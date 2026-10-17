import { RealtimeConnection } from './connection.js';

const MAX_SEEN = 20000;

/**
 * Nguồn sự kiện của màn hình bếp, hỗ trợ 3 chế độ để so sánh:
 *
 * POLLING       : hỏi GET /api/kitchen/events?afterSeq=... mỗi pollingIntervalMs.
 * NAIVE_PUSH    : nhận từ /topic/kitchen, không kiểm tra gì (mất là mất).
 * RELIABLE_PUSH : giao thức tin cậy của nhóm:
 *   - Mỗi sự kiện có seq tăng dần. Client nhớ tập seq đã thấy -> loại bỏ trùng.
 *   - watermark = seq lớn nhất mà mọi seq nhỏ hơn đều đã nhận.
 *   - Gửi ACK {seq} cho mỗi sự kiện nhận được.
 *   - Ngay sau mỗi lần (re)connect gửi RESUME {lastSeq: watermark} -> server gửi bù phần bị lỡ.
 *   - Thấy seq nhảy cóc (VD đang 50 mà nhận 52): chờ gapGraceMs (sự kiện có thể chỉ tới trễ),
 *     nếu vẫn thiếu thì RESUME.
 *   - Seq "lỗ" do transaction rollback (không bao giờ tồn tại): sau replay, watermark nhảy lên latestSeq.
 */
export class KitchenFeed {
  constructor({
    mode,
    wsUrl,
    token,
    fetchEvents,
    pollingIntervalMs = 3000,
    heartbeatMs = 10000,
    WebSocketImpl,
    onEvent,
    onStatus,
    onControl,
    onResynced,
    gapGraceMs = 800,
    backoff,
  }) {
    Object.assign(this, { mode, wsUrl, token, fetchEvents, pollingIntervalMs, heartbeatMs, WebSocketImpl });
    Object.assign(this, { onEvent, onStatus, onControl, onResynced, gapGraceMs, backoff });
    this.seen = new Set();
    this.seenOrder = [];
    this.watermark = 0;
    this.maxSeen = 0;
    this.stats = { received: 0, duplicates: 0, gaps: 0, resumes: 0, replayed: 0, polls: 0, pollBytes: 0, resyncMs: [] };
  }

  start(initialSeq = 0) {
    this.watermark = initialSeq;
    this.maxSeen = initialSeq;
    this.stopped = false;
    if (this.mode === 'POLLING') {
      this._status('polling');
      this._poll();
      return;
    }
    this.conn = new RealtimeConnection({
      url: this.wsUrl,
      connectHeaders: { Authorization: `Bearer ${this.token}` },
      heartbeatMs: this.heartbeatMs,
      WebSocketImpl: this.WebSocketImpl,
      backoff: this.backoff,
      onStatus: (s, info) => this._status(s, info),
      onConnected: (client) => this._onConnected(client),
    });
    this.conn.start();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.gapTimer);
    this.conn?.stop();
  }

  simulateOutage(ms) {
    this.conn?.simulateOutage(ms);
  }

  get transportStats() {
    return this.conn?.client?.stats;
  }

  _status(status, info = {}) {
    this.onStatus?.(status, info);
  }

  // ------------------------------------------------------------------ push

  _onConnected(client) {
    this.client = client;
    client.subscribe('/topic/kitchen', (msg) => this._onLive(msg));
    if (this.mode === 'RELIABLE_PUSH') {
      client.subscribe('/user/queue/replay', (batch) => this._onReplay(batch));
      this.connectedAt = Date.now();
      this._resume();
    }
  }

  _onLive(msg) {
    if (!msg || typeof msg.seq !== 'number') {
      this.onControl?.(msg); // CONFIG_CHANGED...
      return;
    }
    if (this.mode === 'NAIVE_PUSH') {
      this.stats.received++;
      this.onEvent?.(msg);
      return;
    }
    this._accept(msg);
  }

  _accept(env) {
    if (this.seen.has(env.seq)) {
      this.stats.duplicates++;
      return false;
    }
    this._markSeen(env.seq);
    this.stats.received++;
    this.onEvent?.(env);
    this.client?.send('/app/ack', { seq: env.seq });
    if (env.seq > this.maxSeen) this.maxSeen = env.seq;
    this._advanceWatermark();
    if (this.maxSeen > this.watermark) this._scheduleGapCheck();
    return true;
  }

  _advanceWatermark() {
    while (this.seen.has(this.watermark + 1)) this.watermark++;
  }

  _scheduleGapCheck() {
    if (this.gapTimer) return;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      if (this.maxSeen > this.watermark) {
        this.stats.gaps++;
        this._resume();
      }
    }, this.gapGraceMs);
  }

  _resume(fromSeq = this.watermark) {
    if (!this.client?.connected) return;
    this.stats.resumes++;
    this.client.send('/app/resume', { lastSeq: fromSeq });
  }

  _onReplay(batch) {
    for (const env of batch.events || []) {
      if (this._accept(env)) this.stats.replayed++;
    }
    if (batch.hasMore && batch.events.length) {
      this._resume(batch.events[batch.events.length - 1].seq);
      return;
    }
    // Mọi seq <= latestSeq còn thiếu là "lỗ" do rollback -> bỏ qua
    if (batch.latestSeq > this.watermark) this.watermark = batch.latestSeq;
    this._advanceWatermark();
    if (this.connectedAt) {
      this.stats.resyncMs.push(Date.now() - this.connectedAt);
      this.connectedAt = null;
    }
    this.onResynced?.(batch);
  }

  _markSeen(seq) {
    this.seen.add(seq);
    this.seenOrder.push(seq);
    if (this.seenOrder.length > MAX_SEEN) this.seen.delete(this.seenOrder.shift());
  }

  // ------------------------------------------------------------------ polling

  async _poll() {
    if (this.stopped) return;
    try {
      this.stats.polls++;
      const page = await this.fetchEvents(this.maxSeen);
      for (const env of page.events) {
        if (this.seen.has(env.seq)) {
          this.stats.duplicates++;
          continue;
        }
        this._markSeen(env.seq);
        this.stats.received++;
        if (env.seq > this.maxSeen) this.maxSeen = env.seq;
        this.onEvent?.(env);
      }
      this._status('polling');
    } catch (e) {
      this._status('error', { message: e.message });
    }
    if (!this.stopped) this.pollTimer = setTimeout(() => this._poll(), this.pollingIntervalMs);
  }
}
