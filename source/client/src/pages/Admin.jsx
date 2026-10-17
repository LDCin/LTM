import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Login from '../components/Login.jsx';
import { ApiError, getStaffSession, request, setStaffSession } from '../lib/api.js';
import { formatVnd } from '../lib/format.js';

const TABS = [
  ['tables', '🪑 Bàn & QR'],
  ['menu', '📋 Thực đơn'],
  ['monitor', '📡 Giám sát'],
  ['settings', '🧪 Cấu hình thực nghiệm'],
];

export default function Admin() {
  const [session, setSession] = useState(() => {
    const s = getStaffSession();
    return s?.role === 'ADMIN' ? s : null;
  });
  const [tab, setTab] = useState('tables');
  const logout = useCallback(() => {
    setStaffSession(null);
    setSession(null);
  }, []);

  if (!session) {
    return <Login title="⚙️ Đăng nhập quản trị" allowedRoles={['ADMIN']} onLogin={setSession} hint="Tài khoản mẫu: admin / admin123" />;
  }

  const api = async (method, path, body) => {
    try {
      return (await request(method, path, { token: session.token, body })).data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout();
      throw e;
    }
  };

  return (
    <div className="admin">
      <header className="admin-header">
        <h1>⚙️ Quản trị</h1>
        <nav>
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="btn small" onClick={logout}>
          Đăng xuất
        </button>
      </header>
      <main className="admin-body">
        {tab === 'tables' && <TablesTab api={api} />}
        {tab === 'menu' && <MenuTab api={api} />}
        {tab === 'monitor' && <MonitorTab api={api} />}
        {tab === 'settings' && <SettingsTab api={api} />}
      </main>
    </div>
  );
}

function useAsync(loader, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    try {
      setData(await loader());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

// ------------------------------------------------------------------ bàn & QR

function TablesTab({ api }) {
  const { data: tables, error, reload } = useAsync(() => api('GET', '/api/admin/tables'), []);
  const [baseUrl, setBaseUrl] = useState(window.location.origin);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);

  async function act(fn) {
    try {
      await fn();
      setMsg(null);
      reload();
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <label>
          Địa chỉ in trong QR (dùng IP LAN để điện thoại truy cập được):
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={{ width: 280 }} />
        </label>
        <input placeholder="Mã bàn mới (VD B13)" value={code} onChange={(e) => setCode(e.target.value)} />
        <button
          className="btn primary"
          disabled={!code}
          onClick={() =>
            act(async () => {
              await api('POST', '/api/admin/tables', { code });
              setCode('');
            })
          }
        >
          Thêm bàn
        </button>
        <button className="btn" onClick={() => window.print()}>
          In QR
        </button>
      </div>
      {(error || msg) && <p className="error">{error || msg}</p>}
      {window.location.hostname === 'localhost' && (
        <p className="hint">
          Bạn đang mở bằng localhost: điện thoại sẽ không truy cập được. Hãy mở trang này bằng địa chỉ IP LAN của máy chủ
          (VD http://192.168.1.10:5173/admin) hoặc sửa ô địa chỉ ở trên.
        </p>
      )}
      <div className="table-grid">
        {tables
          ?.filter((t) => !t.code.startsWith('LT'))
          .map((t) => {
            const url = `${baseUrl.replace(/\/$/, '')}/t/${t.qrToken}`;
            return (
              <div key={t.id} className={`table-card ${t.status === 'OPEN' ? 'open' : ''}`}>
                <div className="table-card-head">
                  <strong>Bàn {t.code}</strong>
                  <span className={`chip ${t.status === 'OPEN' ? 'chip-ok' : 'chip-muted'}`}>
                    {t.status === 'OPEN' ? 'Đang mở' : 'Đóng'}
                  </span>
                </div>
                <QRCodeSVG value={url} size={150} />
                <a className="qr-link" href={url} target="_blank" rel="noreferrer">
                  Mở link gọi món
                </a>
                <div className="table-card-actions no-print">
                  {t.status === 'OPEN' ? (
                    <button className="btn small" onClick={() => act(() => api('POST', `/api/admin/tables/${t.id}/close`))}>
                      Đóng bàn
                    </button>
                  ) : (
                    <button className="btn small primary" onClick={() => act(() => api('POST', `/api/admin/tables/${t.id}/open`))}>
                      Mở bàn
                    </button>
                  )}
                  <button
                    className="btn small"
                    onClick={() =>
                      window.confirm(`Đổi mã QR bàn ${t.code}? Mã cũ sẽ không dùng được nữa.`) &&
                      act(() => api('POST', `/api/admin/tables/${t.id}/rotate-token`))
                    }
                  >
                    Đổi mã QR
                  </button>
                </div>
              </div>
            );
          })}
      </div>
      {tables?.some((t) => t.code.startsWith('LT')) && (
        <p className="hint">Đã ẩn {tables.filter((t) => t.code.startsWith('LT')).length} bàn tạo bởi load test (mã LT...).</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ thực đơn

const EMPTY_ITEM = { name: '', description: '', price: 0, available: true, stock: '', station: 'KITCHEN', categoryId: '' };

function MenuTab({ api }) {
  const { data, error, reload } = useAsync(async () => {
    const [items, categories] = await Promise.all([api('GET', '/api/admin/menu-items'), api('GET', '/api/admin/categories')]);
    return { items, categories };
  }, []);
  const [drafts, setDrafts] = useState({});
  const [newItem, setNewItem] = useState(EMPTY_ITEM);
  const [msg, setMsg] = useState(null);

  const toRequest = (i) => ({
    categoryId: Number(i.categoryId),
    name: i.name,
    description: i.description || null,
    price: Number(i.price),
    imageUrl: i.imageUrl || null,
    available: !!i.available,
    stock: i.stock === '' || i.stock === null || i.stock === undefined ? null : Number(i.stock),
    station: i.station,
  });

  async function save(item) {
    try {
      await api('PUT', `/api/admin/menu-items/${item.id}`, toRequest({ ...item, ...drafts[item.id] }));
      setDrafts((d) => ({ ...d, [item.id]: undefined }));
      setMsg(`Đã lưu "${item.name}"`);
      reload();
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function create() {
    try {
      await api('POST', '/api/admin/menu-items', toRequest(newItem));
      setNewItem(EMPTY_ITEM);
      setMsg('Đã thêm món');
      reload();
    } catch (e) {
      setMsg(e.message);
    }
  }

  if (!data) return <p>{error || 'Đang tải...'}</p>;
  const catName = (id) => data.categories.find((c) => c.id === id)?.name;
  const edit = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  return (
    <div>
      {msg && <p className="hint">{msg}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Món</th>
            <th>Danh mục</th>
            <th>Giá</th>
            <th>Còn bán</th>
            <th>Tồn kho (trống = không giới hạn)</th>
            <th>Trạm</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => {
            const d = { ...item, ...drafts[item.id] };
            const dirty = !!drafts[item.id];
            return (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{catName(item.categoryId)}</td>
                <td>
                  <input type="number" value={d.price} onChange={(e) => edit(item.id, { price: e.target.value })} style={{ width: 100 }} />
                  <div className="hint">{formatVnd(d.price)}</div>
                </td>
                <td>
                  <input type="checkbox" checked={!!d.available} onChange={(e) => edit(item.id, { available: e.target.checked })} />
                </td>
                <td>
                  <input
                    type="number"
                    value={d.stock ?? ''}
                    onChange={(e) => edit(item.id, { stock: e.target.value })}
                    style={{ width: 80 }}
                  />
                </td>
                <td>{item.station === 'BAR' ? 'Quầy nước' : 'Bếp'}</td>
                <td>
                  <button className="btn small primary" disabled={!dirty} onClick={() => save(item)}>
                    Lưu
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Thêm món mới</h3>
      <div className="toolbar">
        <input placeholder="Tên món" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
        <select value={newItem.categoryId} onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}>
          <option value="">-- Danh mục --</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input type="number" placeholder="Giá" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} />
        <input type="number" placeholder="Tồn kho" value={newItem.stock} onChange={(e) => setNewItem({ ...newItem, stock: e.target.value })} />
        <select value={newItem.station} onChange={(e) => setNewItem({ ...newItem, station: e.target.value })}>
          <option value="KITCHEN">Bếp</option>
          <option value="BAR">Quầy nước</option>
        </select>
        <button className="btn primary" disabled={!newItem.name || !newItem.categoryId} onClick={create}>
          Thêm
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ giám sát

function MonitorTab({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await api('GET', '/api/admin/monitor');
        if (alive) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p>{error || 'Đang tải...'}</p>;
  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="stat-grid">
        <Stat label="Chế độ giao đơn" value={data.settings.deliveryMode} />
        <Stat label="Seq mới nhất" value={data.latestSeq} />
        <Stat label="Màn hình bếp online" value={data.staffConnections} />
        <Stat label="Khách đang kết nối" value={data.customerConnections} />
        {Object.entries(data.counters).map(([k, v]) => (
          <Stat key={k} label={COUNTER_LABELS[k] || k} value={v} />
        ))}
        <Stat label="Thread JVM" value={data.jvm.threads} />
        <Stat label="Heap (MB)" value={`${data.jvm.heapUsedMb} / ${data.jvm.heapMaxMb}`} />
        <Stat label="Bucket rate-limit" value={data.rateLimitBuckets} />
      </div>
      <h3>Kết nối WebSocket ({data.connections.length})</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Loại</th>
            <th>Tên</th>
            <th>Kết nối lúc</th>
            <th>ACK seq</th>
            <th>Độ trễ (seq chưa ACK)</th>
          </tr>
        </thead>
        <tbody>
          {data.connections.map((c) => (
            <tr key={c.sessionId}>
              <td className="mono">{c.sessionId.slice(0, 8)}</td>
              <td>{c.role === 'STAFF' ? 'Bếp' : 'Khách'}</td>
              <td>{c.label}</td>
              <td>{new Date(c.connectedAt).toLocaleTimeString('vi-VN')}</td>
              <td>{c.role === 'STAFF' ? c.lastAckSeq : '-'}</td>
              <td>{c.lag ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COUNTER_LABELS = {
  ordersCreated: 'Đơn đã tạo',
  duplicateRequestsBlocked: 'Request trùng bị chặn',
  rateLimited: 'Request bị giới hạn (429)',
  versionConflicts: 'Xung đột phiên bản (409)',
  wsConnectRejected: 'Kết nối WS bị từ chối',
  eventsPublished: 'Sự kiện đã phát',
  replayRequests: 'Yêu cầu RESUME',
};

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-value">{String(value)}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------ cấu hình thực nghiệm

function SettingsTab({ api }) {
  const { data, error, reload } = useAsync(() => api('GET', '/api/admin/settings'), []);
  const [msg, setMsg] = useState(null);

  async function update(patch) {
    try {
      await api('PUT', '/api/admin/settings', patch);
      setMsg('Đã cập nhật. Màn hình bếp cần tải lại để dùng chế độ giao đơn mới.');
      reload();
    } catch (e) {
      setMsg(e.message);
    }
  }

  if (!data) return <p>{error || 'Đang tải...'}</p>;
  return (
    <div className="settings">
      <p className="hint">
        Dùng để chạy thực nghiệm so sánh baseline và giải pháp đề xuất trên cùng một hệ thống, không cần khởi động lại server.
      </p>
      <label>
        Chế độ giao đơn tới bếp
        <select value={data.deliveryMode} onChange={(e) => update({ deliveryMode: e.target.value })}>
          <option value="RELIABLE_PUSH">RELIABLE_PUSH: WebSocket + seq/ACK/RESUME (đề xuất)</option>
          <option value="NAIVE_PUSH">NAIVE_PUSH: WebSocket không đảm bảo (baseline B)</option>
          <option value="POLLING">POLLING: bếp hỏi định kỳ 3s (baseline A)</option>
        </select>
      </label>
      <Toggle label="Idempotency-Key (chống đặt trùng)" value={data.idempotencyEnabled} onChange={(v) => update({ idempotencyEnabled: v })} />
      <Toggle label="Optimistic locking (chống ghi đè trạng thái)" value={data.optimisticLockEnabled} onChange={(v) => update({ optimisticLockEnabled: v })} />
      <Toggle label="Rate limiting (token bucket)" value={data.rateLimitEnabled} onChange={(v) => update({ rateLimitEnabled: v })} />
      <Toggle
        label="Tin header X-Forwarded-For (chỉ dùng khi thực nghiệm giả lập nhiều IP)"
        value={data.trustForwardedFor}
        onChange={(v) => update({ trustForwardedFor: v })}
      />
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
