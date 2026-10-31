import { useCallback, useEffect, useReducer, useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import Icon from '../components/Icon.jsx';
import Login from '../components/Login.jsx';
import { ApiError, getStaffSession, request, setStaffSession, wsUrl } from '../lib/api.js';
import { ITEM_STATUS, VOID_REASON, categoryIcon, mergeOrder, minutesSince, since } from '../lib/format.js';
import { KitchenFeed } from '../lib/kitchenFeed.js';

const NEXT_ACTIONS = {
  PENDING: [
    { to: 'ACCEPTED', label: 'Tiếp nhận', kind: 'primary', icon: 'check' },
    { to: 'CANCELLED', label: 'Từ chối', kind: 'danger', icon: 'x' },
  ],
  ACCEPTED: [{ to: 'SERVED', label: 'Đã phục vụ', kind: 'ok', icon: 'checkCircle' }],
};

/** Trạng thái màn hình bếp: Map orderId -> order. Mọi thao tác đều idempotent. */
function reducer(state, action) {
  switch (action.type) {
    case 'reset':
      return new Map(action.orders.map((o) => [o.id, o]));
    case 'event': {
      const { type, payload: p } = action.env;
      const next = new Map(state);
      if (type === 'ORDER_CREATED') {
        if (!next.has(p.id)) next.set(p.id, p);
      } else if (type === 'ITEM_STATUS_CHANGED') {
        const o = next.get(p.orderId);
        if (o) {
          next.set(o.id, {
            ...o,
            status: p.orderStatus,
            items: o.items.map((i) =>
              i.id === p.orderItemId && p.version > i.version ? { ...i, status: p.to, version: p.version } : i,
            ),
          });
        }
      } else if (type === 'ORDER_CANCELLED') {
        const o = next.get(p.orderId);
        if (o) next.set(o.id, { ...o, status: 'CANCELLED', items: o.items.map((i) => ({ ...i, status: 'CANCELLED' })) });
      } else if (type === 'ORDER_UPDATED') {
        next.set(p.order.id, mergeOrder(next.get(p.order.id), p.order));
      }
      return next;
    }
    case 'orderUpdated':
      return new Map(state).set(action.order.id, mergeOrder(state.get(action.order.id), action.order));
    case 'itemUpdated': {
      const it = action.item;
      const o = state.get(it.orderId);
      if (!o) return state;
      const next = new Map(state);
      next.set(o.id, { ...o, items: o.items.map((i) => (i.id === it.id && it.version > i.version ? it : i)) });
      return next;
    }
    default:
      return state;
  }
}

/** Cột của từng món (không theo cả đơn): một đơn có thể nằm ở cả hai cột, mỗi cột chỉ hiện các món thuộc cột đó. */
function itemColumn(item) {
  if (item.status === 'PENDING') return 'new';
  if (item.status === 'ACCEPTED') return 'accepted';
  return null;
}

export default function Kitchen() {
  // Phiên đăng nhập dùng chung giữa các trang nhân viên: chỉ nhận nếu đúng vai trò
  const [session, setSession] = useState(() => {
    const s = getStaffSession();
    return s && ['KITCHEN', 'ADMIN'].includes(s.role) ? s : null;
  });
  const logout = useCallback(() => {
    setStaffSession(null);
    setSession(null);
  }, []);
  if (!session) {
    return <Login title="Đăng nhập bếp" icon="chef" allowedRoles={['KITCHEN', 'ADMIN']} onLogin={setSession} hint="Tài khoản mẫu: bep / bep123" />;
  }
  return <KitchenBoard session={session} onLogout={logout} />;
}

function Thumb({ src, fallback }) {
  return src ? <img src={src} alt="" loading="lazy" /> : <span className="noimg"><Icon name={fallback || 'bowl'} /></span>;
}

function KitchenBoard({ session, onLogout }) {
  const [orders, dispatch] = useReducer(reducer, new Map());
  const [conn, setConn] = useState({ status: 'connecting' });
  const [toast, setToast] = useState(null);
  const [configChanged, setConfigChanged] = useState(false);
  const [voiding, setVoiding] = useState(null); // { item?, order, returned?, whole? } đang mở hộp thoại huỷ
  const [view, setView] = useState('board');
  const [servedKey, setServedKey] = useState(0); // tăng để tải lại danh sách món đã phục vụ
  const [images, setImages] = useState({}); // menuItemId -> { url, icon }
  const [now, setNow] = useState(Date.now());
  const token = session.token;

  const loadSnapshot = useCallback(async () => {
    const { data } = await request('GET', '/api/kitchen/orders', { token });
    dispatch({ type: 'reset', orders: data.orders });
    return data;
  }, [token]);

  useEffect(() => {
    let feed;
    let cancelled = false;
    (async () => {
      try {
        const { data: cfg } = await request('GET', '/api/public/config');
        const snapshot = await loadSnapshot();
        if (cancelled) return;
        feed = new KitchenFeed({
          mode: cfg.deliveryMode,
          wsUrl: wsUrl(),
          token,
          pollingIntervalMs: cfg.pollingIntervalMs,
          heartbeatMs: cfg.heartbeatMs,
          fetchEvents: async (afterSeq) => (await request('GET', `/api/kitchen/events?afterSeq=${afterSeq}`, { token })).data,
          onEvent: (env) => dispatch({ type: 'event', env }),
          onStatus: (status, info) => setConn({ status, info }),
          onControl: (msg) => msg?.type === 'CONFIG_CHANGED' && setConfigChanged(true),
        });
        // Bắt đầu nghe từ latestSeq của ảnh chụp ban đầu -> RESUME sẽ bù các sự kiện xảy ra sau đó
        feed.start(snapshot.latestSeq);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onLogout();
        else setConn({ status: 'error', info: { message: e.message } });
      }
    })();
    request('GET', '/api/public/menu')
      .then(({ data }) => {
        const m = {};
        data.categories.forEach((c) => c.items.forEach((i) => { m[i.id] = { url: i.imageUrl, icon: categoryIcon(c.name) }; }));
        setImages(m);
      })
      .catch(() => {});
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled = true;
      clearInterval(clock);
      feed?.stop();
    };
  }, [token, loadSnapshot, onLogout]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function fail(e) {
    setToast(e.message);
    if (e.code === 'VERSION_CONFLICT' || e.code === 'INVALID_STATE_TRANSITION') loadSnapshot().catch(() => {});
    if (e.status === 401) onLogout();
  }

  async function advance(item, to) {
    try {
      const { data } = await request('PATCH', `/api/kitchen/order-items/${item.id}/status`, { token, body: { status: to, version: item.version } });
      dispatch({ type: 'itemUpdated', item: data });
    } catch (e) {
      fail(e);
    }
  }

  // Huỷ / trả lại một món, hoặc huỷ cả đơn: trả về true nếu thành công
  async function submitVoid({ item, order, whole }, { quantity, reason, note }) {
    try {
      const { data } = whole
        ? await request('POST', `/api/kitchen/orders/${order.id}/cancel`, { token, body: { reason, note } })
        : await request('POST', `/api/kitchen/order-items/${item.id}/void`, { token, body: { quantity, reason, note, version: item.version } });
      dispatch({ type: 'orderUpdated', order: data });
      setToast(whole ? `Đã huỷ đơn #${order.id}` : `Đã ${reason === 'RETURNED' ? 'ghi nhận trả lại' : 'huỷ'} ${quantity}× ${item.name}`);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function acceptAll(order) {
    for (const item of order.items.filter((i) => i.status === 'PENDING')) {
      await advance(item, 'ACCEPTED');
    }
  }

  const visible = [...orders.values()].sort((a, b) => a.createdAt - b.createdAt);
  const ticketsFor = (key) =>
    visible
      .map((o) => ({ ...o, all: o.items, items: o.items.filter((i) => itemColumn(i) === key) }))
      .filter((o) => o.items.length > 0);
  const columns = [
    { key: 'new', title: 'Chưa tiếp nhận', orders: ticketsFor('new') },
    { key: 'accepted', title: 'Đã tiếp nhận', orders: ticketsFor('accepted') },
  ];
  const pendingCount = columns[0].orders.reduce((s, o) => s + o.items.length, 0);

  return (
    <AppShell
      area="Khu bếp"
      session={session}
      onLogout={onLogout}
      active={view}
      onNav={setView}
      nav={[
        { key: 'board', label: 'Bảng đơn', icon: 'chef', count: pendingCount },
        { key: 'served', label: 'Món đã phục vụ', icon: 'checkCircle' },
      ]}
      title={view === 'board' ? 'Bảng đơn bếp' : 'Món đã phục vụ'}
      actions={<ConnectionBadge status={conn.status} info={conn.info} />}
    >
      {configChanged && (
        <div className="banner warn">
          <Icon name="refresh" /> Cấu hình giao đơn đã thay đổi.
          <button className="btn small primary" onClick={() => window.location.reload()}>Tải lại</button>
        </div>
      )}

      {view === 'board' && (
        <div className="kds">
          {columns.map((col) => (
            <section key={col.key} className={`kds-col ${col.key}`}>
              <header>
                <span className="dot" />
                <h2>{col.title}</h2>
                <span className="count">{col.orders.length}</span>
              </header>
              {col.orders.length === 0 && (
                <div className="empty"><Icon name={col.key === 'new' ? 'bell' : 'flame'} />{col.key === 'new' ? 'Chưa có đơn mới' : 'Không có món đang làm'}</div>
              )}
              <div className="kds-list">
                {col.orders.map((o) => {
                  const age = minutesSince(o.createdAt, now);
                  const others = o.all.filter((i) => itemColumn(i) && itemColumn(i) !== col.key).length;
                  const active = o.all.filter((i) => itemColumn(i)).length;
                  return (
                    <article key={o.id} className={`ticket ${age >= 15 ? 'late' : ''}`}>
                      <div className="ticket-head">
                        <strong className="ticket-table">{o.tableCode}</strong>
                        <span className="chip">#{o.id}</span>
                        {o.guestName && <span className="hint">{o.guestName}</span>}
                        {o.firstInSession && <span className="chip chip-gold" title="Đơn đầu tiên của lượt khách mới">Bàn mới</span>}
                        <span className={`chip age ${age >= 15 ? 'chip-danger' : ''}`}><Icon name="clock" />{since(o.createdAt, now)}</span>
                      </div>
                      {o.items.map((i) => (
                        <div key={i.id} className="ticket-item">
                          <Thumb src={images[i.menuItemId]?.url} fallback={images[i.menuItemId]?.icon} />
                          <div className="nm">
                            <b>{i.quantity}×</b>{i.name}
                            {i.note && <div className="note"><Icon name="edit" size={13} />{i.note}</div>}
                          </div>
                          <div className="acts">
                            {(NEXT_ACTIONS[i.status] || []).map((a) => (
                              <button key={a.to} className={`btn small ${a.kind}`} onClick={() => advance(i, a.to)}>
                                <Icon name={a.icon} size={15} />{a.label}
                              </button>
                            ))}
                            {i.status === 'ACCEPTED' && (
                              <button className="btn small danger icon-only" title="Huỷ món đã nhận" onClick={() => setVoiding({ item: i, order: o })}>
                                <Icon name="trash" size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {others > 0 && (
                        <div className="ticket-more">
                          <Icon name="info" />
                          {col.key === 'new' ? `${others} món khác của đơn đã được tiếp nhận` : `Còn ${others} món của đơn chưa tiếp nhận`}
                        </div>
                      )}
                      <div className="ticket-foot">
                        {o.items.filter((i) => i.status === 'PENDING').length > 1 && (
                          <button className="btn small primary" onClick={() => acceptAll(o)}><Icon name="check" size={15} />Tiếp nhận cả đơn</button>
                        )}
                        {active > 1 && (
                          <button className="btn small danger" onClick={() => setVoiding({ order: o, whole: true })}><Icon name="x" size={15} />Huỷ cả đơn</button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {view === 'served' && (
        <ServedItems token={token} images={images} onReturn={(item, order) => setVoiding({ item, order, returned: true })} refreshKey={servedKey} />
      )}

      {voiding && (
        <VoidDialog
          {...voiding}
          onClose={() => setVoiding(null)}
          onSubmit={async (form) => {
            if (await submitVoid(voiding, form)) {
              setVoiding(null);
              setServedKey((k) => k + 1);
            }
          }}
        />
      )}

      {toast && <div className="toast"><Icon name="info" />{toast}</div>}
    </AppShell>
  );
}

/** Hộp thoại huỷ: một món (chọn số suất), khách trả lại, hoặc cả đơn. Lý do bắt buộc. */
function VoidDialog({ item, order, returned, whole, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState(returned ? 'RETURNED' : 'OUT_OF_STOCK');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const reasons = Object.entries(VOID_REASON).filter(([k]) => (returned ? true : k !== 'RETURNED'));
  const noteMissing = reason === 'OTHER' && !note.trim();

  async function submit() {
    setBusy(true);
    await onSubmit({ quantity, reason, note: note.trim() || null });
    setBusy(false);
  }

  const title = whole ? `Huỷ cả đơn #${order.id}` : returned ? 'Khách trả lại món' : 'Huỷ món đã nhận';
  return (
    <div className="modal-backdrop center" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            <p className="hint">
              Bàn <strong>{order.tableCode}</strong> · đơn #{order.id}
              {whole ? ` · ${(order.all || order.items).filter((i) => itemColumn(i)).length} món chưa phục vụ` : ` · ${item.quantity}× ${item.name} (${ITEM_STATUS[item.status]?.label})`}
            </p>
          </div>
          <span className="spacer" />
          <button className="btn ghost small icon-only" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          {!whole && item.quantity > 1 && (
            <div className="row">
              <span className="field">Số suất huỷ</span>
              <span className="stepper">
                <button className="btn small icon-only" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}><Icon name="minus" size={15} /></button>
                <strong>{quantity}</strong>
                <button className="btn small icon-only" disabled={quantity >= item.quantity} onClick={() => setQuantity(quantity + 1)}><Icon name="plus" size={15} /></button>
                <span className="hint">/ {item.quantity} suất</span>
              </span>
            </div>
          )}
          <div className="reason-grid">
            {reasons.map(([k, label]) => (
              <label key={k} className="reason">
                <input type="radio" name="void-reason" checked={reason === k} onChange={() => setReason(k)} /> {label}
              </label>
            ))}
          </div>
          <label className="field">
            Ghi chú {reason === 'OTHER' ? '(bắt buộc)' : '(không bắt buộc)'}
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="hint">Món huỷ không tính tiền và được trả lại tồn kho. Bàn đã thanh toán thì thu ngân sẽ thấy số tiền cần trả lại khách.</p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Đóng</button>
          <button className="btn danger solid" disabled={busy || noteMissing} onClick={submit}>
            {whole ? 'Huỷ cả đơn' : `${returned ? 'Ghi nhận trả lại' : 'Huỷ'} ${quantity} suất`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Món đã phục vụ của các bàn đang có khách: bếp chọn món khách trả lại. */
function ServedItems({ token, images, onReturn, refreshKey }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    request('GET', '/api/kitchen/served-orders', { token })
      .then(({ data }) => setOrders(data))
      .catch((e) => setError(e.message));
  }, [token, refreshKey]);

  if (error) return <div className="banner danger"><Icon name="alert" />{error}</div>;
  if (!orders) return <div className="skeleton" style={{ height: 200 }} />;
  if (orders.length === 0) return <div className="card empty"><Icon name="checkCircle" />Chưa có món nào đã phục vụ ở các bàn đang có khách.</div>;
  return (
    <div className="kds-list stagger">
      {orders.map((o) => (
        <article key={o.id} className="ticket">
          <div className="ticket-head">
            <strong className="ticket-table">{o.tableCode}</strong>
            <span className="chip">#{o.id}</span>
            {o.guestName && <span className="hint">{o.guestName}</span>}
          </div>
          {o.items.filter((i) => i.status === 'SERVED').map((i) => (
            <div key={i.id} className="ticket-item">
              <Thumb src={images[i.menuItemId]?.url} fallback={images[i.menuItemId]?.icon} />
              <div className="nm"><b>{i.quantity}×</b>{i.name}</div>
              <button className="btn small danger" onClick={() => onReturn(i, o)}><Icon name="undo" size={15} />Trả lại</button>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
