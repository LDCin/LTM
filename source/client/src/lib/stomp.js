// STOMP 1.2 client tối giản chạy trên WebSocket, tự cài đặt (không dùng thư viện)
// để thấy rõ từng frame đi trên đường truyền. Dùng chung cho trình duyệt và load test Node.
//
// Định dạng một frame:
//   COMMAND\n
//   header1:value1\n
//   header2:value2\n
//   \n
//   BODY\0            <- kết thúc bằng ký tự NUL
//
// Heart-beat: một ký tự xuống dòng "\n" gửi định kỳ để báo "tôi vẫn sống".

const NUL = '\u0000';
const encoder = new TextEncoder();

function escapeHeader(value) {
  return value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/:/g, '\\c');
}

function unescapeHeader(value) {
  return value.replace(/\\(.)/g, (_, c) => ({ r: '\r', n: '\n', c: ':', '\\': '\\' })[c] ?? c);
}

export function encodeFrame(command, headers = {}, body = '') {
  // Theo đặc tả, header của frame CONNECT không được escape
  const esc = command === 'CONNECT' ? (v) => v : escapeHeader;
  let frame = command + '\n';
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    frame += `${esc(String(key))}:${esc(String(value))}\n`;
  }
  return frame + '\n' + body + NUL;
}

export function decodeFrame(raw) {
  const text = raw.replace(/^(\r?\n)+/, '');
  if (!text) return null; // chỉ là heart-beat
  const sep = text.search(/\r?\n\r?\n/);
  const head = sep === -1 ? text : text.slice(0, sep);
  const body = sep === -1 ? '' : text.slice(sep).replace(/^\r?\n\r?\n/, '');
  const lines = head.split(/\r?\n/);
  const command = lines.shift();
  const headers = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = unescapeHeader(line.slice(0, idx));
    // Header lặp lại: giữ giá trị xuất hiện đầu tiên (STOMP 1.2)
    if (!(key in headers)) headers[key] = unescapeHeader(line.slice(idx + 1));
  }
  return { command, headers, body };
}

export class StompClient {
  constructor({ url, connectHeaders = {}, heartbeatMs = 10000, WebSocketImpl, onConnect, onClose, onError, debug } = {}) {
    this.url = url;
    this.connectHeaders = connectHeaders;
    this.heartbeatMs = heartbeatMs;
    this.WebSocketImpl = WebSocketImpl || globalThis.WebSocket;
    this.onConnect = onConnect;
    this.onClose = onClose;
    this.onError = onError;
    this.debug = debug;
    this.connected = false;
    this.buffer = '';
    this.subs = new Map();
    this.subCounter = 0;
    this.timers = [];
    this.lastReceived = Date.now();
    this.stats = { framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0, heartbeatsIn: 0 };
  }

  connect() {
    this.ws = new this.WebSocketImpl(this.url);
    this.ws.onopen = () => {
      // Bước 1 sau khi TCP + WebSocket handshake (HTTP 101) xong: gửi frame CONNECT
      this._sendRaw(
        encodeFrame('CONNECT', {
          'accept-version': '1.2',
          host: new URL(this.url).host,
          'heart-beat': `${this.heartbeatMs},${this.heartbeatMs}`,
          ...this.connectHeaders,
        }),
      );
    };
    this.ws.onmessage = (event) => this._onData(typeof event.data === 'string' ? event.data : String(event.data));
    this.ws.onclose = (event) => this._onSocketClose(event);
    this.ws.onerror = () => {}; // onclose luôn được gọi ngay sau đó
  }

  subscribe(destination, callback) {
    const id = `sub-${++this.subCounter}`;
    this.subs.set(id, callback);
    this._sendRaw(encodeFrame('SUBSCRIBE', { id, destination, ack: 'auto' }));
    return () => {
      this.subs.delete(id);
      if (this.connected) this._sendRaw(encodeFrame('UNSUBSCRIBE', { id }));
    };
  }

  send(destination, body) {
    if (!this.connected) return false;
    this._sendRaw(encodeFrame('SEND', { destination, 'content-type': 'application/json' }, JSON.stringify(body)));
    return true;
  }

  /** Đóng lịch sự: DISCONNECT rồi đóng WebSocket. */
  disconnect() {
    this.closedByUser = true;
    try {
      if (this.connected) this._sendRaw(encodeFrame('DISCONNECT', {}));
      this.ws?.close();
    } catch {
      /* đã đóng */
    }
  }

  /** Đóng đột ngột để giả lập mất mạng (Node `ws` có terminate() cắt TCP ngay). */
  forceClose() {
    if (!this.ws) return;
    if (typeof this.ws.terminate === 'function') this.ws.terminate();
    else this.ws.close();
  }

  _sendRaw(data) {
    if (this.ws?.readyState !== 1) return;
    this.ws.send(data);
    this.stats.bytesOut += encoder.encode(data).length;
    if (data !== '\n') this.stats.framesOut++;
  }

  _onData(data) {
    this.lastReceived = Date.now();
    this.stats.bytesIn += encoder.encode(data).length;
    this.buffer += data;
    let idx;
    // Một message WebSocket có thể chứa nhiều frame, hoặc một frame bị cắt ở giữa -> cắt theo NUL
    while ((idx = this.buffer.indexOf(NUL)) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const frame = decodeFrame(raw);
      if (frame) this._onFrame(frame);
    }
    if (/^(\r?\n)+$/.test(this.buffer)) {
      this.stats.heartbeatsIn++;
      this.buffer = '';
    }
  }

  _onFrame(frame) {
    this.stats.framesIn++;
    this.debug?.('<<<', frame.command, frame.headers);
    switch (frame.command) {
      case 'CONNECTED':
        this.connected = true;
        this._setupHeartbeat(frame.headers['heart-beat']);
        this.onConnect?.(frame);
        break;
      case 'MESSAGE': {
        const callback = this.subs.get(frame.headers.subscription);
        if (!callback) return;
        let payload = frame.body;
        try {
          payload = JSON.parse(frame.body);
        } catch {
          /* body không phải JSON */
        }
        callback(payload, frame);
        break;
      }
      case 'ERROR':
        this.onError?.(frame);
        break;
      default:
        break;
    }
  }

  // Thoả thuận heart-beat: client đề nghị "cx,cy", server trả "sx,sy".
  // Client gửi mỗi max(cx, sy) ms; client mong nhận mỗi max(cy, sx) ms.
  _setupHeartbeat(serverHeader = '0,0') {
    const [sx, sy] = serverHeader.split(',').map((v) => parseInt(v, 10) || 0);
    const outgoing = this.heartbeatMs && sy ? Math.max(this.heartbeatMs, sy) : 0;
    const incoming = this.heartbeatMs && sx ? Math.max(this.heartbeatMs, sx) : 0;
    if (outgoing) {
      this.timers.push(setInterval(() => this._sendRaw('\n'), outgoing));
    }
    if (incoming) {
      this.timers.push(
        setInterval(() => {
          // Quá 2 chu kỳ không nhận được gì -> coi kết nối đã chết (VD rút dây mạng, TCP không báo đóng)
          if (Date.now() - this.lastReceived > incoming * 2) {
            this.debug?.('heart-beat timeout, đóng kết nối');
            this.forceClose();
          }
        }, incoming),
      );
    }
  }

  _onSocketClose(event) {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.connected = false;
    this.onClose?.(event);
  }
}
