# Kết quả thực nghiệm

Sinh tự động bởi `report.js` lúc 19:54:44 17/10/2026.

## E1 – Độ trễ đặt món → bếp nhận (Push vs Polling)

| Chế độ | Bàn | Đơn | Bếp nhận | p50 (ms) | p95 (ms) | p99 (ms) | Request poll/s | Byte bếp nhận | CPU TB (%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| POLLING | 20 | 80 | 80 | 1384.23 | 2753.36 | 3019.26 | 0.55 | 50943 | 0.77 |
| RELIABLE_PUSH | 20 | 80 | 80 | 5.84 | 9.27 | 11.13 | 0 | 62985 | 0.77 |

## E2 – Mất đơn khi màn hình bếp rớt mạng

| Chế độ | Số lần mất mạng | Đơn tạo | Bếp nhận | Đơn mất | Tỷ lệ mất (%) | Trùng tới UI | Trùng bị lọc | RESUME | Gửi bù | Resync p50 (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NAIVE_PUSH | 1 | 200 | 169 | 31 | 15.5 | 0 | 0 | 0 | 0 | - |
| RELIABLE_PUSH | 1 | 200 | 200 | 0 | 0 | 0 | 0 | 2 | 31 | 2 |

## E3 – Đơn trùng khi mất response / bấm 2 lần

| Idempotency | Đơn thực tế | Request gửi | Mất response | Bấm 2 lần | Đơn trong DB | Đơn trùng | Tỷ lệ trùng (%) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 100 | 143 | 32 | 11 | 143 | 43 | 43 |
| Bật | 100 | 146 | 35 | 11 | 100 | 0 | 0 |

## E4 – Nhiều bếp cùng cập nhật một món

| Optimistic lock | Vòng | Client đồng thời | Cập nhật thành công | Kỳ vọng | Lost update | 409 | Vòng bị lost update |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 20 | 10 | 174 | 20 | 154 | 26 | 20 |
| Bật | 20 | 10 | 20 | 20 | 0 | 180 | 0 |

## E5 – Tải tăng dần (0 kết nối WebSocket mở sẵn)

| Client đồng thời | Request | Throughput (đơn/s) | Lỗi (%) | p50 (ms) | p95 (ms) | p99 (ms) | CPU TB (%) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 26132 | 2613.2 | 0 | 3.27 | 7.09 | 9.61 | 25.22 |
| 50 | 31581 | 3157.9 | 0.01 | 14.94 | 21.45 | 32.07 | 13.96 |
| 100 | 31586 | 3158.6 | 0 | 30.46 | 41.05 | 57.65 | 13.99 |

## E6 – Client spam ảnh hưởng khách bình thường

| Rate limit | Khách thường p50 (ms) | p95 (ms) | p99 (ms) | Lỗi khách thường | Spam gửi | Spam được nhận | Spam bị 429 | CPU TB (%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 30.73 | 107.95 | 156.4 | 0 | 41257 | 41257 | 0 | 15.88 |
| Bật | 27.47 | 78.63 | 144.81 | 0 | 47795 | 6 | 47789 | 4.86 |
