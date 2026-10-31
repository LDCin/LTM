# Kết quả thực nghiệm

Sinh tự động bởi `report.js` lúc 20:00:18 17/10/2026.

## E1 – Độ trễ đặt món → bếp nhận (Push vs Polling)

| Chế độ | Bàn | Đơn | Bếp nhận | p50 (ms) | p95 (ms) | p99 (ms) | Request poll/s | Byte bếp nhận | CPU TB (%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| POLLING | 20 | 80 | 80 | 1341.68 | 2809.83 | 2953.84 | 0.55 | 50745 | 1.04 |
| RELIABLE_PUSH | 20 | 80 | 80 | 7.71 | 11.52 | 16.01 | 0 | 61449 | 0.69 |

## E2 – Mất đơn khi màn hình bếp rớt mạng

| Chế độ | Số lần mất mạng | Đơn tạo | Bếp nhận | Đơn mất | Tỷ lệ mất (%) | Trùng tới UI | Trùng bị lọc | RESUME | Gửi bù | Resync p50 (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NAIVE_PUSH | 1 | 200 | 169 | 31 | 15.5 | 0 | 0 | 0 | 0 | - |
| RELIABLE_PUSH | 1 | 200 | 200 | 0 | 0 | 0 | 0 | 2 | 31 | 2 |

## E3 – Đơn trùng khi mất response / bấm 2 lần

| Idempotency | Đơn thực tế | Request gửi | Mất response | Bấm 2 lần | Đơn trong DB | Đơn trùng | Tỷ lệ trùng (%) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 100 | 134 | 24 | 10 | 134 | 34 | 34 |
| Bật | 100 | 141 | 32 | 9 | 100 | 0 | 0 |

## E4 – Nhiều bếp cùng cập nhật một món

| Optimistic lock | Vòng | Client đồng thời | Cập nhật thành công | Kỳ vọng | Lost update | 409 | Vòng bị lost update |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 20 | 10 | 154 | 20 | 134 | 46 | 20 |
| Bật | 20 | 10 | 20 | 20 | 0 | 180 | 0 |

## E5 – Tải tăng dần (0 kết nối WebSocket mở sẵn)

| Client đồng thời | Request | Throughput (đơn/s) | Lỗi (%) | p50 (ms) | p95 (ms) | p99 (ms) | CPU TB (%) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 25361 | 2536.1 | 0 | 3.44 | 7.22 | 9.65 | 28.77 |
| 50 | 32086 | 3208.6 | 0 | 14.93 | 20.87 | 33.55 | 13.89 |
| 100 | 31970 | 3197 | 0 | 29.96 | 39.82 | 54.72 | 14.49 |

## E6 – Client spam ảnh hưởng khách bình thường

| Rate limit | Khách thường p50 (ms) | p95 (ms) | p99 (ms) | Lỗi khách thường | Spam gửi | Spam được nhận | Spam bị 429 | CPU TB (%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 17.74 | 47.51 | 48.07 | 0 | 45708 | 45708 | 0 | 14 |
| Bật | 14.52 | 43.85 | 55.35 | 0 | 52964 | 6 | 52958 | 4.38 |
