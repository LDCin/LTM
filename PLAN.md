# PLAN DỰ ÁN – HỆ THỐNG GỌI MÓN QR & MÀN HÌNH BẾP THỜI GIAN THỰC

> Môn: Lập trình mạng · Chủ đề 3 – Ứng dụng mạng
> Deadline: **23:59 – 31/10/2026** (bắt đầu 17/10/2026 → còn 14 ngày)
> Stack: ReactJS · Java Spring Boot · REST API · WebSocket (STOMP) · MySQL

---

## 0. Rủi ro lớn nhất cần tránh

Đề bài nói rõ: *"Một project chỉ có giao diện và database nhưng không thể hiện rõ bản chất của network programming sẽ không được xem là đáp ứng đầy đủ yêu cầu."*

Một app gọi món "CRUD + WebSocket broadcast" rất dễ bị đánh giá là **web app thông thường**. Vì vậy trọng tâm của nhóm **không phải là nhiều màn hình**, mà là:

> **Đảm bảo đơn hàng được giao tới bếp *đúng 1 lần, không mất, không trùng, đúng thứ tự, với độ trễ thấp* — kể cả khi mạng chập chờn, client mất kết nối hoặc gửi lại request.**

Đây là bài toán mạng thật (nhà hàng dùng Wi-Fi, tablet bếp hay rớt mạng, khách bấm "Đặt món" 2 lần) và đo được bằng số liệu → phục vụ trực tiếp cho Novelty (15%) và Experiment (15%).

---

## 1. Problem – Objective – Scope

### 1.1. Problem
- Gọi món truyền thống phụ thuộc nhân viên → chậm giờ cao điểm, ghi sai món.
- Các hệ thống gọi món đơn giản dùng **polling** hoặc **broadcast WebSocket không đảm bảo** → khi tablet bếp mất Wi-Fi vài giây, đơn phát ra trong lúc đó **bị mất**; khi khách bấm lại do mạng chậm → **đơn bị trùng**.

### 1.2. Objectives
1. Khách quét QR tại bàn → xem thực đơn → đặt món qua REST API.
2. Đơn được đẩy tới màn hình bếp (KDS – Kitchen Display System) qua WebSocket trong thời gian thực.
3. Bếp cập nhật trạng thái từng món; khách và các màn hình bếp khác nhận cập nhật ngay.
4. **Không mất đơn khi bếp mất kết nối** (sequence number + ACK + replay khi reconnect).
5. **Không trùng đơn khi khách gửi lại** (Idempotency-Key).
6. **Không xung đột khi nhiều đầu bếp cùng thao tác** (state machine + optimistic locking).
7. Đo và so sánh với baseline bằng số liệu thực nghiệm.

### 1.3. Scope
| In scope | Out of scope |
|---|---|
| QR theo bàn, phiên bàn (table session) | Thanh toán online |
| Thực đơn, giỏ hàng, đặt món, ghi chú món | Nhiều chi nhánh / multi-tenant |
| KDS real-time, cập nhật trạng thái món | Giao hàng, đặt bàn trước |
| Khách theo dõi trạng thái món real-time | App mobile native |
| Đăng nhập nhân viên bếp/admin | Báo cáo doanh thu phức tạp |
| Reliable delivery, idempotency, concurrency | Triển khai cloud production |
| Script đo hiệu năng & fault injection | |

---

## 2. Kiến trúc hệ thống

```text
 ┌──────────────────────┐        ┌──────────────────────┐       ┌──────────────────┐
 │  Customer Web App    │        │ Kitchen Display (KDS)│       │  Admin Web App   │
 │  (React, điện thoại) │        │ (React, tablet bếp)  │       │  (React)         │
 │  - Menu / Cart       │        │ - Hàng đợi món       │       │ - Quản lý bàn/QR │
 │  - Đặt món           │        │ - Đổi trạng thái     │       │ - Quản lý menu   │
 │  - Theo dõi trạng thái│       │ - ACK / RESUME       │       │ - Giám sát kết nối│
 └───┬───────────▲──────┘        └────┬────────▲────────┘       └───┬──────────────┘
     │REST       │WS (STOMP)          │REST    │WS (STOMP)          │REST
     │HTTP/JSON  │/topic/table.{id}   │        │/topic/kitchen      │
     ▼           │                    ▼        │                    ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         Spring Boot Server                                    │
 │  ┌────────────────┐  ┌──────────────────┐  ┌───────────────────────────────┐  │
 │  │ REST Controllers│  │ WebSocket Layer  │  │ Session Registry              │  │
 │  │ /api/menu       │  │ STOMP endpoint   │  │ (ConcurrentHashMap: client →  │  │
 │  │ /api/orders     │  │ Heartbeat 10s    │  │  lastAckSeq, connectedAt)     │  │
 │  │ /api/items/...  │  │ ACK / RESUME     │  └───────────────────────────────┘  │
 │  └───────┬────────┘  └────────▲─────────┘                                     │
 │          ▼                    │ publish AFTER COMMIT                          │
 │  ┌──────────────────────────────────────┐   ┌──────────────────────────────┐  │
 │  │ Order Service                        │──▶│ Event Publisher              │  │
 │  │ - Validate session / món còn hàng    │   │ - Gán seq tăng dần           │  │
 │  │ - Idempotency check                  │   │ - Ghi order_event (outbox)   │  │
 │  │ - State machine + @Version           │   │ - Replay theo lastSeq        │  │
 │  └───────────────┬──────────────────────┘   └──────────────┬───────────────┘  │
 └──────────────────┼─────────────────────────────────────────┼──────────────────┘
                    ▼ JDBC / JPA (HikariCP pool)               ▼
            ┌──────────────────────────────────────────────────────┐
            │ MySQL: tables, menu_item, orders, order_item,         │
            │        order_event (event log), idempotency, staff    │
            └──────────────────────────────────────────────────────┘
```

### Vai trò các thành phần
| Thành phần | Trách nhiệm |
|---|---|
| Customer App | Mở từ QR `http://<server-ip>:5173/t/{qrToken}`, xem menu, đặt món (gửi kèm Idempotency-Key), subscribe trạng thái bàn mình |
| KDS | Đăng nhập, subscribe `/topic/kitchen`, hiển thị hàng đợi món theo thứ tự, đổi trạng thái, gửi ACK, tự RESUME khi reconnect |
| Admin App | CRUD menu/bàn, sinh QR, mở/đóng bàn, xem số KDS đang online |
| REST layer | Request/response nghiệp vụ (đặt món, đổi trạng thái, menu) |
| WebSocket layer | Server push sự kiện, heartbeat, ACK/RESUME |
| Order Service | Validation, idempotency, state machine, transaction |
| Event Publisher | Đánh số `seq`, lưu event log, phát sau khi commit, replay |
| MySQL | Lưu trữ bền vững + event log phục vụ replay |

### Nguyên tắc thiết kế quan trọng (để giải thích khi bảo vệ)
- **REST cho lệnh (command), WebSocket cho sự kiện (event).** Đặt món qua REST vì cần response rõ ràng (201/409/422) và retry an toàn; WebSocket chỉ dùng để push.
- **Publish sau khi commit** (`@TransactionalEventListener(phase = AFTER_COMMIT)`): không bao giờ đẩy tới bếp một đơn mà DB đã rollback.
- **Event log (outbox) trong MySQL** là nguồn sự thật cho replay; WebSocket chỉ là kênh vận chuyển, có thể mất.

---

## 3. Network Communication Design

### 3.1. Các kênh giao tiếp
| Từ → Đến | Giao thức | Mục đích |
|---|---|---|
| Customer → Server | HTTP/1.1 REST, JSON | Lấy menu, đặt món, xem đơn |
| Server → Customer | WebSocket/STOMP `/topic/table.{tableId}` | Push trạng thái món |
| KDS → Server | HTTP REST | Đổi trạng thái món |
| KDS ↔ Server | WebSocket/STOMP `/topic/kitchen`, `/app/ack`, `/app/resume` | Nhận đơn, ACK, replay |
| Server → MySQL | JDBC qua HikariCP | Lưu trữ |

### 3.2. Vòng đời kết nối WebSocket
1. **Thiết lập:** HTTP `GET /ws` + header `Upgrade: websocket` → `101 Switching Protocols` → STOMP `CONNECT` (header: `Authorization: Bearer <jwt>` cho KDS, `X-Table-Token` cho khách).
2. **Duy trì:** STOMP heartbeat 10s/10s. Quá 2 nhịp không nhận → coi là chết, server xoá khỏi Session Registry.
3. **Đóng:** client gửi `DISCONNECT`, hoặc server phát hiện timeout / lỗi TCP → dọn session.
4. **Reconnect:** client dùng exponential backoff (1s, 2s, 4s… tối đa 30s) + jitter, sau khi kết nối lại gửi `RESUME {lastSeq}`.

### 3.3. Sequence – Đặt món
```text
Customer            Server                       MySQL                 KDS
   │ POST /api/orders  │                           │                     │
   │ Idempotency-Key: K│                           │                     │
   │──────────────────▶│ validate token, món       │                     │
   │                   │ BEGIN TX                  │                     │
   │                   │──insert orders, items────▶│                     │
   │                   │──insert order_event(seq)─▶│                     │
   │                   │──insert idempotency(K)───▶│                     │
   │                   │ COMMIT                    │                     │
   │◀── 201 {orderId} ─│                           │                     │
   │                   │── ORDER_CREATED{seq=n} ──────────────────────────▶│
   │                   │◀───────────────────────────────── ACK{seq=n} ────│
```

### 3.4. Sequence – Bếp cập nhật trạng thái
```text
KDS                  Server                        Customer   KDS khác
 │ PATCH /api/order-items/{id}/status               │          │
 │ {status: COOKING, version: 3}                    │          │
 │─────────────────▶│ kiểm tra transition hợp lệ    │          │
 │                  │ UPDATE ... WHERE version = 3  │          │
 │◀── 200 {version:4}│                              │          │
 │                  │── ITEM_STATUS_CHANGED ────────▶│─────────▶│
```
Nếu 2 đầu bếp cùng bấm: người thứ 2 nhận `409 VERSION_CONFLICT` và UI tự refresh.

### 3.5. Sequence – Mất kết nối và replay (điểm mới chính)
```text
KDS                         Server
 │◀── ORDER_CREATED seq=41 ──│
 │─── ACK 41 ───────────────▶│
 │   ✕ mất Wi-Fi 8 giây       │── seq=42, 43, 44 phát ra (KDS không nhận)
 │   ... reconnect ...        │
 │─── CONNECT ──────────────▶│
 │─── RESUME {lastSeq: 41} ─▶│ SELECT * FROM order_event WHERE seq > 41
 │◀── REPLAY [42, 43, 44] ───│
 │─── ACK 44 ───────────────▶│
```
Client còn tự **phát hiện khoảng trống**: nếu đang ở seq=50 mà nhận seq=52 → gửi `RESUME {lastSeq: 50}`. Client **loại bỏ trùng** theo `seq` (nhận lại seq ≤ lastSeq thì bỏ qua).

---

## 4. Protocol / Message Format

### 4.1. REST API (rút gọn)
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/tables/resolve/{qrToken}` | Đổi QR token → thông tin bàn + session |
| GET | `/api/menu` | Danh mục + món + trạng thái còn hàng |
| POST | `/api/orders` | Đặt món (header `Idempotency-Key`) |
| GET | `/api/orders?sessionId=` | Đơn của bàn (dùng khi khách reconnect) |
| PATCH | `/api/order-items/{id}/status` | Bếp đổi trạng thái (kèm `version`) |
| POST | `/api/orders/{id}/cancel` | Khách huỷ (chỉ khi còn PENDING) |
| POST | `/api/auth/login` | Nhân viên đăng nhập → JWT |
| CRUD | `/api/admin/menu-items`, `/api/admin/tables` | Quản trị |
| GET | `/api/admin/tables/{id}/qr` | Sinh ảnh QR (ZXing) |

**Request đặt món:**
```json
POST /api/orders
Idempotency-Key: 6f1c2a9e-...-uuid
X-Table-Token: 9KfP2x...

{
  "items": [
    { "menuItemId": 12, "quantity": 2, "note": "ít cay" },
    { "menuItemId": 7,  "quantity": 1 }
  ]
}
```

**Response lỗi thống nhất:**
```json
{
  "error": "ITEM_UNAVAILABLE",
  "message": "Món 'Bò lúc lắc' đã hết",
  "details": { "menuItemId": 12 },
  "timestamp": "2026-10-20T12:03:11Z"
}
```

| HTTP | error code | Tình huống |
|---|---|---|
| 400 | `INVALID_REQUEST` | Thiếu field, quantity ≤ 0, JSON hỏng |
| 401 | `INVALID_TABLE_TOKEN` | QR sai/hết hạn (bàn đã đóng) |
| 404 | `NOT_FOUND` | Món/đơn không tồn tại |
| 409 | `INVALID_STATE_TRANSITION` | VD: READY → COOKING |
| 409 | `VERSION_CONFLICT` | Hai người cùng sửa |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Cùng key nhưng body khác |
| 422 | `ITEM_UNAVAILABLE` | Món hết |
| 503 | `SERVICE_UNAVAILABLE` | DB lỗi / quá tải |

### 4.2. WebSocket message envelope (nhóm tự thiết kế)
```json
{
  "type": "ORDER_CREATED",
  "seq": 1024,
  "eventId": "b3d1...-uuid",
  "serverTime": 1760692991123,
  "payload": { ... }
}
```

| Hướng | type | Payload |
|---|---|---|
| S → KDS | `ORDER_CREATED` | orderId, tableCode, items[], createdAt |
| S → KDS, Customer | `ITEM_STATUS_CHANGED` | orderItemId, from, to, version |
| S → KDS, Customer | `ORDER_CANCELLED` | orderId |
| S → KDS | `REPLAY_BATCH` | events[] (các event bị lỡ) |
| S → Customer | `MENU_ITEM_SOLD_OUT` | menuItemId |
| KDS → S | `ACK` | seq |
| KDS → S | `RESUME` | lastSeq, clientId |

### 4.3. State machine của món
```text
PENDING ──▶ ACCEPTED ──▶ COOKING ──▶ READY ──▶ SERVED
   │
   └──▶ CANCELLED   (chỉ khi PENDING)
```
Mọi chuyển trạng thái khác → `409 INVALID_STATE_TRANSITION`.

---

## 5. Database Schema (MySQL)

```text
restaurant_table (id, code, qr_token UNIQUE, status[OPEN/CLOSED])
table_session    (id, table_id, opened_at, closed_at)
category         (id, name, sort_order)
menu_item        (id, category_id, name, price, image_url, available, stock NULL)
orders           (id, session_id, table_id, status, total, created_at)
order_item       (id, order_id, menu_item_id, quantity, note, status, version, updated_at)
order_event      (seq BIGINT AUTO_INCREMENT PK, order_id, type, payload JSON, created_at)
idempotency_key  (key_value PK, request_hash, order_id, created_at)
staff            (id, username UNIQUE, password_hash, role[KITCHEN/ADMIN])
```
- `order_event.seq` = sequence toàn cục cho replay.
- `idempotency_key.request_hash` (SHA-256 của body) để phát hiện cùng key nhưng nội dung khác.
- `order_item.version` dùng cho optimistic locking (`@Version` trong JPA).
- QR token được **đổi mới khi đóng bàn** → ảnh QR chụp từ lần trước không đặt được món nữa.

---

## 6. Concurrency

| Vấn đề | Cách xử lý |
|---|---|
| Nhiều khách đặt cùng lúc | Tomcat thread pool cho REST, mỗi request một transaction riêng |
| Nhiều KDS / khách kết nối WS | Spring `clientInboundChannel` / `clientOutboundChannel` có thread pool riêng, cấu hình kích thước |
| Hai đầu bếp sửa cùng một món | Optimistic locking `@Version` → 409 |
| Món có số lượng giới hạn (stock) | `UPDATE menu_item SET stock = stock - ? WHERE id = ? AND stock >= ?` (atomic, kiểm tra số dòng bị ảnh hưởng) |
| Khách bấm đặt 2 lần / retry | `idempotency_key` PRIMARY KEY → lần 2 trả lại kết quả cũ |
| Thứ tự event | `seq` AUTO_INCREMENT do DB cấp; client sắp xếp và phát hiện thiếu |
| Session Registry | `ConcurrentHashMap`, cập nhật khi CONNECT/DISCONNECT/ACK |
| Client chậm làm nghẽn | Giới hạn `sendTimeLimit`, `sendBufferSizeLimit` của WebSocket |
| Hai request cùng Idempotency-Key tới **cùng lúc** | Cả hai cùng INSERT vào `idempotency_key` → DB unique constraint chỉ cho 1 thắng; bên thua bắt `DuplicateKeyException`, đọc lại kết quả đã lưu và trả cùng `orderId` |

---

## 6b. Chống quá tải (Overload Protection)

Quy mô thực tế của một nhà hàng (~50 bàn × 2–4 điện thoại + vài KDS ≈ 200 kết nối) là nhỏ so với khả năng của Spring Boot. Rủi ro quá tải thật nằm ở **đột biến** (giờ cao điểm, cả quán reconnect cùng lúc khi Wi-Fi có lại) và **client lỗi/spam**. Các lớp bảo vệ:

| Lớp | Cơ chế | Cấu hình gợi ý |
|---|---|---|
| Kết nối TCP | Tomcat NIO connector: kết nối WS rảnh **không giữ thread**; giới hạn tổng kết nối và hàng đợi accept | `server.tomcat.max-connections=2000`, `accept-count=100`, `threads.max=200` |
| Rate limiting | **Token bucket tự cài đặt** theo `tableToken` và theo IP → vượt ngưỡng trả `429 Too Many Requests` + `Retry-After` | VD: đặt món ≤ 5 lần/phút/bàn, API chung ≤ 30 req/10s/IP |
| Giới hạn kết nối WS | Tối đa N kết nối WS mỗi table token; từ chối CONNECT vượt ngưỡng | N = 8 |
| Kiểm soát subscribe | `ChannelInterceptor` kiểm tra SUBSCRIBE: khách chỉ được nghe `/topic/table.{bàn của mình}`, chỉ staff được nghe `/topic/kitchen` | — |
| Backpressure WS | Client nhận chậm bị ngắt thay vì làm nghẽn thread gửi; giới hạn kích thước frame | `sendTimeLimit=10s`, `sendBufferSizeLimit=512KB`, `messageSizeLimit=64KB` |
| Giảm fan-out | Topic theo bàn (`/topic/table.{id}`) và theo trạm bếp (`/topic/kitchen.{station}`) thay vì broadcast tất cả; payload chỉ gửi phần thay đổi (delta) | — |
| Cache menu | Menu đọc nhiều, ghi ít → cache in-memory + `ETag`/`Cache-Control` → `304 Not Modified`; ảnh món phục vụ dạng static | Invalidate khi admin sửa menu |
| Bảo vệ DB | HikariCP pool có giới hạn + `connectionTimeout` ngắn → hết connection thì trả 503 nhanh, không treo request | `maximum-pool-size=20`, `connection-timeout=3000` |
| Fail fast / load shedding | Khi thread pool và hàng đợi đầy → từ chối sớm (503 + `Retry-After`) thay vì để mọi request cùng chậm | — |
| Chống reconnect storm | Client reconnect bằng exponential backoff **+ jitter ngẫu nhiên**, tránh 200 client đập vào server cùng một giây | 1s → 30s, jitter ±50% |
| Timeout mọi nơi | Client HTTP 5s, query DB 3s, heartbeat WS 10s | — |
| Fallback | Nếu WebSocket bị chặn → SockJS fallback hoặc polling chậm (10s) | — |

---

## 7. Error Handling (đối chiếu yêu cầu mục 6 của Instruction)

| Yêu cầu | Cách xử lý |
|---|---|
| Invalid request | Bean Validation (`@Valid`) + `@RestControllerAdvice` → 400 JSON |
| Invalid data | Kiểm tra món tồn tại, còn hàng, quantity hợp lệ |
| Connection failure | Client: exponential backoff + banner "Mất kết nối" |
| Client disconnect | Heartbeat phát hiện, dọn session, đơn vẫn nằm trong event log |
| Server unavailable | Customer app giữ giỏ hàng (localStorage), retry với **cùng** Idempotency-Key |
| Timeout | Axios timeout 5s → retry an toàn nhờ idempotency |
| Duplicate request | Idempotency-Key |
| Invalid state | State machine → 409 |
| Database error | Transaction rollback, 503, không publish event |
| Unexpected input | Frame WS sai format → bỏ qua + log, **không đóng server**; message quá lớn → giới hạn `messageSizeLimit` |

---

## 8. Novelty & Contributions

### 8.1. Baseline
Kiến trúc gọi món phổ biến:
- **Baseline A (Polling):** KDS gọi `GET /api/orders?since=` mỗi 3 giây.
- **Baseline B (Naive Push):** WebSocket broadcast "fire-and-forget", không seq, không ACK, không idempotency.

### 8.2. Proposed – Reliable Real-time Order Delivery
| # | Contribution | Mô tả | Evidence (thực nghiệm) |
|---|---|---|---|
| 1 | **Giao thức giao đơn tin cậy trên WebSocket** | Envelope có `seq`, ACK, RESUME/replay từ event log, client phát hiện khoảng trống & loại trùng | E2: số đơn mất khi KDS bị ngắt định kỳ, Baseline B so với Proposed |
| 2 | **Đặt món idempotent** | Idempotency-Key + request hash, retry an toàn | E3: số đơn trùng khi tiêm timeout/retry |
| 3 | **Publish sau commit + event log (outbox)** | Không bao giờ có "đơn ma" ở bếp, replay được | Test: ép DB lỗi giữa transaction → bếp không nhận event |
| 4 | **Đồng bộ nhiều KDS bằng state machine + optimistic locking** | Không mất cập nhật khi nhiều đầu bếp cùng thao tác | E4: N KDS cùng đổi trạng thái → 0 lost update |
| 5 | **So sánh định lượng Push vs Polling** | Độ trễ & băng thông | E1 |
| 6 | **Chống quá tải nhiều lớp** | Token bucket theo bàn/IP, giới hạn kết nối WS, backpressure, backoff + jitter | E6: burst & reconnect storm, có và không có bảo vệ |

### 8.3. Cách làm baseline công bằng
Dùng **feature flag** trong `application.yml`, cùng một codebase:
```yaml
delivery:
  mode: RELIABLE_PUSH     # POLLING | NAIVE_PUSH | RELIABLE_PUSH
order:
  idempotency-enabled: true
```
→ Chạy cùng kịch bản, chỉ đổi flag, so sánh kết quả. Giải thích rất thuyết phục khi bảo vệ.

---

## 9. Thực nghiệm

> **Chỉ báo cáo số liệu đo thật.** Lưu log thô (CSV) trong `statics/results/` để chứng minh có thể chạy lại.

### 9.1. Công cụ
- **Load generator tự viết** (Node.js hoặc Java), giả lập N bàn đặt món + M KDS nhận đơn. *Cùng một process đóng vai cả khách lẫn bếp* → đo độ trễ bằng cùng một đồng hồ, không lo lệch giờ giữa các máy.
- **k6** (hỗ trợ HTTP + WebSocket) cho throughput REST.
- **Toxiproxy** chèn độ trễ, mất kết nối, ngắt TCP giữa KDS và server.
- **Spring Boot Actuator + Micrometer** để lấy CPU, RAM, số kết nối, thời gian xử lý.

### 9.2. Kịch bản
| ID | Kịch bản | Biến thay đổi | Metric |
|---|---|---|---|
| E1 | Push vs Polling | N bàn = 10, 50, 100, 200; mode = POLLING / RELIABLE_PUSH | Độ trễ đặt món → bếp (p50/p95/p99), số request/s, bytes truyền, CPU server |
| E2 | Độ tin cậy khi mất kết nối | KDS bị ngắt mỗi 10s trong 2–5s; 1000 đơn; NAIVE_PUSH / RELIABLE_PUSH | Số đơn mất, số đơn trùng, thời gian khôi phục sau reconnect |
| E3 | Retry / duplicate | Tiêm timeout 10–30% response; idempotency on/off | Số đơn trùng trong DB |
| E4 | Nhiều KDS cùng thao tác | 2–10 KDS cùng đổi một món | Số lost update, tỷ lệ 409 |
| E5 | Tải tối đa | Tăng dần số đơn/s | Throughput tối đa, error rate, p95 latency, số kết nối WS đồng thời |
| E6 | Burst & reconnect storm | 1 client spam 50 req/s; 200 client reconnect cùng lúc; bảo vệ on/off | p95 latency của các bàn **bình thường**, tỷ lệ 429/503, CPU, thời gian để toàn bộ client kết nối lại |

### 9.3. Bảng kết quả dự kiến (điền số đo thật)
| Metric | Polling | Naive Push | Reliable Push |
|---|---:|---:|---:|
| Độ trễ p95 (ms) | | | |
| Request/s tới server (lúc rảnh) | | | |
| Đơn mất / 1000 (KDS rớt mạng) | | | |
| Đơn trùng / 1000 (có retry) | | | |
| Thời gian khôi phục (ms) | | | |

---

## 10. Cấu trúc thư mục

```text
NhomXX_QROrdering_Source/
├── README.md
├── docker-compose.yml          # MySQL (+ Toxiproxy cho thực nghiệm)
├── report/
├── statics/
│   ├── architecture.png
│   ├── protocol.png
│   └── results/                # CSV + biểu đồ
├── source/
│   ├── server/                 # Spring Boot (Maven)
│   │   └── src/main/java/.../
│   │       ├── config/         # WebSocketConfig, SecurityConfig
│   │       ├── controller/     # REST
│   │       ├── ws/             # AckHandler, ResumeHandler, SessionRegistry
│   │       ├── service/        # OrderService, EventPublisher, StateMachine
│   │       ├── domain/         # Entity
│   │       ├── repository/
│   │       └── exception/      # GlobalExceptionHandler
│   ├── client-customer/        # React + Vite
│   ├── client-kitchen/         # React + Vite (hoặc gộp chung 1 app nhiều route)
│   ├── client-admin/
│   ├── database/schema.sql, seed.sql
│   └── loadtest/               # script thực nghiệm
```

Thư viện ngoài cần ghi trong README: Spring Web, Spring WebSocket, Spring Data JPA, Spring Security + jjwt, MySQL Connector/J, ZXing, `@stomp/stompjs`, axios, react-router.

---

## 11. Timeline 14 ngày

| Ngày | Mốc | Công việc | Đầu ra |
|---|---|---|---|
| **17–18/10** (T7–CN) | Thiết kế | Chốt kiến trúc, API contract, message format, schema; tạo repo, skeleton Spring Boot + React, docker-compose MySQL | Repo chạy được "hello", tài liệu protocol |
| **19–22/10** | Core | Menu, QR/table session, đặt món REST, WS push tới KDS, KDS đổi trạng thái, khách xem trạng thái real-time, login nhân viên | **Demo end-to-end luồng chính** (mốc bắt buộc 22/10) |
| **23–24/10** | Novelty | seq/ACK/RESUME/replay, idempotency, publish after commit, optimistic lock, feature flag + mode POLLING/NAIVE_PUSH | Ba chế độ chạy được |
| **25–26/10** | Test & đo | Unit/integration test, load generator, Toxiproxy, chạy E1–E5, xuất CSV + biểu đồ | `statics/results/` |
| **27–29/10** | Tài liệu | Báo cáo dạng paper, README, vẽ diagram, **chạy Compilatio sớm** để còn thời gian sửa | Report ≤ 20% similarity |
| **30/10** | Final | Test cài đặt trên máy sạch theo README, tập demo + vấn đáp chéo | Gói `NhomXX_QROrdering/` |
| **31/10** | Buffer | Dự phòng, nộp trước 23:59 | |

---

## 12. Phân công (điều chỉnh theo số thành viên)

| Vai trò | Phần việc kỹ thuật | Phần báo cáo |
|---|---|---|
| **TV1 – Backend core** | Schema, REST API, Order Service, state machine, idempotency, exception handler | Problem Definition, Implementation (backend) |
| **TV2 – Network/WebSocket** | WebSocketConfig, envelope, seq/ACK/RESUME, Session Registry, heartbeat, publish after commit | Network Communication Design, Novelty |
| **TV3 – Customer app** | QR flow, menu, giỏ hàng, retry + Idempotency-Key, WS trạng thái bàn | System Architecture, Appendix protocol |
| **TV4 – KDS + Admin** | KDS real-time, reconnect/backoff, phát hiện gap, admin menu/bàn/QR | Implementation (frontend) |
| **TV5 – Test & Experiment** | Load generator, k6, Toxiproxy, chạy E1–E5, biểu đồ | Experimental Setup, Results, Discussion |

- Nhóm 3 người: gộp TV1+TV5, TV3+TV4.
- Nhóm 2 người: một người backend + network, một người frontend + experiment.
- **Mọi thành viên phải tự giải thích được luồng 3.3–3.5**, vì giảng viên sẽ hỏi chéo.

---

## 13. Rủi ro & phòng tránh

| Rủi ro | Phòng tránh |
|---|---|
| Sa đà làm UI đẹp | UI tối giản, ưu tiên mốc 22/10 có luồng end-to-end |
| Điện thoại không vào được app khi demo | Chạy Vite với `--host`, dùng IP LAN, mang router riêng nếu Wi-Fi trường chặn |
| Không đủ thời gian đo | Viết load generator song song từ 23/10 |
| Compilatio > 20% | Tự viết, trích dẫn đúng, kiểm tra trước 29/10 |
| Bị hỏi STOMP là gì | Hiểu được WebSocket handshake → frame → STOMP CONNECT/SUBSCRIBE/SEND/MESSAGE |

---

## 14. Checklist mapping sang báo cáo

| Mục report | Lấy từ plan |
|---|---|
| Introduction / Problem Definition | §1 |
| Proposed Approach / System Architecture | §2, §6 |
| Network Communication Design | §3, §4, §7 |
| Implementation | §5, §10 |
| Experimental Setup / Results | §9 |
| Novelty and Contributions | §8 |
| Appendix | §4 (protocol đầy đủ), §5 (schema) |
