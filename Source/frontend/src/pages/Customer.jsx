import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import AssistantChat from '../components/AssistantChat.jsx';
import Icon from '../components/Icon.jsx';
import { ApiError, isRetryable, newIdempotencyKey, request, withRetry, wsUrl } from '../lib/api.js';
import { RealtimeConnection } from '../lib/connection.js';
import { ITEM_STATUS, RESTAURANT, VOID_REASON, categoryIcon, countdown, formatVnd, mergeOrder } from '../lib/format.js';

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

const METHOD_LABEL = { CASH: 'Tiền mặt tại quầy', VNPAY: 'QR VNPay' };

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
  const [limits, setLimits] = useState({ orderPendingTimeoutMinutes: 20, serviceCallTimeoutMinutes: 10 });
  const [now, setNow] = useState(Date.now());
  const etagRef = useRef(null);
  const payKeyRef = useRef(null); // Idempotency-Key của lần bấm "Thanh toán" đang xử lý

  const notify = useCallback((text) => setToast({ text, at: Date.now() }), []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Đồng hồ cho các bộ đếm ngược (món chờ bếp, thanh toán, gọi phục vụ)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
      .then(({ data }) => {
        setMethods(data.paymentMethods || ['CASH']);
        setLimits(data);
      })
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
                if (c.by !== 'guest') {
                  notify(c.reason === 'RETURNED'
                    ? `Đã ghi nhận trả lại ${c.quantity}× ${c.name}, không tính tiền`
                    : `${c.by === 'system' ? 'Đã tự huỷ' : 'Bếp huỷ'} ${c.whole ? c.name : `${c.quantity}× ${c.name}`}: ${VOID_REASON[c.reason]}${c.note ? ` (${c.note})` : ''}`);
                }
              }
              if (msg.type === 'ITEM_STATUS_CHANGED' && msg.payload.to === 'ACCEPTED') {
                notify(`Bếp đã tiếp nhận ${msg.payload.name}`);
              }
              if (msg.type === 'ITEM_STATUS_CHANGED' && msg.payload.to === 'SERVED') {
                notify(`${msg.payload.name} đã được phục vụ. Chúc ngon miệng!`);
              }
              loadBill().catch(() => {});
              break;
            case 'PAYMENT_UPDATED':
              loadBill().catch(() => {});
              if (msg.payment?.status === 'PAID') notify('Đã nhận thanh toán. Cảm ơn quý khách!');
              break;
            case 'SERVICE_CALL_UPDATED':
              if (msg.call.sessionId !== sessionId) break;
              setServiceCall(msg.call.handledAt ? null : msg.call);
              if (msg.call.handledAt) notify(msg.call.handledBy === 'AUTO_TIMEOUT' ? 'Yêu cầu gọi phục vụ đã hết hạn, bạn có thể gọi lại' : 'Nhân viên đã nhận yêu cầu và đang tới bàn bạn');
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
      notify(res.status === 200 ? 'Đơn này đã được ghi nhận trước đó (không tạo trùng)' : 'Đã gửi đơn tới bếp!');
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

  async function cancelItem(order, item) {
    try {
      const { data } = await request('POST', `/api/orders/${order.id}/items/${item.id}/cancel`, { tableToken: token, sessionId });
      setOrders((prev) => prev.map((o) => (o.id === data.id ? data : o)));
      loadBill().catch(() => {});
      notify(`Đã huỷ ${item.quantity}× ${item.name}`);
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
      notify('Đã báo nhân viên, vui lòng đợi trong giây lát');
    } catch (e) {
      handleError(e);
    } finally {
      setCalling(false);
    }
  }

  // ------------------------------------------------------------------ giao diện

  const screen = (icon, title, text, action) => (
    <div className="ended" style={{ backgroundImage: 'url(/images/hoian.jpg)' }}>
      <div className="card">
        <span className="logo"><Icon name={icon} size={30} /></span>
        <span className="eyebrow">{RESTAURANT.name}</span>
        <h2>{title}</h2>
        <p className="muted">{text}</p>
        {action}
      </div>
    </div>
  );
  if (fatal) return screen('alert', fatal, 'Vui lòng quét lại mã QR trên bàn hoặc gọi nhân viên.');
  if (phase === 'closed') return screen('lock', 'Bàn đang tạm ngừng phục vụ', 'Vui lòng gọi nhân viên để được xếp bàn khác.');
  if (phase === 'ended') {
    return screen('lantern', 'Cảm ơn quý khách!', 'Lượt dùng bữa của bạn ở bàn này đã kết thúc. Hẹn gặp lại!',
      <button className="btn primary lg" onClick={join}>Bắt đầu lượt mới</button>);
  }
  if (phase !== 'ready' || !menu) {
    return (
      <div className="cust">
        <div className="skeleton" style={{ height: 210, borderRadius: '0 0 28px 28px' }} />
        <div className="cust-body"><div className="menu-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 240, borderRadius: 20 }} />)}</div></div>
      </div>
    );
  }

  const categories = menu.categories.filter((c) => c.items.length > 0);
  const shownCat = categories.find((c) => c.id === activeCat) || categories[0];
  const visibleOrders = [...orders].reverse();
  const canOrder = !paymentPending;
  const orderTimeoutMs = (limits.orderPendingTimeoutMinutes || 20) * 60000;
  const callTimeoutMs = (limits.serviceCallTimeoutMinutes || 10) * 60000;
  const catThumb = (c) => c.items.find((i) => i.imageUrl)?.imageUrl;

  const billCard = orders.length > 0 && bill && (
    <section className="card card-pad bill">
      <strong style={{ fontSize: 16 }}>Hoá đơn của bàn</strong>
      <div className="ln"><span>Tiền món</span><span className="money">{formatVnd(bill.subtotal)}</span></div>
      <div className="ln"><span>Thuế VAT</span><span className="money">{formatVnd(bill.vat)}</span></div>
      {bill.paid > 0 && <div className="ln"><span>Đã thanh toán</span><span className="money">− {formatVnd(bill.paid)}</span></div>}
      <div className="ln total"><span>Còn phải trả</span><span className="money">{formatVnd(Math.max(0, bill.remaining))}</span></div>
      {bill.remaining < 0 && <div className="banner ok"><Icon name="undo" />Có món được huỷ sau khi bạn đã thanh toán: quầy sẽ trả lại bạn {formatVnd(-bill.remaining)}</div>}
      {bill.total > 0 && bill.remaining <= 0 && !paymentPending && <div className="banner ok"><Icon name="checkCircle" />Bàn đã thanh toán đủ. Cảm ơn quý khách!</div>}
      {bill.remaining > 0 && !paymentPending && (
        <button className="btn primary lg block" onClick={() => setShowPay(true)}><Icon name="card" size={18} />Thanh toán {formatVnd(bill.remaining)}</button>
      )}
    </section>
  );

  return (
    <div className="cust">
      <header className="cust-hero" style={{ backgroundImage: 'url(/images/hero.jpg)' }}>
        <div className="cust-top">
          <span className="brandmark"><span className="logo"><Icon name="lantern" /></span>{RESTAURANT.name}</span>
          <span className="spacer" />
          <ConnectionBadge status={conn.status} info={conn.info} />
        </div>
        <div className="cust-hero-in">
          <div>
            <span className="table-pill"><b>Bàn {session.code}</b>Chào mừng quý khách</span>
            <h1>Hôm nay bạn muốn dùng gì?</h1>
            <button className="guest-btn" onClick={() => { setNameInput(guestName || ''); setAskName(true); }}>
              <Icon name="user" />Bạn là <strong>{guestName || '…'}</strong><Icon name="edit" />
            </button>
          </div>
          <div className="actions">
            <button className={`btn call ${serviceCall ? 'calling' : ''}`} disabled={calling || !!serviceCall} onClick={callStaff}
              title={serviceCall ? 'Đã báo nhân viên' : 'Gọi nhân viên tới bàn'}>
              <Icon name="bell" size={18} />
              {serviceCall ? `Đang gọi… ${countdown(serviceCall.createdAt + callTimeoutMs, now)}` : 'Gọi phục vụ'}
            </button>
          </div>
        </div>
      </header>

      <div className="cust-body">
        {pending && !submitting && (
          <div className="banner warn">
            <Icon name="wifiOff" />
            <span style={{ flex: 1 }}>Có đơn chưa gửi được ({pending.items.reduce((s, i) => s + i.quantity, 0)} món).</span>
            <button className="btn small primary" onClick={() => sendOrder(pending)}>Gửi lại</button>
            <button className="btn small" onClick={() => { writeJson(pendingKey(token), null); setPending(null); }}>Bỏ</button>
          </div>
        )}

        {paymentPending && (
          <div className="banner info">
            <Icon name={paymentPending.method === 'VNPAY' ? 'qr' : 'cash'} />
            <div style={{ flex: 1 }}>
              <strong>Bàn đang thanh toán</strong> · {METHOD_LABEL[paymentPending.method]} · <span className="money">{formatVnd(paymentPending.amount)}</span>
              <div className="hint">
                {paymentPending.method === 'CASH' ? 'Vui lòng ra quầy thu ngân.' : 'Hoàn tất thanh toán trên trang VNPay.'} Trong lúc chờ chưa gọi thêm món được.
                {' '}<span className="timer"><Icon name="clock" />Hết hạn sau {countdown(paymentPending.expiresAt, now)}</span>
              </div>
            </div>
            <div className="pay-actions">
              {paymentPending.payUrl && <a className="btn small primary" href={paymentPending.payUrl}>Mở trang VNPay</a>}
              <button className="btn small" onClick={() => cancelPayment(paymentPending)}>Huỷ thanh toán</button>
            </div>
          </div>
        )}

        <div className="cust-layout">
          <div>
            <nav className="cat-tabs" aria-label="Danh mục món ăn">
              {categories.map((c) => (
                <button key={c.id} className={`cat-tab ${c.id === shownCat?.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>
                  <span className="thumb">{catThumb(c) ? <img src={catThumb(c)} alt="" /> : <Icon name={categoryIcon(c.name)} size={18} />}</span>
                  {c.name} <small>{c.items.length}</small>
                </button>
              ))}
            </nav>

            {!shownCat && <div className="card empty"><Icon name="menu" />Thực đơn đang được cập nhật. Vui lòng liên hệ nhân viên.</div>}
            {shownCat && <div className="menu-head"><h2>{shownCat.name}</h2><span className="hint">{shownCat.items.length} món</span></div>}
            <div className="menu-grid stagger" key={shownCat?.id}>
              {shownCat?.items.map((item) => {
                const qty = cart[item.id]?.qty || 0;
                return (
                  <article key={item.id} className={`mi ${item.available ? '' : 'sold-out'} ${qty ? 'in-cart' : ''}`}>
                    <div className="ph">
                      {item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" /> : <Icon name={categoryIcon(shownCat.name)} />}
                      {!item.available && <span className="chip chip-danger tag">Hết món</span>}
                      {item.available && item.stock !== null && item.stock <= 5 && <span className="chip chip-gold tag">Còn {item.stock} suất</span>}
                    </div>
                    <div className="bd">
                      <span className="name">{item.name}</span>
                      {item.description && <span className="desc">{item.description}</span>}
                      <div className="ft">
                        <span className="price">{formatVnd(item.price)}</span>
                        {item.available && (
                          <div className="qty">
                            {qty > 0 && (
                              <>
                                <button aria-label={`Giảm ${item.name}`} onClick={() => changeQty(item, -1)}><Icon name="minus" /></button>
                                <span key={qty}>{qty}</span>
                              </>
                            )}
                            <button className="add" aria-label={`Thêm ${item.name}`} disabled={!canOrder} onClick={() => changeQty(item, 1)}><Icon name="plus" /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="cust-side">
            <section className="card card-pad" style={{ display: 'grid', gap: 12 }}>
              <div className="row"><strong style={{ fontSize: 16 }}>Đơn của bàn</strong><span className="chip">{orders.length}</span></div>
              {visibleOrders.length === 0 && <div className="empty" style={{ padding: 20 }}><Icon name="receipt" />Bàn chưa gọi món nào trong lượt này.</div>}
              {visibleOrders.map((o) => {
                const mine = mineIds.has(o.id);
                const waiting = o.items.filter((i) => i.status === 'PENDING');
                return (
                  <div key={o.id} className={`order-card ${mine ? 'mine' : ''}`}>
                    <div className="order-head">
                      <strong>Đơn #{o.id}</strong>
                      {mine ? <span className="chip chip-gold">Bạn đặt</span> : <span className="chip">{o.guestName || 'Khách khác'}</span>}
                      <span>{new Date(o.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="money">{formatVnd(o.total)}</span>
                    </div>
                    {o.items.map((i) => (
                      <div key={i.id} className={`order-line ${i.status === 'CANCELLED' ? 'cancelled' : ''}`}>
                        <span className="nm">
                          {i.quantity}× {i.name}
                          {i.note && <em className="note">{i.note}</em>}
                          {i.cancelReason && <em className="note">{VOID_REASON[i.cancelReason]}{i.cancelNote ? `: ${i.cancelNote}` : ''}</em>}
                        </span>
                        <span className={`chip chip-${ITEM_STATUS[i.status]?.tone}`}>{i.cancelReason === 'RETURNED' ? 'Đã trả lại' : ITEM_STATUS[i.status]?.short}</span>
                        {mine && canOrder && i.status === 'PENDING' && o.items.length > 1 && (
                          <button className="btn ghost small icon-only" title="Huỷ món này" onClick={() => cancelItem(o, i)}><Icon name="x" size={15} /></button>
                        )}
                      </div>
                    ))}
                    {waiting.length > 0 && (
                      <div className="row">
                        <span className="timer"><Icon name="clock" />Chờ bếp tiếp nhận · tự huỷ sau {countdown(Math.min(...waiting.map((i) => i.updatedAt)) + orderTimeoutMs, now)}</span>
                        <span className="spacer" />
                        {mine && canOrder && waiting.length === o.items.length && (
                          <button className="btn small danger" onClick={() => cancelOrder(o)}><Icon name="trash" size={14} />Huỷ đơn</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
            {billCard}
          </aside>
        </div>
      </div>

      {cartCount > 0 && (
        <button className="cart-bar" onClick={() => setShowCart(true)}>
          <span className="cnt"><Icon name="bag" size={26} /><b key={cartCount}>{cartCount}</b></span>
          <span><span className="hint" style={{ color: '#cdbdaa' }}>Giỏ món · chưa gồm VAT</span><br /><strong className="money">{formatVnd(cartTotal)}</strong></span>
          <span className="go">Xem giỏ<Icon name="chevronRight" size={16} /></span>
        </button>
      )}

      {showCart && (
        <div className="modal-backdrop" onClick={() => setShowCart(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><h2 className="display">Giỏ món</h2><span className="hint">Bàn {session.code} · {cartCount} món</span></div>
              <span className="spacer" />
              <button className="btn ghost small icon-only" onClick={() => setShowCart(false)}><Icon name="x" /></button>
            </div>
            {cartLines.map((l) => (
              <div key={l.item.id} className="cart-line">
                {l.item.imageUrl ? <img src={l.item.imageUrl} alt="" /> : <span className="noimg"><Icon name="bowl" /></span>}
                <div>
                  <strong>{l.item.name}</strong>
                  <div className="money" style={{ color: 'var(--brand)' }}>{formatVnd(l.qty * l.item.price)}</div>
                </div>
                <div className="qty">
                  <button onClick={() => changeQty(l.item, -1)}><Icon name="minus" /></button>
                  <span key={l.qty}>{l.qty}</span>
                  <button className="add" onClick={() => changeQty(l.item, 1)}><Icon name="plus" /></button>
                </div>
                <input placeholder="Ghi chú cho bếp (VD: ít cay, không hành)" value={l.note} onChange={(e) => changeNote(l.item.id, e.target.value)} />
              </div>
            ))}
            <div className="bill" style={{ marginTop: 14 }}>
              <div className="ln total"><span>Tạm tính</span><span className="money">{formatVnd(cartTotal)}</span></div>
              <span className="hint">VAT được cộng khi thanh toán. Bếp cần tiếp nhận trong {limits.orderPendingTimeoutMinutes || 20} phút, quá hạn đơn tự huỷ.</span>
            </div>
            {pending && <div className="banner warn" style={{ marginTop: 12 }}><Icon name="alert" />Hãy gửi lại hoặc bỏ đơn đang chờ trước khi đặt đơn mới.</div>}
            {!canOrder && <div className="banner info" style={{ marginTop: 12 }}><Icon name="info" />Bàn đang thanh toán, huỷ thanh toán để gọi thêm.</div>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowCart(false)}>Chọn thêm</button>
              <button className="btn primary lg" disabled={submitting || !!pending || !canOrder} onClick={submitCart}>
                <Icon name="send" size={17} />{submitting ? 'Đang gửi...' : 'Gửi đơn tới bếp'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPay && bill && (
        <div className="modal-backdrop" onClick={() => setShowPay(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div><h2 className="display">Thanh toán</h2><span className="hint">Bàn {session.code} · cho cả bàn</span></div>
              <span className="spacer" />
              <button className="btn ghost small icon-only" onClick={() => setShowPay(false)}><Icon name="x" /></button>
            </div>
            <div className="bill card card-pad" style={{ marginBottom: 16 }}>
              <div className="ln"><span>Tiền món</span><span className="money">{formatVnd(bill.subtotal)}</span></div>
              <div className="ln"><span>Thuế VAT</span><span className="money">{formatVnd(bill.vat)}</span></div>
              {bill.paid > 0 && <div className="ln"><span>Đã thanh toán</span><span className="money">− {formatVnd(bill.paid)}</span></div>}
              <div className="ln total"><span>Cần thanh toán</span><span className="money">{formatVnd(bill.remaining)}</span></div>
            </div>
            {methods.map((m) => (
              <button key={m} className="pay-option" disabled={paying} onClick={() => startPayment(m)}>
                <span className="ic"><Icon name={m === 'VNPAY' ? 'qr' : 'cash'} size={22} /></span>
                <div style={{ flex: 1 }}>
                  <strong>{m === 'VNPAY' ? 'Thanh toán QR / thẻ qua VNPay' : 'Tiền mặt tại quầy'}</strong>
                  <span>{m === 'VNPAY' ? 'Quét mã bằng ứng dụng ngân hàng' : 'Mời bạn ra quầy thu ngân'}</span>
                </div>
                <Icon name="chevronRight" />
              </button>
            ))}
          </div>
        </div>
      )}

      {askName && (
        <div className="modal-backdrop center">
          <form className="modal" style={{ maxWidth: 420 }} onSubmit={(e) => { e.preventDefault(); saveName(nameInput); }}>
            <span className="logo" style={{ marginBottom: 12 }}><Icon name="lantern" /></span>
            <h2 className="display">Chào mừng tới bàn {session.code}</h2>
            <p className="muted" style={{ margin: '6px 0 16px' }}>Cho cả bàn biết ai gọi món nào nhé.</p>
            <label className="field">
              Tên của bạn
              <input autoFocus maxLength={20} value={nameInput} placeholder="VD: Minh" onChange={(e) => setNameInput(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => saveName('')}>Bỏ qua</button>
              <button className="btn primary">Tiếp tục<Icon name="arrowRight" size={16} /></button>
            </div>
          </form>
        </div>
      )}

      <AssistantChat
        token={token}
        sessionId={sessionId}
        itemsById={itemsById}
        canOrder={canOrder}
        onAdd={(item, qty) => {
          changeQty(item, qty);
          notify(`Đã thêm ${qty}× ${item.name} vào giỏ`);
        }}
        onError={handleError}
      />

      {toast && <div className="toast"><Icon name="info" />{toast.text}</div>}
    </div>
  );
}
