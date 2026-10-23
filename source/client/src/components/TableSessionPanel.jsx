import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { minutesSince } from '../lib/format.js';

/**
 * Dọn bàn (kết thúc phiên của khách cũ, mở phiên mới cho khách sau).
 * Nếu bàn còn món chưa phục vụ, server trả 409 TABLE_HAS_ACTIVE_ORDERS -> hỏi lại rồi gửi force=true.
 * @return true nếu đã dọn, false nếu người dùng huỷ.
 */
export async function resetTableSession(token, tableId) {
  try {
    await request('POST', `/api/kitchen/tables/${tableId}/reset-session`, { token });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'TABLE_HAS_ACTIVE_ORDERS') {
      if (!window.confirm(`${e.message}. Vẫn dọn bàn và bắt đầu lượt khách mới?`)) return false;
      await request('POST', `/api/kitchen/tables/${tableId}/reset-session?force=true`, { token });
      return true;
    }
    throw e;
  }
}

/** Cửa sổ danh sách bàn trên màn hình bếp. */
export default function TableSessionPanel({ token, onClose, onMessage }) {
  const [tables, setTables] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setTables((await request('GET', '/api/kitchen/tables', { token })).data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function reset(t) {
    setBusy(t.id);
    try {
      if (await resetTableSession(token, t.id)) {
        onMessage?.(`Đã dọn bàn ${t.code}: khách sau sẽ không thấy đơn cũ`);
        await load();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop center" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>🪑 Bàn & lượt khách</h2>
          <button className="btn small" onClick={onClose}>
            Đóng
          </button>
        </div>
        <p className="hint">
          Bấm <b>Dọn bàn</b> khi khách đã rời đi: lượt khách cũ kết thúc, khách sau quét QR sẽ bắt đầu một lượt mới và không
          thấy đơn của khách trước.
        </p>
        {error && <p className="error">{error}</p>}
        {!tables && !error && <p>Đang tải...</p>}
        {tables && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Bàn</th>
                <th>Trạng thái</th>
                <th>Lượt khách bắt đầu</th>
                <th>Số đơn</th>
                <th>Món chưa phục vụ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id}>
                  <td>
                    <b>{t.code}</b>
                  </td>
                  <td>
                    <span className={`chip ${t.status === 'OPEN' ? 'chip-ok' : 'chip-muted'}`}>
                      {t.status === 'OPEN' ? 'Đang mở' : 'Đóng'}
                    </span>
                  </td>
                  <td>{t.sessionOpenedAt ? `${minutesSince(t.sessionOpenedAt)} phút trước` : '-'}</td>
                  <td>{t.orderCount}</td>
                  <td>{t.activeItemCount > 0 ? <span className="chip chip-warn">{t.activeItemCount}</span> : 0}</td>
                  <td>
                    <button className="btn small primary" disabled={busy === t.id} onClick={() => reset(t)}>
                      {t.status === 'OPEN' ? 'Dọn bàn' : 'Mở lượt mới'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
