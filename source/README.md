# QR Order – Gọi món QR & màn hình bếp thời gian thực

Khách quét mã QR tại bàn để xem thực đơn và tự đặt món. Đơn được gửi lên server qua REST API, lưu vào MySQL,
rồi được đẩy tới màn hình bếp qua WebSocket (STOMP). Bếp cập nhật trạng thái từng món và khách thấy ngay trên điện thoại.

Trọng tâm kỹ thuật là **giao đơn tin cậy qua mạng**: không mất đơn khi màn hình bếp rớt mạng (seq + ACK + RESUME/replay),
không trùng đơn khi khách bấm lại hoặc mất response (Idempotency-Key), không ghi đè khi nhiều bếp thao tác cùng lúc
(state machine + optimistic locking), và chống quá tải (token bucket, giới hạn kết nối, backpressure).
Thiết kế chi tiết nằm ở [`../PLAN.md`](../PLAN.md).

## 1. Cấu trúc

```text
source/
├── server/      Spring Boot 3.3 (Java 17): REST + WebSocket/STOMP + JdbcTemplate
│   └── src/main/java/com/ltm/qrorder/
│       ├── auth/        đăng nhập nhân viên, token HMAC-SHA256 tự ký
│       ├── ratelimit/   token bucket tự cài đặt + interceptor (429 + Retry-After)
│       ├── table/       bàn, QR token, phiên bàn
│       ├── menu/        thực đơn + cache + ETag (304 Not Modified)
│       ├── order/       đặt món idempotent, state machine, optimistic lock
│       ├── event/       event log (outbox) + publish sau commit
│       ├── ws/          WebSocketConfig, xác thực/phân quyền STOMP, ACK/RESUME, SessionRegistry
│       ├── admin/       quản trị, giám sát, bật/tắt baseline cho thực nghiệm
│       └── common/      lỗi thống nhất, metrics
├── client/      React 18 + Vite: /t/:token (khách), /kitchen (bếp), /admin (quản trị)
│   └── src/lib/
│       ├── stomp.js        STOMP 1.2 client TỰ VIẾT trên WebSocket (encode/decode frame, heart-beat)
│       ├── connection.js   tự kết nối lại: exponential backoff + jitter
│       ├── kitchenFeed.js  giao thức tin cậy phía client: seq, chống trùng, phát hiện thiếu, ACK, RESUME
│       └── api.js          REST client: timeout, retry, Idempotency-Key
├── loadtest/    Node.js: thực nghiệm E1–E6 (dùng lại thư viện mạng của client)
└── docker-compose.yml   MySQL 8 (tuỳ chọn)
```

## 2. Yêu cầu

| Thành phần | Phiên bản |
|---|---|
| JDK | 17 trở lên |
| Maven | 3.9 trở lên (hoặc mở `server/` bằng IntelliJ IDEA) |
| Node.js | 18 trở lên (đã thử với 20.18) |
| MySQL | 8.0 (không bắt buộc: có thể chạy bằng H2 trong RAM) |

Thư viện ngoài: Spring Boot (web, websocket, jdbc, validation, actuator), spring-security-crypto (chỉ BCrypt),
MySQL Connector/J, H2; React, react-router-dom, qrcode.react, Vite; `ws` (load test). Không dùng thư viện STOMP
phía client: `stomp.js` do nhóm tự viết.

## 3. Chạy nhanh (không cần MySQL)

```bash
cd source/client
npm install
npm run build              # build UI vào server/src/main/resources/static
cd ../server
mvn package -DskipTests
java -jar target/qrorder-server-1.0.0.jar --spring.profiles.active=h2
```

Mở `http://localhost:8080`. Dữ liệu mẫu được tạo tự động:

| Trang | Đường dẫn | Tài khoản |
|---|---|---|
| Quản trị (bàn, QR, thực đơn, giám sát) | `/admin` | `admin` / `admin123` |
| Màn hình bếp | `/kitchen` | `bep` / `bep123` |
| Thu ngân (sơ đồ bàn, thanh toán, trả bàn) | `/cashier` | `thungan` / `thungan123` |
| Khách gọi món | `/t/<qrToken>` (quét QR ở trang Quản trị, hoặc xem link trong log khởi động) | – |

## 4. Chạy với MySQL

1. Có MySQL 8 tại `localhost:3306`. Có thể dùng Docker: `docker compose up -d` trong thư mục `source/`.
2. Database `qrorder` và các bảng được tạo tự động khi server khởi động (`schema.sql`, `createDatabaseIfNotExist=true`).
3. Cấu hình kết nối bằng biến môi trường (mặc định `root`/`root`):

```bash
set DB_HOST=localhost
set DB_USER=root
set DB_PASSWORD=root
java -jar target/qrorder-server-1.0.0.jar
```

## 5. Chế độ phát triển (sửa code frontend, tự reload)

```bash
cd source/server
mvn spring-boot:run -Dspring-boot.run.profiles=h2
```

```bash
cd source/client
npm run dev
```

Vite chạy ở cổng 5173 và proxy `/api`, `/ws` sang server 8080.

### Demo với điện thoại thật

1. Máy chủ và điện thoại cùng một mạng Wi-Fi. Xem IP LAN của máy chủ (`ipconfig`), ví dụ `192.168.1.10`.
2. Trên máy chủ, mở `http://192.168.1.10:8080/admin` (hoặc cổng 5173 nếu đang dùng `npm run dev`). Mã QR trên trang sẽ chứa
   địa chỉ IP đó; nếu cần, sửa ô "Địa chỉ in trong QR".
3. Điện thoại quét QR để gọi món. Nếu không truy cập được, mở cổng 8080/5173 trên Windows Firewall.

## 6. Kiểm thử

```bash
cd source/server
mvn test
```

21 test, gồm: token bucket; state machine; và test tích hợp qua HTTP thật (đặt trùng cùng key, **8 request song song
cùng key chỉ tạo 1 đơn**, cùng key khác nội dung → 409, request sai → 400, mã QR sai → 401, sai version → 409,
bếp chưa đăng nhập → 401, ETag → 304, **8 máy vào bàn trống cùng lúc chỉ mở 1 phiên**, đơn chung trong phiên + chỉ
máy đặt mới huỷ được, máy của lượt cũ bị chặn sau khi trả bàn, admin không đóng được bàn có khách, thanh toán tiền
mặt + thu ngân xác nhận + trả bàn, **IPN VNPay: sai chữ ký → 97, sai số tiền → 04, gọi lặp → 02**, phiên bỏ trống tự
kết thúc).

Kiểm thử end-to-end trên server đang chạy (181 ca trong 16 nhóm, khoảng 40 giây): REST, phân quyền, xử lý lỗi, idempotency,
WebSocket (sự kiện, ACK, RESUME, phân quyền SUBSCRIBE/SEND, giới hạn 8 kết nối/bàn, frame hỏng/quá cỡ,
time-to-first-message), state machine, optimistic lock, huỷ đơn, tồn kho, bàn (vào bàn, ngừng/phục vụ lại), thực đơn,
các chế độ baseline, rate limit, giao đơn tin cậy khi bếp mất mạng, phiên bàn nhiều điện thoại, thanh toán và thu ngân.
Test dùng bàn riêng `LTE...` và tự khôi phục cấu hình khi xong.
Server chạy cổng khác: `node e2e-test.js --base=http://localhost:8081`.

```bash
cd source/loadtest
npm install
npm run e2e
```

### Phiên bàn, đơn chung, thanh toán

- **Phiên bàn** = một lượt khách. Phiên **tự mở** khi khách đầu tiên quét QR (`POST /api/public/tables/{qrToken}/join`);
  nhiều điện thoại quét cùng lúc vẫn chung một phiên (UPDATE có điều kiện `current_session_id IS NULL`).
- Mọi điện thoại trong phiên thấy **đơn chung**; đơn ghi tên người đặt (khách nhập khi vào, trình duyệt nhớ theo phiên).
  Mỗi trình duyệt có **mã thiết bị** (`X-Device-Id`, không bao giờ trả ra ngoài): chỉ máy đặt đơn mới huỷ được đơn đó.
- Máy khách gửi kèm `X-Session-Id`: sau khi trả bàn, máy của lượt cũ bị từ chối (`409 SESSION_ENDED`), không đặt nhầm
  vào lượt của khách sau.
- **Thanh toán theo bàn**: tiền mặt (thu ngân xác nhận) hoặc **VNPay sandbox** (IPN + Return URL có chữ ký HMAC-SHA512,
  tra cứu `querydr` trước khi cho hết hạn). Mỗi phiên tối đa một lần thanh toán đang chờ; trong lúc chờ không gọi thêm.
- **Trả bàn** ở trang Thu ngân kết thúc phiên; còn nợ / còn món thì phải chọn lý do. Tự kết thúc phiên sau 30 phút không
  gọi món, hoặc 30 phút sau khi đã trả đủ.
- **Đóng bàn / Mở bàn** ở trang Quản trị = ngừng phục vụ / phục vụ lại (bảo trì); không đóng được bàn đang có khách.
- Database cũ được tự nâng cấp khi server khởi động (`SchemaMigrator`).

Kiểm thử thủ công tính năng chịu lỗi: trên màn hình bếp bấm **"Giả lập mất mạng 5s"** trong lúc đặt món từ điện thoại.
Sau khi kết nối lại, bếp tự gửi RESUME và nhận bù các đơn bị lỡ (thanh thống kê hiện số "Gửi bù").

## 7. Thực nghiệm

Server phải đang chạy (khuyến nghị chạy bằng jar, không qua Vite).

```bash
cd source/loadtest
npm install
node run-all.js            # toàn bộ ma trận, ~15 phút
node run-all.js --quick    # bản rút gọn, ~5 phút
node report.js             # tổng hợp statics/results/*.json -> statics/results/REPORT.md
```

Chạy riêng từng kịch bản, ví dụ: `node experiment.js e2 --mode=NAIVE_PUSH --orders=600`.

| ID | Kịch bản | So sánh |
|---|---|---|
| E1 | Độ trễ đặt món → bếp nhận, số request và byte phía bếp | POLLING vs NAIVE_PUSH vs RELIABLE_PUSH |
| E2 | Bếp rớt mạng định kỳ trong khi đơn liên tục đổ về: số đơn mất | NAIVE_PUSH vs RELIABLE_PUSH |
| E3 | Mất response + bấm 2 lần: số đơn trùng trong DB | Idempotency tắt vs bật |
| E4 | 10 bếp cùng đổi trạng thái một món: số lost update | Optimistic lock tắt vs bật |
| E5 | Tăng dần số client đồng thời: throughput, p50/p95/p99, lỗi | (tuỳ chọn mở sẵn N kết nối WS) |
| E6 | Một client spam: độ trễ của khách bình thường | Rate limit tắt vs bật |

Baseline và proposed chạy trên **cùng một codebase**, bật/tắt bằng `PUT /api/admin/settings` (load test tự làm việc này).
Load test dùng các bàn riêng có mã `LT001...`; trước mỗi kịch bản và khi chạy xong, đơn của các bàn này được dọn
(`POST /api/admin/maintenance/clear-test-orders`) và cấu hình được trả về mặc định (`node experiment.js cleanup`).
Kết quả thô (JSON/CSV) nằm trong `statics/results/`. Chỉ đưa vào báo cáo số liệu đo được trên máy thực nghiệm.

Lưu ý khi đọc số liệu: với profile `h2`, DB nằm trong RAM nên E5 (throughput) và E6 (ảnh hưởng của spam) cho số
lạc quan hơn nhiều so với MySQL. Số liệu đưa vào báo cáo nên đo với MySQL.

## 8. Cấu hình chính (`server/src/main/resources/application.yml`)

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `app.delivery-mode` | `RELIABLE_PUSH` | `POLLING` / `NAIVE_PUSH` / `RELIABLE_PUSH` |
| `app.idempotency-enabled` | `true` | Chống đặt trùng bằng Idempotency-Key |
| `app.optimistic-lock-enabled` | `true` | Kiểm tra version khi đổi trạng thái món |
| `app.rate-limit.*` | 10 đơn/phút/bàn; 60 burst, 20 req/s mỗi IP | Token bucket |
| `app.session.idle-timeout-minutes` | `30` | Phiên không gọi món quá 30 phút -> tự kết thúc |
| `app.session.auto-checkout-after-paid-minutes` | `30` | Đã trả đủ, 30 phút chưa ai bấm Trả bàn -> tự trả bàn |
| `app.payment.expire-minutes` | `15` | Hạn mỗi lần thanh toán |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` (biến môi trường) | khoá sandbox của nhóm (trong `application.yml`) | Mã merchant VNPay sandbox; để trống thì ẩn VNPay |
| `APP_PUBLIC_URL` (biến môi trường) | trống | Địa chỉ tunnel cho Return URL của VNPay; trống thì lấy theo request |
| `app.ws.heartbeat-ms` | `10000` | Chu kỳ heart-beat STOMP |
| `app.ws.max-connections-per-table` | `8` | Số kết nối WebSocket tối đa mỗi bàn |
| `app.ws.replay-batch-limit` | `500` | Số sự kiện tối đa mỗi lần gửi bù |
| `server.tomcat.max-connections` | `2000` | Số kết nối TCP tối đa |
| `spring.datasource.hikari.maximum-pool-size` | `20` | Số kết nối DB tối đa |

## 9. Tóm tắt giao thức

REST (JSON, lỗi dạng `{"error","message","details","timestamp"}`):

| Method | Endpoint | Ghi chú |
|---|---|---|
| GET | `/api/public/config` | Chế độ giao đơn, heart-beat, cách thanh toán đang bật |
| GET | `/api/public/tables/{qrToken}` | Mã QR → bàn |
| POST | `/api/public/tables/{qrToken}/join` | Vào bàn: vào phiên đang có hoặc mở phiên mới; bàn ngừng phục vụ → `409 TABLE_CLOSED` |
| GET | `/api/public/menu` | Có `ETag`, gửi `If-None-Match` → `304` |
| POST | `/api/orders` | Header `X-Table-Token`, `X-Device-Id`, `X-Session-Id`, `Idempotency-Key`; body thêm `guestName`; `201` / `200` + `Idempotent-Replayed`; `409 PAYMENT_IN_PROGRESS`, `409 SESSION_ENDED` |
| GET | `/api/orders` | **Mọi đơn của phiên** + `mineOrderIds` (đơn do máy này đặt) |
| POST | `/api/orders/{id}/cancel` | Chỉ máy đã đặt, khi mọi món còn PENDING |
| GET | `/api/payments/bill` | Tổng, đã trả, còn phải trả, lần đang chờ |
| POST | `/api/payments` | `{method: CASH | VNPAY}` + `Idempotency-Key`; VNPay trả kèm `payUrl` |
| POST | `/api/payments/{id}/cancel` | Huỷ lần đang chờ |
| GET | `/api/payments/vnpay/ipn` | VNPay gọi về (server-to-server), trả `{RspCode, Message}` |
| GET | `/api/payments/vnpay/return` | Trình duyệt quay về từ VNPay → chuyển về trang gọi món |
| POST | `/api/auth/login` | → token nhân viên |
| GET | `/api/kitchen/orders` | Ảnh chụp ban đầu + `latestSeq` |
| GET | `/api/kitchen/events?afterSeq=` | Dùng cho POLLING |
| PATCH | `/api/kitchen/order-items/{id}/status` | `{status, version}` |
| GET | `/api/cashier/tables[/{id}]` | Sơ đồ bàn / chi tiết hóa đơn (CASHIER, ADMIN) |
| POST | `/api/cashier/tables/{id}/payments` | Thu ngân tạo lần thu tiền mặt tại quầy |
| PATCH | `/api/cashier/payments/{id}/confirm` | `{version}`: "Đã nhận tiền" (khoá lạc quan) |
| POST | `/api/cashier/tables/{id}/checkout` | **Trả bàn** `{reason, note}`; `409 CONFIRM_REQUIRED` nếu còn nợ/còn món mà chưa có lý do |
| * | `/api/admin/...` | Bàn (mở/đóng = phục vụ/ngừng phục vụ), thực đơn, lịch sử thanh toán, giám sát, cấu hình |

WebSocket `ws://host/ws` (STOMP 1.2):

| Hướng | Destination | Nội dung |
|---|---|---|
| Client → Server | `CONNECT` | `Authorization: Bearer <token>` (bếp) hoặc `tableToken: <qrToken>` (khách) |
| Server → Bếp | `/topic/kitchen` | `{type, seq, eventId, serverTime, payload}`: ORDER_CREATED, ITEM_STATUS_CHANGED, ORDER_CANCELLED |
| Server → Khách | `/topic/table.{id}` | Đơn chung của phiên (như trên, không lộ mã thiết bị), PAYMENT_UPDATED, TABLE_SESSION_ENDED, TABLE_CLOSED |
| Server → Thu ngân | `/topic/cashier` | TABLE_STATE_CHANGED, PAYMENT_UPDATED (chỉ CASHIER, ADMIN) |
| Server → Tất cả | `/topic/menu` | MENU_UPDATED |
| Bếp → Server | `/app/ack` | `{seq}` |
| Bếp → Server | `/app/resume` | `{lastSeq}` → server trả `/user/queue/replay`: `{type:"REPLAY_BATCH", latestSeq, hasMore, events[]}` |
