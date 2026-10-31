// Đọc mọi file kết quả JSON trong tests/results và sinh REPORT.md (bảng so sánh).
// Với mỗi cấu hình chỉ lấy lần chạy MỚI NHẤT.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESULTS_DIR } from './lib/common.js';

const files = readdirSync(RESULTS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort(); // tên file có timestamp -> sort tăng dần, bản sau ghi đè bản trước
const latest = new Map();
for (const f of files) {
  const key = f.replace(/_\d{4}-\d{2}-\d{2}T.*$/, '');
  latest.set(key, { file: f, data: JSON.parse(readFileSync(resolve(RESULTS_DIR, f), 'utf8')) });
}
const byExp = (exp) => [...latest.values()].filter((r) => r.data.experiment === exp).map((r) => r.data);
const v = (x) => (x === undefined || x === null ? '-' : x);

const out = ['# Kết quả thực nghiệm', '', `Sinh tự động bởi \`report.js\` lúc ${new Date().toLocaleString('vi-VN')}.`, ''];

const e1 = byExp('E1');
if (e1.length) {
  out.push('## E1 – Độ trễ đặt món → bếp nhận (Push vs Polling)', '');
  out.push('| Chế độ | Bàn | Đơn | Bếp nhận | p50 (ms) | p95 (ms) | p99 (ms) | Request poll/s | Byte bếp nhận | CPU TB (%) |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of e1) {
    const bytes = r.mode === 'POLLING' ? r.kitchen.pollPayloadBytes : r.kitchen.wsBytesIn;
    out.push(
      `| ${r.mode} | ${r.tables} | ${r.ordersCreated} | ${r.deliveredToKitchen} | ${v(r.orderToKitchenLatencyMs.p50)} | ${v(r.orderToKitchenLatencyMs.p95)} | ${v(r.orderToKitchenLatencyMs.p99)} | ${r.kitchen.pollRequestsPerSec} | ${bytes} | ${v(r.serverCpuPercent.mean)} |`,
    );
  }
  out.push('');
}

const e2 = byExp('E2');
if (e2.length) {
  out.push('## E2 – Mất đơn khi màn hình bếp rớt mạng', '');
  out.push('| Chế độ | Số lần mất mạng | Đơn tạo | Bếp nhận | Đơn mất | Tỷ lệ mất (%) | Trùng tới UI | Trùng bị lọc | RESUME | Gửi bù | Resync p50 (ms) |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of e2) {
    out.push(
      `| ${r.mode} | ${r.outages} | ${r.ordersCreated} | ${r.receivedByKitchen} | ${r.lostOrders} | ${r.lossRatePercent} | ${r.duplicateDeliveriesToApp} | ${r.duplicatesFilteredBySeq} | ${r.resumeRequests} | ${r.replayedEvents} | ${v(r.resyncTimeMs.p50)} |`,
    );
  }
  out.push('');
}

const e3 = byExp('E3');
if (e3.length) {
  out.push('## E3 – Đơn trùng khi mất response / bấm 2 lần', '');
  out.push('| Idempotency | Đơn thực tế | Request gửi | Mất response | Bấm 2 lần | Đơn trong DB | Đơn trùng | Tỷ lệ trùng (%) |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of e3) {
    out.push(
      `| ${r.idempotencyEnabled ? 'Bật' : 'Tắt'} | ${r.logicalOrders} | ${r.httpRequestsSent} | ${r.simulatedLostResponses} | ${r.doubleTaps} | ${r.ordersInDatabase} | ${r.duplicateOrders} | ${r.duplicateRatePercent} |`,
    );
  }
  out.push('');
}

const e4 = byExp('E4');
if (e4.length) {
  out.push('## E4 – Nhiều bếp cùng cập nhật một món', '');
  out.push('| Optimistic lock | Vòng | Client đồng thời | Cập nhật thành công | Kỳ vọng | Lost update | 409 | Vòng bị lost update |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of e4) {
    out.push(
      `| ${r.optimisticLockEnabled ? 'Bật' : 'Tắt'} | ${r.rounds} | ${r.concurrentClients} | ${r.successfulUpdates} | ${r.expectedSuccessfulUpdates} | ${r.lostUpdates} | ${r.conflicts409} | ${r.roundsWithLostUpdate} |`,
    );
  }
  out.push('');
}

for (const r of byExp('E5')) {
  out.push(`## E5 – Tải tăng dần (${r.openWebSockets} kết nối WebSocket mở sẵn)`, '');
  out.push('| Client đồng thời | Request | Throughput (đơn/s) | Lỗi (%) | p50 (ms) | p95 (ms) | p99 (ms) | CPU TB (%) |');
  out.push('|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const x of r.results) {
    out.push(
      `| ${x.concurrentClients} | ${x.requests} | ${x.throughputPerSec} | ${x.errorRatePercent} | ${v(x.latencyMs.p50)} | ${v(x.latencyMs.p95)} | ${v(x.latencyMs.p99)} | ${v(x.serverCpuPercent.mean)} |`,
    );
  }
  out.push('');
}

const e6 = byExp('E6');
if (e6.length) {
  out.push('## E6 – Client spam ảnh hưởng khách bình thường', '');
  out.push('| Rate limit | Khách thường p50 (ms) | p95 (ms) | p99 (ms) | Lỗi khách thường | Spam gửi | Spam được nhận | Spam bị 429 | CPU TB (%) |');
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of e6) {
    out.push(
      `| ${r.rateLimitEnabled ? 'Bật' : 'Tắt'} | ${v(r.normalRequestLatencyMs.p50)} | ${v(r.normalRequestLatencyMs.p95)} | ${v(r.normalRequestLatencyMs.p99)} | ${r.normalRequestErrors} | ${r.spammer.sent} | ${r.spammer.accepted} | ${r.spammer.rateLimited} | ${v(r.serverCpuPercent.mean)} |`,
    );
  }
  out.push('');
}

writeFileSync(resolve(RESULTS_DIR, 'REPORT.md'), out.join('\n'));
console.log(`Đã ghi ${resolve(RESULTS_DIR, 'REPORT.md')}`);
