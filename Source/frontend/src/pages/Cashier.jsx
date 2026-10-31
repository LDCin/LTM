import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import AppShell from '../components/AppShell.jsx';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import Icon from '../components/Icon.jsx';
import Login from '../components/Login.jsx';
import TableArt, { STATE_COLOR } from '../components/TableArt.jsx';
import { ApiError, getStaffSession, request, setStaffSession, wsUrl } from '../lib/api.js';
import { RealtimeConnection } from '../lib/connection.js';
import { ITEM_STATUS, VOID_REASON, countdown, formatVnd, since } from '../lib/format.js';

const STATE_LABEL = {
  EMPTY: 'Trống',
  DINING: 'Đang dùng bữa',
  AWAITING_PAYMENT: 'Chờ thanh toán',
  PAID: 'Đã thanh toán',
  REFUND_DUE: 'Cần trả lại tiền',
  OUT_OF_SERVICE: 'Ngừng phục vụ',
};
const STATE_CHIP = { EMPTY: 'chip-muted', DINING: 'chip-brand', AWAITING_PAYMENT: 'chip-gold', PAID: 'chip-ok', REFUND_DUE: 'chip-danger', OUT_OF_SERVICE: 'chip-muted' };
const METHOD_LABEL = { CASH: 'Tiền mặt', VNPAY: 'QR VNPay' };
const PAY_STATUS = { PENDING: 'Đang chờ', PAID: 'Đã trả', FAILED: 'Thất bại', EXPIRED: 'Hết hạn', CANCELLED: 'Đã huỷ' };
const REASONS = [
  ['UNPAID_LEFT', 'Khách bỏ về không trả'],
  ['COMPED', 'Mời khách (không thu tiền)'],
  ['OTHER', 'Lý do khác'],
];

/** Tiếng "ting" ngắn khi có khách gọi (Web Audio, không cần file âm thanh). Trình duyệt chặn thì bỏ qua. */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => ctx.close();
  } catch {
    // không phát được âm thanh: vẫn còn toast và ô bàn nhấp nháy
  }
}

export default function Cashier() {
  const [session, setSession] = useState(() => {
    const s = getStaffSession();
    return s && ['CASHIER', 'ADMIN'].includes(s.role) ? s : null;
  });
  const logout = useCallback(() => {
    setStaffSession(null);
    setSession(null);
  }, []);
  if (!session) {
    return <Login title="Đăng nhập thu ngân" icon="receipt" allowedRoles={['CASHIER', 'ADMIN']} onLogin={setSession} hint="Tài khoản mẫu: thungan / thungan123" />;
  }
  return <CashierBoard session={session} onLogout={logout} />;
}

function CashierBoard({ session, onLogout }) {
  const token = session.token;
  const [tables, setTables] = useState([]);
  const [selected, setSelected] = useState(null); // id bàn đang mở chi tiết
  const [detail, setDetail] = useState(null);
  const [conn, setConn] = useState({ status: 'connecting' });
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [calls, setCalls] = useState([]); // lượt khách gọi phục vụ đang chờ, cũ nhất trước
  const [filter, setFilter] = useState(null);
  const [view, setView] = useState('floor');
  const [confirm, setConfirm] = useState(null); // hỏi lại khi trả bàn (409 CONFIRM_REQUIRED)
  const [callTimeout, setCallTimeout] = useState(10);
  const reloadTimer = useRef(null);

  const api = useCallback(
    async (method, path, body) => {
      try {
        return (await request(method, path, { token, body })).data;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onLogout();
        throw e;
      }
    },
    [token, onLogout],
  );

  const loadTables = useCallback(async () => {
    const [list, open] = await Promise.all([api('GET', '/api/cashier/tables'), api('GET', '/api/cashier/service-calls')]);
    setTables(list);
    setCalls(open);
  }, [api]);

  const loadDetail = useCallback(async (id) => {
    if (id) setDetail(await api('GET', `/api/cashier/tables/${id}`));
  }, [api]);

  // Nhiều sự kiện tới dồn dập -> gộp lại, tải lại một lần sau 300 ms
  const scheduleReload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      loadTables().catch(() => {});
      setSelected((id) => {
        if (id) loadDetail(id).catch(() => {});
        return id;
      });
    }, 300);
  }, [loadTables, loadDetail]);

  useEffect(() => {
    loadTables().catch((e) => setToast(e.message));
    request('GET', '/api/public/config').then(({ data }) => setCallTimeout(data.serviceCallTimeoutMinutes || 10)).catch(() => {});
    const connection = new RealtimeConnection({
      url: wsUrl(),
      connectHeaders: { Authorization: `Bearer ${token}` },
      onStatus: (status, info) => setConn({ status, info }),
      onConnected: (client) => {
        client.subscribe('/topic/cashier', (msg) => {
          if (msg.type === 'PAYMENT_UPDATED' && msg.payment?.status === 'PAID') {
            setToast(`Bàn ${msg.payment.tableCode}: đã nhận ${formatVnd(msg.payment.amount)} (${METHOD_LABEL[msg.payment.method]})`);
          }
          if (msg.type === 'SERVICE_CALL_UPDATED' && !msg.call.handledAt) {
            setToast(`Bàn ${msg.call.tableCode} gọi phục vụ${msg.call.guestName ? ` (${msg.call.guestName})` : ''}`);
            beep();
          }
          scheduleReload();
        });
        scheduleReload(); // kết nối lại: đồng bộ toàn bộ
      },
    });
    connection.start();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      connection.stop();
      clearInterval(clock);
      clearTimeout(reloadTimer.current);
    };
  }, [token, loadTables, scheduleReload]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function open(id) {
    setSelected(id);
    setDetail(null);
    loadDetail(id).catch((e) => setToast(e.message));
  }

  async function act(fn, okText) {
    try {
      await fn();
      if (okText) setToast(okText);
      await loadTables();
      if (selected) await loadDetail(selected);
    } catch (e) {
      setToast(e.message);
      if (e.code === 'VERSION_CONFLICT') scheduleReload();
    }
  }

  // Trả bàn: server có thể hỏi xác nhận (409 CONFIRM_REQUIRED) -> mở hộp thoại rồi gửi lại kèm câu trả lời
  async function checkout(t, body = {}) {
    try {
      await api('POST', `/api/cashier/tables/${t.id}/checkout`, body);
      setConfirm(null);
      setSelected(null);
      setToast(`Đã trả bàn ${t.code}`);
      await loadTables();
    } catch (e) {
      if (e.code === 'CONFIRM_REQUIRED') setConfirm({ table: t, message: e.message, details: e.details || {}, body });
      else setToast(e.message);
    }
  }

  const counts = tables.reduce((m, t) => ({ ...m, [t.state]: (m[t.state] || 0) + 1 }), {});
  const shown = filter ? tables.filter((t) => t.state === filter) : tables;
  const callList = (
    <div className="calls stagger">
      {calls.map((c) => (
        <div key={c.id} className="call-row">
          <span className="ic"><Icon name="bell" size={18} /></span>
          <div className="who">
            <strong>Bàn {c.tableCode}{c.guestName && ` · ${c.guestName}`}</strong>
            <span className="hint">{since(c.createdAt, now)} trước · tự đóng sau {countdown(c.createdAt + callTimeout * 60000, now)}</span>
          </div>
          <button className="btn small ok" onClick={() => act(() => api('POST', `/api/cashier/service-calls/${c.id}/handle`), `Đã xử lý bàn ${c.tableCode}`)}>
            <Icon name="check" size={15} />Đã xử lý
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <AppShell
      area="Quầy thu ngân"
      session={session}
      onLogout={onLogout}
      active={view}
      onNav={setView}
      nav={[
        { key: 'floor', label: 'Sơ đồ bàn', icon: 'table' },
        { key: 'calls', label: 'Khách gọi phục vụ', icon: 'bell', count: calls.length },
      ]}
      title={view === 'floor' ? 'Sơ đồ bàn' : 'Khách gọi phục vụ'}
      actions={<ConnectionBadge status={conn.status} info={conn.info} />}
    >
      {view === 'floor' && (
        <>
          {calls.length > 0 && callList}
          <div className="stat-strip">
            {Object.entries(STATE_LABEL).map(([k, label]) => (
              <button key={k} className={`stat-pill ${filter === k ? 'active' : ''}`} onClick={() => setFilter(filter === k ? null : k)}>
                <span className="sw" style={{ background: STATE_COLOR[k] }} />
                <span>{label}</span>
                <b>{counts[k] || 0}</b>
              </button>
            ))}
          </div>
          <div className="floor">
            {shown.map((t, i) => (
              <button key={t.id} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} className={`tcard ${t.serviceCall ? 'calling' : ''}`} onClick={() => open(t.id)}>
                {t.serviceCall && <span className="bell"><Icon name="bell" size={17} /></span>}
                <div className="art"><TableArt state={t.state} /></div>
                <h3>Bàn {t.code}<span className={`chip ${STATE_CHIP[t.state]}`}>{STATE_LABEL[t.state]}</span></h3>
                {t.sessionId ? (
                  <>
                    <span className="amt money">{formatVnd(t.total)}</span>
                    <span className="meta">
                      <span><Icon name="clock" />{since(t.sessionOpenedAt, now)}</span>
                      <span><Icon name="receipt" />{t.orderCount} đơn</span>
                      {t.activeItemCount > 0 && <span><Icon name="flame" />{t.activeItemCount} món chưa ra</span>}
                    </span>
                    {t.pending && <span className="chip chip-gold"><Icon name={t.pending.method === 'VNPAY' ? 'qr' : 'cash'} />{METHOD_LABEL[t.pending.method]} · {formatVnd(t.pending.amount)}</span>}
                    {t.refundDue > 0 && <span className="chip chip-danger"><Icon name="undo" />Trả lại khách {formatVnd(t.refundDue)}</span>}
                    {t.needsRefund && <span className="chip chip-danger"><Icon name="alert" />Cần hoàn tiền</span>}
                  </>
                ) : (
                  <span className="meta">{t.inService ? 'Sẵn sàng đón khách' : 'Tạm ngừng phục vụ'}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {view === 'calls' && (calls.length ? callList : <div className="card empty"><Icon name="bell" />Hiện không có bàn nào gọi phục vụ.</div>)}

      {selected && (
        <div className="modal-backdrop center" onClick={() => setSelected(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            {!detail ? (
              <div className="skeleton" style={{ height: 300 }} />
            ) : (
              <TableDetail
                detail={detail}
                now={now}
                onClose={() => setSelected(null)}
                onCreate={(method) =>
                  act(() => api('POST', `/api/cashier/tables/${detail.table.id}/payments?method=${method}`),
                    method === 'VNPAY' ? 'Đã tạo mã QR thanh toán' : 'Đã tạo lần thu tiền mặt')}
                onConfirm={(p) => act(() => api('PATCH', `/api/cashier/payments/${p.id}/confirm`, { version: p.version }), 'Đã xác nhận nhận tiền')}
                onCancelPayment={(p) => act(() => api('POST', `/api/cashier/payments/${p.id}/cancel`), 'Đã huỷ lần thanh toán')}
                onCheckout={() => checkout(detail.table)}
              />
            )}
          </div>
        </div>
      )}

      {confirm && <CheckoutDialog {...confirm} onClose={() => setConfirm(null)} onSubmit={(body) => checkout(confirm.table, body)} />}

      {toast && <div className="toast"><Icon name="info" />{toast}</div>}
    </AppShell>
  );
}

function TableDetail({ detail, now, onClose, onCreate, onConfirm, onCancelPayment, onCheckout }) {
  const { table, bill, orders } = detail;
  const pending = bill.pending;
  return (
    <>
      <div className="modal-head">
        <div style={{ width: 64 }}><TableArt state={table.state} /></div>
        <div>
          <h2 className="display">Bàn {table.code}</h2>
          <span className={`chip ${STATE_CHIP[table.state]}`}>{STATE_LABEL[table.state]}</span>
          {table.sessionOpenedAt && <span className="hint"> · khách vào {since(table.sessionOpenedAt, now)} trước</span>}
        </div>
        <span className="spacer" />
        <button className="btn ghost small icon-only" onClick={onClose}><Icon name="x" /></button>
      </div>

      {!table.sessionId ? (
        <div className="empty"><Icon name="table" />Bàn đang trống. Phiên mới tự mở khi khách quét QR.</div>
      ) : (
        <div className="detail-grid">
          <div className="detail-orders">
            {orders.length === 0 && <div className="empty"><Icon name="receipt" />Chưa gọi món</div>}
            {orders.map((o) => (
              <div key={o.id} className="order-card">
                <div className="order-head">
                  <strong>Đơn #{o.id}</strong>
                  <span>{o.guestName || 'Khách'}</span>
                  <span>· {new Date(o.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="money">{formatVnd(o.total)}</span>
                </div>
                {o.items.map((i) => (
                  <div key={i.id} className={`order-line ${i.status === 'CANCELLED' ? 'cancelled' : ''}`}>
                    <span className="nm">
                      {i.quantity}× {i.name}
                      {i.cancelReason && <em className="note">{VOID_REASON[i.cancelReason]}{i.cancelNote ? `: ${i.cancelNote}` : ''} ({i.cancelledBy})</em>}
                    </span>
                    <span className={`chip chip-${ITEM_STATUS[i.status]?.tone}`}>{i.cancelReason === 'RETURNED' ? 'Trả lại' : ITEM_STATUS[i.status]?.short}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <div className="card card-pad bill">
              <div className="ln"><span>Tiền món</span><span className="money">{formatVnd(bill.subtotal)}</span></div>
              <div className="ln"><span>VAT</span><span className="money">{formatVnd(bill.vat)}</span></div>
              <div className="ln"><span>Tổng cộng</span><strong className="money">{formatVnd(bill.total)}</strong></div>
              {bill.paid > 0 && <div className="ln"><span>Đã thanh toán</span><span className="money">− {formatVnd(bill.paid)}</span></div>}
              <div className="ln total">
                <span>{bill.remaining < 0 ? 'Trả lại khách' : 'Còn phải thu'}</span>
                <span className="money">{formatVnd(Math.abs(bill.remaining))}</span>
              </div>
            </div>
            {bill.remaining < 0 && (
              <div className="banner warn"><Icon name="undo" />Khách đã trả dư {formatVnd(-bill.remaining)} (món bị huỷ sau khi thanh toán). Trả lại tiền trước khi trả bàn.</div>
            )}

            {pending ? (
              pending.method === 'VNPAY' && pending.payUrl ? (
                <div className="qr-pay">
                  <span className="eyebrow">Mời khách quét mã</span>
                  <div className="qr"><QRCodeSVG value={pending.payUrl} size={180} level="M" /></div>
                  <strong className="money" style={{ fontSize: 22 }}>{formatVnd(pending.amount)}</strong>
                  <span className="timer"><Icon name="clock" />Hết hạn sau {countdown(pending.expiresAt, now)}</span>
                  <span className="hint">Quét bằng app ngân hàng / VNPay. Quầy tự cập nhật khi cổng báo đã thanh toán.</span>
                  <div className="pay-actions">
                    <a className="btn small" href={pending.payUrl} target="_blank" rel="noreferrer"><Icon name="arrowRight" size={15} />Mở link</a>
                    <button className="btn small danger" onClick={() => onCancelPayment(pending)}>Huỷ</button>
                  </div>
                </div>
              ) : (
                <div className="banner warn">
                  <Icon name={pending.method === 'VNPAY' ? 'qr' : 'cash'} />
                  <div style={{ flex: 1 }}>
                    Đang chờ <strong>{METHOD_LABEL[pending.method]}</strong> · {formatVnd(pending.amount)}
                    <div className="timer">Hết hạn sau {countdown(pending.expiresAt, now)}</div>
                  </div>
                  <div className="pay-actions">
                    {pending.method === 'CASH' && <button className="btn small ok" onClick={() => onConfirm(pending)}><Icon name="check" size={15} />Đã nhận tiền</button>}
                    <button className="btn small" onClick={() => onCancelPayment(pending)}>Huỷ</button>
                  </div>
                </div>
              )
            ) : (
              bill.remaining > 0 && (
                <div className="grid-2e" style={{ gap: 10 }}>
                  <button className="btn primary" onClick={() => onCreate('CASH')}><Icon name="cash" size={18} />Tiền mặt</button>
                  {bill.methods.includes('VNPAY') && <button className="btn gold" onClick={() => onCreate('VNPAY')}><Icon name="qr" size={18} />Thanh toán QR</button>}
                </div>
              )
            )}

            {bill.payments.length > 0 && (
              <div className="card card-pad" style={{ display: 'grid', gap: 8 }}>
                <strong>Lịch sử thanh toán</strong>
                {bill.payments.map((p) => (
                  <div key={p.id} className="order-line">
                    <span className="nm">#{p.id} · {METHOD_LABEL[p.method]} · <span className="money">{formatVnd(p.amount)}</span></span>
                    <span className={`chip ${p.status === 'PAID' ? 'chip-ok' : p.status === 'PENDING' ? 'chip-gold' : ''}`}>{PAY_STATUS[p.status] || p.status}</span>
                    {p.needsRefund && <span className="chip chip-danger">Cần hoàn tiền</span>}
                  </div>
                ))}
              </div>
            )}

            <button className="btn lg block" disabled={!!pending} onClick={onCheckout}><Icon name="door" size={18} />Trả bàn</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Hỏi lại khi trả bàn: xác nhận đã trả tiền dư, hoặc chọn lý do khi bàn còn nợ / còn món. */
function CheckoutDialog({ table, message, details, body, onClose, onSubmit }) {
  const needRefund = details.refundDue > 0 && !body.refundReturned;
  const [refunded, setRefunded] = useState(false);
  const [reason, setReason] = useState(REASONS[0][0]);
  const [note, setNote] = useState('');
  return (
    <div className="modal-backdrop center" style={{ zIndex: 60 }} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Trả bàn {table.code}</h3><p className="hint">{message}</p></div>
          <span className="spacer" />
          <button className="btn ghost small icon-only" onClick={onClose}><Icon name="x" /></button>
        </div>
        {needRefund ? (
          <label className="reason"><input type="checkbox" checked={refunded} onChange={(e) => setRefunded(e.target.checked)} />Đã trả lại khách {formatVnd(details.refundDue)}</label>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="reason-grid">
              {REASONS.map(([k, label]) => (
                <label key={k} className="reason"><input type="radio" checked={reason === k} onChange={() => setReason(k)} />{label}</label>
              ))}
            </div>
            <label className="field">Ghi chú<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Đóng</button>
          <button
            className="btn primary"
            disabled={needRefund ? !refunded : reason === 'OTHER' && !note.trim()}
            onClick={() => onSubmit(needRefund ? { ...body, refundReturned: true } : { ...body, reason, note })}
          >
            Xác nhận trả bàn
          </button>
        </div>
      </div>
    </div>
  );
}
