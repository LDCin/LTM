// Thực nghiệm E1-E6. Chạy: node experiment.js <e1..e6> [--tham-so=gia-tri ...]
// Server mặc định: http://localhost:8080 (đổi bằng --base=http://ip:8080)
import WebSocket from 'ws';
import { KitchenFeed } from '../client/src/lib/kitchenFeed.js';
import { StompClient } from '../client/src/lib/stomp.js';
import {
  adminLogin,
  createHttp,
  ensureTables,
  orderableItems,
  parseArgs,
  pick,
  randomKey,
  randomOrder,
  saveResult,
  setSettings,
  sleep,
  startCpuSampler,
  summarize,
  waitFor,
} from './lib/common.js';

const [, , experiment, ...rest] = process.argv;
const opts = parseArgs(rest);
const BASE = opts.base || 'http://localhost:8080';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
const http = createHttp(BASE);

const num = (key, def) => (opts[key] !== undefined ? Number(opts[key]) : def);
const bool = (key, def) => (opts[key] !== undefined ? opts[key] === 'true' : def);

async function createKitchenFeed({ token, mode, onEvent, kitchenHttp }) {
  const cfg = (await http.call('GET', '/api/public/config')).data;
  const snapshot = (await kitchenHttp.call('GET', '/api/kitchen/orders', { token })).data;
  kitchenHttp.counters.requests = 0;
  kitchenHttp.counters.bytesIn = 0;
  const feed = new KitchenFeed({
    mode,
    wsUrl: WS_URL,
    token,
    WebSocketImpl: WebSocket,
    pollingIntervalMs: cfg.pollingIntervalMs,
    heartbeatMs: cfg.heartbeatMs,
    fetchEvents: async (afterSeq) => {
      const r = await kitchenHttp.call('GET', `/api/kitchen/events?afterSeq=${afterSeq}`, { token });
      if (r.status !== 200) throw new Error(`poll HTTP ${r.status}`);
      return r.data;
    },
    onEvent,
  });
  feed.start(snapshot.latestSeq);
  if (mode !== 'POLLING') {
    const ok = await waitFor(() => feed.conn?.connected, 10000);
    if (!ok) throw new Error('Màn hình bếp giả lập không kết nối được WebSocket');
  }
  await sleep(500);
  return { feed, cfg };
}

// =====================================================================================
// E1 – Push vs Polling: độ trễ từ lúc khách bấm đặt món tới lúc bếp nhận được đơn
// =====================================================================================
async function e1() {
  const mode = opts.mode || 'RELIABLE_PUSH';
  const tables = num('tables', 50);
  const duration = num('duration', 60);
  const interval = num('interval', 5000);
  const token = await adminLogin(http);
  await setSettings(http, token, { deliveryMode: mode, rateLimitEnabled: false, idempotencyEnabled: true, optimisticLockEnabled: true });
  const tbls = await ensureTables(http, token, tables);
  const items = await orderableItems(http);

  const sentAt = new Map();
  const recvAt = new Map();
  const kitchenHttp = createHttp(BASE);
  const { feed, cfg } = await createKitchenFeed({
    token,
    mode,
    kitchenHttp,
    onEvent: (env) => {
      if (env.type === 'ORDER_CREATED' && !recvAt.has(env.payload.id)) recvAt.set(env.payload.id, performance.now());
    },
  });

  console.log(`E1 mode=${mode} tables=${tables} duration=${duration}s interval=${interval}ms`);
  const cpu = startCpuSampler(http);
  const endAt = Date.now() + duration * 1000;
  const placeMs = [];
  let httpErrors = 0;
  await Promise.all(
    tbls.slice(0, tables).map(async (t) => {
      await sleep(Math.random() * interval);
      while (Date.now() < endAt) {
        const t0 = performance.now();
        const r = await http.call('POST', '/api/orders', {
          tableToken: t.qrToken,
          headers: { 'Idempotency-Key': randomKey() },
          body: randomOrder(items),
        });
        if (r.status === 201) {
          sentAt.set(r.data.id, t0);
          placeMs.push(r.ms);
        } else httpErrors++;
        await sleep(interval);
      }
    }),
  );
  await sleep((mode === 'POLLING' ? cfg.pollingIntervalMs : 0) + 2000); // chờ bếp nhận nốt
  const cpuSummary = cpu.stop();
  const transport = feed.transportStats;
  feed.stop();

  const latencies = [];
  const rows = [];
  for (const [orderId, t0] of sentAt) {
    const t1 = recvAt.get(orderId);
    if (t1 !== undefined) {
      latencies.push(t1 - t0);
      rows.push({ orderId, latencyMs: (t1 - t0).toFixed(2) });
    }
  }
  const summary = {
    experiment: 'E1',
    mode,
    tables,
    durationSec: duration,
    orderIntervalMs: interval,
    ordersCreated: sentAt.size,
    deliveredToKitchen: latencies.length,
    notDelivered: sentAt.size - latencies.length,
    httpErrors,
    orderToKitchenLatencyMs: summarize(latencies),
    placeOrderHttpLatencyMs: summarize(placeMs),
    kitchen: {
      pollRequests: feed.stats.polls,
      pollRequestsPerSec: +(feed.stats.polls / duration).toFixed(2),
      pollPayloadBytes: kitchenHttp.counters.bytesIn,
      wsBytesIn: transport?.bytesIn ?? 0,
      wsFramesIn: transport?.framesIn ?? 0,
    },
    serverCpuPercent: cpuSummary,
  };
  console.log(JSON.stringify(summary, null, 2));
  saveResult(`e1_${mode}_${tables}t`, summary, rows);
}

// =====================================================================================
// E2 – Độ tin cậy: màn hình bếp bị ngắt mạng định kỳ trong lúc đơn liên tục đổ về
// =====================================================================================
async function e2() {
  const mode = opts.mode || 'RELIABLE_PUSH';
  const orders = num('orders', 600);
  const rate = num('rate', 10);
  const dropEvery = num('dropEvery', 10000);
  const outage = num('outage', 3000);
  const tables = num('tables', 20);
  const token = await adminLogin(http);
  await setSettings(http, token, { deliveryMode: mode, rateLimitEnabled: false, idempotencyEnabled: true });
  const tbls = await ensureTables(http, token, tables);
  const items = await orderableItems(http);

  const created = new Set();
  const received = new Set();
  let receivedEvents = 0;
  const { feed } = await createKitchenFeed({
    token,
    mode,
    kitchenHttp: createHttp(BASE),
    onEvent: (env) => {
      if (env.type !== 'ORDER_CREATED') return;
      receivedEvents++;
      received.add(env.payload.id);
    },
  });

  console.log(`E2 mode=${mode} orders=${orders} rate=${rate}/s mất mạng ${outage}ms mỗi ${dropEvery}ms`);
  let outages = 0;
  const dropTimer = setInterval(() => {
    outages++;
    feed.simulateOutage(outage);
  }, dropEvery);

  let httpErrors = 0;
  const gapMs = 1000 / rate;
  const startedAt = Date.now();
  const inflight = [];
  for (let i = 0; i < orders; i++) {
    const due = startedAt + i * gapMs;
    if (due > Date.now()) await sleep(due - Date.now());
    const t = tbls[i % tbls.length];
    inflight.push(
      http
        .call('POST', '/api/orders', {
          tableToken: t.qrToken,
          headers: { 'Idempotency-Key': randomKey() },
          body: randomOrder(items),
        })
        .then((r) => (r.status === 201 ? created.add(r.data.id) : httpErrors++)),
    );
  }
  await Promise.all(inflight);
  clearInterval(dropTimer);
  // Cho bếp kết nối lại và đồng bộ xong
  await waitFor(() => feed.conn?.connected, 40000);
  await sleep(4000);
  feed.stop();

  const lost = [...created].filter((id) => !received.has(id));
  const summary = {
    experiment: 'E2',
    mode,
    orders,
    ratePerSec: rate,
    outageMs: outage,
    dropEveryMs: dropEvery,
    outages,
    ordersCreated: created.size,
    receivedByKitchen: [...created].filter((id) => received.has(id)).length,
    lostOrders: lost.length,
    lossRatePercent: +((lost.length / Math.max(1, created.size)) * 100).toFixed(2),
    duplicateDeliveriesToApp: receivedEvents - received.size,
    duplicatesFilteredBySeq: feed.stats.duplicates,
    gapsDetected: feed.stats.gaps,
    resumeRequests: feed.stats.resumes,
    replayedEvents: feed.stats.replayed,
    reconnects: feed.conn?.reconnects ?? 0,
    resyncTimeMs: summarize(feed.stats.resyncMs),
    httpErrors,
  };
  console.log(JSON.stringify(summary, null, 2));
  saveResult(`e2_${mode}`, summary);
}

// =====================================================================================
// E3 – Đặt trùng khi mất response và khách bấm 2 lần (idempotency on/off)
// =====================================================================================
async function e3() {
  const idempotency = bool('idempotency', true);
  const orders = num('orders', 300);
  const lossRate = num('lossRate', 0.3);
  const doubleTapRate = num('doubleTapRate', 0.1);
  const concurrency = num('concurrency', 20);
  const token = await adminLogin(http);
  await setSettings(http, token, { idempotencyEnabled: idempotency, rateLimitEnabled: false });
  const tbls = await ensureTables(http, token, 20);
  const items = await orderableItems(http);
  const since = (await http.call('GET', '/api/public/config')).data.serverTime;

  console.log(`E3 idempotency=${idempotency} orders=${orders} lossRate=${lossRate} doubleTap=${doubleTapRate}`);
  const responseIds = new Set();
  let requests = 0;
  let simulatedLoss = 0;
  let doubleTaps = 0;
  let replayed = 0;
  let next = 0;
  const send = async (t, key, body) => {
    requests++;
    const r = await http.call('POST', '/api/orders', { tableToken: t.qrToken, headers: { 'Idempotency-Key': key }, body });
    if (r.status === 200) replayed++;
    if (r.data?.id) responseIds.add(r.data.id);
    return r;
  };
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < orders) {
        next++;
        const t = pick(tbls);
        const key = randomKey();
        const body = randomOrder(items);
        if (Math.random() < doubleTapRate) {
          // Khách bấm "Đặt món" 2 lần liên tiếp -> 2 request song song cùng key
          doubleTaps++;
          await Promise.all([send(t, key, body), send(t, key, body)]);
        } else {
          await send(t, key, body);
        }
        if (Math.random() < lossRate) {
          // Response bị mất trên đường về -> client không biết đơn đã tạo chưa nên gửi lại (cùng key)
          simulatedLoss++;
          await sleep(100);
          await send(t, key, body);
        }
      }
    }),
  );
  const stats = (await http.call('GET', `/api/admin/stats?since=${since}`, { token })).data;
  const summary = {
    experiment: 'E3',
    idempotencyEnabled: idempotency,
    logicalOrders: orders,
    httpRequestsSent: requests,
    simulatedLostResponses: simulatedLoss,
    doubleTaps,
    replayedResponses: replayed,
    ordersInDatabase: stats.orders,
    duplicateOrders: stats.orders - orders,
    duplicateRatePercent: +(((stats.orders - orders) / orders) * 100).toFixed(2),
  };
  console.log(JSON.stringify(summary, null, 2));
  saveResult(`e3_idem-${idempotency}`, summary);
}

// =====================================================================================
// E4 – Nhiều màn hình bếp cùng đổi trạng thái một món (optimistic lock on/off)
// =====================================================================================
async function e4() {
  const lock = bool('lock', true);
  const rounds = num('rounds', 50);
  const clients = num('clients', 10);
  const token = await adminLogin(http);
  await setSettings(http, token, { optimisticLockEnabled: lock, rateLimitEnabled: false });
  const tbls = await ensureTables(http, token, 5);
  const items = await orderableItems(http);

  console.log(`E4 optimisticLock=${lock} rounds=${rounds} clients=${clients}`);
  let ok = 0;
  let conflicts = 0;
  let otherErrors = 0;
  let roundsWithLostUpdate = 0;
  for (let i = 0; i < rounds; i++) {
    const r = await http.call('POST', '/api/orders', {
      tableToken: tbls[i % tbls.length].qrToken,
      headers: { 'Idempotency-Key': randomKey() },
      body: { items: [{ menuItemId: items[0], quantity: 1 }] },
    });
    const itemId = r.data.items[0].id;
    // Một nửa đầu bếp bấm "Nhận", một nửa bấm "Từ chối" cùng lúc, đều dựa trên version 0
    const results = await Promise.all(
      Array.from({ length: clients }, (_, k) =>
        http.call('PATCH', `/api/kitchen/order-items/${itemId}/status`, {
          token,
          body: { status: k % 2 === 0 ? 'ACCEPTED' : 'CANCELLED', version: 0 },
        }),
      ),
    );
    const success = results.filter((x) => x.status === 200).length;
    ok += success;
    conflicts += results.filter((x) => x.status === 409).length;
    otherErrors += results.filter((x) => x.status !== 200 && x.status !== 409).length;
    if (success > 1) roundsWithLostUpdate++;
  }
  const summary = {
    experiment: 'E4',
    optimisticLockEnabled: lock,
    rounds,
    concurrentClients: clients,
    successfulUpdates: ok,
    expectedSuccessfulUpdates: rounds,
    lostUpdates: ok - rounds,
    conflicts409: conflicts,
    otherErrors,
    roundsWithLostUpdate,
  };
  console.log(JSON.stringify(summary, null, 2));
  saveResult(`e4_lock-${lock}`, summary);
}

// =====================================================================================
// E5 – Tải tăng dần: throughput và độ trễ đặt món theo số client đồng thời
// =====================================================================================
async function e5() {
  const levels = (opts.levels || '10,25,50,100,200').split(',').map(Number);
  const step = num('step', 20);
  const wsClients = num('ws', 0);
  const token = await adminLogin(http);
  await setSettings(http, token, { rateLimitEnabled: false, idempotencyEnabled: true, deliveryMode: 'RELIABLE_PUSH' });
  const tbls = await ensureTables(http, token, Math.max(200, Math.ceil(wsClients / 4)));
  const items = await orderableItems(http);

  // Tuỳ chọn: giữ sẵn N kết nối WebSocket của khách để đo ảnh hưởng của nhiều kết nối mở
  const sockets = [];
  for (let i = 0; i < wsClients; i++) {
    const c = new StompClient({ url: WS_URL, connectHeaders: { tableToken: tbls[i % tbls.length].qrToken }, WebSocketImpl: WebSocket });
    c.connect();
    sockets.push(c);
  }
  if (wsClients) {
    await waitFor(() => sockets.every((s) => s.connected), 30000);
    console.log(`Đã mở ${sockets.filter((s) => s.connected).length}/${wsClients} kết nối WebSocket`);
  }

  const results = [];
  for (const level of levels) {
    const latencies = [];
    let okCount = 0;
    let errors = 0;
    const cpu = startCpuSampler(http);
    const endAt = Date.now() + step * 1000;
    await Promise.all(
      Array.from({ length: level }, async () => {
        while (Date.now() < endAt) {
          const r = await http.call('POST', '/api/orders', {
            tableToken: pick(tbls).qrToken,
            headers: { 'Idempotency-Key': randomKey() },
            body: randomOrder(items),
          });
          latencies.push(r.ms);
          if (r.status === 201) okCount++;
          else errors++;
        }
      }),
    );
    const row = {
      concurrentClients: level,
      requests: latencies.length,
      throughputPerSec: +(okCount / step).toFixed(1),
      errorRatePercent: +((errors / Math.max(1, latencies.length)) * 100).toFixed(2),
      latencyMs: summarize(latencies),
      serverCpuPercent: cpu.stop(),
    };
    console.log(JSON.stringify(row));
    results.push(row);
    await sleep(2000);
  }
  sockets.forEach((s) => s.disconnect());
  const summary = { experiment: 'E5', stepSec: step, openWebSockets: wsClients, results };
  saveResult(
    `e5_ws-${wsClients}`,
    summary,
    results.map((r) => ({
      concurrentClients: r.concurrentClients,
      throughputPerSec: r.throughputPerSec,
      errorRatePercent: r.errorRatePercent,
      p50: r.latencyMs.p50,
      p95: r.latencyMs.p95,
      p99: r.latencyMs.p99,
      cpuMean: r.serverCpuPercent.mean ?? '',
    })),
  );
}

// =====================================================================================
// E6 – Một client spam làm ảnh hưởng tới khách bình thường? (rate limit on/off)
// =====================================================================================
async function e6() {
  const rateLimit = bool('rateLimit', true);
  const normalUsers = num('normal', 30);
  const spamConcurrency = num('spam', 50);
  const duration = num('duration', 30);
  const token = await adminLogin(http);
  await setSettings(http, token, { rateLimitEnabled: rateLimit, trustForwardedFor: true, idempotencyEnabled: true });
  const tbls = await ensureTables(http, token, normalUsers + 1);
  const items = await orderableItems(http);
  const spamTable = tbls[normalUsers];

  console.log(`E6 rateLimit=${rateLimit} normal=${normalUsers} spam=${spamConcurrency} duration=${duration}s`);
  const cpu = startCpuSampler(http);
  const endAt = Date.now() + duration * 1000;
  const normalLatency = [];
  let normalErrors = 0;
  let normalOrdersOk = 0;
  let normalOrdersFailed = 0;
  const spam = { sent: 0, accepted: 0, rateLimited: 0, other: 0 };

  const normal = tbls.slice(0, normalUsers).map(async (t, idx) => {
    const ip = `10.0.1.${idx + 1}`; // mỗi khách một IP (giả lập bằng X-Forwarded-For)
    let lastOrder = Date.now() - Math.random() * 15000;
    while (Date.now() < endAt) {
      const r = await http.call('GET', '/api/orders', { tableToken: t.qrToken, headers: { 'X-Forwarded-For': ip } });
      normalLatency.push(r.ms);
      if (r.status !== 200) normalErrors++;
      if (Date.now() - lastOrder > 15000) {
        lastOrder = Date.now();
        const o = await http.call('POST', '/api/orders', {
          tableToken: t.qrToken,
          headers: { 'X-Forwarded-For': ip, 'Idempotency-Key': randomKey() },
          body: randomOrder(items),
        });
        if (o.status === 201) normalOrdersOk++;
        else normalOrdersFailed++;
      }
      await sleep(1000);
    }
  });
  const spammers = Array.from({ length: spamConcurrency }, async () => {
    while (Date.now() < endAt) {
      spam.sent++;
      const r = await http.call('POST', '/api/orders', {
        tableToken: spamTable.qrToken,
        headers: { 'X-Forwarded-For': '10.0.99.1', 'Idempotency-Key': randomKey() },
        body: randomOrder(items),
      });
      if (r.status === 201) spam.accepted++;
      else if (r.status === 429) spam.rateLimited++;
      else spam.other++;
    }
  });
  await Promise.all([...normal, ...spammers]);
  const summary = {
    experiment: 'E6',
    rateLimitEnabled: rateLimit,
    durationSec: duration,
    normalUsers,
    spamConcurrency,
    normalRequestLatencyMs: summarize(normalLatency),
    normalRequestErrors: normalErrors,
    normalOrdersOk,
    normalOrdersFailed,
    spammer: { ...spam, requestsPerSec: +(spam.sent / duration).toFixed(1) },
    serverCpuPercent: cpu.stop(),
  };
  await setSettings(http, token, { trustForwardedFor: false, rateLimitEnabled: true });
  console.log(JSON.stringify(summary, null, 2));
  saveResult(`e6_ratelimit-${rateLimit}`, summary);
}

/** Dọn đơn của bàn load test và trả cấu hình về mặc định (để demo sau thực nghiệm). */
async function cleanup() {
  const token = await adminLogin(http);
  const r = await http.call('POST', '/api/admin/maintenance/clear-test-orders', { token, timeoutMs: 120000 });
  await setSettings(http, token, {
    deliveryMode: 'RELIABLE_PUSH',
    idempotencyEnabled: true,
    optimisticLockEnabled: true,
    rateLimitEnabled: true,
    trustForwardedFor: false,
  });
  console.log('Đã dọn dữ liệu thực nghiệm:', JSON.stringify(r.data));
}

const EXPERIMENTS = { e1, e2, e3, e4, e5, e6, cleanup };
if (!EXPERIMENTS[experiment]) {
  console.log('Cách dùng: node experiment.js <e1|e2|e3|e4|e5|e6> [--tham-so=gia-tri]');
  console.log('  e1 --mode=POLLING|NAIVE_PUSH|RELIABLE_PUSH --tables=50 --duration=60 --interval=5000');
  console.log('  e2 --mode=NAIVE_PUSH|RELIABLE_PUSH --orders=600 --rate=10 --dropEvery=10000 --outage=3000');
  console.log('  e3 --idempotency=true|false --orders=300 --lossRate=0.3 --doubleTapRate=0.1');
  console.log('  e4 --lock=true|false --rounds=50 --clients=10');
  console.log('  e5 --levels=10,25,50,100,200 --step=20 --ws=0');
  console.log('  e6 --rateLimit=true|false --normal=30 --spam=50 --duration=30');
  process.exit(1);
}
EXPERIMENTS[experiment]()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Thực nghiệm lỗi:', e.message);
    process.exit(1);
  });
