// Kiểm thử end-to-end toàn bộ tính năng trên server đang chạy (REST + WebSocket/STOMP).
// Chạy: node e2e-test.js [--base=http://localhost:8080]
// Test dùng các bàn riêng mã LTE001..., tự khôi phục cấu hình và dữ liệu thực đơn khi kết thúc.
import WebSocket from 'ws';
import { StompClient, encodeFrame } from '../client/src/lib/stomp.js';
import { KitchenFeed } from '../client/src/lib/kitchenFeed.js';
import { createHttp, parseArgs, randomKey, sleep, waitFor } from './lib/common.js';

const opts = parseArgs(process.argv.slice(2));
const BASE = opts.base || 'http://localhost:8080';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
const http = createHttp(BASE);

// Hai "điện thoại" khác nhau. Mặc định mọi request/kết nối của khách đi từ máy A,
// trừ khi test tự đặt header X-Device-Id / deviceId khác.
const DEV_A = randomKey();
const DEV_B = randomKey();
const call = (method, path, opts = {}) => {
  if (opts.tableToken && !(opts.headers && 'X-Device-Id' in opts.headers)) {
    opts = { ...opts, headers: { ...opts.headers, 'X-Device-Id': DEV_A } };
  }
  return http.call(method, path, opts);
};

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✘ ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail).slice(0, 300) : ''}`);
  }
}
async function section(title, fn) {
  console.log(`\n■ ${title}`);
  try {
    await fn();
  } catch (e) {
    failures.push(`${title}: ${e.message}`);
    console.log(`  ✘ Ngoại lệ: ${e.stack}`);
  }
}

// ------------------------------------------------------------------ tiện ích WebSocket

function stomp(connectHeaders = {}) {
  if (connectHeaders.tableToken && !('deviceId' in connectHeaders)) {
    connectHeaders = { ...connectHeaders, deviceId: DEV_A };
  }
  return new Promise((resolve) => {
    const s = { errors: [], connected: false, closed: false, frame: null };
    const client = new StompClient({
      url: WS_URL,
      connectHeaders,
      WebSocketImpl: WebSocket,
      onConnect: (f) => {
        s.connected = true;
        s.frame = f;
        resolve(s);
      },
      onError: (f) => {
        s.errors.push(f.headers.message || f.body);
        resolve(s);
      },
      onClose: () => {
        s.closed = true;
        resolve(s);
      },
    });
    s.client = client;
    client.connect();
    setTimeout(() => resolve(s), 5000);
  });
}

function collect(s, destination) {
  const messages = [];
  s.client.subscribe(destination, (m) => messages.push(m));
  return messages;
}

function rawSocket() {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const s = { ws, closed: false, closeCode: null, messages: [] };
    ws.on('open', () => resolve(s));
    ws.on('message', (d) => s.messages.push(d.toString()));
    ws.on('close', (code) => {
      s.closed = true;
      s.closeCode = code;
    });
    ws.on('error', () => {});
  });
}

const placeOrder = (tableToken, items, key = randomKey()) =>
  call('POST', '/api/orders', { tableToken, headers: key ? { 'Idempotency-Key': key } : {}, body: { items } });

async function serverAlive() {
  const r = await call('GET', '/api/public/config');
  return r.status === 200;
}

// ------------------------------------------------------------------ chuẩn bị

const ctx = {};

async function setup() {
  const admin = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  if (admin.status !== 200) throw new Error(`Không đăng nhập được admin (HTTP ${admin.status}). Server đã chạy chưa?`);
  ctx.admin = admin.data.token;
  ctx.bep = (await call('POST', '/api/auth/login', { body: { username: 'bep', password: 'bep123' } })).data.token;
  ctx.thungan = (await call('POST', '/api/auth/login', { body: { username: 'thungan', password: 'thungan123' } })).data?.token;
  if (!ctx.thungan) throw new Error('Không đăng nhập được tài khoản thu ngân thungan/thungan123');
  ctx.originalSettings = (await call('GET', '/api/admin/settings', { token: ctx.admin })).data;
  await setSettings({ deliveryMode: 'RELIABLE_PUSH', idempotencyEnabled: true, optimisticLockEnabled: true, rateLimitEnabled: false, trustForwardedFor: false });
  const tables = (await call('POST', '/api/admin/tables/bulk', { token: ctx.admin, body: { prefix: 'LTE', count: 8, open: true } })).data;
  await call('POST', '/api/admin/maintenance/clear-test-orders', { token: ctx.admin });
  ctx.tables = tables;
  ctx.t1 = tables[0];
  ctx.t2 = tables[1];
  const items = (await call('GET', '/api/admin/menu-items', { token: ctx.admin })).data;
  ctx.items = items;
  ctx.pho = items.find((i) => i.name === 'Phở bò tái');
  ctx.bo = items.find((i) => i.name === 'Bò lúc lắc');
  ctx.flan = items.find((i) => i.name === 'Bánh flan');
  ctx.originalBo = { ...ctx.bo };
  ctx.originalFlan = { ...ctx.flan };
}

function setSettings(patch) {
  return call('PUT', '/api/admin/settings', { token: ctx.admin, body: patch });
}

function menuItemRequest(item, patch = {}) {
  const i = { ...item, ...patch };
  return { categoryId: i.categoryId, name: i.name, description: i.description, price: i.price, imageUrl: i.imageUrl, available: i.available, stock: i.stock, station: i.station };
}

async function teardown() {
  await call('PUT', `/api/admin/menu-items/${ctx.bo.id}`, { token: ctx.admin, body: menuItemRequest(ctx.originalBo) });
  await call('PUT', `/api/admin/menu-items/${ctx.flan.id}`, { token: ctx.admin, body: menuItemRequest(ctx.originalFlan) });
  await setSettings({ ...ctx.originalSettings, rateLimitEnabled: true, trustForwardedFor: false });
  await call('POST', '/api/admin/maintenance/clear-test-orders', { token: ctx.admin });
}

// ================================================================== CÁC NHÓM TEST

async function testPublic() {
  const cfg = await call('GET', '/api/public/config');
  check('GET /config trả deliveryMode, heartbeatMs', cfg.status === 200 && cfg.data.deliveryMode && cfg.data.heartbeatMs === 10000, cfg.data);
  const t = await call('GET', `/api/public/tables/${ctx.t1.qrToken}`);
  check('Mã QR hợp lệ -> thông tin bàn', t.status === 200 && t.data.code === ctx.t1.code && t.data.open === true, t.data);
  const bad = await call('GET', '/api/public/tables/khong-ton-tai');
  check('Mã QR sai -> 401 INVALID_TABLE_TOKEN', bad.status === 401 && bad.data.error === 'INVALID_TABLE_TOKEN', bad);
  const menu = await call('GET', '/api/public/menu');
  const etag = menu.headers.get('etag');
  check('Thực đơn có danh mục và ETag', menu.status === 200 && menu.data.categories.length >= 4 && !!etag, etag);
  const again = await call('GET', '/api/public/menu', { headers: { 'If-None-Match': etag } });
  check('If-None-Match khớp -> 304 Not Modified, body rỗng', again.status === 304 && again.data === null, again.status);
  const notFound = await call('GET', '/api/khong-co');
  check('API không tồn tại -> 404 JSON NOT_FOUND', notFound.status === 404 && notFound.data?.error === 'NOT_FOUND', notFound);
  for (const path of ['/kitchen', '/admin', '/t/abc']) {
    const r = await fetch(BASE + path);
    const html = await r.text();
    check(`Route SPA ${path} trả index.html`, r.status === 200 && html.includes('<div id="root">'), r.status);
  }
}

async function testAuth() {
  const ok = await call('POST', '/api/auth/login', { body: { username: 'bep', password: 'bep123' } });
  check('Đăng nhập đúng -> token + role KITCHEN', ok.status === 200 && ok.data.role === 'KITCHEN' && ok.data.token.includes('.'), ok.data);
  const wrong = await call('POST', '/api/auth/login', { body: { username: 'bep', password: 'sai' } });
  check('Sai mật khẩu -> 401', wrong.status === 401 && wrong.data.error === 'UNAUTHORIZED', wrong.data);
  const empty = await call('POST', '/api/auth/login', { body: {} });
  check('Thiếu username/password -> 400 kèm lỗi từng trường', empty.status === 400 && empty.data.details.username, empty.data);
  const noToken = await call('GET', '/api/kitchen/orders');
  check('API bếp không có token -> 401', noToken.status === 401, noToken.status);
  const forged = await call('GET', '/api/kitchen/orders', { token: ctx.bep.slice(0, -3) + 'abc' });
  check('Token bị sửa chữ ký -> 401', forged.status === 401, forged.status);
  const forbidden = await call('GET', '/api/admin/tables', { token: ctx.bep });
  check('Tài khoản bếp gọi API admin -> 403', forbidden.status === 403 && forbidden.data.error === 'FORBIDDEN', forbidden.data);
  const kitchenOk = await call('GET', '/api/kitchen/orders', { token: ctx.bep });
  check('Tài khoản bếp gọi API bếp -> 200', kitchenOk.status === 200, kitchenOk.status);
}

async function testOrderValidation() {
  const tok = ctx.t1.qrToken;
  const line = [{ menuItemId: ctx.pho.id, quantity: 1 }];
  const noHeader = await call('POST', '/api/orders', { body: { items: line } });
  check('Thiếu X-Table-Token -> 400', noHeader.status === 400, noHeader.status);
  const badToken = await placeOrder('sai-ma', line);
  check('X-Table-Token sai -> 401', badToken.status === 401, badToken.status);
  const empty = await placeOrder(tok, []);
  check('Đơn rỗng -> 400', empty.status === 400 && empty.data.details.items, empty.data);
  const q0 = await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 0 }]);
  check('Số lượng 0 -> 400', q0.status === 400, q0.data);
  const q51 = await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 51 }]);
  check('Số lượng 51 -> 400', q51.status === 400, q51.data);
  const longNote = await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 1, note: 'x'.repeat(201) }]);
  check('Ghi chú > 200 ký tự -> 400', longNote.status === 400, longNote.data);
  const tooMany = await placeOrder(tok, Array.from({ length: 31 }, () => ({ menuItemId: ctx.pho.id, quantity: 1 })));
  check('Quá 30 dòng món -> 400', tooMany.status === 400, tooMany.data);
  const malformed = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Table-Token': tok }, body: '{"items": [' });
  check('JSON hỏng -> 400', malformed.status === 400, malformed.status);
  const wrongType = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Table-Token': tok }, body: 'hello' });
  check('Sai Content-Type -> 415', wrongType.status === 415, wrongType.status);
  const wrongTypeJson = await wrongType.json().catch(() => null);
  check('Lỗi 415 vẫn trả JSON thống nhất', wrongTypeJson?.error === 'INVALID_REQUEST', wrongTypeJson);
  const badKey = await placeOrder(tok, line, 'abc');
  check('Idempotency-Key sai định dạng -> 400', badKey.status === 400, badKey.data);
  const noItem = await placeOrder(tok, [{ menuItemId: 999999, quantity: 1 }]);
  check('Món không tồn tại -> 422 ITEM_UNAVAILABLE', noItem.status === 422 && noItem.data.error === 'ITEM_UNAVAILABLE', noItem.data);
  await call('PUT', `/api/admin/menu-items/${ctx.flan.id}`, { token: ctx.admin, body: menuItemRequest(ctx.flan, { available: false }) });
  const unavailable = await placeOrder(tok, [{ menuItemId: ctx.flan.id, quantity: 1 }]);
  check('Món đã tắt bán -> 422', unavailable.status === 422, unavailable.data);
  await call('PUT', `/api/admin/menu-items/${ctx.flan.id}`, { token: ctx.admin, body: menuItemRequest(ctx.originalFlan) });
  const wrongMethod = await call('GET', '/api/orders/1/cancel', { tableToken: tok });
  check('Sai HTTP method -> 405 JSON', wrongMethod.status === 405 && wrongMethod.data?.error === 'INVALID_REQUEST', wrongMethod.status);
  const badPath = await call('POST', '/api/orders/abc/cancel', { tableToken: tok });
  check('Path variable không phải số -> 400', badPath.status === 400, badPath.status);
  check('Server vẫn sống sau loạt request lỗi', await serverAlive());
}

async function testIdempotency() {
  const tok = ctx.t1.qrToken;
  const key = randomKey();
  const items = [{ menuItemId: ctx.pho.id, quantity: 2, note: 'ít hành' }];
  const first = await placeOrder(tok, items, key);
  check('Đơn mới -> 201, Idempotent-Replayed: false', first.status === 201 && first.headers.get('idempotent-replayed') === 'false', first.status);
  check('Đơn có tổng tiền và món ở trạng thái PENDING', first.data.total === ctx.pho.price * 2 && first.data.items[0].status === 'PENDING' && first.data.items[0].note === 'ít hành', first.data);
  const second = await placeOrder(tok, items, key);
  check('Gửi lại cùng key -> 200, cùng orderId, Idempotent-Replayed: true',
    second.status === 200 && second.data.id === first.data.id && second.headers.get('idempotent-replayed') === 'true', second.status);
  const reused = await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 3 }], key);
  check('Cùng key, khác nội dung -> 409 IDEMPOTENCY_KEY_REUSED', reused.status === 409 && reused.data.error === 'IDEMPOTENCY_KEY_REUSED', reused.data);
  const key2 = randomKey();
  const burst = await Promise.all(Array.from({ length: 10 }, () => placeOrder(tok, items, key2)));
  const ids = new Set(burst.map((r) => r.data?.id));
  check('10 request song song cùng key -> tất cả 2xx, chỉ 1 đơn', burst.every((r) => r.status === 201 || r.status === 200) && ids.size === 1, burst.map((r) => r.status));
  check('...trong đó đúng 1 response là 201', burst.filter((r) => r.status === 201).length === 1, burst.map((r) => r.status));
  const a = await placeOrder(tok, items, null);
  const b = await placeOrder(tok, items, null);
  check('Không gửi key -> mỗi lần là một đơn mới', a.status === 201 && b.status === 201 && a.data.id !== b.data.id);
  const mine = await call('GET', '/api/orders', { tableToken: tok });
  check('GET /api/orders trả các đơn của bàn', mine.status === 200 && mine.data.orders.some((o) => o.id === first.data.id) && mine.data.table.code === ctx.t1.code, mine.data.table);
  const other = await call('GET', '/api/orders', { tableToken: ctx.t2.qrToken });
  check('Bàn khác không thấy đơn của bàn này', !other.data.orders.some((o) => o.id === first.data.id));
}

async function testRealtime() {
  const kitchen = await stomp({ Authorization: `Bearer ${ctx.bep}` });
  check('Bếp CONNECT bằng token -> CONNECTED', kitchen.connected, kitchen.errors);
  check('Thoả thuận heart-beat 10000,10000', kitchen.frame?.headers['heart-beat'] === '10000,10000', kitchen.frame?.headers);
  const c1 = await stomp({ tableToken: ctx.t1.qrToken });
  const c2 = await stomp({ tableToken: ctx.t2.qrToken, deviceId: DEV_B });
  check('Khách CONNECT bằng tableToken -> CONNECTED', c1.connected && c2.connected, [c1.errors, c2.errors]);
  const kMsgs = collect(kitchen, '/topic/kitchen');
  const replays = collect(kitchen, '/user/queue/replay');
  const c1Msgs = collect(c1, `/topic/table.${ctx.t1.id}`);
  const c2TableMsgs = collect(c2, `/topic/table.${ctx.t2.id}`);
  await sleep(300);

  const order = await placeOrder(ctx.t1.qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }]);
  await waitFor(() => kMsgs.some((m) => m.payload?.id === order.data.id) && c1Msgs.length > 0, 3000);
  const created = kMsgs.find((m) => m.type === 'ORDER_CREATED' && m.payload?.id === order.data.id);
  check('Bếp nhận ORDER_CREATED qua WebSocket', !!created, kMsgs.map((m) => m.type));
  check('Envelope có seq, eventId, serverTime, payload', created && typeof created.seq === 'number' && created.eventId?.length === 36 && created.serverTime > 0 && created.payload.items.length === 1, created);
  check('Khách của bàn nhận ORDER_CREATED trên /topic/table.{id}, payload không lộ mã thiết bị',
    c1Msgs.some((m) => m.type === 'ORDER_CREATED' && m.payload.id === order.data.id) && !JSON.stringify(c1Msgs).includes(DEV_A), c1Msgs.length);
  await sleep(300);
  check('Khách bàn khác KHÔNG nhận sự kiện của bàn này', c2TableMsgs.length === 0, c2TableMsgs);

  kitchen.client.send('/app/ack', { seq: created.seq });
  await sleep(300);
  const monitor = (await call('GET', '/api/admin/monitor', { token: ctx.admin })).data;
  const staffConn = monitor.connections.find((c) => c.role === 'STAFF' && c.label === 'bep' && c.lastAckSeq === created.seq);
  check('ACK được ghi nhận (trang giám sát thấy lastAckSeq)', !!staffConn, monitor.connections);

  kitchen.client.send('/app/resume', { lastSeq: created.seq - 1 });
  await waitFor(() => replays.length > 0, 3000);
  const batch = replays[0];
  check('RESUME -> REPLAY_BATCH gửi riêng cho session', batch?.type === 'REPLAY_BATCH' && batch.events.some((e) => e.seq === created.seq), batch);
  check('REPLAY_BATCH có latestSeq >= seq và hasMore=false', batch && batch.latestSeq >= created.seq && batch.hasMore === false, batch && { latestSeq: batch.latestSeq, hasMore: batch.hasMore });

  const itemId = order.data.items[0].id;
  const upd = await call('PATCH', `/api/kitchen/order-items/${itemId}/status`, { token: ctx.bep, body: { status: 'ACCEPTED', version: 0 } });
  check('Bếp nhận món -> 200, version tăng lên 1', upd.status === 200 && upd.data.version === 1 && upd.data.status === 'ACCEPTED', upd.data);
  await waitFor(() => c1Msgs.some((m) => m.type === 'ITEM_STATUS_CHANGED'), 3000);
  const changed = c1Msgs.find((m) => m.type === 'ITEM_STATUS_CHANGED');
  check('Khách nhận ITEM_STATUS_CHANGED (from/to/version/by)', changed?.payload.from === 'PENDING' && changed.payload.to === 'ACCEPTED' && changed.payload.version === 1 && changed.payload.by === 'bep', changed);
  check('Bếp cũng nhận ITEM_STATUS_CHANGED', kMsgs.some((m) => m.type === 'ITEM_STATUS_CHANGED' && m.payload.orderItemId === itemId));
  const seqs = kMsgs.filter((m) => typeof m.seq === 'number').map((m) => m.seq);
  check('seq tăng dần theo thứ tự nhận', seqs.every((s, i) => i === 0 || s > seqs[i - 1]), seqs);

  // Cấu hình thay đổi -> bếp nhận CONFIG_CHANGED
  await setSettings({ deliveryMode: 'RELIABLE_PUSH' });
  await waitFor(() => kMsgs.some((m) => m.type === 'CONFIG_CHANGED'), 2000);
  check('Đổi cấu hình -> bếp nhận CONFIG_CHANGED', kMsgs.some((m) => m.type === 'CONFIG_CHANGED'));

  // Lỗi khi xử lý message: JSON hỏng gửi tới /app/resume
  const errs = collect(kitchen, '/user/queue/errors');
  await sleep(200);
  kitchen.client.ws.send(encodeFrame('SEND', { destination: '/app/resume', 'content-type': 'application/json' }, '{hỏng'));
  await waitFor(() => errs.length > 0, 3000);
  check('Payload STOMP hỏng -> lỗi gửi về /user/queue/errors', errs[0]?.error === 'INVALID_MESSAGE', errs);
  await sleep(300);
  check('...và kết nối bếp vẫn mở', kitchen.client.connected && !kitchen.closed);

  // Bếp mới kết nối gửi RESUME từ latestSeq -> giám sát coi như đã ACK tới đó (không hiện độ trễ ảo)
  const fresh = await stomp({ Authorization: `Bearer ${ctx.bep}` });
  collect(fresh, '/user/queue/replay');
  await sleep(200);
  const latest = (await call('GET', '/api/kitchen/orders', { token: ctx.bep })).data.latestSeq;
  fresh.client.send('/app/resume', { lastSeq: latest });
  await sleep(400);
  const mon2 = (await call('GET', '/api/admin/monitor', { token: ctx.admin })).data;
  const freshConn = mon2.connections.filter((c) => c.role === 'STAFF').sort((a, b) => b.connectedAt - a.connectedAt)[0];
  check('RESUME từ latestSeq -> lastAckSeq = latestSeq, độ trễ ~0', freshConn.lastAckSeq === latest && freshConn.lag <= 1, freshConn);

  [kitchen, c1, c2, fresh].forEach((s) => s.client.disconnect());
}

async function testWsSecurity() {
  const anon = await stomp({});
  check('CONNECT không xác thực -> ERROR, không kết nối', !anon.connected && anon.errors.some((e) => e.includes('UNAUTHORIZED')), anon.errors);
  const badTable = await stomp({ tableToken: 'sai-ma' });
  check('CONNECT với tableToken sai -> ERROR', !badTable.connected && badTable.errors.some((e) => e.includes('INVALID_TABLE_TOKEN')), badTable.errors);
  const badBearer = await stomp({ Authorization: 'Bearer abc.def' });
  check('CONNECT với token nhân viên giả -> ERROR', !badBearer.connected && badBearer.errors.length > 0, badBearer.errors);

  const c1 = await stomp({ tableToken: ctx.t1.qrToken });
  collect(c1, `/topic/table.${ctx.t2.id}`);
  await waitFor(() => c1.errors.length > 0, 2000);
  check('Khách subscribe topic bàn khác -> ERROR FORBIDDEN', c1.errors.some((e) => e.includes('FORBIDDEN')), c1.errors);
  c1.client.disconnect();

  const c2 = await stomp({ tableToken: ctx.t1.qrToken });
  collect(c2, '/topic/kitchen');
  await waitFor(() => c2.errors.length > 0, 2000);
  check('Khách subscribe /topic/kitchen -> ERROR FORBIDDEN', c2.errors.some((e) => e.includes('FORBIDDEN')), c2.errors);
  c2.client.disconnect();

  const c3 = await stomp({ tableToken: ctx.t1.qrToken });
  c3.client.send('/app/resume', { lastSeq: 0 });
  await waitFor(() => c3.errors.length > 0, 2000);
  check('Khách gửi /app/resume -> ERROR FORBIDDEN', c3.errors.some((e) => e.includes('FORBIDDEN')), c3.errors);
  c3.client.disconnect();

  // Giới hạn 8 kết nối mỗi bàn
  const t3 = ctx.tables[2];
  await sleep(300);
  const conns = [];
  for (let i = 0; i < 8; i++) conns.push(await stomp({ tableToken: t3.qrToken }));
  check('8 kết nối đầu tiên của một bàn được chấp nhận', conns.every((s) => s.connected), conns.map((s) => s.errors));
  const ninth = await stomp({ tableToken: t3.qrToken });
  check('Kết nối thứ 9 -> ERROR TOO_MANY_CONNECTIONS', !ninth.connected && ninth.errors.some((e) => e.includes('TOO_MANY_CONNECTIONS')), ninth.errors);
  conns[0].client.disconnect();
  await sleep(500);
  const afterFree = await stomp({ tableToken: t3.qrToken });
  check('Đóng 1 kết nối -> kết nối mới lại được chấp nhận (bộ đếm giảm đúng)', afterFree.connected, afterFree.errors);
  [...conns.slice(1), afterFree].forEach((s) => s.client.disconnect());

  // Dữ liệu bất thường ở tầng WebSocket
  const garbage = await rawSocket();
  garbage.ws.send('KHONG_PHAI_STOMP\n\n\u0000');
  await waitFor(() => garbage.closed || garbage.messages.some((m) => m.startsWith('ERROR')), 3000);
  check('Frame không phải STOMP -> server trả ERROR/đóng kết nối', garbage.closed || garbage.messages.some((m) => m.startsWith('ERROR')), garbage.messages);
  garbage.ws.terminate();

  const big = await stomp({ Authorization: `Bearer ${ctx.bep}` });
  big.client.ws.send(encodeFrame('SEND', { destination: '/app/ack', 'content-type': 'application/json' }, `{"seq":1,"pad":"${'x'.repeat(100 * 1024)}"}`));
  await waitFor(() => big.closed, 4000);
  check('Frame 100KB vượt giới hạn 64KB -> server đóng kết nối', big.closed);
  check('Server vẫn sống sau frame quá cỡ', await serverAlive());

  // Spring kiểm tra time-to-first-message khi có kết nối mới -> chờ quá 10s rồi mở một kết nối khác để kích hoạt
  const silent = await rawSocket();
  console.log('    (chờ 11s để kiểm tra time-to-first-message...)');
  await sleep(11000);
  const trigger = await stomp({ tableToken: ctx.t1.qrToken });
  await waitFor(() => silent.closed, 3000, 100);
  check('WebSocket không gửi CONNECT quá 10s -> bị server đóng', silent.closed, silent.closeCode);
  trigger.client.disconnect();
}

async function testKitchenAndStateMachine() {
  const tok = ctx.t1.qrToken;
  const order = (await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 1 }, { menuItemId: ctx.items.find((i) => i.station === 'BAR').id, quantity: 1 }])).data;
  const snap = await call('GET', '/api/kitchen/orders', { token: ctx.bep });
  check('Ảnh chụp bếp có latestSeq và đơn mới', snap.status === 200 && snap.data.latestSeq > 0 && snap.data.orders.some((o) => o.id === order.id), snap.data.latestSeq);
  check('Món có trạm (KITCHEN/BAR) để lọc', order.items.some((i) => i.station === 'BAR') && order.items.some((i) => i.station === 'KITCHEN'));
  const events = await call('GET', `/api/kitchen/events?afterSeq=${snap.data.latestSeq - 1}`, { token: ctx.bep });
  check('GET /events?afterSeq trả sự kiện sau seq', events.status === 200 && events.data.events.length >= 1 && events.data.events.every((e) => e.seq > snap.data.latestSeq - 1), events.data.events.length);

  const item = order.items[0];
  let version = 0;
  for (const to of ['ACCEPTED', 'COOKING', 'READY', 'SERVED']) {
    const r = await call('PATCH', `/api/kitchen/order-items/${item.id}/status`, { token: ctx.bep, body: { status: to, version } });
    check(`Chuyển trạng thái -> ${to} (version ${version} -> ${version + 1})`, r.status === 200 && r.data.status === to && r.data.version === version + 1, r.data);
    version++;
  }
  const back = await call('PATCH', `/api/kitchen/order-items/${item.id}/status`, { token: ctx.bep, body: { status: 'COOKING', version } });
  check('SERVED -> COOKING bị từ chối 409 INVALID_STATE_TRANSITION', back.status === 409 && back.data.error === 'INVALID_STATE_TRANSITION', back.data);
  const skip = await call('PATCH', `/api/kitchen/order-items/${order.items[1].id}/status`, { token: ctx.bep, body: { status: 'READY', version: 0 } });
  check('PENDING -> READY (nhảy cóc) bị từ chối, kèm danh sách allowed', skip.status === 409 && skip.data.details.allowed?.includes('ACCEPTED'), skip.data);
  const stale = await call('PATCH', `/api/kitchen/order-items/${item.id}/status`, { token: ctx.bep, body: { status: 'SERVED', version: 1 } });
  check('Version cũ -> 409 VERSION_CONFLICT kèm currentVersion', stale.status === 409 && stale.data.error === 'VERSION_CONFLICT' && stale.data.details.currentVersion === 4, stale.data);
  const reject = await call('PATCH', `/api/kitchen/order-items/${order.items[1].id}/status`, { token: ctx.bep, body: { status: 'CANCELLED', version: 0 } });
  check('Bếp từ chối món (PENDING -> CANCELLED)', reject.status === 200 && reject.data.status === 'CANCELLED', reject.data);
  const mine = (await call('GET', '/api/orders', { tableToken: tok })).data.orders.find((o) => o.id === order.id);
  check('Mọi món SERVED/CANCELLED -> đơn COMPLETED', mine.status === 'COMPLETED', mine.status);
  const snap2 = (await call('GET', '/api/kitchen/orders', { token: ctx.bep })).data;
  check('Đơn hoàn tất không còn trong ảnh chụp bếp', !snap2.orders.some((o) => o.id === order.id));
  const missing = await call('PATCH', '/api/kitchen/order-items/99999999/status', { token: ctx.bep, body: { status: 'ACCEPTED', version: 0 } });
  check('Món không tồn tại -> 404', missing.status === 404, missing.status);
  const badEnum = await call('PATCH', `/api/kitchen/order-items/${item.id}/status`, { token: ctx.bep, body: { status: 'FOO', version: 0 } });
  check('Trạng thái không hợp lệ ("FOO") -> 400', badEnum.status === 400, badEnum.status);

  const race = (await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data.items[0];
  const results = await Promise.all(Array.from({ length: 10 }, (_, k) =>
    call('PATCH', `/api/kitchen/order-items/${race.id}/status`, { token: ctx.bep, body: { status: k % 2 ? 'ACCEPTED' : 'CANCELLED', version: 0 } })));
  check('10 bếp cùng đổi một món -> đúng 1 thành công, 9 nhận 409', results.filter((r) => r.status === 200).length === 1 && results.filter((r) => r.status === 409).length === 9, results.map((r) => r.status));
}

async function testCancel() {
  const tok = ctx.t1.qrToken;
  const kitchen = await stomp({ Authorization: `Bearer ${ctx.bep}` });
  const kMsgs = collect(kitchen, '/topic/kitchen');
  await sleep(200);
  const order = (await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data;
  const cancel = await call('POST', `/api/orders/${order.id}/cancel`, { tableToken: tok });
  check('Khách huỷ đơn còn PENDING -> 200, đơn CANCELLED', cancel.status === 200 && cancel.data.status === 'CANCELLED' && cancel.data.items.every((i) => i.status === 'CANCELLED'), cancel.data);
  await waitFor(() => kMsgs.some((m) => m.type === 'ORDER_CANCELLED'), 2000);
  check('Bếp nhận ORDER_CANCELLED', kMsgs.some((m) => m.type === 'ORDER_CANCELLED' && m.payload.orderId === order.id));
  kitchen.client.disconnect();

  const accepted = (await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data;
  await call('PATCH', `/api/kitchen/order-items/${accepted.items[0].id}/status`, { token: ctx.bep, body: { status: 'ACCEPTED', version: 0 } });
  const late = await call('POST', `/api/orders/${accepted.id}/cancel`, { tableToken: tok });
  check('Huỷ sau khi bếp đã nhận -> 409', late.status === 409 && late.data.error === 'INVALID_STATE_TRANSITION', late.data);
  const otherTable = await call('POST', `/api/orders/${accepted.id}/cancel`, { tableToken: ctx.t2.qrToken });
  check('Bàn khác huỷ đơn không phải của mình -> 404', otherTable.status === 404, otherTable.status);
  const none = await call('POST', '/api/orders/99999999/cancel', { tableToken: tok });
  check('Huỷ đơn không tồn tại -> 404', none.status === 404, none.status);
}

async function testStock() {
  const tok = ctx.t1.qrToken;
  const c1 = await stomp({ tableToken: tok });
  const menuMsgs = collect(c1, '/topic/menu');
  await sleep(200);
  await call('PUT', `/api/admin/menu-items/${ctx.bo.id}`, { token: ctx.admin, body: menuItemRequest(ctx.originalBo, { stock: 3, available: true }) });
  const etagBefore = (await call('GET', '/api/public/menu')).headers.get('etag');
  const two = await placeOrder(tok, [{ menuItemId: ctx.bo.id, quantity: 2 }]);
  check('Đặt 2/3 suất -> 201', two.status === 201, two.data);
  const stockAfter = (await call('GET', '/api/admin/menu-items', { token: ctx.admin })).data.find((i) => i.id === ctx.bo.id);
  check('Tồn kho giảm còn 1', stockAfter.stock === 1 && stockAfter.available === true, stockAfter);
  const tooMuch = await placeOrder(tok, [{ menuItemId: ctx.bo.id, quantity: 2 }]);
  check('Đặt 2 khi chỉ còn 1 -> 422 không đủ số lượng', tooMuch.status === 422 && tooMuch.data.details.requested === 2, tooMuch.data);
  const last = await placeOrder(tok, [{ menuItemId: ctx.bo.id, quantity: 1 }]);
  check('Đặt suất cuối -> 201', last.status === 201, last.status);
  const soldOut = (await call('GET', '/api/public/menu')).data.categories.flatMap((c) => c.items).find((i) => i.id === ctx.bo.id);
  check('Hết suất -> món tự chuyển available=false trên thực đơn', soldOut.available === false && soldOut.stock === 0, soldOut);
  const etagAfter = (await call('GET', '/api/public/menu')).headers.get('etag');
  check('ETag thực đơn đổi khi tồn kho đổi', etagBefore !== etagAfter, [etagBefore, etagAfter]);
  await waitFor(() => menuMsgs.length > 0, 2000);
  check('Khách nhận MENU_UPDATED qua WebSocket', menuMsgs.some((m) => m.type === 'MENU_UPDATED'), menuMsgs);
  const afterSold = await placeOrder(tok, [{ menuItemId: ctx.bo.id, quantity: 1 }]);
  check('Đặt món đã hết -> 422', afterSold.status === 422, afterSold.status);
  const cancel = await call('POST', `/api/orders/${last.data.id}/cancel`, { tableToken: tok });
  const restored = (await call('GET', '/api/admin/menu-items', { token: ctx.admin })).data.find((i) => i.id === ctx.bo.id);
  check('Huỷ đơn -> hoàn lại tồn kho và mở bán lại', cancel.status === 200 && restored.stock === 1 && restored.available === true, restored);
  const racers = await Promise.all(ctx.tables.slice(0, 5).map((t) => placeOrder(t.qrToken, [{ menuItemId: ctx.bo.id, quantity: 1 }])));
  check('5 bàn tranh suất cuối cùng -> đúng 1 bàn thành công', racers.filter((r) => r.status === 201).length === 1 && racers.filter((r) => r.status === 422).length === 4, racers.map((r) => r.status));
  c1.client.disconnect();
}

async function testTables() {
  const code = `LTX${Date.now() % 100000}`;
  const created = await call('POST', '/api/admin/tables', { token: ctx.admin, body: { code } });
  check('Tạo bàn mới -> 201, đang phục vụ (OPEN), chưa có phiên, có qrToken 24 ký tự',
    created.status === 201 && created.data.status === 'OPEN' && created.data.sessionId === null && created.data.qrToken.length === 24, created.data);
  const dup = await call('POST', '/api/admin/tables', { token: ctx.admin, body: { code } });
  check('Trùng mã bàn -> 409', dup.status === 409, dup.data);
  const invalid = await call('POST', '/api/admin/tables', { token: ctx.admin, body: { code: 'a b' } });
  check('Mã bàn chứa khoảng trắng -> 400', invalid.status === 400, invalid.status);
  const tok = created.data.qrToken;
  const id = created.data.id;
  const noSession = await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 1 }]);
  check('Đặt món khi chưa vào bàn (chưa có phiên) -> 409 SESSION_ENDED', noSession.status === 409 && noSession.data.error === 'SESSION_ENDED', noSession.data);

  const joined = await call('POST', `/api/public/tables/${tok}/join`, { tableToken: tok });
  check('Khách đầu tiên vào bàn -> phiên tự mở (newSession = true)', joined.status === 200 && joined.data.sessionId > 0 && joined.data.newSession === true, joined.data);
  const joinedB = await call('POST', `/api/public/tables/${tok}/join`, { tableToken: tok, headers: { 'X-Device-Id': DEV_B } });
  check('Máy thứ hai vào cùng phiên (newSession = false)', joinedB.data.sessionId === joined.data.sessionId && joinedB.data.newSession === false, joinedB.data);
  const ok = await placeOrder(tok, [{ menuItemId: ctx.pho.id, quantity: 1 }]);
  check('Đã vào bàn -> đặt món được', ok.status === 201, ok.status);

  const closeBusy = await call('POST', `/api/admin/tables/${id}/close`, { token: ctx.admin });
  check('Admin đóng bàn (ngừng phục vụ) khi đang có khách -> 409 TABLE_HAS_GUESTS', closeBusy.status === 409 && closeBusy.data.error === 'TABLE_HAS_GUESTS', closeBusy.data);
  await call('POST', `/api/cashier/tables/${id}/checkout`, { token: ctx.thungan, body: { reason: 'OTHER', note: 'e2e' } });

  const cust = await stomp({ tableToken: tok });
  const msgs = collect(cust, `/topic/table.${id}`);
  await sleep(200);
  const closed = await call('POST', `/api/admin/tables/${id}/close`, { token: ctx.admin });
  check('Bàn trống -> admin đóng bàn được, trạng thái CLOSED', closed.status === 200 && closed.data.status === 'CLOSED' && closed.data.sessionId === null, closed.data);
  await waitFor(() => msgs.some((m) => m.type === 'TABLE_CLOSED'), 2000);
  check('Khách đang mở trang nhận TABLE_CLOSED qua WebSocket', msgs.some((m) => m.type === 'TABLE_CLOSED'), msgs);
  cust.client.disconnect();
  const joinClosed = await call('POST', `/api/public/tables/${tok}/join`, { tableToken: tok });
  check('Quét QR bàn đang ngừng phục vụ -> 409 TABLE_CLOSED, không mở phiên', joinClosed.status === 409 && joinClosed.data.error === 'TABLE_CLOSED', joinClosed.data);
  await call('POST', `/api/admin/tables/${id}/open`, { token: ctx.admin });
  const rejoin = await call('POST', `/api/public/tables/${tok}/join`, { tableToken: tok });
  check('Mở bàn lại -> khách vào được, phiên mới, không thấy đơn của khách trước',
    rejoin.status === 200 && rejoin.data.sessionId !== joined.data.sessionId
    && (await call('GET', '/api/orders', { tableToken: tok, headers: { 'X-Session-Id': String(rejoin.data.sessionId) } })).data.orders.length === 0, rejoin.data);
  await call('POST', `/api/cashier/tables/${id}/checkout`, { token: ctx.thungan, body: {} });

  const rotated = await call('POST', `/api/admin/tables/${id}/rotate-token`, { token: ctx.admin });
  check('Đổi mã QR -> token mới khác token cũ', rotated.status === 200 && rotated.data.qrToken !== tok, rotated.data);
  const oldTok = await call('GET', `/api/public/tables/${tok}`);
  const newTok = await call('GET', `/api/public/tables/${rotated.data.qrToken}`);
  check('Mã QR cũ không dùng được nữa (401), mã mới dùng được', oldTok.status === 401 && newTok.status === 200, [oldTok.status, newTok.status]);
  await call('POST', `/api/admin/tables/${id}/close`, { token: ctx.admin });
}

async function testMenuAdmin() {
  const cats = await call('GET', '/api/admin/categories', { token: ctx.admin });
  check('Danh sách danh mục', cats.status === 200 && cats.data.length >= 4, cats.data.length);
  const badPrice = await call('POST', '/api/admin/menu-items', { token: ctx.admin, body: { ...menuItemRequest(ctx.pho), price: -1 } });
  check('Thêm món giá âm -> 400', badPrice.status === 400 && badPrice.data.details.price, badPrice.data);
  const badStation = await call('POST', '/api/admin/menu-items', { token: ctx.admin, body: { ...menuItemRequest(ctx.pho), station: 'X' } });
  check('Thêm món trạm không hợp lệ -> 400', badStation.status === 400, badStation.status);
  const badCat = await call('POST', '/api/admin/menu-items', { token: ctx.admin, body: { ...menuItemRequest(ctx.pho), categoryId: 99999 } });
  check('Thêm món vào danh mục không tồn tại -> 400', badCat.status === 400, badCat.data);
  const etag1 = (await call('GET', '/api/public/menu')).headers.get('etag');
  const upd = await call('PUT', `/api/admin/menu-items/${ctx.flan.id}`, { token: ctx.admin, body: menuItemRequest(ctx.flan, { price: ctx.flan.price + 1000 }) });
  check('Sửa giá món -> 200', upd.status === 200 && upd.data.price === ctx.flan.price + 1000, upd.data);
  const etag2 = (await call('GET', '/api/public/menu')).headers.get('etag');
  check('Sửa thực đơn -> ETag đổi (cache bị làm mới)', etag1 !== etag2, [etag1, etag2]);
  const priced = (await placeOrder(ctx.t1.qrToken, [{ menuItemId: ctx.flan.id, quantity: 1 }])).data;
  check('Đơn mới dùng giá mới (snapshot giá lúc đặt)', priced.items[0].unitPrice === ctx.flan.price + 1000, priced.items[0]);
  await call('PUT', `/api/admin/menu-items/${ctx.flan.id}`, { token: ctx.admin, body: menuItemRequest(ctx.originalFlan) });
  const missing = await call('PUT', '/api/admin/menu-items/99999', { token: ctx.admin, body: menuItemRequest(ctx.flan) });
  check('Sửa món không tồn tại -> 404', missing.status === 404, missing.status);
}

async function testMonitorAndModes() {
  const m = (await call('GET', '/api/admin/monitor', { token: ctx.admin })).data;
  check('Giám sát có counters, jvm, settings', m.counters && m.jvm.threads > 0 && m.settings.deliveryMode, Object.keys(m));
  check('Bộ đếm ghi nhận request trùng, xung đột, WS bị từ chối',
    m.counters.duplicateRequestsBlocked > 0 && m.counters.versionConflicts > 0 && m.counters.wsConnectRejected > 0, m.counters);
  const since = Date.now() - 60000;
  const stats = await call('GET', `/api/admin/stats?since=${since}`, { token: ctx.admin });
  check('Thống kê số đơn theo thời gian', stats.status === 200 && stats.data.orders > 0, stats.data);

  const kitchen = await stomp({ Authorization: `Bearer ${ctx.bep}` });
  const kMsgs = collect(kitchen, '/topic/kitchen');
  const cust = await stomp({ tableToken: ctx.t1.qrToken });
  const cMsgs = collect(cust, `/topic/table.${ctx.t1.id}`);
  await sleep(200);

  await setSettings({ deliveryMode: 'POLLING' });
  const cfg = (await call('GET', '/api/public/config')).data;
  check('Đổi sang POLLING -> /config phản ánh ngay', cfg.deliveryMode === 'POLLING');
  const pollOrder = (await placeOrder(ctx.t1.qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data;
  await sleep(800);
  check('POLLING: bếp KHÔNG nhận ORDER_CREATED qua WebSocket', !kMsgs.some((x) => x.type === 'ORDER_CREATED' && x.payload.id === pollOrder.id));
  check('POLLING: khách vẫn nhận sự kiện bàn mình', cMsgs.some((x) => x.type === 'ORDER_CREATED' && x.payload.id === pollOrder.id));
  const polled = (await call('GET', '/api/kitchen/events?afterSeq=0&limit=1000', { token: ctx.bep })).data;
  check('POLLING: bếp lấy được đơn qua /events', polled.events.some((e) => e.type === 'ORDER_CREATED' && e.payload.id === pollOrder.id) || polled.latestSeq > 0);

  await setSettings({ deliveryMode: 'NAIVE_PUSH' });
  const naiveOrder = (await placeOrder(ctx.t1.qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data;
  await waitFor(() => kMsgs.some((x) => x.payload?.id === naiveOrder.id), 2000);
  check('NAIVE_PUSH: bếp nhận qua WebSocket', kMsgs.some((x) => x.type === 'ORDER_CREATED' && x.payload.id === naiveOrder.id));
  await setSettings({ deliveryMode: 'RELIABLE_PUSH' });
  kitchen.client.disconnect();
  cust.client.disconnect();

  await setSettings({ idempotencyEnabled: false });
  const key = randomKey();
  const a = await placeOrder(ctx.t1.qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }], key);
  const b = await placeOrder(ctx.t1.qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }], key);
  check('Tắt idempotency (baseline) -> cùng key tạo 2 đơn', a.status === 201 && b.status === 201 && a.data.id !== b.data.id);
  await setSettings({ idempotencyEnabled: true });

  await setSettings({ optimisticLockEnabled: false });
  const item = (await placeOrder(ctx.t1.qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data.items[0];
  await call('PATCH', `/api/kitchen/order-items/${item.id}/status`, { token: ctx.bep, body: { status: 'ACCEPTED', version: 0 } });
  const stale = await call('PATCH', `/api/kitchen/order-items/${item.id}/status`, { token: ctx.bep, body: { status: 'COOKING', version: 0 } });
  check('Tắt optimistic lock (baseline) -> version cũ vẫn được ghi', stale.status === 200, stale.data);
  await setSettings({ optimisticLockEnabled: true });
}

async function testRateLimit() {
  await setSettings({ rateLimitEnabled: true, trustForwardedFor: true });
  const t = ctx.tables[3];
  const results = [];
  for (let i = 0; i < 12; i++) {
    results.push(await call('POST', '/api/orders', {
      tableToken: t.qrToken,
      headers: { 'Idempotency-Key': randomKey(), 'X-Forwarded-For': '10.9.9.1' },
      body: { items: [{ menuItemId: ctx.pho.id, quantity: 1 }] },
    }));
  }
  const codes = results.map((r) => r.status);
  check('Một bàn (chung mọi điện thoại) đặt 12 đơn liên tiếp -> 10 đơn đầu 201, sau đó 429', codes.slice(0, 10).every((c) => c === 201) && codes.slice(10).every((c) => c === 429), codes);
  const limited = results[11];
  check('429 có header Retry-After và mã RATE_LIMITED', !!limited.headers.get('retry-after') && limited.data.error === 'RATE_LIMITED', [limited.headers.get('retry-after'), limited.data]);
  const otherTable = await call('POST', '/api/orders', {
    tableToken: ctx.tables[4].qrToken,
    headers: { 'Idempotency-Key': randomKey(), 'X-Forwarded-For': '10.9.9.2' },
    body: { items: [{ menuItemId: ctx.pho.id, quantity: 1 }] },
  });
  check('Bàn khác không bị ảnh hưởng', otherTable.status === 201, otherTable.status);
  const burst = await Promise.all(Array.from({ length: 90 }, () => call('GET', '/api/public/config', { headers: { 'X-Forwarded-For': '10.9.9.3' } })));
  const ok = burst.filter((r) => r.status === 200).length;
  const tooMany = burst.filter((r) => r.status === 429).length;
  check('Một IP gửi 90 request cùng lúc -> khoảng 60 được phục vụ, phần còn lại 429', ok >= 55 && ok <= 75 && tooMany > 0, { ok, tooMany });
  const otherIp = await call('GET', '/api/public/config', { headers: { 'X-Forwarded-For': '10.9.9.4' } });
  check('IP khác vẫn được phục vụ bình thường', otherIp.status === 200);
  const mon = (await call('GET', '/api/admin/monitor', { token: ctx.admin, headers: { 'X-Forwarded-For': '10.9.9.5' } })).data;
  check('Bộ đếm rateLimited tăng', mon.counters.rateLimited > 0, mon.counters.rateLimited);
  await setSettings({ rateLimitEnabled: false, trustForwardedFor: false });
}

async function testReliableFeed() {
  async function run(mode) {
    await setSettings({ deliveryMode: mode });
    const snap = (await call('GET', '/api/kitchen/orders', { token: ctx.bep })).data;
    const received = new Set();
    const feed = new KitchenFeed({
      mode,
      wsUrl: WS_URL,
      token: ctx.bep,
      WebSocketImpl: WebSocket,
      onEvent: (env) => env.type === 'ORDER_CREATED' && received.add(env.payload.id),
    });
    feed.start(snap.latestSeq);
    await waitFor(() => feed.conn?.connected, 5000);
    await sleep(300);
    feed.simulateOutage(2500);
    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push((await placeOrder(ctx.tables[5].qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data.id);
    }
    await sleep(500);
    const live = (await placeOrder(ctx.tables[5].qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data.id;
    await waitFor(() => feed.conn?.connected, 10000);
    await sleep(1500);
    created.push((await placeOrder(ctx.tables[5].qrToken, [{ menuItemId: ctx.pho.id, quantity: 1 }])).data.id);
    await sleep(800);
    feed.stop();
    return { lost: [...created, live].filter((id) => !received.has(id)).length, stats: feed.stats, reconnects: feed.conn.reconnects };
  }
  const naive = await run('NAIVE_PUSH');
  check('NAIVE_PUSH: đơn đặt trong lúc bếp mất mạng bị MẤT (baseline)', naive.lost >= 5, naive);
  const reliable = await run('RELIABLE_PUSH');
  check('RELIABLE_PUSH: không mất đơn nào sau khi bếp kết nối lại', reliable.lost === 0, reliable);
  check('RELIABLE_PUSH: có RESUME và gửi bù đơn bị lỡ', reliable.stats.resumes >= 2 && reliable.stats.replayed >= 5, reliable.stats);
  check('Tự kết nối lại sau mất mạng (backoff)', reliable.reconnects >= 1, reliable.reconnects);
  await setSettings({ deliveryMode: 'RELIABLE_PUSH' });
}

async function testSharedSessionAndNames() {
  const table = ctx.tables[6];
  const tok = table.qrToken;
  const asB = { 'X-Device-Id': DEV_B };
  const line = [{ menuItemId: ctx.pho.id, quantity: 1 }];
  // Bắt đầu từ một lượt khách sạch rồi cho 2 "điện thoại" vào bàn
  await call('POST', `/api/cashier/tables/${table.id}/checkout`, { token: ctx.thungan, body: { reason: 'OTHER' } });
  const joinA = (await call('POST', `/api/public/tables/${tok}/join`, { tableToken: tok })).data;
  const joinB = (await call('POST', `/api/public/tables/${tok}/join`, { tableToken: tok, headers: asB })).data;
  check('Hai điện thoại quét cùng QR -> cùng một phiên', joinA.sessionId === joinB.sessionId && joinA.sessionId > 0, [joinA, joinB]);
  const session = { 'X-Session-Id': String(joinA.sessionId) };

  const other = ctx.tables[7];
  await call('POST', `/api/cashier/tables/${other.id}/checkout`, { token: ctx.thungan, body: { reason: 'OTHER' } });
  const racers = await Promise.all(Array.from({ length: 6 }, () =>
    call('POST', `/api/public/tables/${other.qrToken}/join`, { tableToken: other.qrToken, headers: { 'X-Device-Id': randomKey() } })));
  check('6 máy vào bàn trống cùng lúc -> chung 1 phiên', new Set(racers.map((r) => r.data?.sessionId)).size === 1, racers.map((r) => r.data?.sessionId));

  const custB = await stomp({ tableToken: tok });
  const bTable = collect(custB, `/topic/table.${table.id}`);
  await sleep(300);
  const orderA = (await call('POST', '/api/orders', {
    tableToken: tok,
    headers: { ...session, 'Idempotency-Key': randomKey() },
    body: { items: line, guestName: '  Minh   Anh ' },
  })).data;
  check('Tên khách được chuẩn hoá và lưu kèm đơn', orderA.guestName === 'Minh Anh', orderA.guestName);
  check('Đơn đầu tiên của phiên có cờ firstInSession', orderA.firstInSession === true, orderA.firstInSession);
  await waitFor(() => bTable.some((m) => m.type === 'ORDER_CREATED' && m.payload.id === orderA.id), 3000);
  check('Máy B (cùng bàn) nhận ORDER_CREATED của máy A ngay lập tức', bTable.some((m) => m.type === 'ORDER_CREATED' && m.payload.id === orderA.id));

  const viewA = (await call('GET', '/api/orders', { tableToken: tok, headers: session })).data;
  const viewB = (await call('GET', '/api/orders', { tableToken: tok, headers: { ...asB, ...session } })).data;
  check('Máy B thấy đơn của máy A trong danh sách chung', viewB.orders.some((o) => o.id === orderA.id), viewB.orders.map((o) => o.id));
  check('mineOrderIds: máy A biết đơn là của mình, máy B thì không',
    viewA.mineOrderIds.includes(orderA.id) && !viewB.mineOrderIds.includes(orderA.id), [viewA.mineOrderIds, viewB.mineOrderIds]);
  check('Phản hồi không lộ mã thiết bị', !JSON.stringify(viewB).includes(DEV_A));
  const cancelByB = await call('POST', `/api/orders/${orderA.id}/cancel`, { tableToken: tok, headers: { ...asB, ...session } });
  check('Máy B không huỷ được đơn của máy A (404)', cancelByB.status === 404, cancelByB.status);
  const second = (await call('POST', '/api/orders', { tableToken: tok, headers: { ...asB, ...session, 'Idempotency-Key': randomKey() }, body: { items: line } })).data;
  check('Đơn thứ hai của phiên không còn cờ firstInSession', second.firstInSession === false, second.firstInSession);

  const snap = (await call('GET', '/api/kitchen/orders', { token: ctx.bep })).data;
  const onKitchen = snap.orders.find((o) => o.id === orderA.id);
  check('Bếp thấy tên khách và nhãn Bàn mới mở', onKitchen?.guestName === 'Minh Anh' && onKitchen.firstInSession === true, onKitchen);

  // Trả bàn -> lượt khách cũ bị chặn, lượt mới không thấy gì
  const needReason = await call('POST', `/api/cashier/tables/${table.id}/checkout`, { token: ctx.thungan, body: {} });
  check('Trả bàn khi còn nợ / còn món -> 409 CONFIRM_REQUIRED kèm số tiền',
    needReason.status === 409 && needReason.data.error === 'CONFIRM_REQUIRED' && needReason.data.details.remaining > 0, needReason.data);
  const out = await call('POST', `/api/cashier/tables/${table.id}/checkout`, { token: ctx.thungan, body: { reason: 'UNPAID_LEFT', note: 'e2e' } });
  check('Trả bàn với lý do "khách bỏ về" -> bàn trống', out.status === 200 && out.data.state === 'EMPTY', out.data);
  await waitFor(() => bTable.some((m) => m.type === 'TABLE_SESSION_ENDED'), 3000);
  check('Khách đang mở trang nhận TABLE_SESSION_ENDED', bTable.some((m) => m.type === 'TABLE_SESSION_ENDED'));
  const late = await call('POST', '/api/orders', { tableToken: tok, headers: { ...session, 'Idempotency-Key': randomKey() }, body: { items: line } });
  check('Máy của lượt cũ gửi đơn kèm phiên cũ -> 409 SESSION_ENDED', late.status === 409 && late.data.error === 'SESSION_ENDED', late.data);
  const stillOnKitchen = (await call('GET', '/api/kitchen/orders', { token: ctx.bep })).data.orders.some((o) => o.id === orderA.id);
  check('Đơn chưa xong của lượt cũ vẫn còn trên màn hình bếp (không bị mất)', stillOnKitchen);
  custB.client.disconnect();
}

async function testPaymentsAndCashier() {
  const table = ctx.tables[7];
  const tok = table.qrToken;
  await call('POST', `/api/cashier/tables/${table.id}/checkout`, { token: ctx.thungan, body: { reason: 'OTHER' } });
  const join = (await call('POST', `/api/public/tables/${tok}/join`, { tableToken: tok })).data;
  const session = { 'X-Session-Id': String(join.sessionId) };
  const order = (await call('POST', '/api/orders', {
    tableToken: tok,
    headers: { ...session, 'Idempotency-Key': randomKey() },
    body: { items: [{ menuItemId: ctx.pho.id, quantity: 2 }] },
  })).data;

  const bill = (await call('GET', '/api/payments/bill', { tableToken: tok, headers: session })).data;
  check('Hóa đơn: tổng do server tính, còn phải trả = tổng', bill.total === ctx.pho.price * 2 && bill.remaining === bill.total && bill.methods.includes('CASH'), bill);

  const cashierWs = await stomp({ Authorization: `Bearer ${ctx.thungan}` });
  const cashierMsgs = collect(cashierWs, '/topic/cashier');
  const kitchenOnCashier = await stomp({ Authorization: `Bearer ${ctx.bep}` });
  collect(kitchenOnCashier, '/topic/cashier');
  await waitFor(() => kitchenOnCashier.errors.length > 0, 2000);
  check('Tài khoản bếp subscribe /topic/cashier -> ERROR FORBIDDEN', kitchenOnCashier.errors.some((e) => e.includes('FORBIDDEN')), kitchenOnCashier.errors);
  const custWs = await stomp({ tableToken: tok });
  const custMsgs = collect(custWs, `/topic/table.${table.id}`);
  await sleep(300);

  const key = randomKey();
  const pay = await call('POST', '/api/payments', { tableToken: tok, headers: { ...session, 'Idempotency-Key': key }, body: { method: 'CASH' } });
  check('Khách bấm Thanh toán (tiền mặt) -> 201 PENDING, số tiền = còn phải trả', pay.status === 201 && pay.data.status === 'PENDING' && pay.data.amount === bill.remaining, pay.data);
  const again = await call('POST', '/api/payments', { tableToken: tok, headers: { ...session, 'Idempotency-Key': key }, body: { method: 'CASH' } });
  check('Gửi lại cùng Idempotency-Key -> 200, cùng lần thanh toán', again.status === 200 && again.data.id === pay.data.id, again.status);
  const otherPhone = await call('POST', '/api/payments', {
    tableToken: tok,
    headers: { ...session, 'X-Device-Id': DEV_B, 'Idempotency-Key': randomKey() },
    body: { method: 'CASH' },
  });
  check('Máy khác bấm Thanh toán -> nhận lại lần đang chờ, không tạo lần thứ hai', otherPhone.data.id === pay.data.id, otherPhone.data);
  const blocked = await call('POST', '/api/orders', {
    tableToken: tok,
    headers: { ...session, 'Idempotency-Key': randomKey() },
    body: { items: [{ menuItemId: ctx.pho.id, quantity: 1 }] },
  });
  check('Đang thanh toán -> chưa gọi thêm được (409 PAYMENT_IN_PROGRESS)', blocked.status === 409 && blocked.data.error === 'PAYMENT_IN_PROGRESS', blocked.data);
  await waitFor(() => cashierMsgs.some((m) => m.type === 'PAYMENT_UPDATED'), 3000);
  check('Quầy thu ngân nhận PAYMENT_UPDATED real-time', cashierMsgs.some((m) => m.type === 'PAYMENT_UPDATED' && m.payment.id === pay.data.id));

  const map = (await call('GET', '/api/cashier/tables', { token: ctx.thungan })).data;
  check('Sơ đồ bàn không hiện bàn của bộ test (mã LT...)', map.every((t) => !t.code.startsWith('LT')), map.length);
  const detail = (await call('GET', `/api/cashier/tables/${table.id}`, { token: ctx.thungan })).data;
  check('Chi tiết bàn: trạng thái AWAITING_PAYMENT, có lần đang chờ', detail.table.state === 'AWAITING_PAYMENT' && detail.bill.pending.id === pay.data.id, detail.table);
  const kitchenCalls = await call('GET', '/api/cashier/tables', { token: ctx.bep });
  check('Tài khoản bếp gọi API thu ngân -> 403', kitchenCalls.status === 403, kitchenCalls.status);
  const checkoutWhilePending = await call('POST', `/api/cashier/tables/${table.id}/checkout`, { token: ctx.thungan, body: {} });
  check('Trả bàn khi đang có lần chờ -> 409 PAYMENT_IN_PROGRESS',
    checkoutWhilePending.status === 409 && checkoutWhilePending.data.error === 'PAYMENT_IN_PROGRESS', checkoutWhilePending.data);

  const confirms = await Promise.all([0, 1].map(() =>
    call('PATCH', `/api/cashier/payments/${pay.data.id}/confirm`, { token: ctx.thungan, body: { version: pay.data.version } })));
  check('Hai thu ngân cùng bấm "Đã nhận tiền" -> đúng 1 thành công, 1 nhận 409',
    confirms.filter((r) => r.status === 200).length === 1 && confirms.filter((r) => r.status === 409).length === 1, confirms.map((r) => r.status));
  await waitFor(() => custMsgs.some((m) => m.type === 'PAYMENT_UPDATED' && m.payment.status === 'PAID'), 3000);
  check('Điện thoại khách nhận PAYMENT_UPDATED (PAID)', custMsgs.some((m) => m.type === 'PAYMENT_UPDATED' && m.payment.status === 'PAID'));
  const paidBill = (await call('GET', '/api/payments/bill', { tableToken: tok, headers: session })).data;
  check('Sau khi trả: còn phải trả = 0, không còn lần chờ', paidBill.remaining === 0 && paidBill.pending === null, paidBill);
  const nothing = await call('POST', '/api/payments', { tableToken: tok, headers: { ...session, 'Idempotency-Key': randomKey() }, body: { method: 'CASH' } });
  check('Đã trả đủ mà bấm Thanh toán nữa -> 422 NOTHING_TO_PAY', nothing.status === 422 && nothing.data.error === 'NOTHING_TO_PAY', nothing.data);
  const extra = await call('POST', '/api/orders', {
    tableToken: tok,
    headers: { ...session, 'Idempotency-Key': randomKey() },
    body: { items: [{ menuItemId: ctx.flan.id, quantity: 1 }] },
  });
  const afterExtra = (await call('GET', '/api/payments/bill', { tableToken: tok, headers: session })).data;
  check('Trả xong vẫn gọi thêm được, phần mới thành "còn phải trả"', extra.status === 201 && afterExtra.remaining === ctx.flan.price, afterExtra);

  if (bill.methods.includes('VNPAY')) {
    const vp = await call('POST', '/api/payments', { tableToken: tok, headers: { ...session, 'Idempotency-Key': randomKey() }, body: { method: 'VNPAY' } });
    check('VNPay đã cấu hình: tạo thanh toán có link sang VNPay', vp.status === 201 && (vp.data.payUrl || '').includes('vnp_SecureHash='), vp.data);
    const fake = await call('GET', '/api/payments/vnpay/ipn?vnp_TxnRef=X&vnp_Amount=100&vnp_ResponseCode=00&vnp_SecureHash=abc');
    check('IPN giả mạo (sai chữ ký) -> RspCode 97, không ghi nhận', fake.data?.RspCode === '97', fake.data);
    const cancel = await call('POST', `/api/payments/${vp.data.id}/cancel`, { tableToken: tok, headers: session });
    check('Khách huỷ lần thanh toán VNPay đang chờ', cancel.status === 200 && cancel.data.status === 'CANCELLED', cancel.data);
  } else {
    const vp = await call('POST', '/api/payments', { tableToken: tok, headers: { ...session, 'Idempotency-Key': randomKey() }, body: { method: 'VNPAY' } });
    check('VNPay chưa cấu hình -> 422 PAYMENT_METHOD_UNAVAILABLE', vp.status === 422 && vp.data.error === 'PAYMENT_METHOD_UNAVAILABLE', vp.data);
  }

  await call('PATCH', `/api/kitchen/order-items/${order.items[0].id}/status`, { token: ctx.bep, body: { status: 'ACCEPTED', version: 0 } });
  const payAll = (await call('POST', `/api/cashier/tables/${table.id}/payments`, { token: ctx.thungan })).data;
  check('Thu ngân tạo lần thu tiền mặt tại quầy cho phần còn lại', payAll.amount === ctx.flan.price && payAll.method === 'CASH', payAll);
  await call('PATCH', `/api/cashier/payments/${payAll.id}/confirm`, { token: ctx.thungan, body: { version: payAll.version } });
  const done = await call('POST', `/api/cashier/tables/${table.id}/checkout`, { token: ctx.thungan, body: { reason: 'OTHER', note: 'món chưa ra' } });
  check('Trả bàn sau khi thanh toán -> bàn trống', done.status === 200 && done.data.state === 'EMPTY', done.data);
  const history = (await call('GET', '/api/admin/payments?limit=20', { token: ctx.admin })).data;
  check('Admin xem được lịch sử thanh toán', history.some((p) => p.id === pay.data.id && p.status === 'PAID' && p.confirmedBy === 'thungan'), history.length);
  [cashierWs, kitchenOnCashier, custWs].forEach((s) => s.client.disconnect());
}

// ================================================================== chạy

(async () => {
  console.log(`Kiểm thử end-to-end trên ${BASE}`);
  try {
    await setup();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  await section('1. API công khai (cấu hình, mã QR, thực đơn + ETag, SPA)', testPublic);
  await section('2. Xác thực và phân quyền nhân viên', testAuth);
  await section('3. Đặt món: kiểm tra dữ liệu đầu vào và xử lý lỗi', testOrderValidation);
  await section('4. Đặt món: idempotency', testIdempotency);
  await section('5. WebSocket: sự kiện thời gian thực, ACK, RESUME', testRealtime);
  await section('6. WebSocket: bảo mật, giới hạn kết nối, dữ liệu bất thường', testWsSecurity);
  await section('7. Bếp: state machine và optimistic locking', testKitchenAndStateMachine);
  await section('8. Khách huỷ đơn', testCancel);
  await section('9. Tồn kho và hết món', testStock);
  await section('10. Bàn: vào bàn, ngừng/phục vụ lại, đổi mã QR', testTables);
  await section('11. Quản lý thực đơn', testMenuAdmin);
  await section('12. Giám sát và các chế độ baseline', testMonitorAndModes);
  await section('13. Rate limiting', testRateLimit);
  await section('14. Giao đơn tin cậy khi bếp mất mạng (thư viện client)', testReliableFeed);
  await section('15. Phiên bàn: nhiều điện thoại, đơn chung, tên khách, trả bàn', testSharedSessionAndNames);
  await section('16. Thanh toán và quầy thu ngân', testPaymentsAndCashier);
  await teardown().catch((e) => console.error('Dọn dẹp lỗi:', e.message));

  console.log(`\n================ KẾT QUẢ: ${passed} đạt, ${failures.length} lỗi ================`);
  failures.forEach((f) => console.log(`  ✘ ${f}`));
  process.exit(failures.length ? 1 : 0);
})();
