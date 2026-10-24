import { useCallback, useEffect, useRef, useState } from 'react';
import ConnectionBadge from '../components/ConnectionBadge.jsx';
import Login from '../components/Login.jsx';
import { ApiError, getStaffSession, request, setStaffSession, wsUrl } from '../lib/api.js';
import { RealtimeConnection } from '../lib/connection.js';
import { ITEM_STATUS, VOID_REASON, formatVnd, minutesSince } from '../lib/format.js';

const STATE_LABEL = {
  EMPTY: 'Trống',
  DINING: 'Đang ăn',
  AWAITING_PAYMENT: 'Chờ thanh toán',
  PAID: 'Đã thanh toán',
  REFUND_DUE: 'Cần trả lại tiền',
  OUT_OF_SERVICE: 'Ngừng phục vụ',
};
const METHOD_LABEL = { CASH: 'Tiền mặt', VNPAY: 'VNPay' };
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
    return (
      <Login
        title="💵 Đăng nhập thu ngân"
        allowedRoles={['CASHIER', 'ADMIN']}
        onLogin={setSession}
        hint="Tài khoản mẫu: thungan / thungan123"
      />
    );
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

  const loadDetail = useCallback(
    async (id) => {
      if (!id) return;
      setDetail(await api('GET', `/api/cashier/tables/${id}`));
    },
    [api],
  );

  // Nhiều sự kiện tới dồn dập (VD bếp cập nhật nhiều món) -> gộp lại, tải lại một lần sau 300 ms
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
    const connection = new RealtimeConnection({
      url: wsUrl(),
      connectHeaders: { Authorization: `Bearer ${token}` },
      onStatus: (status, info) => setConn({ status, info }),
      onConnected: (client) => {
        // /topic/cashier: TABLE_STATE_CHANGED, PAYMENT_UPDATED, SERVICE_CALL_UPDATED -> sơ đồ bàn tự cập nhật
        client.subscribe('/topic/cashier', (msg) => {
          if (msg.type === 'PAYMENT_UPDATED' && msg.payment?.status === 'PAID') {
            setToast(`Bàn ${msg.payment.tableCode}: đã nhận ${formatVnd(msg.payment.amount)} (${METHOD_LABEL[msg.payment.method]})`);
          }
          if (msg.type === 'SERVICE_CALL_UPDATED' && !msg.call.handledAt) {
            setToast(`🙋 Bàn ${msg.call.tableCode} gọi phục vụ${msg.call.guestName ? ` (${msg.call.guestName})` : ''}`);
            beep();
          }
          scheduleReload();
        });
        scheduleReload(); // kết nối lại: đồng bộ toàn bộ
      },
    });
    connection.start();
    const clock = setInterval(() => setNow(Date.now()), 30_000);
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
      if (e.code === 'VERSION_CONFLICT') {
        loadTables().catch(() => {});
        if (selected) loadDetail(selected).catch(() => {});
      }
    }
  }

  // Trả bàn: server có thể hỏi xác nhận (409 CONFIRM_REQUIRED) -> hỏi thu ngân rồi gửi lại kèm câu trả lời.
  // Hai loại xác nhận: đã trả lại tiền dư cho khách (details.refundDue), lý do khi còn nợ / còn món.
  async function checkout(t) {
    const body = {};
    try {
      for (;;) {
        try {
          await api('POST', `/api/cashier/tables/${t.id}/checkout`, body);
          break;
        } catch (e) {
          if (e.code !== 'CONFIRM_REQUIRED') throw e;
          if (e.details?.refundDue > 0 && !body.refundReturned) {
            if (!window.confirm(`${e.message}\n\nĐã trả lại khách ${formatVnd(e.details.refundDue)}?`)) return;
            body.refundReturned = true;
          } else if (!body.reason) {
            const choice = window.prompt(
              `${e.message}\n\nNhập số lý do:\n${REASONS.map(([, label], i) => `${i + 1}. ${label}`).join('\n')}`,
              '1',
            );
            const reason = REASONS[Number(choice) - 1];
            if (!reason) return;
            body.reason = reason[0];
            body.note = reason[0] === 'OTHER' ? window.prompt('Ghi chú lý do:') || '' : '';
          } else {
            throw e;
          }
        }
      }
      setToast(`Đã trả bàn ${t.code}`);
      setSelected(null);
      await loadTables();
    } catch (e) {
      setToast(e.message);
      loadTables().catch(() => {});
    }
  }

  const counts = tables.reduce((m, t) => ({ ...m, [t.state]: (m[t.state] || 0) + 1 }), {});

  return (
    <div className="cashier">
      <header className="admin-header">
        <h1>💵 Thu ngân</h1>
        <div className="cashier-legend">
          {Object.entries(STATE_LABEL).map(([k, label]) => (
            <span key={k}>
              {label}: <strong>{counts[k] || 0}</strong>
            </span>
          ))}
        </div>
        <ConnectionBadge status={conn.status} info={conn.info} />
        <span className="hint">{session.username}</span>
        <button className="btn small" onClick={onLogout}>
          Đăng xuất
        </button>
      </header>

      {calls.length > 0 && (
        <section className="service-calls">
          <h2>🙋 Khách gọi phục vụ ({calls.length})</h2>
          {calls.map((c) => (
            <div key={c.id} className="service-call">
              <span className="who">
                <strong>Bàn {c.tableCode}</strong>
                {c.guestName && ` · ${c.guestName}`} · {minutesSince(c.createdAt, now)} phút trước
              </span>
              <button
                className="btn small ok"
                onClick={() => act(() => api('POST', `/api/cashier/service-calls/${c.id}/handle`), `Đã xử lý bàn ${c.tableCode}`)}
              >
                Đã xử lý
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="cashier-grid">
        {tables.map((t) => (
          <button key={t.id} className={`cashier-card state-${t.state} ${t.serviceCall ? 'calling' : ''}`} onClick={() => open(t.id)}>
            <h3>Bàn {t.code}</h3>
            <span className="state">{STATE_LABEL[t.state]}</span>
            {t.serviceCall && <span className="call">🙋 Đang gọi phục vụ</span>}
            {t.sessionId && (
              <>
                <span className="money">{formatVnd(t.total)}</span>
                <span className="hint">
                  {t.orderCount} đơn · {minutesSince(t.sessionOpenedAt, now)} phút
                  {t.activeItemCount > 0 && ` · ${t.activeItemCount} món chưa ra`}
                </span>
                {t.pending && (
                  <span>
                    {METHOD_LABEL[t.pending.method]}: <strong>{formatVnd(t.pending.amount)}</strong>
                  </span>
                )}
                {t.refundDue > 0 && <span className="refund">↩ Trả lại khách {formatVnd(t.refundDue)}</span>}
                {t.needsRefund && <span className="refund">⚠ Cần hoàn tiền</span>}
              </>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <div className="modal-backdrop center" onClick={() => setSelected(null)}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            {!detail ? (
              <p>Đang tải...</p>
            ) : (
              <TableDetail
                detail={detail}
                onClose={() => setSelected(null)}
                onCreateCash={() =>
                  act(() => api('POST', `/api/cashier/tables/${detail.table.id}/payments`), 'Đã tạo lần thu tiền mặt')
                }
                onConfirm={(p) =>
                  act(() => api('PATCH', `/api/cashier/payments/${p.id}/confirm`, { version: p.version }), 'Đã xác nhận nhận tiền')
                }
                onCancelPayment={(p) => act(() => api('POST', `/api/cashier/payments/${p.id}/cancel`), 'Đã huỷ lần thanh toán')}
                onCheckout={() => checkout(detail.table)}
              />
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function TableDetail({ detail, onClose, onCreateCash, onConfirm, onCancelPayment, onCheckout }) {
  const { table, bill, orders } = detail;
  const pending = bill.pending;
  return (
    <>
      <div className="panel-head">
        <h2>
          Bàn {table.code} · {STATE_LABEL[table.state]}
        </h2>
        <button className="btn small" onClick={onClose}>
          Đóng
        </button>
      </div>

      {!table.sessionId ? (
        <p className="hint">Bàn đang trống. Phiên mới tự mở khi khách quét QR.</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Đơn</th>
                <th>Người đặt</th>
                <th>Món</th>
                <th>Tiền</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>{o.guestName || '—'}</td>
                  <td>
                    {o.items.map((i) => (
                      <div key={i.id}>
                        {i.quantity}× {i.name}{' '}
                        <span className={`chip chip-${ITEM_STATUS[i.status]?.tone}`}>
                          {i.cancelReason === 'RETURNED' ? 'Trả lại' : ITEM_STATUS[i.status]?.short}
                        </span>
                        {i.cancelReason && (
                          <span className="hint">
                            {' '}
                            {VOID_REASON[i.cancelReason]}
                            {i.cancelNote ? `: ${i.cancelNote}` : ''} ({i.cancelledBy})
                          </span>
                        )}
                      </div>
                    ))}
                  </td>
                  <td>{formatVnd(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bill-summary">
            <div className="order-line">
              <span>Tổng (không tính món huỷ)</span>
              <strong>{formatVnd(bill.total)}</strong>
            </div>
            <div className="order-line">
              <span>Đã thanh toán</span>
              <span>{formatVnd(bill.paid)}</span>
            </div>
            <div className="order-line total-line">
              <span>{bill.remaining < 0 ? 'Cần trả lại khách' : 'Còn phải trả'}</span>
              <strong>{formatVnd(Math.abs(bill.remaining))}</strong>
            </div>
          </div>
          {bill.remaining < 0 && (
            <div className="banner warn">
              Khách đã trả dư {formatVnd(-bill.remaining)} (có món bị huỷ / trả lại sau khi thanh toán). Trả lại tiền cho khách
              trước khi bấm Trả bàn.
            </div>
          )}

          {pending ? (
            <div className="banner warn pay-banner">
              <div>
                Đang chờ: <strong>{METHOD_LABEL[pending.method]}</strong> · {formatVnd(pending.amount)} · hết hạn lúc{' '}
                {new Date(pending.expiresAt).toLocaleTimeString('vi-VN')}
                {pending.method === 'VNPAY' && <div className="hint">VNPay được xác nhận tự động khi cổng báo về.</div>}
              </div>
              <div className="pay-actions">
                {pending.method === 'CASH' && (
                  <button className="btn small ok" onClick={() => onConfirm(pending)}>
                    Đã nhận tiền
                  </button>
                )}
                <button className="btn small" onClick={() => onCancelPayment(pending)}>
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            bill.remaining > 0 && (
              <button className="btn primary" onClick={onCreateCash}>
                Thu tiền mặt {formatVnd(bill.remaining)}
              </button>
            )
          )}

          {bill.payments.length > 0 && (
            <div>
              <h3>Các lần thanh toán</h3>
              {bill.payments.map((p) => (
                <div key={p.id} className="order-line">
                  <span>
                    #{p.id} · {METHOD_LABEL[p.method]} · {formatVnd(p.amount)}
                  </span>
                  <span>
                    {p.status}
                    {p.needsRefund && <span className="chip chip-danger">Cần hoàn tiền</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="modal-actions">
            <button className="btn primary" disabled={!!pending} onClick={onCheckout}>
              Trả bàn
            </button>
          </div>
        </>
      )}
    </>
  );
}
