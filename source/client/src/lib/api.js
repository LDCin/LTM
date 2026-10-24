import { backoffDelay } from './connection.js';

export class ApiError extends Error {
  constructor(status, code, message, details = {}, retryAfter = null) {
    super(message);
    this.status = status; // 0 = lỗi mạng / timeout
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Gọi REST API với timeout; mọi lỗi được chuẩn hoá thành ApiError. */
export async function request(method, path, { body, headers = {}, token, tableToken, sessionId, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const allHeaders = { ...headers };
  if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
  if (token) allHeaders.Authorization = `Bearer ${token}`;
  if (tableToken) {
    allHeaders['X-Table-Token'] = tableToken;
    allHeaders['X-Device-Id'] = getDeviceId(); // request của khách luôn kèm mã thiết bị
  }
  // Phiên bàn máy này đang giữ: server từ chối (409 SESSION_ENDED) nếu lượt khách đã kết thúc
  if (sessionId) allHeaders['X-Session-Id'] = String(sessionId);
  try {
    const res = await fetch(path, {
      method,
      headers: allHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (res.status === 304) return { status: 304, data: null, headers: res.headers };
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new ApiError(
        res.status,
        data?.error || `HTTP_${res.status}`,
        data?.message || res.statusText,
        data?.details || {},
        Number(res.headers.get('Retry-After')) || null,
      );
    }
    return { status: res.status, data, headers: res.headers };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw new ApiError(0, 'TIMEOUT', 'Máy chủ không phản hồi (timeout)');
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ');
  } finally {
    clearTimeout(timer);
  }
}

/** Lỗi tạm thời, thử lại được: mất mạng, timeout, 429, 502/503/504. */
export function isRetryable(err) {
  return err instanceof ApiError && [0, 429, 502, 503, 504].includes(err.status);
}

/** Thử lại với exponential backoff + jitter; tôn trọng Retry-After của server. */
export async function withRetry(fn, { attempts = 4, baseMs = 500, onRetry } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn(i);
    } catch (e) {
      if (!isRetryable(e) || i >= attempts - 1) throw e;
      const delay = e.retryAfter ? e.retryAfter * 1000 : backoffDelay(i, { baseMs, maxMs: 8000 });
      onRetry?.(e, i + 1, delay);
      await sleep(delay);
    }
  }
}

/**
 * Idempotency-Key ngẫu nhiên 128 bit. Dùng crypto.getRandomValues vì crypto.randomUUID chỉ có
 * trong "secure context" (HTTPS/localhost), mà điện thoại truy cập qua http://IP-LAN.
 */
export function newIdempotencyKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ mã thiết bị của khách

const DEVICE_KEY = 'qrorder.deviceId';
let memoryDeviceId = null;

/**
 * Mã thiết bị: sinh ngẫu nhiên lần đầu và giữ trong localStorage của trình duyệt.
 * Server dùng mã này để biết đơn nào do chính máy này đặt (máy đó mới được huỷ). Mã không bao giờ bị trả ra ngoài.
 * Nếu localStorage bị chặn (chế độ riêng tư) thì dùng tạm mã trong bộ nhớ cho tới khi đóng trang.
 */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = newIdempotencyKey();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    memoryDeviceId = memoryDeviceId || newIdempotencyKey();
    return memoryDeviceId;
  }
}

export function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

// ------------------------------------------------------------------ phiên đăng nhập nhân viên

const SESSION_KEY = 'qrorder.staff';

export function getStaffSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return s && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function setStaffSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* localStorage bị chặn */
  }
}
