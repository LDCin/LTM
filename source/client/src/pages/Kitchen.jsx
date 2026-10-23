import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import Login from '../components/Login.jsx';
import TableSessionPanel from '../components/TableSessionPanel.jsx';
import { ApiError, getStaffSession, request, setStaffSession, wsUrl } from '../lib/api.js';
import { ITEM_STATUS, minutesSince } from '../lib/format.js';
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
      }
      return next;
    }
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

function column(order) {
  const active = order.items.filter((i) => !['SERVED', 'CANCELLED'].includes(i.status));
  if (active.length === 0) return null;
  if (active.some((i) => i.status === 'PENDING')) return 'new';
  if (active.some((i) => i.status === 'ACCEPTED' || i.status === 'COOKING')) return 'cooking';
  return 'ready';
}

export default function Kitchen() {
  const [session, setSession] = useState(() => getStaffSession());
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
  const [stats, setStats] = useState(null);
  const [station, setStation] = useState('ALL');
  const [toast, setToast] = useState(null);
  const [configChanged, setConfigChanged] = useState(false);
  const [showTables, setShowTables] = useState(false);
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
    const statsTimer = setInterval(() => {
      const f = feedRef.current;
      if (f) setStats({ ...f.stats, watermark: f.watermark, transport: f.transportStats && { ...f.transportStats } });
      setNow(Date.now());
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(statsTimer);
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

  async function acceptAll(order) {
    for (const item of order.items.filter((i) => i.status === 'PENDING')) {
      await advance(item, 'ACCEPTED');
    }
  }

  const visible = [...orders.values()]
    .map((o) => ({
      ...o,
      items: station === 'ALL' ? o.items : o.items.filter((i) => i.station === station),
    }))
    .filter((o) => o.items.length > 0 && column(o))
    .sort((a, b) => a.createdAt - b.createdAt);

  const columns = [
    { key: 'new', title: '🆕 Mới', orders: visible.filter((o) => column(o) === 'new') },
    { key: 'cooking', title: '🔥 Đang làm', orders: visible.filter((o) => column(o) === 'cooking') },
    { key: 'ready', title: '✅ Sẵn sàng', orders: visible.filter((o) => column(o) === 'ready') },
  ];

  return (
    <div className="kitchen">
      <header className="kitchen-header">
        <h1>👨‍🍳 Màn hình bếp</h1>
        <div className="station-tabs">
          {[
            ['ALL', 'Tất cả'],
            ['KITCHEN', 'Bếp'],
            ['BAR', 'Quầy nước'],
          ].map(([key, label]) => (
            <button key={key} className={station === key ? 'active' : ''} onClick={() => setStation(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="kitchen-meta">
          <span className="chip chip-info">Chế độ: {mode || '...'}</span>
          <ConnectionBadge status={conn.status} info={conn.info} />
          {mode !== 'POLLING' && (
            <button className="btn small" onClick={() => feedRef.current?.simulateOutage(5000)}>
              Giả lập mất mạng 5s
            </button>
          )}
          <button className="btn small" onClick={() => setShowTables(true)}>
            🪑 Dọn bàn
          </button>
          <span className="user">{session.username}</span>
          <button className="btn small" onClick={onLogout}>
            Đăng xuất
          </button>
        </div>
      </header>

      {showTables && <TableSessionPanel token={token} onClose={() => setShowTables(false)} onMessage={setToast} />}

      {configChanged && (
        <div className="banner warn">
          Cấu hình giao đơn đã thay đổi.{' '}
          <button className="btn small primary" onClick={() => window.location.reload()}>
            Tải lại
          </button>
        </div>
      )}

      {stats && (
        <div className="feed-stats">
          <span>Đã nhận: {stats.received}</span>
          <span>Watermark seq: {stats.watermark}</span>
          <span>Trùng bị loại: {stats.duplicates}</span>
          <span>Phát hiện thiếu: {stats.gaps}</span>
          <span>RESUME: {stats.resumes}</span>
          <span>Gửi bù: {stats.replayed}</span>
          {mode === 'POLLING' && <span>Số lần poll: {stats.polls}</span>}
          {stats.transport && <span>Nhận: {(stats.transport.bytesIn / 1024).toFixed(1)} KB</span>}
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
                      </div>
                    </div>
                  ))}
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
