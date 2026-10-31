import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../results');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randomKey = () => randomBytes(16).toString('hex');
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export async function waitFor(predicate, timeoutMs = 10000, stepMs = 50) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

/** HTTP client đo thời gian từng request và đếm số byte payload nhận về. */
export function createHttp(baseUrl) {
  const counters = { requests: 0, bytesIn: 0 };
  async function call(method, path, { body, headers = {}, token, tableToken, timeoutMs = 10000 } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = `Bearer ${token}`;
    if (tableToken) h['X-Table-Token'] = tableToken;
    const started = performance.now();
    counters.requests++;
    try {
      const res = await fetch(baseUrl + path, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      counters.bytesIn += Buffer.byteLength(text);
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { status: res.status, data, headers: res.headers, ms: performance.now() - started };
    } catch (e) {
      return { status: 0, data: null, error: e.message, ms: performance.now() - started };
    }
  }
  return { call, counters };
}

// ------------------------------------------------------------------ thống kê

export function summarize(values) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const round = (v) => Math.round(v * 100) / 100;
  return {
    count: sorted.length,
    min: round(sorted[0]),
    mean: round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p50: round(q(50)),
    p95: round(q(95)),
    p99: round(q(99)),
    max: round(sorted[sorted.length - 1]),
  };
}

export function saveResult(name, summary, rows = null) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = resolve(RESULTS_DIR, `${name}_${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
  if (rows?.length) {
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n');
    writeFileSync(`${base}.csv`, csv);
  }
  console.log(`\nĐã lưu kết quả: ${base}.json${rows?.length ? ' (+ .csv)' : ''}`);
}

// ------------------------------------------------------------------ chuẩn bị dữ liệu

export async function adminLogin(http) {
  const r = await http.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  if (r.status !== 200) throw new Error(`Đăng nhập admin thất bại (HTTP ${r.status}). Server đã chạy chưa?`);
  return r.data.token;
}

export async function setSettings(http, token, settings) {
  const r = await http.call('PUT', '/api/admin/settings', { token, body: settings });
  if (r.status !== 200) throw new Error(`Đổi cấu hình thất bại (HTTP ${r.status})`);
  return r.data;
}

export async function ensureTables(http, token, count) {
  const r = await http.call('POST', '/api/admin/tables/bulk', {
    token,
    body: { prefix: 'LT', count, open: true },
    timeoutMs: 60000,
  });
  if (r.status !== 200) throw new Error(`Tạo bàn thất bại (HTTP ${r.status})`);
  // Dọn đơn của các lần chạy trước để mỗi thực nghiệm bắt đầu từ trạng thái sạch
  const c = await http.call('POST', '/api/admin/maintenance/clear-test-orders', { token, timeoutMs: 120000 });
  if (c.status !== 200) throw new Error(`Dọn dữ liệu thực nghiệm thất bại (HTTP ${c.status})`);
  return r.data;
}

/** Các món luôn đặt được (còn bán, không giới hạn số lượng) để thực nghiệm không bị "hết món". */
export async function orderableItems(http) {
  const r = await http.call('GET', '/api/public/menu');
  const items = r.data.categories.flatMap((c) => c.items).filter((i) => i.available && i.stock === null);
  if (!items.length) throw new Error('Không có món nào để đặt');
  return items.map((i) => i.id);
}

export function randomOrder(itemIds) {
  const lines = 1 + Math.floor(Math.random() * 3);
  const chosen = new Set();
  while (chosen.size < lines) chosen.add(pick(itemIds));
  return { items: [...chosen].map((id) => ({ menuItemId: id, quantity: 1 + Math.floor(Math.random() * 2) })) };
}

/** Lấy mẫu CPU của tiến trình server qua Spring Boot Actuator mỗi giây. */
export function startCpuSampler(http) {
  const samples = [];
  const timer = setInterval(async () => {
    const r = await http.call('GET', '/actuator/metrics/process.cpu.usage', { timeoutMs: 2000 });
    const v = r.data?.measurements?.[0]?.value;
    if (typeof v === 'number') samples.push(v * 100);
  }, 1000);
  return {
    stop() {
      clearInterval(timer);
      return summarize(samples);
    },
  };
}

export function parseArgs(argv) {
  const opts = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) opts[m[1]] = m[2];
    else if (a.startsWith('--')) opts[a.slice(2)] = 'true';
  }
  return opts;
}
