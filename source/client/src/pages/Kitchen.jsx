import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import Login from '../components/Login.jsx';
import { ApiError, getStaffSession, request, setStaffSession, wsUrl } from '../lib/api.js';
import { ITEM_STATUS, VOID_REASON, mergeOrder, minutesSince } from '../lib/format.js';
import { KitchenFeed } from '../lib/kitchenFeed.js';

const NEXT_ACTIONS = {
  PENDING: [
    { to: 'ACCEPTED', label: 'Nhận', kind: 'primary' },
    { to: 'CANCELLED', label: 'Từ chối', kind: 'danger' },
  ],
  ACCEPTED: [{ to: 'COOKING', label: 'Bắt đầu nấu', kind: 'primary' }],
  COOKING: [{ to: 'READY', label: 'Xong', kind: 'ok' }],
  READY: [{ to: 'SERVED', label: 'Đã phục vụ', kind: '' }],
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

/** Cột của từng món (không theo cả đơn): một đơn có thể nằm ở nhiều cột, mỗi cột chỉ hiện các món thuộc cột đó. */
function itemColumn(item) {
  if (item.status === 'PENDING') return 'new';
  if (item.status === 'ACCEPTED' || item.status === 'COOKING') return 'cooking';
  if (item.status === 'READY') return 'ready';
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
    return (
      <Login
        title="👨‍🍳 Đăng nhập bếp"
        allowedRoles={['KITCHEN', 'ADMIN']}
        onLogin={setSession}
        hint="Tài khoản mẫu: bep / bep123"
      />
    );
  }
  return <KitchenBoard session={session} onLogout={logout} />;
}

function KitchenBoard({ session, onLogout }) {
  const [orders, dispatch] = useReducer(reducer, new Map());
  const [conn, setConn] = useState({ status: 'connecting' });
  const [mode, setMode] = useState(null);
  const [toast, setToast] = useState(null);
  const [configChanged, setConfigChanged] = useState(false);
  const [voiding, setVoiding] = useState(null); // { item, order, returned } đang mở hộp thoại huỷ / trả lại
  const [showServed, setShowServed] = useState(false);
  const [servedKey, setServedKey] = useState(0); // tăng để tải lại danh sách món đã phục vụ
  const [now, setNow] = useState(Date.now());
  const feedRef = useRef(null);
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
        setMode(cfg.deliveryMode);
        feed = new KitchenFeed({
          mode: cfg.deliveryMode,
          wsUrl: wsUrl(),
          token,
          pollingIntervalMs: cfg.pollingIntervalMs,
          heartbeatMs: cfg.heartbeatMs,
          fetchEvents: async (afterSeq) =>
            (await request('GET', `/api/kitchen/events?afterSeq=${afterSeq}`, { token })).data,
          onEvent: (env) => dispatch({ type: 'event', env }),
          onStatus: (status, info) => setConn({ status, info }),
          onControl: (msg) => msg?.type === 'CONFIG_CHANGED' && setConfigChanged(true),
        });
        feedRef.current = feed;
        // Bắt đầu nghe từ latestSeq của ảnh chụp ban đầu -> RESUME sẽ bù các sự kiện xảy ra sau đó
        feed.start(snapshot.latestSeq);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onLogout();
        else setConn({ status: 'error', info: { message: e.message } });
      }
    })();
    // Cập nhật số phút chờ trên thẻ món
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

  async function advance(item, to) {
    try {
      const { data } = await request('PATCH', `/api/kitchen/order-items/${item.id}/status`, {
        token,
        body: { status: to, version: item.version },
      });
      dispatch({ type: 'itemUpdated', item: data });
    } catch (e) {
      setToast(e.message);
      if (e.code === 'VERSION_CONFLICT' || e.code === 'INVALID_STATE_TRANSITION') loadSnapshot().catch(() => {});
      if (e.status === 401) onLogout();
    }
  }

  // Huỷ / trả lại món đã nhận: dialog hỏi số suất và lý do; trả về true nếu thành công
  async function voidItem(item, { quantity, reason, note }) {
    try {
      const { data } = await request('POST', `/api/kitchen/order-items/${item.id}/void`, {
        token,
        body: { quantity, reason, note, version: item.version },
      });
      dispatch({ type: 'orderUpdated', order: data });
      setToast(`Đã ${reason === 'RETURNED' ? 'ghi nhận trả lại' : 'huỷ'} ${quantity}× ${item.name}`);
      return true;
    } catch (e) {
      setToast(e.message);
      if (e.code === 'VERSION_CONFLICT' || e.code === 'INVALID_STATE_TRANSITION') loadSnapshot().catch(() => {});
      if (e.status === 401) onLogout();
      return false;
    }
  }

  async function acceptAll(order) {
    for (const item of order.items.filter((i) => i.status === 'PENDING')) {
      await advance(item, 'ACCEPTED');
    }
  }

  const visible = [...orders.values()].sort((a, b) => a.createdAt - b.createdAt);

  // Mỗi cột nhận phần đơn gồm các món đang ở trạng thái của cột; otherCount = số món chưa xong đang ở cột khác
  const ticketsFor = (key) =>
    visible
      .map((o) => {
        const items = o.items.filter((i) => itemColumn(i) === key);
        const otherCount = o.items.filter((i) => itemColumn(i) && itemColumn(i) !== key).length;
        return { ...o, items, otherCount };
      })
      .filter((o) => o.items.length > 0);

  const columns = [
    { key: 'new', title: '🆕 Mới', orders: ticketsFor('new') },
    { key: 'cooking', title: '🔥 Đang làm', orders: ticketsFor('cooking') },
    { key: 'ready', title: '✅ Sẵn sàng', orders: ticketsFor('ready') },
  ];

  return (
    <div className="kitchen">
      <header className="kitchen-header">
        <h1>👨‍🍳 Màn hình bếp</h1>
        <div className="kitchen-meta">
          <span className="chip chip-info">Chế độ: {mode || '...'}</span>
          <ConnectionBadge status={conn.status} info={conn.info} />
          {mode !== 'POLLING' && (
            <button className="btn small" onClick={() => feedRef.current?.simulateOutage(5000)}>
              Giả lập mất mạng 5s
            </button>
          )}
          <button className="btn small" onClick={() => setShowServed(true)}>
            🍽 Món đã phục vụ
          </button>
          <span className="user">{session.username}</span>
          <button className="btn small" onClick={onLogout}>
            Đăng xuất
          </button>
        </div>
      </header>

      {configChanged && (
        <div className="banner warn">
          Cấu hình giao đơn đã thay đổi.{' '}
          <button className="btn small primary" onClick={() => window.location.reload()}>
            Tải lại
          </button>
        </div>
      )}

      <div className="board">
        {columns.map((col) => (
          <section key={col.key} className={`board-col col-${col.key}`}>
            <h2>
              {col.title} <span className="count">{col.orders.length}</span>
            </h2>
            {col.orders.map((o) => {
              const age = minutesSince(o.createdAt, now);
              return (
                <div key={o.id} className={`ticket ${age >= 15 ? 'late' : ''}`}>
                  <div className="ticket-head">
                    <strong className="ticket-table">{o.tableCode}</strong>
                    <span>#{o.id}</span>
                    {o.guestName && <span className="guest">· {o.guestName}</span>}
                    {o.firstInSession && <span className="chip chip-warn" title="Đơn đầu tiên của lượt khách mới: kiểm tra bàn có khách thật">Bàn mới mở</span>}
                    <span className="age">{age} phút</span>
                  </div>
                  {o.items.map((i) => (
                    <div key={i.id} className={`ticket-item status-${i.status}`}>
                      <div className="ticket-item-name">
                        <b>{i.quantity}×</b> {i.name}
                        {i.note && <div className="note">📝 {i.note}</div>}
                      </div>
                      <div className="ticket-actions">
                        <span className={`chip chip-${ITEM_STATUS[i.status]?.tone}`}>{ITEM_STATUS[i.status]?.short}</span>
                        {(NEXT_ACTIONS[i.status] || []).map((a) => (
                          <button key={a.to} className={`btn small ${a.kind}`} onClick={() => advance(i, a.to)}>
                            {a.label}
                          </button>
                        ))}
                        {i.status !== 'PENDING' && (
                          <button className="btn small danger" title="Huỷ món đã nhận" onClick={() => setVoiding({ item: i, order: o })}>
                            Huỷ
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {o.otherCount > 0 && <div className="ticket-more">+{o.otherCount} món của đơn này ở cột khác</div>}
                  {o.items.filter((i) => i.status === 'PENDING').length > 1 && (
                    <button className="btn small primary block" onClick={() => acceptAll(o)}>
                      Nhận cả đơn
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {showServed && (
        <ServedItems
          token={token}
          onClose={() => setShowServed(false)}
          onReturn={(item, order) => setVoiding({ item, order, returned: true })}
          refreshKey={servedKey}
        />
      )}

      {voiding && (
        <VoidDialog
          {...voiding}
          onClose={() => setVoiding(null)}
          onSubmit={async (form) => {
            if (await voidItem(voiding.item, form)) {
              setVoiding(null);
              setServedKey((k) => k + 1);
            }
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** Hộp thoại huỷ / trả lại món: chọn số suất (nếu dòng có nhiều suất), lý do bắt buộc, ghi chú. */
function VoidDialog({ item, order, returned, onClose, onSubmit }) {
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

  return (
    <div className="modal-backdrop center" onClick={onClose}>
      <div className="modal panel void-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{returned ? '↩ Khách trả lại món' : '❌ Huỷ món đã nhận'}</h3>
        <p>
          Bàn <strong>{order.tableCode}</strong> · đơn #{order.id} · <strong>{item.quantity}× {item.name}</strong> (
          {ITEM_STATUS[item.status]?.label})
        </p>
        {item.quantity > 1 && (
          <label>
            Số suất huỷ
            <div className="qty-row">
              <button className="btn small" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>−</button>
              <strong>{quantity}</strong>
              <button className="btn small" disabled={quantity >= item.quantity} onClick={() => setQuantity(quantity + 1)}>+</button>
              <span className="hint">/ {item.quantity} suất</span>
            </div>
          </label>
        )}
        <div className="void-reasons">
          {reasons.map(([k, label]) => (
            <label key={k} className="radio">
              <input type="radio" name="void-reason" checked={reason === k} onChange={() => setReason(k)} /> {label}
            </label>
          ))}
        </div>
        <label>
          Ghi chú {reason === 'OTHER' ? '(bắt buộc)' : '(không bắt buộc)'}
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="hint">
          Món huỷ không tính tiền{item.status === 'ACCEPTED' ? ', số suất được trả lại tồn kho' : ''}. Bàn đã thanh toán thì thu
          ngân sẽ thấy số tiền cần trả lại khách.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Đóng</button>
          <button className="btn danger" disabled={busy || noteMissing} onClick={submit}>
            {returned ? 'Ghi nhận trả lại' : 'Huỷ'} {quantity} suất
          </button>
        </div>
      </div>
    </div>
  );
}

/** Món đã phục vụ của các bàn đang có khách: bếp chọn món khách trả lại. */
function ServedItems({ token, onClose, onReturn, refreshKey }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    request('GET', '/api/kitchen/served-orders', { token })
      .then(({ data }) => setOrders(data))
      .catch((e) => setError(e.message));
  }, [token, refreshKey]);

  return (
    <div className="modal-backdrop center" onClick={onClose}>
      <div className="modal panel served-list" onClick={(e) => e.stopPropagation()}>
        <h3>🍽 Món đã phục vụ (bàn đang có khách)</h3>
        {error && <p className="hint">{error}</p>}
        {!orders && !error && <p>Đang tải...</p>}
        {orders && orders.length === 0 && <p className="hint">Chưa có món nào đã phục vụ.</p>}
        {orders?.map((o) => (
          <div key={o.id} className="served-order">
            <div className="ticket-head">
              <strong className="ticket-table">{o.tableCode}</strong>
              <span>#{o.id}</span>
              {o.guestName && <span className="guest">· {o.guestName}</span>}
            </div>
            {o.items
              .filter((i) => i.status === 'SERVED')
              .map((i) => (
                <div key={i.id} className="ticket-item">
                  <div className="ticket-item-name">
                    <b>{i.quantity}×</b> {i.name}
                  </div>
                  <button className="btn small danger" onClick={() => onReturn(i, o)}>
                    Khách trả lại
                  </button>
                </div>
              ))}
          </div>
        ))}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
