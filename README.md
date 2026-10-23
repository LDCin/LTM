# NETWORK PROGRAMMING – FINAL PROJECT

> **Academic Year 2026–2027**

---

# 1. Project Information

## 1.1. Project Name

**QR Order – Gọi món qua mã QR với màn hình bếp thời gian thực (giao đơn tin cậy trên WebSocket/STOMP)**

## 1.2. Topic

**[Mã topic – Chủ đề 3: Ứng dụng mạng]**

## 1.3. Group

| No. | Student ID | Full Name | Email | Main Responsibility | Contribution |
| --- | ---------- | --------- | ----- | ------------------- | -----------: |
| 1   | ...        | ...       | ...   | ...                 |         ...% |
| 2   | ...        | ...       | ...   | ...                 |         ...% |
| 3   | ...        | ...       | ...   | ...                 |         ...% |
|     |            |           |       | **Total**           |     **100%** |

## 1.4. Instructor

**[Tên giảng viên]**

---

# 2. Project Summary

## 2.1. Problem

Khách quét mã QR tại bàn để xem thực đơn và tự đặt món; đơn phải tới màn hình bếp (KDS) ngay lập tức và bếp cập nhật trạng thái từng món cho khách theo thời gian thực. Mọi thiết bị đều đi qua Wi-Fi của nhà hàng nên kết nối có thể đứt bất kỳ lúc nào. Ba lỗi cần giải quyết:

* **Mất đơn**: nếu chỉ đẩy WebSocket kiểu "gửi rồi quên", đơn phát ra đúng lúc máy tính bảng ở bếp mất mạng sẽ không bao giờ tới bếp.
* **Đơn trùng**: khách bấm "Đặt món" hai lần, hoặc client tự gửi lại vì không nhận được phản hồi, tạo ra hai đơn.
* **Ghi đè đồng thời**: hai đầu bếp cùng bấm trên một món, cập nhật của người này đè lên người kia.

## 2.2. Motivation

Polling thì không mất đơn nhưng chậm (độ trễ ≈ ½ chu kỳ hỏi); broadcast WebSocket thì nhanh nhưng không bảo đảm. TCP chỉ tin cậy trong phạm vi một kết nối, nên khi kết nối bị cắt và mở lại, ứng dụng phải tự bảo đảm không mất, không trùng. Đây là bài toán mạng thật, đo được bằng số liệu.

## 2.3. Objectives

Project hướng tới các mục tiêu:

1. Khách quét QR, xem thực đơn, đặt món qua REST; theo dõi trạng thái món real-time qua WebSocket/STOMP.
2. Bếp nhận đơn real-time, đổi trạng thái từng món; mọi màn hình liên quan cập nhật ngay.
3. Không mất đơn khi bếp mất kết nối (seq + ACK + RESUME/replay từ event log, publish sau commit).
4. Không trùng đơn khi client gửi lại (Idempotency-Key + băm nội dung).
5. Không lost update khi nhiều bếp thao tác (state machine + optimistic locking).
6. Chống quá tải (token bucket theo IP/bàn, giới hạn kết nối WS, backpressure, backoff + jitter).
7. So sánh định lượng với baseline trên cùng mã nguồn (thực nghiệm E1–E6).

## 2.4. Scope

### In scope

* QR theo bàn, phiên bàn, mở/đóng bàn, đổi mã QR.
* Thực đơn, giỏ hàng, ghi chú món, tồn kho giới hạn; màn hình bếp và trang quản trị.
* Giao đơn tin cậy, idempotency, đồng bộ nhiều bếp, chống quá tải, bộ thực nghiệm E1–E6.

### Out of scope

* Thanh toán trực tuyến, giao hàng, đặt bàn trước.
* Nhiều chi nhánh, triển khai cloud, nhiều máy chủ.
* Ứng dụng di động native; HTTPS/WSS (chạy trong LAN).

---

# 3. System Overview

## 3.1. System Description

Một ứng dụng web React (3 trang: khách `/t/:token`, bếp `/kitchen`, quản trị `/admin`) giao tiếp với máy chủ Spring Boot qua hai kênh: **REST/HTTP cho lệnh** (đặt món, đổi trạng thái…) và **WebSocket + STOMP 1.2 cho sự kiện** (máy chủ đẩy). Mọi thay đổi trạng thái đơn được ghi vào bảng `order_event` trong cùng giao dịch với dữ liệu; cột `seq` là số thứ tự toàn cục của sự kiện. Client bếp ACK, loại trùng theo `seq`, phát hiện khoảng trống và gửi `RESUME` để máy chủ phát bù từ nhật ký. Client STOMP do nhóm tự viết (`source/client/src/lib/stomp.js`).

## 3.2. Target Users

* Khách tại bàn (điện thoại, trình duyệt).
* Nhân viên bếp (máy tính bảng/màn hình bếp).
* Quản lý nhà hàng (quản trị bàn, mã QR, thực đơn, giám sát kết nối).

## 3.3. Main Functions

| Function | Description | Status |
| -------- | ----------- | ------ |
| Quét QR, xem thực đơn | `/t/{qrToken}` → bàn + thực đơn (cache, ETag → 304) | Done |
| Đặt món idempotent | `POST /api/orders` + `Idempotency-Key`; giữ đơn chưa gửi trong `localStorage`, retry cùng khoá | Done |
| Huỷ đơn | Chỉ khi mọi món còn `PENDING` | Done |
| Màn hình bếp real-time | 3 chế độ `POLLING` / `NAIVE_PUSH` / `RELIABLE_PUSH`; ACK, RESUME, phát bù | Done |
| Đổi trạng thái món | State machine `PENDING→ACCEPTED→COOKING→READY→SERVED`, `PENDING→CANCELLED`; khoá lạc quan theo `version` | Done |
| Khách theo dõi trạng thái | `/topic/table.{id}`; tải lại đơn khi kết nối lại | Done |
| Đăng nhập nhân viên | Token HMAC-SHA256 tự ký, mật khẩu BCrypt | Done |
| Quản trị | Bàn, QR (sinh ở frontend), thực đơn, giám sát kết nối/lag ACK, bật/tắt baseline | Done |
| Chống quá tải | Token bucket theo IP và theo bàn (429 + Retry-After), ≤ 8 kết nối WS/bàn, giới hạn buffer/frame | Done |
| Thực nghiệm E1–E6 | `source/loadtest` | Done (mới chạy bản rút gọn trên H2) |

---

# 4. System Architecture

## 4.1. Architecture Diagram

Đặt architecture diagram tại:

```text
statics/architecture.png
```

> [CẦN VẼ: `statics/architecture.png`]. Trong lúc chờ, sơ đồ dạng text:

```text
 Khách (React)        Bếp / KDS (React)         Quản trị (React)
   │REST   ▲STOMP        │REST   ▲STOMP              │REST
   ▼       │             ▼       │                   ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Spring Boot (Tomcat NIO :8080)                                 │
 │  RateLimit + Auth interceptors → REST controllers              │
 │  /ws: STOMP, StompAuthInterceptor, KitchenWsController (ACK/   │
 │       RESUME), SessionRegistry, simple broker                  │
 │  OrderService → EventStore (order_event) → EventPublisher      │
 │                                  (gửi sau commit)              │
 └───────────────────────────┬──────────────────────────────────┘
                             │ JDBC (HikariCP ≤ 20)
                             ▼
                   MySQL 8 (hoặc H2 chế độ MySQL)
```

## 4.2. Components

| Component | Responsibility |
| --------- | -------------- |
| Client – khách | Thực đơn, giỏ hàng, đặt món kèm Idempotency-Key, nhận trạng thái món của bàn |
| Client – bếp | Ảnh chụp đơn + `latestSeq`, nhận sự kiện (`kitchenFeed.js`), ACK/RESUME, đổi trạng thái kèm `version` |
| Client – quản trị | Bàn, QR, thực đơn, giám sát, cấu hình thực nghiệm |
| Server – REST | Xác thực, rate limit, validation, lỗi thống nhất `{error, message, details, timestamp}` |
| Server – WebSocket | Handshake `/ws`, STOMP 1.2, phân quyền CONNECT/SUBSCRIBE/SEND, heart-beat 10 s, backpressure |
| Service | `OrderService` (idempotency, state machine, optimistic lock, transaction), `TableService`, `MenuService`, `AuthService` |
| Event log | `EventStore` (ghi/đọc `order_event`), `EventPublisher` (phát sau commit) |
| Database | MySQL 8: bàn, phiên bàn, thực đơn, đơn, món, nhật ký sự kiện, idempotency key, nhân viên |
| Worker | Không có worker riêng; broker STOMP trong RAM và thread pool inbound/outbound channel (8–32 thread) |

## 4.3. Data Flow

1. Khách quét QR → `GET /api/public/tables/{qrToken}`, `GET /api/public/menu`; mở WebSocket, `CONNECT` với `tableToken`, `SUBSCRIBE /topic/table.{id}`.
2. `POST /api/orders` → một giao dịch ghi `idempotency_key`, `orders`, `order_item`, `order_event` → COMMIT → `201`.
3. Sau commit, máy chủ phát envelope `{type, seq, eventId, serverTime, payload}` tới `/topic/kitchen` và `/topic/table.{id}`.
4. Bếp nhận, ACK; đổi trạng thái qua `PATCH` → sự kiện `ITEM_STATUS_CHANGED` tới mọi bếp và bàn.
5. Bếp mất kết nối → kết nối lại (backoff + jitter) → `RESUME {lastSeq}` → `REPLAY_BATCH` các sự kiện bị lỡ.

---

# 5. Network Communication Design

## 5.1. Communication Model

```text
Khách / Bếp / Quản trị (trình duyệt)
        │                         │
  HTTP/1.1 REST (JSON)     WebSocket + STOMP 1.2 (ws://host:8080/ws)
        │                         │
        └──────── Spring Boot Server ────────┘
                         │
                   JDBC (HikariCP)
                         │
                       MySQL
```

## 5.2. Protocol

**Protocol:** HTTP/1.1 REST (lệnh) + WebSocket (RFC 6455) với STOMP 1.2 (sự kiện), cộng giao thức ứng dụng do nhóm thiết kế trên STOMP: envelope có `seq`, ACK, RESUME/REPLAY_BATCH.

## 5.3. Message Format

REST – đặt món:

```text
POST /api/orders
X-Table-Token: <qrToken>
Idempotency-Key: <8-64 ký tự [A-Za-z0-9_-]>

{ "items": [ { "menuItemId": 12, "quantity": 2, "note": "ít cay" } ] }

→ 201 Created  (đơn mới)
→ 200 OK + Idempotent-Replayed: true  (gửi lại, trả đơn cũ)
→ 409 IDEMPOTENCY_KEY_REUSED  (cùng khoá, khác nội dung)
```

REST – lỗi:

```text
{ "error": "VERSION_CONFLICT", "message": "...", "details": {...}, "timestamp": 1760692991123 }
```

WebSocket – sự kiện (server → client):

```text
{ "type": "ORDER_CREATED" | "ITEM_STATUS_CHANGED" | "ORDER_CANCELLED",
  "seq": 1024, "eventId": "uuid", "serverTime": 1760692991123, "payload": { ... } }
```

WebSocket – bếp → server: `/app/ack {"seq": n}`, `/app/resume {"lastSeq": n}`;
server → một phiên: `/user/queue/replay {"type":"REPLAY_BATCH","fromSeq","latestSeq","hasMore","events":[...]}`.

Chi tiết đầy đủ: [`report/report.md`](report/report.md) mục 6 và Phụ lục A–B; tóm tắt trong [`source/README.md`](source/README.md) mục 9.

## 5.4. Communication Sequence

```text
Bếp                              Server                         Khách
 │── GET /ws (Upgrade) ─────────▶│                                │
 │◀─ 101 Switching Protocols ────│                                │
 │── CONNECT (Bearer, hb 10s) ──▶│                                │
 │◀─ CONNECTED ──────────────────│                                │
 │── SUBSCRIBE /topic/kitchen ──▶│                                │
 │── SEND /app/resume {lastSeq}─▶│                                │
 │◀─ REPLAY_BATCH ───────────────│◀── POST /api/orders (key K) ───│
 │                               │ BEGIN … INSERT order_event … COMMIT
 │◀─ MESSAGE ORDER_CREATED seq=n─│─── 201 {order} ───────────────▶│
 │── SEND /app/ack {n} ─────────▶│                                │
 │  ✕ mất mạng … backoff+jitter  │                                │
 │── CONNECT … RESUME {n} ──────▶│ SELECT … WHERE seq > n         │
 │◀─ REPLAY_BATCH [n+1 …] ───────│                                │
 │── DISCONNECT / đóng TCP ─────▶│ dọn SessionRegistry            │
```

## 5.5. Error Handling

Mô tả cách hệ thống xử lý:

* **Invalid request**: Bean Validation + `@RestControllerAdvice` → `400 INVALID_REQUEST` (JSON hỏng, thiếu header/trường, Idempotency-Key sai định dạng).
* **Timeout**: client REST 5 s; query DB 3 s; chờ kết nối DB 3 s → `503` + `Retry-After`; client retry lỗi tạm thời (0/429/502/503/504) với backoff + jitter và cùng Idempotency-Key.
* **Disconnect**: heart-beat STOMP 10 s, client coi là chết sau 2 chu kỳ im lặng; tự kết nối lại (1 s → 30 s, jitter ±50%); bếp RESUME, khách tải lại đơn; server dọn phiên khi `SessionDisconnectEvent`.
* **Invalid data**: món không tồn tại/hết/không đủ tồn kho → `422 ITEM_UNAVAILABLE`; QR sai → `401`; bàn đóng → `409 TABLE_CLOSED`.
* **Invalid state / concurrency**: chuyển trạng thái sai → `409 INVALID_STATE_TRANSITION`; sai version → `409 VERSION_CONFLICT`.
* **Server error**: lỗi không lường trước → `500 INTERNAL_ERROR` (đã log), không dừng server.
* **Database error**: transaction rollback, không phát sự kiện, trả `503 SERVICE_UNAVAILABLE`.
* **Other exceptions**: frame STOMP sai → lỗi gửi riêng `/user/queue/errors`; frame > 64 KB bị từ chối; CONNECT/SUBSCRIBE/SEND sai quyền → frame `ERROR`; quá 8 kết nối/bàn → từ chối CONNECT; spam → `429 RATE_LIMITED` + `Retry-After`.

---

# 6. Technology Stack

| Category   | Technology           |
| ---------- | -------------------- |
| Language   | Java 17 (server); JavaScript ES2022 (client, load test) |
| Network    | HTTP/1.1 REST, WebSocket (RFC 6455), STOMP 1.2 (client tự viết) |
| Database   | MySQL 8.0 (chính), H2 in-memory chế độ MySQL (chạy nhanh, kiểm thử) |
| Framework  | Spring Boot 3.3.5 (web, websocket, jdbc, validation, actuator), spring-security-crypto (chỉ BCrypt); React 18.3, react-router-dom 6.26, qrcode.react 3.1, Vite 5.4; thư viện `ws` 8.18 (load test) |
| Build Tool | Maven 3.9+, npm |
| IDE        | [Điền IDE nhóm dùng, ví dụ IntelliJ IDEA / VS Code] |
| OS         | Windows 11 (phát triển); chạy được trên mọi OS có JDK 17 và Node.js 18 |

Không dùng thư viện STOMP phía client và không dùng Spring Security/JWT: STOMP client và token HMAC do nhóm tự viết.

---

# 7. Novelty and Contributions

## 7.1. Baseline

Cùng một mã nguồn, bật/tắt lúc chạy qua `PUT /api/admin/settings`:

* **Baseline A – POLLING**: bếp gọi `GET /api/kitchen/events?afterSeq=` mỗi 3 s.
* **Baseline B – NAIVE_PUSH**: bếp nhận `/topic/kitchen`, không ACK, không RESUME, không loại trùng.
* Idempotency tắt (POST tạo đơn mới mỗi lần), optimistic lock tắt (UPDATE không kiểm tra `version`), rate limit tắt.

## 7.2. Proposed Improvement

**RELIABLE_PUSH**: envelope có `seq` toàn cục từ event log; client ACK, loại trùng, phát hiện khoảng trống, RESUME sau mỗi lần kết nối lại; server phát bù theo trang (≤ 500 sự kiện/lô); sự kiện ghi cùng giao dịch và chỉ gửi sau commit. Kèm theo: Idempotency-Key + SHA-256 nội dung (an toàn cả với request đồng thời), state machine + optimistic locking, chống quá tải nhiều lớp.

## 7.3. Contributions

| No. | Contribution | Description | Evidence |
| --- | ------------ | ----------- | -------- |
| 1   | Giao thức sự kiện tin cậy trên STOMP | seq + ACK + RESUME/REPLAY_BATCH, watermark xử lý trùng/khoảng trống/lỗ seq do rollback | E2: mất 31/200 → 0/200 (H2) |
| 2   | Event log cùng giao dịch + publish sau commit | Không có "đơn ma"; gửi lỗi không làm mất sự kiện | `EventStore`, `EventPublisher` (chưa có test riêng cho rollback) |
| 3   | Đặt món idempotent | Idempotency-Key + băm nội dung, khoá chính phân xử request song song | E3: trùng 34% → 0%; test 8 request song song cùng khoá → 1 đơn |
| 4   | Đồng bộ nhiều bếp | State machine + `UPDATE … WHERE version = ?` | E4: lost update 134 → 0 |
| 5   | Push vs Polling định lượng | Đo cùng đồng hồ | E1: p50 1341,68 ms → 7,71 ms |
| 6   | Chống quá tải nhiều lớp | Token bucket tự cài đặt, giới hạn kết nối WS, backpressure, backoff + jitter | E6: spam lọt qua 45 708 → 6, CPU 14,00% → 4,38% |
| 7   | STOMP client tự viết + khung thực nghiệm | Dùng chung cho trình duyệt và load test | `stomp.js`, `source/loadtest` |

## 7.4. Baseline vs Proposed

| Aspect        | Baseline | Proposed |
| ------------- | -------- | -------- |
| Architecture  | Ghi DB rồi phát ngay, không nhật ký | Event log cùng giao dịch, phát sau commit |
| Algorithm     | Không thứ tự, không phát hiện mất; ghi đè | seq + watermark + RESUME; optimistic lock; token bucket |
| Communication | Polling 3 s hoặc push không ACK | Push + ACK + phát bù, heart-beat, backoff + jitter |
| Performance   | p50 đặt món → bếp 1341,68 ms (polling, H2) | 7,71 ms (H2) |
| Functionality | Mất đơn, đơn trùng, lost update | 0 trong các kịch bản đã đo (H2) |

---

# 8. Project Structure

```text
project/
│
├── README.md               (file này)
├── Instruction.md
├── Topics.md
├── PLAN.md, PROGRESS.md    (kế hoạch, tiến độ)
│
├── report/
│   └── report.md           (bản nháp báo cáo; bản nộp: NhomXX_QROrder_Report.docx / report.pdf)
│
├── statics/
│   ├── architecture.png    (cần vẽ)
│   ├── protocol.png        (cần vẽ)
│   └── results/            (JSON/CSV + REPORT.md của thực nghiệm)
│
└── source/
    ├── README.md           (hướng dẫn chi tiết build/run/test/thực nghiệm)
    ├── docker-compose.yml  (MySQL 8)
    ├── server/             (Spring Boot: auth, ratelimit, table, menu, order, event, ws, admin, common)
    ├── client/             (React + Vite: pages/, components/, lib/stomp.js, connection.js, kitchenFeed.js, api.js)
    └── loadtest/           (Node.js: experiment.js, run-all.js, report.js)
```

---

# 9. Requirements

## Hardware

* CPU: [Điền cấu hình máy demo/thực nghiệm]
* RAM: [Điền]
* Disk: khoảng 1 GB trống (JDK, Maven, node_modules, MySQL)

## Software

* OS: Windows / Linux / macOS
* Java: JDK 17 trở lên
* Maven/Gradle: Maven 3.9 trở lên
* Database: MySQL 8.0 (hoặc dùng H2 trong RAM, không cần cài)
* Other dependencies: Node.js 18 trở lên (đã thử với 20.18), npm; Docker (tuỳ chọn, để chạy MySQL)

---

# 10. Installation

> Hướng dẫn chi tiết từ máy trống (cài JDK, Maven, Node.js, MySQL, IDE...): [`SETUP.md`](SETUP.md).

## 10.1. Clone / Download

```bash
git clone [repository-url]
```

hoặc download source code từ Google Drive.

## 10.2. Install Dependencies

```bash
cd source/client
npm install
npm run build
```

(`npm run build` đưa giao diện vào `server/src/main/resources/static` để server phục vụ luôn.)

```bash
cd source/server
mvn package -DskipTests
```

```bash
cd source/loadtest
npm install
```

## 10.3. Database Setup

```bash
cd source
docker compose up -d
```

hoặc dùng MySQL 8 có sẵn tại `localhost:3306`. Database `qrorder` và các bảng được tạo tự động khi server khởi động (`createDatabaseIfNotExist=true`, `schema.sql`); dữ liệu mẫu do `DataSeeder` tạo.

```text
Database script:
source/server/src/main/resources/schema.sql
```

## 10.4. Configuration

* `source/server/src/main/resources/application.yml`: cổng, Tomcat, kết nối MySQL (biến môi trường `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, mặc định `root`/`root`), HikariCP, chế độ giao đơn, idempotency, optimistic lock, rate limit, tham số WebSocket. Biến `AUTH_SECRET` để đổi khoá ký token.
* `application-h2.yml`: profile `h2` dùng H2 trong RAM.
* `source/client/vite.config.js`: dev server 5173, proxy `/api`, `/ws` sang 8080.
* Bảng khoá cấu hình: [`source/README.md`](source/README.md) mục 8.

---

# 11. Running the Project

## 11.1. Start Server

```bash
cd source/server
java -jar target/qrorder-server-1.0.0.jar
```

Không có MySQL:

```bash
java -jar target/qrorder-server-1.0.0.jar --spring.profiles.active=h2
```

## 11.2. Start Client

Client được server phục vụ sẵn sau khi `npm run build`: mở `http://localhost:8080`.

| Trang | Đường dẫn | Tài khoản |
|---|---|---|
| Quản trị | `/admin` | `admin` / `admin123` |
| Màn hình bếp | `/kitchen` | `bep` / `bep123` |
| Khách | `/t/<qrToken>` (quét QR ở trang Quản trị) | – |

Chế độ phát triển (tự reload):

```bash
cd source/client
npm run dev
```

## 11.3. Start Multiple Clients

Mở nhiều tab/thiết bị: nhiều điện thoại quét QR các bàn khác nhau, nhiều tab `/kitchen`. Với điện thoại thật: máy chủ và điện thoại cùng Wi-Fi, mở `http://<IP-LAN>:8080/admin` để mã QR chứa IP LAN, mở cổng 8080 trên firewall nếu cần. Giả lập nhiều client bằng load test:

```bash
cd source/loadtest
node experiment.js e5 --levels=10,50,100 --step=10
```

## 11.4. Run Test

```bash
cd source/server
mvn test
```

Thực nghiệm (server đang chạy):

```bash
cd source/loadtest
node run-all.js
```

---

# 12. Main Features

| No. | Feature | Description | Test   |
| --- | ------- | ----------- | ------ |
| 1   | Đặt món idempotent | Cùng key → 1 đơn; 8 request song song cùng key → 1 đơn; cùng key khác nội dung → 409 | Passed (JUnit) |
| 2   | Validation & xác thực | Request sai → 400; QR sai → 401; bếp chưa đăng nhập → 401 | Passed (JUnit) |
| 3   | State machine + optimistic lock | Sai version → 409; chuyển trạng thái sai → 409 | Passed (JUnit) |
| 4   | Token bucket | Burst tới capacity rồi chặn; nạp lại theo thời gian; không vượt capacity | Passed (JUnit) |
| 5   | Cache thực đơn | ETag → 304 Not Modified | Passed (JUnit) |
| 6   | Giao đơn tin cậy khi bếp mất mạng | RESUME + phát bù | E2 (load test, H2); thử tay nút "Giả lập mất mạng 5s" |

Tổng cộng 14 test JUnit, đều qua.

---

# 13. Experimental Setup

## 13.1. Environment

Bộ sinh tải Node.js (dùng lại `stomp.js`, `connection.js`, `kitchenFeed.js` của client) và server chạy trên cùng một máy, qua `localhost`. **Số liệu hiện có đo với H2 trong RAM** (`run-all.js --quick`, 17/10/2026); chưa có số liệu MySQL. CPU server lấy từ Actuator `process.cpu.usage`. Cấu hình máy: [Điền].

## 13.2. Dataset

Thực đơn mẫu của `DataSeeder`; các bàn load test `LT001…` tạo tự động; mỗi đơn 1–3 món ngẫu nhiên, số lượng 1–2. Dữ liệu thực nghiệm được dọn trước/sau mỗi kịch bản.

## 13.3. Test Scenarios

### Scenario 1

**E1 – Push vs Polling**: 20 bàn, mỗi bàn 1 đơn/5 s trong 20 s; đo độ trễ từ lúc gửi `POST /api/orders` tới lúc bếp nhận `ORDER_CREATED`.

### Scenario 2

**E2 – Bếp mất kết nối**: 200 đơn, 10 đơn/s; cứ 10 s cắt kết nối bếp và chặn kết nối lại 3 s; NAIVE_PUSH vs RELIABLE_PUSH; đo số đơn mất.

### Scenario 3

**E3 – Gửi lặp**: 100 đơn logic; 30% "mất phản hồi" → gửi lại cùng key; 10% "bấm 2 lần" song song; idempotency tắt/bật; đo số đơn trùng trong DB.

Ngoài ra: **E4** (20 vòng × 10 client cùng PATCH một món với `version = 0`), **E5** (10/50/100 client vòng kín, mỗi mức 10 s), **E6** (30 khách thường + 50 luồng spam từ một bàn, 15 s, rate limit tắt/bật).

## 13.4. Evaluation Metrics

Các metric sử dụng:

* Response time: độ trễ đặt món → bếp nhận (p50/p95/p99); độ trễ request của khách thường;
* Throughput: đơn/s (E5);
* Error rate: tỷ lệ lỗi HTTP (E5);
* Concurrent users: số client đồng thời (E5), số client cùng cập nhật (E4);
* Resource utilization: CPU server, số request poll/s, byte bếp nhận;
* Metric đặc thù: số đơn mất, số đơn trùng, số lost update, số request bị 429, số sự kiện gửi bù.

---

# 14. Experimental Results

## 14.1. Functional Results

![Demo](statics/results/demo.png)

> [CẦN CHỤP: `statics/results/demo.png` – màn hình khách, bếp, quản trị]

## 14.2. Performance Results

Số liệu thật từ [`statics/results/REPORT.md`](statics/results/REPORT.md), **đo với H2 trong RAM**, bản rút gọn, mỗi cấu hình 1 lần.

| Scenario | Metric 1 | Metric 2 | Metric 3 |
| -------- | -------: | -------: | -------: |
| E1 RELIABLE_PUSH (20 bàn) | p50 7,71 ms | p95 11,52 ms | p99 16,01 ms |
| E1 POLLING 3 s (20 bàn) | p50 1341,68 ms | p95 2809,83 ms | p99 2953,84 ms |
| E5 – 10 client | 2536,1 đơn/s | p95 7,22 ms | lỗi 0% |
| E5 – 50 client | 3208,6 đơn/s | p95 20,87 ms | lỗi 0% |
| E5 – 100 client | 3197,0 đơn/s | p95 39,82 ms | lỗi 0% |
| Số liệu MySQL | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | |

## 14.3. Comparison

| Metric | Baseline | Proposed | Difference |
| ------ | -------: | -------: | ---------: |
| Độ trễ đặt món → bếp p50 (E1) | 1341,68 ms (POLLING) | 7,71 ms | −1333,97 ms |
| Đơn mất khi bếp mất mạng 3 s (E2) | 31/200 (15,5%) | 0/200 (0%) | −31 đơn |
| Tỷ lệ đơn trùng (E3) | 34% | 0% | −34 điểm % |
| Lost update, 20 vòng × 10 client (E4) | 134 | 0 | −134 |
| Request spam vào tới nghiệp vụ (E6) | 45 708 | 6 | −45 702 |
| CPU server TB khi bị spam (E6) | 14,00% | 4,38% | −9,62 điểm % |
| Byte bếp nhận trong E1 (20 bàn, 20 s) | 50 745 (POLLING) | 61 449 | +10 704 (push tốn hơn ở kịch bản này) |
| Các metric trên với MySQL | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | |

> **Only report measured or reproducible results. Do not fabricate experimental data.**

---

# 15. Discussion

1. **Kết quả có đạt mục tiêu không?** Trên H2, các tính chất không mất đơn, không trùng, không lost update đều đạt (0 trong các kịch bản đo); độ trễ đẩy ở mức vài mili-giây. Cần đo lại với MySQL để khẳng định.
2. **Vì sao?** Polling có độ trễ ≈ ½ chu kỳ hỏi (p50 1,34 s với chu kỳ 3 s). NAIVE_PUSH mất các đơn phát trong lúc bếp offline (≈ 3 s × 10 đơn/s ≈ 30 đơn, đo được 31); RELIABLE_PUSH phát bù đúng 31 sự kiện từ event log. Không idempotency thì mỗi request tạo một đơn; không optimistic lock thì kiểm tra và ghi không nguyên tử nên các request đọc cùng `PENDING` ghi đè nhau.
3. **Khi tăng số client/request?** Throughput bão hoà ở khoảng 3200 đơn/s từ 50 client; độ trễ tăng tuyến tính theo số client (khớp định luật Little), chưa có lỗi.
4. **Bottleneck?** Chưa xác định chắc: bộ sinh tải chạy cùng máy với server; H2 trong RAM loại bỏ chi phí I/O của DB. Với MySQL, kỳ vọng DB (ghi 4 bảng mỗi đơn) là nút thắt.
5. **Ưu điểm**: không cần broker ngoài; sự kiện và dữ liệu nhất quán nhờ cùng một giao dịch; baseline/đề xuất so sánh trên cùng mã nguồn.
6. **Hạn chế**: ở E1, push tốn nhiều byte hơn polling; ở E6, rate limit chủ yếu bảo vệ DB/CPU, tác động lên độ trễ khách thường nhỏ và không nhất quán (p99 tăng 48,07 → 55,35 ms). Phân tích đầy đủ: [`report/report.md`](report/report.md) mục 10.

---

# 16. Limitations

Các hạn chế hiện tại:

1. Số liệu mới đo trên H2 trong RAM, bản rút gọn, mỗi cấu hình một lần; chưa có MySQL, chưa đo trong mạng Wi-Fi thật (loopback, cùng máy).
2. Mất kết nối được giả lập bằng cắt TCP phía client; chưa dùng Toxiproxy; E2 chỉ có 1 lần mất kết nối.
3. Một máy chủ: simple broker, `SessionRegistry`, rate limiter đều trong RAM.
4. Event log và bảng `idempotency_key` chưa có cơ chế dọn theo thời gian.
5. Thứ tự commit có thể khác thứ tự `seq`; trường hợp hiếm có thể khiến một sự kiện bị coi là "lỗ" nếu client mất kết nối đúng lúc đó.
6. Chưa có test tự động cho phát-sau-commit khi rollback và cho luồng RESUME qua WebSocket.
7. Chưa có HTTPS/WSS; mã QR tĩnh theo bàn (chỉ đổi khi quản trị bấm); token nhân viên không thu hồi được trước hạn.

---

# 17. Future Work

Các hướng phát triển:

1. Chạy bản đầy đủ trên MySQL, lặp nhiều lần, tách bộ sinh tải sang máy khác trong LAN, chèn lỗi mạng bằng Toxiproxy/`tc netem`, đo reconnect storm.
2. Sửa triệt để vấn đề thứ tự commit vs `seq`; thêm test WebSocket và test rollback.
3. Mở rộng nhiều máy chủ (STOMP broker relay, rate limiter dùng chung), dọn event log theo TTL, topic theo trạm bếp, HTTPS/WSS, QR theo phiên.

---

# 18. Report

Báo cáo đầy đủ được đặt tại:

```text
report/report.pdf
```

Bản nháp hiện tại: [`report/report.md`](report/report.md) (chuyển sang `NhomXX_QROrder_Report.docx` để nộp Compilatio).

Báo cáo phải tuân thủ cấu trúc được quy định trong `INSTRUCTION.md`.

Báo cáo phải được kiểm tra bằng **Compilatio**.

> **Similarity ≤ 20% là yêu cầu đạt của học phần.**

---

# 19. References

Các tài liệu tham khảo được sử dụng:

1. I. Fette, A. Melnikov, "The WebSocket Protocol," RFC 6455, IETF, 2011.
2. STOMP Protocol Specification, Version 1.2 – https://stomp.github.io/stomp-specification-1.2.html
3. R. Fielding, M. Nottingham, J. Reschke, "HTTP Semantics," RFC 9110, IETF, 2022; M. Nottingham, R. Fielding, "Additional HTTP Status Codes," RFC 6585, IETF, 2012.
4. Spring Framework Reference – WebSockets/STOMP; Transaction-bound Events – https://docs.spring.io/spring-framework/reference/
5. Stripe, "Idempotent requests" – https://docs.stripe.com/api/idempotent_requests; J. Jena, S. Dalal, "The Idempotency-Key HTTP Header Field," IETF Internet-Draft (work in progress).
6. C. Richardson, "Pattern: Transactional outbox" – https://microservices.io/patterns/data/transactional-outbox.html
7. H. T. Kung, J. T. Robinson, "On optimistic methods for concurrency control," ACM TODS, 6(2), 1981.
8. A. S. Tanenbaum, D. J. Wetherall, *Computer Networks*, 5th ed., Pearson, 2011 (token bucket).
9. M. Brooker, "Exponential Backoff And Jitter," AWS Architecture Blog, 2015.
10. M. Kleppmann, *Designing Data-Intensive Applications*, O'Reilly, 2017.

Danh sách đầy đủ (23 tài liệu) và vị trí trích dẫn: [`report/report.md`](report/report.md) mục Tài liệu tham khảo.

Các tài liệu phải được trích dẫn trong nội dung báo cáo khi sử dụng.

---

# 20. Team Contribution

| Student   | Main Contribution | Percentage |
| --------- | ----------------- | ---------: |
| Student 1 | ...               |       ...% |
| Student 2 | ...               |       ...% |
| Student 3 | ...               |       ...% |
| **Total** |                   |   **100%** |

---

# 21. Demo

## Demo Environment

* Server machine: [Điền – máy laptop chạy `java -jar … `]
* Client machine(s): điện thoại của khách (quét QR), máy tính bảng/laptop làm màn hình bếp, laptop quản trị
* Network: cùng một mạng Wi-Fi LAN (mang router riêng nếu Wi-Fi trường chặn kết nối giữa thiết bị)
* Number of clients: [Điền]

## Demo Steps

### Step 1

Khởi động server; mở `http://<IP-LAN>:8080/admin`, đăng nhập `admin`/`admin123`, mở bàn và hiển thị mã QR. Mở `/kitchen` trên máy tính bảng, đăng nhập `bep`/`bep123`.

### Step 2

Điện thoại quét QR, chọn món, đặt món: đơn hiện ngay trên màn hình bếp; bếp bấm Nhận → Đang nấu → Xong, điện thoại cập nhật trạng thái real-time. Thử hai màn hình bếp cùng bấm một món: một bên nhận `409` và tự tải lại.

### Step 3

Trên màn hình bếp bấm **"Giả lập mất mạng 5s"**, trong lúc đó đặt thêm món từ điện thoại; khi bếp kết nối lại, các đơn bị lỡ được gửi bù (thanh thống kê hiện số "Gửi bù"). Ở trang quản trị đổi chế độ sang `NAIVE_PUSH` và lặp lại để thấy đơn bị mất; đổi về `RELIABLE_PUSH` sau khi demo.

---

# 22. Submission

## Source Code

Project source code được nộp thông qua **Google Drive**.

**Submission link sẽ được giảng viên thông báo sau.**

## Report

```text
report/report.pdf
```

## Required Contents

* Source code;
* README;
* Report;
* Configuration;
* Database script nếu có;
* Dataset/sample data nếu có;
* Test cases;
* Experimental results;
* Architecture diagrams.

---

# 23. Final Verification

Before submission:

```text
[ ] Project can run
[ ] Server can start
[ ] Client can connect
[ ] Network communication works
[ ] Protocol is documented
[ ] Multiple clients tested
[ ] Error handling tested
[ ] Experiments completed
[ ] Results are reproducible
[ ] Novelty is clearly stated
[ ] README is complete
[ ] Report is complete
[ ] References are included
[ ] Compilatio <= 20%
[ ] Google Drive link is accessible
[ ] All team members understand the project
```

---

# 24. Contact

For questions about:

* Topic selection;
* Architecture;
* Technical implementation;
* Project scope;
* Report structure;

contact the course instructor.
