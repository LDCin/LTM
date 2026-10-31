import { useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import AppShell from '../components/AppShell.jsx';
import Icon from '../components/Icon.jsx';
import Login from '../components/Login.jsx';
import TableArt from '../components/TableArt.jsx';
import { ApiError, getStaffSession, request, setStaffSession, wsUrl } from '../lib/api.js';
import { RealtimeConnection } from '../lib/connection.js';
import { VOID_REASON, categoryIcon, formatVnd } from '../lib/format.js';

const TABS = [
  { key: 'overview', label: 'Thống kê kinh doanh', icon: 'chart' },
  { key: 'tables', label: 'Bàn & mã QR', icon: 'qr' },
  { key: 'menu', label: 'Thực đơn & VAT', icon: 'menu' },
  { key: 'payments', label: 'Lịch sử thanh toán', icon: 'card' },
  { key: 'settings', label: 'Cấu hình thực nghiệm', icon: 'settings' },
];

export default function Admin() {
  const [session, setSession] = useState(() => {
    const s = getStaffSession();
    return s?.role === 'ADMIN' ? s : null;
  });
  const [tab, setTab] = useState('overview');
  const [toast, setToast] = useState(null);
  const logout = useCallback(() => {
    setStaffSession(null);
    setSession(null);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const api = useCallback(
    async (method, path, body) => {
      try {
        return (await request(method, path, { token: session?.token, body })).data;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) logout();
        throw e;
      }
    },
    [session, logout],
  );

  if (!session) {
    return <Login title="Đăng nhập quản lý" icon="chart" allowedRoles={['ADMIN']} onLogin={setSession} hint="Tài khoản mẫu: admin / admin123" />;
  }
  const current = TABS.find((t) => t.key === tab);

  return (
    <AppShell area="Quản lý nhà hàng" session={session} onLogout={logout} nav={TABS} active={tab} onNav={setTab} title={current.label}>
      {tab === 'overview' && <OverviewTab api={api} />}
      {tab === 'tables' && <TablesTab api={api} token={session.token} notify={setToast} />}
      {tab === 'menu' && <MenuTab api={api} notify={setToast} />}
      {tab === 'payments' && <PaymentsTab api={api} />}
      {tab === 'settings' && <SettingsTab api={api} notify={setToast} />}
      {toast && <div className="toast"><Icon name="info" />{toast}</div>}
    </AppShell>
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

// ------------------------------------------------------------------ thống kê kinh doanh

const DAY = 86_400_000;
const RANGES = [
  ['today', 'Hôm nay'],
  ['7d', '7 ngày'],
  ['30d', '30 ngày'],
  ['month', 'Tháng này'],
];
const PALETTE = ['#b3352a', '#c0892b', '#2e7550', '#2c5f8d', '#7a4f9a', '#85756a'];
const METHOD = { CASH: 'Tiền mặt', VNPAY: 'QR VNPay' };
const REASON = { ...VOID_REASON, CUSTOMER: 'Khách huỷ / bếp từ chối' };

function rangeOf(key) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const to = start.getTime() + DAY;
  if (key === 'today') return { from: start.getTime(), to };
  if (key === 'month') return { from: new Date(start.getFullYear(), start.getMonth(), 1).getTime(), to };
  return { from: to - (key === '7d' ? 7 : 30) * DAY, to };
}

/** Làm tròn giá trị lớn nhất của trục y lên mốc đẹp (1, 2, 2.5, 5 × 10^k) để 4 vạch chia đều. */
function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const short = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}tr` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));

function OverviewTab({ api }) {
  const [range, setRange] = useState('7d');
  const tz = -new Date().getTimezoneOffset();
  const { data, error, reload } = useAsync(() => {
    const { from, to } = rangeOf(range);
    return api('GET', `/api/admin/reports?from=${from}&to=${to}&tzOffsetMinutes=${tz}`);
  }, [range]);

  const days = useMemo(() => {
    if (!data) return [];
    const byDay = new Map(data.revenueByDay.map((d) => [d.day_index, d.revenue]));
    const out = [];
    for (let t = data.from; t < data.to; t += DAY) {
      const idx = Math.floor((t + tz * 60000) / DAY);
      out.push({ label: new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }), value: byDay.get(idx) || 0 });
    }
    return out;
  }, [data, tz]);

  if (error) return <div className="banner danger"><Icon name="alert" />{error}</div>;
  const s = data?.summary;
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${h}h`, value: data?.ordersByHour.find((x) => x.hour_of_day === h)?.orders || 0 }));
  const maxTop = Math.max(1, ...(data?.topItems || []).map((i) => i.quantity));

  return (
    <>
      <div className="row">
        <div className="seg">
          {RANGES.map(([k, label]) => <button key={k} className={range === k ? 'active' : ''} onClick={() => setRange(k)}>{label}</button>)}
        </div>
        <span className="spacer" />
        <button className="btn small" onClick={reload}><Icon name="refresh" size={15} />Làm mới</button>
      </div>

      {!s ? (
        <div className="kpis">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 140, borderRadius: 20 }} />)}</div>
      ) : (
        <div className="kpis stagger">
          <Kpi cls="hero-kpi" icon="trend" label="Doanh thu đã thu" value={formatVnd(s.revenue)} sub={`${s.payments} lần thanh toán`} />
          <Kpi cls="gold" icon="receipt" label="Đơn gọi món" value={s.orders} sub={`${s.sessions} lượt khách`} />
          <Kpi cls="ok" icon="bowl" label="Món đã bán" value={s.itemsSold} sub={`Doanh số ${formatVnd(s.grossSales)}`} />
          <Kpi cls="info" icon="users" label="Trung bình / lượt khách" value={formatVnd(s.sessions ? Math.round(s.revenue / s.sessions) : 0)} sub={`VAT đã tính ${formatVnd(s.vat)}`} />
          <Kpi icon="x" label="Món bị huỷ" value={s.itemsCancelled} sub={`Giá trị ${formatVnd(s.cancelledValue)}`} />
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h3><Icon name="bars" />Doanh thu theo ngày</h3></div>
          <div className="card-pad">{data ? <BarChart data={days} format={formatVnd} /> : <div className="skeleton" style={{ height: 220 }} />}</div>
        </section>
        <section className="card">
          <div className="card-head"><h3><Icon name="flame" />Món bán chạy</h3></div>
          <div className="card-pad top-list">
            {data?.topItems.length === 0 && <div className="empty"><Icon name="bowl" />Chưa có món nào được bán</div>}
            {data?.topItems.map((it, i) => (
              <div key={it.id} className="top-item">
                <span className="rk">{i + 1}</span>
                {it.image_url ? <img src={it.image_url} alt="" /> : <span className="noimg"><Icon name="bowl" /></span>}
                <div>
                  <strong>{it.name}</strong>
                  <div className="track"><i style={{ width: `${(it.quantity / maxTop) * 100}%` }} /></div>
                </div>
                <div style={{ textAlign: 'right' }}><strong>{it.quantity}</strong><div className="hint">{formatVnd(it.sales)}</div></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h3><Icon name="clock" />Lượng đơn theo giờ</h3><span className="hint">Giờ cao điểm để sắp xếp nhân sự</span></div>
          <div className="card-pad">{data ? <BarChart data={hours} alt format={(v) => `${v} đơn`} every={3} /> : <div className="skeleton" style={{ height: 220 }} />}</div>
        </section>
        <section className="card">
          <div className="card-head"><h3><Icon name="menu" />Doanh số theo danh mục</h3></div>
          <div className="card-pad">{data && <Donut rows={data.byCategory.map((c) => ({ label: c.name, value: c.sales, sub: `${c.quantity} món` }))} />}</div>
        </section>
      </div>

      <div className="grid-2e">
        <section className="card">
          <div className="card-head"><h3><Icon name="card" />Phương thức thanh toán</h3></div>
          <div className="card-pad">{data && <Donut rows={data.byMethod.map((m) => ({ label: METHOD[m.method] || m.method, value: m.amount, sub: `${m.payments} lần` }))} />}</div>
        </section>
        <section className="card">
          <div className="card-head"><h3><Icon name="alert" />Lý do huỷ món</h3></div>
          <div className="card-pad legend">
            {data?.cancelReasons.length === 0 && <div className="empty"><Icon name="checkCircle" />Không có món bị huỷ</div>}
            {data?.cancelReasons.map((r, i) => (
              <div key={r.reason} className="legend-row">
                <span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span>{REASON[r.reason] || r.reason}</span>
                <strong>{r.quantity}</strong>
                <span className="pct">món</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Kpi({ cls = '', icon, label, value, sub }) {
  return (
    <div className={`kpi ${cls}`}>
      <span className="ic"><Icon name={icon} /></span>
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
      <span className="sub">{sub}</span>
    </div>
  );
}

/** Biểu đồ cột SVG gọn nhẹ: trục y 4 vạch, nhãn trục x thưa dần theo số cột, rê chuột xem giá trị. */
function BarChart({ data, format, alt, every }) {
  const W = 640;
  const H = 230;
  const pad = { l: 46, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const step = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(34, step * 0.62));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const skip = every || Math.ceil(data.length / 10);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      <g className="grid axis">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} strokeDasharray={t ? '3 4' : ''} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">{short(Math.round(t))}</text>
          </g>
        ))}
      </g>
      {data.map((d, i) => {
        const x = pad.l + step * i + (step - bw) / 2;
        return (
          <g key={d.label}>
            <rect className={`bar bar-anim ${alt ? 'alt' : ''}`} style={{ animationDelay: `${i * 18}ms` }} x={x} y={y(d.value)} width={bw}
              height={Math.max(d.value ? 2 : 0, H - pad.b - y(d.value))} rx={Math.min(6, bw / 3)}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            {i % skip === 0 && <text className="axis" x={x + bw / 2} y={H - 8} textAnchor="middle" fill="var(--muted)" fontSize="11">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ rows }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) return <div className="empty"><Icon name="chart" />Chưa có dữ liệu</div>;
  const R = 60;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" width="160" height="160">
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="22" />
        {rows.map((r, i) => {
          const len = (r.value / total) * C;
          const el = (
            <circle key={r.label} cx="80" cy="80" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="22"
              strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 80 80)">
              <title>{`${r.label}: ${formatVnd(r.value)}`}</title>
            </circle>
          );
          acc += len;
          return el;
        })}
        <text x="80" y="76" textAnchor="middle" fontSize="11" fill="var(--muted)">Tổng</text>
        <text x="80" y="96" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--ink)">{short(total)}</text>
      </svg>
      <div className="legend">
        {rows.map((r, i) => (
          <div key={r.label} className="legend-row">
            <span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span>{r.label}<div className="hint">{r.sub}</div></span>
            <strong className="money">{formatVnd(r.value)}</strong>
            <span className="pct">{Math.round((r.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bàn & QR

const TABLE_STATE = { EMPTY: ['Trống', 'chip-ok'], OUT_OF_SERVICE: ['Ngừng phục vụ', 'chip-muted'] };

function TablesTab({ api, token, notify }) {
  const { data, error, reload } = useAsync(async () => {
    const [tables, states] = await Promise.all([api('GET', '/api/admin/tables'), api('GET', '/api/cashier/tables')]);
    const byId = new Map(states.map((s) => [s.id, s]));
    return tables.filter((t) => !t.code.startsWith('LT')).map((t) => ({ ...t, view: byId.get(t.id) }));
  }, []);
  const [baseUrl, setBaseUrl] = useState(window.location.origin);
  const [code, setCode] = useState('');

  // Đồng bộ trạng thái bàn (có khách / trống) theo thời gian thực qua kênh của quầy thu ngân
  useEffect(() => {
    const connection = new RealtimeConnection({
      url: wsUrl(),
      connectHeaders: { Authorization: `Bearer ${token}` },
      onStatus: () => {},
      onConnected: (client) => {
        client.subscribe('/topic/cashier', () => reload());
        reload();
      },
    });
    connection.start();
    return () => connection.stop();
  }, [token, reload]);

  async function act(fn, ok) {
    try {
      await fn();
      if (ok) notify(ok);
      reload();
    } catch (e) {
      notify(e.message);
    }
  }

  return (
    <>
      <section className="card card-pad no-print">
        <div className="form-grid">
          <label className="field" style={{ gridColumn: 'span 2' }}>
            Địa chỉ in trong QR
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            <span className="hint">Dùng địa chỉ tunnel hoặc IP LAN để điện thoại khách truy cập được.</span>
          </label>
          <label className="field">
            Mã bàn mới
            <input placeholder="VD: B13" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary" disabled={!code} onClick={() => act(async () => { await api('POST', '/api/admin/tables', { code }); setCode(''); }, 'Đã thêm bàn')}>
              <Icon name="plus" size={16} />Thêm bàn
            </button>
            <button className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />In QR</button>
          </div>
        </div>
        {window.location.hostname === 'localhost' && (
          <div className="banner info" style={{ marginTop: 14 }}><Icon name="info" />Bạn đang mở bằng localhost: điện thoại sẽ không truy cập được link trong QR.</div>
        )}
      </section>
      {error && <div className="banner danger"><Icon name="alert" />{error}</div>}
      <div className="qr-grid">
        {data?.map((t, i) => {
          const url = `${baseUrl.replace(/\/$/, '')}/t/${t.qrToken}`;
          const state = t.view?.state || (t.status === 'OPEN' ? 'EMPTY' : 'OUT_OF_SERVICE');
          const [label, chip] = TABLE_STATE[state] || ['Có khách', 'chip-brand'];
          return (
            <div key={t.id} className={`qr-card ${t.status !== 'OPEN' ? 'off' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
              <div className="top">
                <span style={{ width: 34 }}><TableArt state={state} /></span>
                <h3>Bàn {t.code}</h3>
                <span className={`chip ${chip}`}>{label}</span>
              </div>
              <div className="qrbox"><QRCodeSVG value={url} size={150} /></div>
              <a className="hint" href={url} target="_blank" rel="noreferrer">Mở link gọi món</a>
              <div className="acts no-print">
                {t.status === 'OPEN' ? (
                  <button className="btn small" title="Ngừng phục vụ bàn này" onClick={() => act(() => api('POST', `/api/admin/tables/${t.id}/close`), `Đã đóng bàn ${t.code}`)}>
                    <Icon name="lock" size={15} />Đóng bàn
                  </button>
                ) : (
                  <button className="btn small primary" onClick={() => act(() => api('POST', `/api/admin/tables/${t.id}/open`), `Đã mở bàn ${t.code}`)}>Mở bàn</button>
                )}
                <button className="btn small" onClick={() => window.confirm(`Đổi mã QR bàn ${t.code}? Mã cũ sẽ không dùng được nữa.`) &&
                  act(() => api('POST', `/api/admin/tables/${t.id}/rotate-token`), 'Đã đổi mã QR')}>
                  <Icon name="refresh" size={15} />Đổi QR
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ thực đơn & VAT

const EMPTY_ITEM = { name: '', description: '', price: '', available: true, stock: '', station: 'KITCHEN', categoryId: '', imageUrl: '', vatRate: 8 };

function MenuTab({ api, notify }) {
  const { data, error, reload } = useAsync(async () => {
    const [items, categories] = await Promise.all([api('GET', '/api/admin/menu-items'), api('GET', '/api/admin/categories')]);
    return { items, categories };
  }, []);
  const [editing, setEditing] = useState(null);
  const [vatAll, setVatAll] = useState(8);
  const [cat, setCat] = useState('all');

  const toRequest = (i) => ({
    categoryId: Number(i.categoryId),
    name: i.name.trim(),
    description: i.description || null,
    price: Number(i.price),
    imageUrl: i.imageUrl?.trim() || null,
    available: !!i.available,
    stock: i.stock === '' || i.stock === null || i.stock === undefined ? null : Number(i.stock),
    station: i.station,
    vatRate: Number(i.vatRate),
  });

  async function save(item) {
    try {
      if (item.id) await api('PUT', `/api/admin/menu-items/${item.id}`, toRequest(item));
      else await api('POST', '/api/admin/menu-items', toRequest(item));
      notify(`Đã lưu "${item.name}"`);
      setEditing(null);
      reload();
    } catch (e) {
      notify(e.message);
    }
  }

  async function quick(item, patch) {
    try {
      await api('PUT', `/api/admin/menu-items/${item.id}`, toRequest({ ...item, ...patch }));
      reload();
    } catch (e) {
      notify(e.message);
    }
  }

  async function applyVat() {
    if (!window.confirm(`Áp VAT ${vatAll}% cho tất cả món? Món đã đặt giữ mức VAT lúc đặt.`)) return;
    try {
      const r = await api('PUT', '/api/admin/menu-items/vat', { vatRate: Number(vatAll) });
      notify(`Đã áp VAT ${r.vatRate}% cho ${r.updated} món`);
      reload();
    } catch (e) {
      notify(e.message);
    }
  }

  if (!data) return error ? <div className="banner danger"><Icon name="alert" />{error}</div> : <div className="skeleton" style={{ height: 300 }} />;
  const catName = (id) => data.categories.find((c) => c.id === id)?.name || '';
  const items = cat === 'all' ? data.items : data.items.filter((i) => i.categoryId === Number(cat));

  return (
    <>
      <div className="grid-2">
        <section className="card card-pad row">
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            <button className={cat === 'all' ? 'active' : ''} onClick={() => setCat('all')}>Tất cả ({data.items.length})</button>
            {data.categories.map((c) => (
              <button key={c.id} className={cat === String(c.id) ? 'active' : ''} onClick={() => setCat(String(c.id))}>{c.name}</button>
            ))}
          </div>
          <span className="spacer" />
          <button className="btn primary" onClick={() => setEditing({ ...EMPTY_ITEM, categoryId: data.categories[0]?.id || '' })}><Icon name="plus" size={16} />Thêm món</button>
        </section>
        <section className="card card-pad row">
          <span className="ic" style={{ color: 'var(--gold)' }}><Icon name="percent" size={22} /></span>
          <div style={{ flex: 1 }}>
            <strong>VAT cho toàn bộ thực đơn</strong>
            <div className="hint">Tự động cộng vào hoá đơn khi thanh toán</div>
          </div>
          <input type="number" min="0" max="100" value={vatAll} onChange={(e) => setVatAll(e.target.value)} style={{ width: 80 }} />
          <button className="btn gold" onClick={applyVat}>Áp dụng</button>
        </section>
      </div>

      <section className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr><th>Món</th><th>Danh mục</th><th>Giá</th><th>VAT</th><th>Giá gồm VAT</th><th>Tồn kho</th><th>Đang bán</th><th /></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="menu-cell">
                    {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="noimg"><Icon name={categoryIcon(catName(item.categoryId))} /></span>}
                    <div><strong>{item.name}</strong><span className="hint">{item.description}</span></div>
                  </div>
                </td>
                <td>{catName(item.categoryId)}</td>
                <td className="money">{formatVnd(item.price)}</td>
                <td><span className="chip chip-gold">{item.vatRate}%</span></td>
                <td className="money">{formatVnd(Math.round((item.price * (100 + item.vatRate)) / 100))}</td>
                <td>{item.stock ?? <span className="hint">Không giới hạn</span>}</td>
                <td>
                  <label className="switch"><input type="checkbox" checked={item.available} onChange={(e) => quick(item, { available: e.target.checked })} /><i /></label>
                </td>
                <td><button className="btn small" onClick={() => setEditing({ ...item, stock: item.stock ?? '', imageUrl: item.imageUrl || '' })}><Icon name="edit" size={15} />Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && <MenuItemDialog item={editing} categories={data.categories} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function MenuItemDialog({ item, categories, onClose, onSave }) {
  const [d, setD] = useState(item);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const valid = d.name.trim() && d.categoryId && d.price !== '' && Number(d.price) >= 0 && Number(d.vatRate) >= 0 && Number(d.vatRate) <= 100;
  return (
    <div className="modal-backdrop center" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{d.id ? `Sửa món: ${item.name}` : 'Thêm món mới'}</h3>
          <span className="spacer" />
          <button className="btn ghost small icon-only" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="grid-2e">
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <div className="img-preview">{d.imageUrl ? <img src={d.imageUrl} alt="" /> : <Icon name="image" size={48} />}</div>
            <label className="field">Link ảnh minh hoạ<input value={d.imageUrl} placeholder="/images/menu/01.jpg hoặc https://..." onChange={(e) => set({ imageUrl: e.target.value })} /></label>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="field">Tên món<input value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="field">Mô tả<textarea rows={2} value={d.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>
            <div className="form-grid">
              <label className="field">Danh mục
                <select value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="field">Khu chế biến
                <select value={d.station} onChange={(e) => set({ station: e.target.value })}>
                  <option value="KITCHEN">Bếp</option><option value="BAR">Quầy pha chế</option>
                </select>
              </label>
              <label className="field">Giá (đ)<input type="number" min="0" value={d.price} onChange={(e) => set({ price: e.target.value })} /></label>
              <label className="field">VAT (%)<input type="number" min="0" max="100" value={d.vatRate} onChange={(e) => set({ vatRate: e.target.value })} /></label>
              <label className="field">Tồn kho<input type="number" min="0" placeholder="Không giới hạn" value={d.stock} onChange={(e) => set({ stock: e.target.value })} /></label>
              <label className="field">Đang bán<label className="switch"><input type="checkbox" checked={d.available} onChange={(e) => set({ available: e.target.checked })} /><i /></label></label>
            </div>
            {d.price !== '' && <div className="hint">Khách trả: <strong className="money">{formatVnd(Math.round((Number(d.price) * (100 + Number(d.vatRate || 0))) / 100))}</strong> / suất (đã gồm VAT)</div>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Huỷ</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(d)}><Icon name="check" size={16} />Lưu món</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ lịch sử thanh toán (chỉ xem)

const PAYMENT_STATUS = {
  PENDING: ['Đang chờ', 'chip-gold'],
  PAID: ['Đã trả', 'chip-ok'],
  FAILED: ['Thất bại', 'chip-danger'],
  EXPIRED: ['Hết hạn', 'chip-muted'],
  CANCELLED: ['Đã huỷ', 'chip-muted'],
};

function PaymentsTab({ api }) {
  const { data, error, reload } = useAsync(() => api('GET', '/api/admin/payments?limit=200'), []);
  const fmt = (t) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  return (
    <>
      <div className="row">
        <span className="hint">200 lần thanh toán gần nhất. Xác nhận tiền mặt và trả bàn ở quầy thu ngân.</span>
        <span className="spacer" />
        <button className="btn small" onClick={reload}><Icon name="refresh" size={15} />Làm mới</button>
      </div>
      {error && <div className="banner danger"><Icon name="alert" />{error}</div>}
      <section className="card table-scroll">
        <table className="data-table">
          <thead><tr><th>#</th><th>Bàn</th><th>Cách trả</th><th>Số tiền</th><th>Trạng thái</th><th>Tạo lúc</th><th>Trả lúc</th><th>Xác nhận</th></tr></thead>
          <tbody>
            {(data || []).map((p) => (
              <tr key={p.id}>
                <td className="hint">{p.id}</td>
                <td><strong>{p.tableCode}</strong></td>
                <td><span className="row" style={{ gap: 6 }}><Icon name={p.method === 'VNPAY' ? 'qr' : 'cash'} size={16} />{METHOD[p.method]}</span></td>
                <td className="money">{formatVnd(p.amount)}</td>
                <td>
                  <span className={`chip ${PAYMENT_STATUS[p.status]?.[1] || ''}`}>{PAYMENT_STATUS[p.status]?.[0] || p.status}</span>
                  {p.needsRefund && <span className="chip chip-danger">Cần hoàn tiền</span>}
                </td>
                <td>{fmt(p.createdAt)}</td>
                <td>{p.paidAt ? fmt(p.paidAt) : '—'}</td>
                <td>{p.confirmedBy || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <div className="empty"><Icon name="card" />Chưa có lần thanh toán nào.</div>}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ cấu hình thực nghiệm

function SettingsTab({ api, notify }) {
  const { data, error, reload } = useAsync(() => api('GET', '/api/admin/settings'), []);

  async function update(patch) {
    try {
      await api('PUT', '/api/admin/settings', patch);
      notify('Đã cập nhật. Màn hình bếp cần tải lại để dùng chế độ giao đơn mới.');
      reload();
    } catch (e) {
      notify(e.message);
    }
  }

  if (!data) return error ? <div className="banner danger"><Icon name="alert" />{error}</div> : <div className="skeleton" style={{ height: 240 }} />;
  const toggles = [
    ['idempotencyEnabled', 'Idempotency-Key', 'Chống đặt trùng đơn khi mạng chập chờn'],
    ['optimisticLockEnabled', 'Optimistic locking', 'Chống ghi đè trạng thái khi hai người cùng thao tác'],
    ['rateLimitEnabled', 'Rate limiting', 'Giới hạn tần suất gọi API (token bucket)'],
  ];
  return (
    <section className="card card-pad" style={{ maxWidth: 760 }}>
      <p className="hint" style={{ marginBottom: 16 }}>Dùng khi chạy thực nghiệm so sánh baseline và giải pháp đề xuất trên cùng một hệ thống, không cần khởi động lại server.</p>
      <label className="field">
        Chế độ giao đơn tới bếp
        <select value={data.deliveryMode} onChange={(e) => update({ deliveryMode: e.target.value })}>
          <option value="RELIABLE_PUSH">RELIABLE_PUSH: WebSocket + seq/ACK/RESUME (đề xuất)</option>
          <option value="NAIVE_PUSH">NAIVE_PUSH: WebSocket không đảm bảo (baseline B)</option>
          <option value="POLLING">POLLING: bếp hỏi định kỳ 3s (baseline A)</option>
        </select>
      </label>
      <div style={{ marginTop: 10 }}>
        {toggles.map(([key, title, desc]) => (
          <div key={key} className="toggle-row">
            <div><strong>{title}</strong><span className="hint">{desc}</span></div>
            <label className="switch"><input type="checkbox" checked={!!data[key]} onChange={(e) => update({ [key]: e.target.checked })} /><i /></label>
          </div>
        ))}
      </div>
    </section>
  );
}
