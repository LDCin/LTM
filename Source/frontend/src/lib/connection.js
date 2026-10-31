import { StompClient } from './stomp.js';

/**
 * Exponential backoff + jitter.
 * Lần thử thứ n chờ base * 2^n (tối đa maxMs), nhân với hệ số ngẫu nhiên trong [1-jitter, 1+jitter].
 * Jitter giúp hàng trăm client mất mạng cùng lúc KHÔNG kết nối lại cùng một thời điểm (reconnect storm).
 */
export function backoffDelay(attempt, { baseMs = 1000, maxMs = 30000, jitter = 0.5 } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const factor = 1 - jitter + Math.random() * 2 * jitter;
  return Math.round(exp * factor);
}

/**
 * Giữ một kết nối STOMP luôn sống: tự kết nối lại khi rớt mạng.
 * Mỗi lần kết nối lại tạo một StompClient mới và gọi onConnected để đăng ký lại subscription.
 */
export class RealtimeConnection {
  constructor({ url, connectHeaders = {}, heartbeatMs = 10000, WebSocketImpl, onConnected, onStatus, backoff = {} }) {
    this.url = url;
    this.connectHeaders = connectHeaders;
    this.heartbeatMs = heartbeatMs;
    this.WebSocketImpl = WebSocketImpl;
    this.onConnected = onConnected;
    this.onStatus = onStatus;
    this.backoff = backoff;
    this.attempt = 0;
    this.stopped = true;
    this.blockedUntil = 0;
    this.reconnects = 0;
  }

  start() {
    this.stopped = false;
    this._open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.client?.disconnect();
  }

  /** Giả lập mất mạng trong ms mili-giây (dùng cho demo và thực nghiệm độ tin cậy). */
  simulateOutage(ms) {
    this.blockedUntil = Date.now() + ms;
    this.client?.forceClose();
  }

  get connected() {
    return !!this.client?.connected;
  }

  _status(status, info = {}) {
    this.onStatus?.(status, info);
  }

  _open() {
    if (this.stopped) return;
    const blockedFor = this.blockedUntil - Date.now();
    if (blockedFor > 0) {
      this._status('offline', { delay: blockedFor });
      this.timer = setTimeout(() => this._open(), blockedFor);
      return;
    }
    this._status(this.attempt === 0 ? 'connecting' : 'reconnecting', { attempt: this.attempt });
    const client = new StompClient({
      url: this.url,
      connectHeaders: this.connectHeaders,
      heartbeatMs: this.heartbeatMs,
      WebSocketImpl: this.WebSocketImpl,
      onConnect: () => {
        if (this.attempt > 0) this.reconnects++;
        this.attempt = 0;
        this._status('connected');
        this.onConnected?.(client);
      },
      onError: (frame) => {
        this._status('error', { message: frame.headers.message || 'Lỗi STOMP' });
      },
      onClose: () => {
        if (this.client === client) this._scheduleReconnect();
      },
    });
    this.client = client;
    client.connect();
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    const delay = backoffDelay(this.attempt, this.backoff);
    this.attempt++;
    this._status('reconnecting', { delay, attempt: this.attempt });
    this.timer = setTimeout(() => this._open(), delay);
  }
}
