import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import { ApiError, getDeviceId, isRetryable, newIdempotencyKey, request, withRetry, wsUrl } from '../lib/api.js';
import { RealtimeConnection } from '../lib/connection.js';
import { ITEM_STATUS, categoryIcon, formatVnd } from '../lib/format.js';

// Đơn chưa gửi được (mất mạng) được giữ trong localStorage cùng Idempotency-Key,
// gửi lại bao nhiêu lần cũng chỉ tạo đúng một đơn.
const pendingKey = (token) => `qrorder.pending.${token}`;
function loadPending(token) {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(token)));
  } catch {
    return null;
  }
}
function savePending(token, value) {
  try {
    if (value) localStorage.setItem(pendingKey(token), JSON.stringify(value));
    else localStorage.removeItem(pendingKey(token));
  } catch {
    /* localStorage bị chặn */
  }
}

/** Gộp một sự kiện vào danh sách đơn (idempotent: áp dụng lại nhiều lần vẫn cho cùng kết quả). */
function applyEvent(orders, msg) {
  const p = msg.payload;
  switch (msg.type) {
    case 'ORDER_CREATED':
      return orders.some((o) => o.id === p.id) ? orders : [...orders, p];
    case 'ITEM_STATUS_CHANGED':
      return orders.map((o) =>
        o.id !== p.orderId
          ? o
          : {
              ...o,
              status: p.orderStatus,
              items: o.items.map((i) =>
                i.id === p.orderItemId && p.version > i.version ? { ...i, status: p.to, version: p.version } : i,
              ),
            },
      );
    case 'ORDER_CANCELLED':
      return orders.map((o) =>
        o.id !== p.orderId ? o : { ...o, status: 'CANCELLED', items: o.items.map((i) => ({ ...i, status: 'CANCELLED' })) },
      );
    default:
      return orders;
  }
}

export default function Customer() {
  const { token } = useParams();
  const [table, setTable] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [menu, setMenu] = useState(null);
  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState({}); // menuItemId -> { qty, note }
  const [orders, setOrders] = useState([]);
  const [conn, setConn] = useState({ status: 'connecting' });
  const [toast, setToast] = useState(null);
  const [showCart, setShowCart] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState(() => loadPending(token));
  const etagRef = useRef(null);

  const notify = useCallback((text) => {
    setToast({ text, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Thực đơn: gửi If-None-Match, server trả 304 nếu không đổi -> tiết kiệm băng thông
  const loadMenu = useCallback(async () => {
    const res = await request('GET', '/api/public/menu', {
      headers: etagRef.current ? { 'If-None-Match': etagRef.current } : {},
    });
    if (res.status === 304) return;
    etagRef.current = res.headers.get('ETag');
    setMenu(res.data);
  }, []);

  const loadOrders = useCallback(async () => {
    const { data } = await request('GET', '/api/orders', { tableToken: token });
    setTable(data.table);
    setOrders(data.orders);
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await request('GET', `/api/public/tables/${encodeURIComponent(token)}`);
        setTable(data);
        await Promise.all([loadMenu(), loadOrders()]);
      } catch (e) {
        setFatal(e instanceof ApiError ? e.message : 'Không tải được dữ liệu');
      }
    })();
  }, [token, loadMenu, loadOrders]);

  // WebSocket:
  //  - /topic/guest.{deviceId}: trạng thái các đơn do CHÍNH máy này đặt (máy khác cùng bàn không nhận được)
  //  - /topic/table.{tableId} : thông báo của bàn (đóng bàn, dọn bàn), không chứa dữ liệu đơn
  const tableId = table?.tableId;
  useEffect(() => {
    if (!tableId) return undefined;
    const deviceId = getDeviceId();
    const connection = new RealtimeConnection({
      url: wsUrl(),
      connectHeaders: { tableToken: token, deviceId },
      onStatus: (status, info) => setConn({ status, info }),
      onConnected: (client) => {
        client.subscribe(`/topic/guest.${deviceId}`, (msg) => {
          setOrders((prev) => applyEvent(prev, msg));
          if (msg.type === 'ITEM_STATUS_CHANGED' && msg.payload.to === 'READY') {
            notify(`🔔 ${msg.payload.name} đã sẵn sàng!`);
          }
        });
        client.subscribe(`/topic/table.${tableId}`, (msg) => {
          if (msg.type === 'TABLE_CLOSED') {
            setTable((t) => (t ? { ...t, open: false } : t));
            notify('Bàn đã được đóng. Vui lòng gọi nhân viên nếu cần gọi thêm.');
          } else if (msg.type === 'TABLE_SESSION_RESET') {
            // Nhân viên đã dọn bàn: phiên cũ kết thúc, danh sách đơn của phiên mới bắt đầu trống
            setOrders([]);
            loadOrders().catch(() => {});
            notify('Bàn đã được dọn, bắt đầu lượt khách mới.');
          }
        });
        client.subscribe('/topic/menu', () => loadMenu().catch(() => {}));
        // Đồng bộ lại toàn bộ sau mỗi lần (re)connect: bù các sự kiện bị lỡ khi mất mạng
        loadOrders().catch(() => {});
        loadMenu().catch(() => {});
      },
    });
    connection.start();
    return () => connection.stop();
  }, [tableId, token, loadMenu, loadOrders, notify]);

  const itemsById = useMemo(() => {
    const map = new Map();
    menu?.categories.forEach((c) => c.items.forEach((i) => map.set(i.id, i)));
    return map;
  }, [menu]);

  const cartLines = Object.entries(cart)
    .map(([id, v]) => ({ item: itemsById.get(Number(id)), ...v }))
    .filter((l) => l.item);
  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cartLines.reduce((s, l) => s + l.qty * l.item.price, 0);

  function changeQty(item, delta) {
    setCart((c) => {
      const qty = (c[item.id]?.qty || 0) + delta;
      const next = { ...c };
      if (qty <= 0) delete next[item.id];
      else next[item.id] = { note: c[item.id]?.note || '', qty: Math.min(qty, 50) };
      return next;
    });
  }

  function changeNote(id, note) {
    setCart((c) => ({ ...c, [id]: { ...c[id], note: note.slice(0, 200) } }));
  }

  async function sendOrder(attempt) {
    setSubmitting(true);
    try {
      const res = await withRetry(
        () =>
          request('POST', '/api/orders', {
            tableToken: token,
            headers: { 'Idempotency-Key': attempt.key },
            body: { items: attempt.items },
          }),
        { onRetry: (e, n) => notify(`Mạng chập chờn, đang gửi lại lần ${n}...`) },
      );
      savePending(token, null);
      setPending(null);
      setOrders((prev) => (prev.some((o) => o.id === res.data.id) ? prev : [...prev, res.data]));
      notify(res.status === 200 ? 'Đơn này đã được ghi nhận trước đó (không tạo trùng)' : '✅ Đã gửi đơn tới bếp!');
      return true;
    } catch (e) {
      if (isRetryable(e)) {
        notify('Chưa gửi được đơn. Bấm "Gửi lại" khi có mạng, đơn sẽ không bị trùng.');
      } else {
        savePending(token, null);
        setPending(null);
        notify(e.message);
        if (e.code === 'ITEM_UNAVAILABLE') loadMenu().catch(() => {});
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCart() {
    const items = cartLines.map((l) => ({ menuItemId: l.item.id, quantity: l.qty, note: l.note || undefined }));
    // Sinh Idempotency-Key MỘT lần cho lần đặt này; mọi lần gửi lại dùng cùng key
    const attempt = { key: newIdempotencyKey(), items, createdAt: Date.now() };
    savePending(token, attempt);
    setPending(attempt);
    setCart({});
    setShowCart(false);
    await sendOrder(attempt);
  }

  async function cancelOrder(order) {
    try {
      const { data } = await request('POST', `/api/orders/${order.id}/cancel`, { tableToken: token });
      setOrders((prev) => prev.map((o) => (o.id === data.id ? data : o)));
      notify(`Đã huỷ đơn #${order.id}`);
    } catch (e) {
      notify(e.message);
    }
  }

  if (fatal) {
    return (
      <div className="center-page">
        <div className="card">
          <h2>😕 {fatal}</h2>
          <p>Vui lòng quét lại mã QR trên bàn hoặc gọi nhân viên.</p>
        </div>
      </div>
    );
  }
  if (!table || !menu) return <div className="center-page">Đang tải thực đơn...</div>;

  const categories = menu.categories.filter((c) => c.items.length > 0);
  const shownCat = categories.find((c) => c.id === activeCat) || categories[0];
  const visibleOrders = [...orders].reverse();

  return (
    <div className="customer">
      <header className="customer-header">
        <div>
          <div className="table-code">Bàn {table.code}</div>
          {!table.open && <div className="error small">Bàn chưa mở, chưa thể gọi món</div>}
        </div>
        <ConnectionBadge status={conn.status} info={conn.info} />
      </header>

      {pending && !submitting && (
        <div className="banner warn">
          Có đơn chưa gửi được ({pending.items.reduce((s, i) => s + i.quantity, 0)} món).
          <button className="btn small primary" onClick={() => sendOrder(pending)}>
            Gửi lại
          </button>
          <button
            className="btn small"
            onClick={() => {
              savePending(token, null);
              setPending(null);
            }}
          >
            Bỏ
          </button>
        </div>
      )}

      <nav className="cat-tabs">
        {categories.map((c) => (
          <button key={c.id} className={c.id === shownCat?.id ? 'active' : ''} onClick={() => setActiveCat(c.id)}>
            {categoryIcon(c.name)} {c.name}
          </button>
        ))}
      </nav>

      <section className="menu-list">
        {shownCat?.items.map((item) => {
          const qty = cart[item.id]?.qty || 0;
          return (
            <div key={item.id} className={`menu-item ${item.available ? '' : 'sold-out'}`}>
              <div className="menu-thumb">{categoryIcon(shownCat.name)}</div>
              <div className="menu-info">
                <div className="menu-name">{item.name}</div>
                {item.description && <div className="menu-desc">{item.description}</div>}
                <div className="menu-price">{formatVnd(item.price)}</div>
              </div>
              {item.available ? (
                <div className="qty">
                  {qty > 0 && (
                    <>
                      <button onClick={() => changeQty(item, -1)}>−</button>
                      <span>{qty}</span>
                    </>
                  )}
                  <button className="add" disabled={!table.open} onClick={() => changeQty(item, 1)}>
                    +
                  </button>
                </div>
              ) : (
                <span className="chip chip-danger">Hết món</span>
              )}
            </div>
          );
        })}
      </section>

      <section className="my-orders">
        <h2>Đơn của bạn ({orders.length})</h2>
        {visibleOrders.length === 0 && <p className="hint">Bạn chưa đặt đơn nào trong lượt này.</p>}
        {visibleOrders.map((o) => (
          <div key={o.id} className="order-card">
            <div className="order-head">
              <strong>Đơn #{o.id}</strong>
              <span>{new Date(o.createdAt).toLocaleTimeString('vi-VN')}</span>
              <span className="order-total">{formatVnd(o.total)}</span>
            </div>
            {o.items.map((i) => (
              <div key={i.id} className="order-line">
                <span>
                  {i.quantity}× {i.name}
                  {i.note && <em className="note"> ({i.note})</em>}
                </span>
                <span className={`chip chip-${ITEM_STATUS[i.status]?.tone}`}>{ITEM_STATUS[i.status]?.label}</span>
              </div>
            ))}
            {o.items.every((i) => i.status === 'PENDING') && (
              <button className="btn small danger" onClick={() => cancelOrder(o)}>
                Huỷ đơn
              </button>
            )}
          </div>
        ))}
      </section>

      {cartCount > 0 && (
        <button className="cart-bar" onClick={() => setShowCart(true)}>
          <span>🛒 {cartCount} món</span>
          <strong>{formatVnd(cartTotal)}</strong>
          <span>Xem giỏ ›</span>
        </button>
      )}

      {showCart && (
        <div className="modal-backdrop" onClick={() => setShowCart(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Giỏ hàng – Bàn {table.code}</h2>
            {cartLines.map((l) => (
              <div key={l.item.id} className="cart-line">
                <div className="cart-line-top">
                  <span>{l.item.name}</span>
                  <div className="qty">
                    <button onClick={() => changeQty(l.item, -1)}>−</button>
                    <span>{l.qty}</span>
                    <button onClick={() => changeQty(l.item, 1)}>+</button>
                  </div>
                  <span>{formatVnd(l.qty * l.item.price)}</span>
                </div>
                <input
                  placeholder="Ghi chú (VD: ít cay, không hành)"
                  value={l.note}
                  onChange={(e) => changeNote(l.item.id, e.target.value)}
                />
              </div>
            ))}
            <div className="cart-total">
              Tổng cộng: <strong>{formatVnd(cartTotal)}</strong>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowCart(false)}>
                Chọn thêm
              </button>
              <button className="btn primary" disabled={submitting || !!pending || !table.open} onClick={submitCart}>
                {submitting ? 'Đang gửi...' : 'Đặt món'}
              </button>
            </div>
            {pending && <p className="hint">Hãy gửi lại hoặc bỏ đơn đang chờ trước khi đặt đơn mới.</p>}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast.text}</div>}
    </div>
  );
}
