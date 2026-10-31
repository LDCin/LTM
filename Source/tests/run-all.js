// Chạy toàn bộ ma trận thực nghiệm baseline vs proposed, sau đó tổng hợp ra REPORT.md.
// Thời gian chạy ~15 phút. Dùng --quick để chạy bản rút gọn (~4 phút) khi kiểm tra nhanh.
import { spawnSync } from 'node:child_process';

const quick = process.argv.includes('--quick');
const base = process.argv.find((a) => a.startsWith('--base='));

const runs = quick
  ? [
      ['e1', '--mode=POLLING', '--tables=20', '--duration=20'],
      ['e1', '--mode=RELIABLE_PUSH', '--tables=20', '--duration=20'],
      ['e2', '--mode=NAIVE_PUSH', '--orders=200', '--rate=10'],
      ['e2', '--mode=RELIABLE_PUSH', '--orders=200', '--rate=10'],
      ['e3', '--idempotency=false', '--orders=100'],
      ['e3', '--idempotency=true', '--orders=100'],
      ['e4', '--lock=false', '--rounds=20'],
      ['e4', '--lock=true', '--rounds=20'],
      ['e5', '--levels=10,50,100', '--step=10'],
      ['e6', '--rateLimit=false', '--duration=15'],
      ['e6', '--rateLimit=true', '--duration=15'],
    ]
  : [
      ['e1', '--mode=POLLING', '--tables=50', '--duration=60'],
      ['e1', '--mode=NAIVE_PUSH', '--tables=50', '--duration=60'],
      ['e1', '--mode=RELIABLE_PUSH', '--tables=50', '--duration=60'],
      ['e1', '--mode=POLLING', '--tables=200', '--duration=60'],
      ['e1', '--mode=RELIABLE_PUSH', '--tables=200', '--duration=60'],
      ['e2', '--mode=NAIVE_PUSH'],
      ['e2', '--mode=RELIABLE_PUSH'],
      ['e3', '--idempotency=false'],
      ['e3', '--idempotency=true'],
      ['e4', '--lock=false'],
      ['e4', '--lock=true'],
      ['e5'],
      ['e5', '--ws=500'],
      ['e6', '--rateLimit=false'],
      ['e6', '--rateLimit=true'],
    ];

for (const args of runs) {
  const full = base ? [...args, base] : args;
  console.log(`\n========== node experiment.js ${full.join(' ')} ==========`);
  const r = spawnSync(process.execPath, ['experiment.js', ...full], { stdio: 'inherit' });
  if (r.status !== 0) console.error(`!! Thực nghiệm ${args.join(' ')} thất bại`);
}
spawnSync(process.execPath, ['experiment.js', 'cleanup', ...(base ? [base] : [])], { stdio: 'inherit' });
spawnSync(process.execPath, ['report.js'], { stdio: 'inherit' });
