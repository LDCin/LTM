import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import { ApiError, isRetryable, newIdempotencyKey, request, withRetry, wsUrl } from '../lib/api.js';
import { RealtimeConnection } from '../lib/connection.js';
import { ITEM_STATUS, VOID_REASON, categoryIcon, formatVnd, mergeOrder } from '../lib/format.js';

// ------------------------------------------------------------------ lưu trên trình duyệt

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function writeJson(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* localStorage bị chặn */
  }
}

// Đơn chưa gửi được (mất mạng) được giữ cùng Idempotency-Key: gửi lại bao nhiêu lần cũng chỉ tạo một đơn.
const pendingKey = (token) => `qrorder.pending.${token}`;
// Tên khách nhớ theo PHIÊN: sang lượt khách mới (phiên khác) thì hỏi lại.
const guestKey = (token) => `qrorder.guest.${token}`;

const METHOD_LABEL = { CASH: 'Tiền mặt tại quầy', VNPAY: 'VNPay' };

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
    case 'ORDER_UPDATED': // bếp huỷ / khách trả lại món: payload.order là bản đơn mới nhất
      return orders.map((o) => (o.id === p.order.id ? mergeOrder(o, p.order) : o));
    default:
      return orders;
  }
}

function randomGuestName() {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `Khách ${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export default function Customer() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | closed | ended | ready
  const [fatal, setFatal] = useState(null);
  const [session, setSession] = useState(null); // { tableId, code, sessionId }
  const [guestName, setGuestName] = useState(null);
  const [askName, setAskName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [menu, setMenu] = useState(null);
  const [methods, setMethods] = useState(['CASH']);
  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState({}); // menuItemId -> { qty, note }
  const [orders, setOrders] = useState([]);
  const [mineIds, setMineIds] = useState(() => new Set());
  const [bill, setBill] = useState(null);
  const [conn, setConn] = useState({ status: 'connecting' });
  const [toast, setToast] = useState(null);
  const [showCart, setShowCart] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [serviceCall, setServiceCall] = useState(null); // lượt gọi phục vụ đang chờ nhân viên
  const [calling, setCalling] = useState(false);
  const [pending, setPending] = useState(() => readJson(pendingKey(token)));
  const etagRef = useRef(null);
  const payKeyRef = useRef(null); // Idempotency-Key của lần bấm "Thanh toán" đang xử lý

  const notify = useCallback((text) => setToast({ text, at: Date.now() }), []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const sessionId = session?.sessionId;
  const tableId = session?.tableId;

  // Lượt khách đã kết thúc (thu ngân trả bàn): dừng lại, KHÔNG tự vào lại (tránh mở phiên mới khi khách đã về)
  const handleEnded = useCallback(() => {
    setPhase('ended');
    setOrders([]);
    setBill(null);
    setShowCart(false);
    setShowPay(false);
  }, []);

  const handleError = useCallback(
    (e) => {
      if (e instanceof ApiError && e.code === 'SESSION_ENDED') handleEnded();
      else if (e instanceof ApiError && e.code === 'TABLE_CLOSED') setPhase('closed');
      else notify(e.message);
    },
    [handleEnded, notify],
  );

  // ------------------------------------------------------------------ tải dữ liệu

  const loadMenu = useCallback(async () => {
    const res = await request('GET', '/api/public/menu', {
      headers: etagRef.current ? { 'If-None-Match': etagRef.current } : {},
    });
    if (res.status === 304) return;
    etagRef.current = res.headers.get('ETag');
    setMenu(res.data);
  }, []);

  const loadOrders = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await request('GET', '/api/orders', { tableToken: token, sessionId });
    setOrders(data.orders);
    setMineIds(new Set(data.mineOrderIds));
  }, [token, sessionId]);

  const loadBill = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await request('GET', '/api/payments/bill', { tableToken: token, sessionId });
    setBill(data);
  }, [token, sessionId]);

  // Lượt gọi phục vụ đang mở của bàn (204 = không có)
  const loadServiceCall = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await request('GET', '/api/service-calls/current', { tableToken: token, sessionId });
    setServiceCall(data || null);
  }, [token, sessionId]);

  // Vào bàn: vào phiên đang có hoặc mở phiên mới nếu bàn trống
  const join = useCallback(async () => {
    setPhase('loading');
    try {
      const { data } = await request('POST', `/api/public/tables/${encodeURIComponent(token)}/join`, {
        tableToken: token,
      });
      setSession({ tableId: data.tableId, code: data.code, sessionId: data.sessionId });
      const saved = readJson(guestKey(token));
      if (saved && saved.sessionId === data.sessionId && saved.name) {
        setGuestName(saved.name);
        setAskName(false);
      } else {
        setGuestName(null);
        setNameInput('');
        setAskName(true);
      }
      setPhase('ready');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TABLE_CLOSED') setPhase('closed');
      else setFatal(e instanceof ApiError ? e.message : 'Không kết nối được máy chủ');
    }
  }, [token]);

  useEffect(() => {
    join();
    loadMenu().catch(() => {});
    request('GET', '/api/public/config')
      .then(({ data }) => setMethods(data.paymentMethods || ['CASH']))
      .catch(() => {});
  }, [join, loadMenu]);

  useEffect(() => {
    if (phase !== 'ready' || !sessionId) return;
    loadOrders().catch(handleError);
    loadBill().catch(() => {});
    loadServiceCall().catch(() => {});
  }, [phase, sessionId, loadOrders, loadBill, loadServiceCall, handleError]);

  // Quay về từ trang VNPay: /t/{token}?payment=12[&vnpay=mã lỗi]
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('payment')) return;
    const code = params.get('vnpay');
    notify(code ? `Thanh toán VNPay chưa thành công (mã ${code})` : 'Đã nhận kết quả thanh toán từ VNPay');
    window.history.replaceState(null, '', window.location.pathname);
  }, [notify]);

  // ------------------------------------------------------------------ WebSocket
  // /topic/table.{id}: đơn chung của phiên, thanh toán, trả bàn, đóng bàn.
  useEffect(() => {
    if (phase !== 'ready' || !tableId) return undefined;
    const connection = new RealtimeConnection({
      url: wsUrl(),
      connectHeaders: { tableToken: token },
      onStatus: (status, info) => setConn({ status, info }),
      onConnected: (client) => {
        client.subscribe(`/topic/table.${tableId}`, (msg) => {
          switch (msg.type) {
            case 'ORDER_CREATED':
            case 'ITEM_STATUS_CHANGED':
            case 'ORDER_CANCELLED':
            case 'ORDER_UPDATED':
              setOrders((prev) => applyEvent(prev, msg));
              if (msg.type === 'ORDER_UPDATED') {
                const c = msg.payload.change;
                notify(c.reason === 'RETURNED'
                  ? `↩ Đã ghi nhận trả lại ${c.quantity}× ${c.name}, không tính tiền`
                  : `❌ Bếp huỷ ${c.quantity}× ${c.name}: ${VOID_REASON[c.reason]}${c.note ? ` (${c.note})` : ''}`);
              }
              if (msg.type === 'ITEM_STATUS_CHANGED' && msg.payload.to === 'READY') {
                notify(`🔔 ${msg.payload.name} đã sẵn sàng!`);
              }
              loadBill().catch(() => {});
              break;
            case 'PAYMENT_UPDATED':
              loadBill().catch(() => {});
              if (msg.payment?.status === 'PAID') notify('✅ Đã nhận thanh toán');
              break;
            case 'SERVICE_CALL_UPDATED':
              if (msg.call.sessionId !== sessionId) break;
              setServiceCall(msg.call.handledAt ? null : msg.call);
              if (msg.call.handledAt) notify('🙋 Nhân viên đã nhận yêu cầu và đang tới bàn bạn');
              break;
            case 'TABLE_SESSION_ENDED':
              handleEnded();
              break;
            case 'TABLE_CLOSED':
              setPhase('closed');
              break;
            case 'TABLE_TOKEN_ROTATED':
              setFatal('Mã QR của bàn đã được đổi');
              break;
            default:
          }
        });
        client.subscribe('/topic/menu', () => loadMenu().catch(() => {}));
        // Đồng bộ lại toàn bộ sau mỗi lần (re)connect: bù các sự kiện bị lỡ khi mất mạng
        loadOrders().catch(handleError);
        loadBill().catch(() => {});
        loadMenu().catch(() => {});
        loadServiceCall().catch(() => {});
      },
    });
    connection.start();
    return () => connection.stop();
  }, [phase, tableId, token, sessionId, loadMenu, loadOrders, loadBill, loadServiceCall, notify, handleEnded, handleError]);

  // ------------------------------------------------------------------ tên khách

  function saveName(name) {
    const value = (name || '').replace(/\s+/g, ' ').trim().slice(0, 20) || randomGuestName();
    setGuestName(value);
    writeJson(guestKey(token), { sessionId, name: value });
    setAskName(false);
  }

  // ------------------------------------------------------------------ giỏ hàng, đặt món

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
  const paymentPending = bill?.pending || null;

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
            sessionId: attempt.sessionId,
            headers: { 'Idempotency-Key': attempt.key },
            body: { items: attempt.items, guestName: attempt.guestName },
          }),
        { onRetry: (e, n) => notify(`Mạng chập chờn, đang gửi lại lần ${n}...`) },
      );
      writeJson(pendingKey(token), null);
      setPending(null);
      setOrders((prev) => (prev.some((o) => o.id === res.data.id) ? prev : [...prev, res.data]));
      setMineIds((prev) => new Set(prev).add(res.data.id));
      loadBill().catch(() => {});
      notify(res.status === 200 ? 'Đơn này đã được ghi nhận trước đó (không tạo trùng)' : '✅ Đã gửi đơn tới bếp!');
      return true;
    } catch (e) {
      if (isRetryable(e)) {
        notify('Chưa gửi được đơn. Bấm "Gửi lại" khi có mạng, đơn sẽ không bị trùng.');
      } else {
        writeJson(pendingKey(token), null);
        setPending(null);
        handleError(e);
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
    const attempt = { key: newIdempotencyKey(), items, guestName, sessionId, createdAt: Date.now() };
    writeJson(pendingKey(token), attempt);
    setPending(attempt);
    setCart({});
    setShowCart(false);
    await sendOrder(attempt);
  }

  async function cancelOrder(order) {
    try {
      const { data } = await request('POST', `/api/orders/${order.id}/cancel`, { tableToken: token, sessionId });
      setOrders((prev) => prev.map((o) => (o.id === data.id ? data : o)));
      loadBill().catch(() => {});
      notify(`Đã huỷ đơn #${order.id}`);
    } catch (e) {
      handleError(e);
    }
  }

  // ------------------------------------------------------------------ thanh toán

  async function startPayment(method) {
    setPaying(true);
    if (!payKeyRef.current) payKeyRef.current = newIdempotencyKey();
    try {
      const res = await withRetry(() =>
        request('POST', '/api/payments', {
          tableToken: token,
          sessionId,
          headers: { 'Idempotency-Key': payKeyRef.current },
          body: { method },
        }),
      );
      payKeyRef.current = null;
      setShowPay(false);
      await loadBill().catch(() => {});
      const p = res.data;
      if (res.status === 200 && p.method !== method) {
        notify(`Bạn cùng bàn đang thanh toán bằng ${METHOD_LABEL[p.method]}`);
      } else if (p.method === 'VNPAY' && p.payUrl) {
        window.location.href = p.payUrl; // chuyển sang trang thanh toán của VNPay
      } else if (p.method === 'CASH') {
        notify('Vui lòng ra quầy thu ngân để thanh toán');
      }
    } catch (e) {
      if (!isRetryable(e)) payKeyRef.current = null;
      handleError(e);
    } finally {
      setPaying(false);
    }
  }

  async function cancelPayment(p) {
    try {
      await request('POST', `/api/payments/${p.id}/cancel`, { tableToken: token, sessionId });
      await loadBill();
      notify('Đã huỷ lần thanh toán, bạn có thể gọi thêm món');
    } catch (e) {
      handleError(e);
    }
  }

  // ------------------------------------------------------------------ gọi phục vụ

  async function callStaff() {
    setCalling(true);
    try {
      const { data } = await request('POST', '/api/service-calls', {
        tableToken: token,
        sessionId,
        body: { guestName },
      });
      setServiceCall(data);
      notify('🔔 Đã báo quầy lễ tân, nhân viên sẽ tới ngay');
    } catch (e) {
      handleError(e);
    } finally {
      setCalling(false);
    }
  }

  // ------------------------------------------------------------------ giao diện

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
  if (phase === 'closed') {
    return (
      <div className="center-page">
        <div className="card">
          <h2>🚧 Bàn đang tạm ngừng phục vụ</h2>
          <p>Vui lòng gọi nhân viên để được xếp bàn khác.</p>
        </div>
      </div>
    );
  }
  if (phase === 'ended') {
    return (
      <div className="center-page">
        <div className="card">
          <h2>🙏 Cảm ơn quý khách!</h2>
          <p>Lượt của bạn ở bàn này đã kết thúc.</p>
          <button className="btn primary block" onClick={join}>
            Bắt đầu lượt mới
          </button>
        </div>
      </div>
    );
  }
  if (phase !== 'ready' || !menu) return <div className="center-page">Đang tải thực đơn...</div>;

  const categories = menu.categories.filter((c) => c.items.length > 0);
  const shownCat = categories.find((c) => c.id === activeCat) || categories[0];
  const visibleOrders = [...orders].reverse();
  const summary = new Map();
  orders.forEach((o) =>
    o.items
      .filter((i) => i.status !== 'CANCELLED')
      .forEach((i) => summary.set(i.name, (summary.get(i.name) || 0) + i.quantity)),
  );
  const canOrder = !paymentPending;

  return (
    <div className="customer">
      <header className="customer-header">
        <div>
          <div className="table-code">Bàn {session.code}</div>
          <button className="link-btn" onClick={() => { setNameInput(guestName || ''); setAskName(true); }}>
            Bạn là: <strong>{guestName || '…'}</strong> ✏️
          </button>
        </div>
        <div className="header-actions">
          <button
            className={`btn small ${serviceCall ? 'calling' : ''}`}
            disabled={calling || !!serviceCall}
            onClick={callStaff}
            title={serviceCall ? 'Đã báo quầy lễ tân, nhân viên đang tới' : 'Gọi nhân viên tới bàn'}
          >
            {serviceCall ? '⏳ Đang gọi…' : '🙋 Gọi phục vụ'}
          </button>
          <ConnectionBadge status={conn.status} info={conn.info} />
        </div>
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
              writeJson(pendingKey(token), null);
              setPending(null);
            }}
          >
            Bỏ
          </button>
        </div>
      )}

      {paymentPending && (
        <div className="banner info pay-banner">
          <div>
            <strong>Bàn đang thanh toán</strong> · {METHOD_LABEL[paymentPending.method]} ·{' '}
            {formatVnd(paymentPending.amount)}
            <div className="hint">
              {paymentPending.method === 'CASH'
                ? 'Vui lòng ra quầy thu ngân. Trong lúc chờ chưa gọi thêm món được.'
                : 'Hoàn tất thanh toán trên trang VNPay. Trong lúc chờ chưa gọi thêm món được.'}
            </div>
          </div>
          <div className="pay-actions">
            {paymentPending.payUrl && (
              <a className="btn small primary" href={paymentPending.payUrl}>
                Mở trang VNPay
              </a>
            )}
            <button className="btn small" onClick={() => cancelPayment(paymentPending)}>
              Huỷ thanh toán
            </button>
          </div>
        </div>
      )}

      {bill && bill.total > 0 && bill.remaining <= 0 && !paymentPending && (
        <div className="banner ok">✅ Bàn đã thanh toán đủ. Cảm ơn quý khách!</div>
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
                  <button className="add" disabled={!canOrder} onClick={() => changeQty(item, 1)}>
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
        <h2>Đơn của bàn ({orders.length})</h2>
        {visibleOrders.length === 0 && <p className="hint">Bàn chưa có đơn nào trong lượt này.</p>}
        {visibleOrders.map((o) => {
          const mine = mineIds.has(o.id);
          return (
            <div key={o.id} className={`order-card ${mine ? 'mine' : ''}`}>
              <div className="order-head">
                <strong>Đơn #{o.id}</strong>
                <span>{new Date(o.createdAt).toLocaleTimeString('vi-VN')}</span>
                {mine ? (
                  <span className="chip chip-info">BẠN ĐẶT</span>
                ) : (
                  <span className="chip">{o.guestName || 'Khách khác'}</span>
                )}
                <span className="order-total">{formatVnd(o.total)}</span>
              </div>
              {o.items.map((i) => (
                <div key={i.id} className="order-line">
                  <span>
                    {i.quantity}× {i.name}
                    {i.note && <em className="note"> ({i.note})</em>}
                    {i.cancelReason && (
                      <em className="note void-reason"> · {VOID_REASON[i.cancelReason]}{i.cancelNote ? `: ${i.cancelNote}` : ''}</em>
                    )}
                  </span>
                  <span className={`chip chip-${ITEM_STATUS[i.status]?.tone}`}>
                    {i.cancelReason === 'RETURNED' ? 'Đã trả lại' : ITEM_STATUS[i.status]?.label}
                  </span>
                </div>
              ))}
              {mine && canOrder && o.items.every((i) => i.status === 'PENDING') && (
                <button className="btn small danger" onClick={() => cancelOrder(o)}>
                  Huỷ đơn
                </button>
              )}
            </div>
          );
        })}

        {orders.length > 0 && (
          <div className="bill-summary">
            <h3>Tổng cả bàn</h3>
            {[...summary.entries()].map(([name, qty]) => (
              <div key={name} className="order-line">
                <span>{name}</span>
                <span>×{qty}</span>
              </div>
            ))}
            {bill && (
              <>
                <div className="order-line total-line">
                  <span>Tạm tính</span>
                  <strong>{formatVnd(bill.total)}</strong>
                </div>
                {bill.paid > 0 && (
                  <div className="order-line">
                    <span>Đã thanh toán</span>
                    <span>{formatVnd(bill.paid)}</span>
                  </div>
                )}
                <div className="order-line total-line">
                  <span>Còn phải trả</span>
                  <strong>{formatVnd(Math.max(0, bill.remaining))}</strong>
                </div>
                {bill.remaining < 0 && (
                  <div className="banner ok">Có món được huỷ sau khi bạn đã thanh toán: quầy thu ngân sẽ trả lại bạn {formatVnd(-bill.remaining)}</div>
                )}
                {bill.remaining > 0 && !paymentPending && (
                  <button className="btn primary block" onClick={() => setShowPay(true)}>
                    Thanh toán {formatVnd(bill.remaining)}
                  </button>
                )}
              </>
            )}
          </div>
        )}
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
            <h2>Giỏ hàng – Bàn {session.code}</h2>
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
              <button className="btn primary" disabled={submitting || !!pending || !canOrder} onClick={submitCart}>
                {submitting ? 'Đang gửi...' : 'Đặt món'}
              </button>
            </div>
            {pending && <p className="hint">Hãy gửi lại hoặc bỏ đơn đang chờ trước khi đặt đơn mới.</p>}
            {!canOrder && <p className="hint">Bàn đang thanh toán, huỷ thanh toán để gọi thêm.</p>}
          </div>
        </div>
      )}

      {showPay && bill && (
        <div className="modal-backdrop" onClick={() => setShowPay(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Thanh toán – Bàn {session.code}</h2>
            <p>
              Số tiền: <strong>{formatVnd(bill.remaining)}</strong> (cho cả bàn)
            </p>
            {methods.map((m) => (
              <button key={m} className="btn block" disabled={paying} onClick={() => startPayment(m)}>
                {m === 'VNPAY' ? '💳 Thanh toán qua VNPay' : '💵 Tiền mặt tại quầy'}
              </button>
            ))}
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowPay(false)}>
                Để sau
              </button>
            </div>
          </div>
        </div>
      )}

      {askName && (
        <div className="modal-backdrop center">
          <form
            className="modal panel name-modal"
            onSubmit={(e) => {
              e.preventDefault();
              saveName(nameInput);
            }}
          >
            <h2>Chào mừng tới bàn {session.code} 👋</h2>
            <label>
              Bạn tên gì? (để cả bàn biết ai gọi món nào)
              <input
                autoFocus
                maxLength={20}
                value={nameInput}
                placeholder="VD: Minh"
                onChange={(e) => setNameInput(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => saveName('')}>
                Bỏ qua
              </button>
              <button className="btn primary">Tiếp tục</button>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast">{toast.text}</div>}
    </div>
  );
}
