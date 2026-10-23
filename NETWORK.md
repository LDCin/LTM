# Phần mạng của dự án QR Order

Tài liệu giải thích phần **lập trình mạng** của dự án, trình bày theo đúng các mục mà `Instruction.md` yêu cầu:
kiến trúc (3.3), giao tiếp mạng (3.4), protocol/message format (3.5), concurrency (mục 5), xử lý lỗi (mục 6). Cuối
tài liệu là các câu hỏi giảng viên hay hỏi khi bảo vệ (mục 17) kèm câu trả lời ngắn.

Chế độ giao đơn được trình bày là **RELIABLE_PUSH** (mặc định của hệ thống).

---

## Mục lục

1. [Kiến trúc hệ thống](#1-kiến-trúc-hệ-thống-instruction-33)
2. [Giao tiếp mạng](#2-giao-tiếp-mạng-instruction-34)
3. [Protocol và định dạng message](#3-protocol-và-định-dạng-message-instruction-35)
4. [Giao đơn tin cậy: vì sao TCP chưa đủ](#4-giao-đơn-tin-cậy-vì-sao-tcp-chưa-đủ)
5. [Xử lý nhiều client đồng thời](#5-xử-lý-nhiều-client-đồng-thời-instruction-mục-5)
6. [Xử lý lỗi](#6-xử-lý-lỗi-instruction-mục-6)
7. [Đường đi của gói tin khi chạy qua tunnel](#7-đường-đi-của-gói-tin-khi-chạy-qua-tunnel)
8. [Câu hỏi bảo vệ thường gặp](#8-câu-hỏi-bảo-vệ-thường-gặp-instruction-mục-17)

---

## 1. Kiến trúc hệ thống (Instruction 3.3)

### 1.1. Mô hình

Hệ thống theo mô hình **client–server**: nhiều client (trình duyệt) kết nối tới **một** server trung tâm; server là
nơi duy nhất truy cập cơ sở dữ liệu. Client không bao giờ nói chuyện trực tiếp với nhau: khách gửi đơn lên server,
server đẩy đơn xuống bếp.

```text
 ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
 │ Khách         │   │ Bếp (KDS)     │   │ Quản trị      │
 │ điện thoại    │   │ máy tính bảng │   │ laptop        │
 └──┬─────────▲──┘   └──┬────────▲───┘   └──┬────────────┘
    │ REST    │ WS      │ REST   │ WS        │ REST
    │ (lệnh)  │ (sự kiện)        │           │
 ═══╪═════════╪═════════╪════════╪═══════════╪═══════  Mạng (Wi-Fi/4G, Internet qua tunnel)
    ▼         │         ▼        │           ▼
 ┌──────────────────────────────────────────────────────┐
 │ Spring Boot server – một cổng TCP 8080                │
 │  ├─ Tầng REST: Controllers + interceptor rate limit   │
 │  ├─ Tầng WebSocket/STOMP: /ws, broker trong RAM       │
 │  ├─ Tầng nghiệp vụ: OrderService, TableService, ...   │
 │  └─ Event log + EventPublisher (phát sau commit)      │
 └──────────────────────────┬───────────────────────────┘
                            │ JDBC trên TCP 3306 (HikariCP, tối đa 20 kết nối)
                            ▼
                 ┌──────────────────────┐
                 │ MySQL 8              │
                 └──────────────────────┘
```

### 1.2. Vai trò các thành phần

| Thành phần | Vai trò mạng |
|---|---|
| Ứng dụng khách | Client HTTP (gửi lệnh) + client WebSocket (nhận trạng thái món của bàn mình) |
| Màn hình bếp | Client HTTP (đổi trạng thái món) + client WebSocket (nhận đơn, gửi ACK, RESUME) |
| Quản trị | Client HTTP (quản lý bàn, thực đơn, xem giám sát) |
| Tầng REST | Nhận request, kiểm tra, trả response có mã trạng thái |
| Tầng WebSocket | Giữ kết nối lâu dài với từng client, đẩy sự kiện, kiểm tra quyền từng frame |
| Broker STOMP | Bộ định tuyến message trong RAM: một message gửi tới `/topic/kitchen` được chuyển tới mọi client đã đăng ký đích đó |
| Event log (`order_event`) | Lưu mọi sự kiện với số thứ tự `seq`, dùng để gửi bù cho client bị lỡ |
| MySQL | Lưu trữ bền vững |

### 1.3. Nguyên tắc thiết kế: tách **lệnh** và **sự kiện**

| | Lệnh (command) | Sự kiện (event) |
|---|---|---|
| Ví dụ | Đặt món, đổi trạng thái, huỷ đơn | "Có đơn mới", "Món đã sẵn sàng" |
| Chiều | Client → Server | Server → Client |
| Kênh | **REST/HTTP** | **WebSocket/STOMP** |
| Lý do | Cần phản hồi rõ ràng thành công/thất bại (201, 409, 422...), dễ thử lại an toàn | Server chủ động báo ngay khi có thay đổi, không phải đợi client hỏi |

---

## 2. Giao tiếp mạng (Instruction 3.4)

### 2.1. Ai giao tiếp với ai, bằng giao thức gì

| Từ → Đến | Giao thức (từ trên xuống) | Cổng | Mục đích |
|---|---|---|---|
| Khách → Server | HTTP/1.1 → TCP → IP | 8080 | Lấy thông tin bàn, thực đơn; đặt/huỷ món |
| Server → Khách | STOMP 1.2 → WebSocket → TCP → IP | 8080 | Trạng thái món, thực đơn đổi, bàn bị đóng |
| Bếp → Server | HTTP/1.1 → TCP | 8080 | Đăng nhập, lấy ảnh chụp đơn, đổi trạng thái |
| Bếp ↔ Server | STOMP 1.2 → WebSocket → TCP | 8080 | Nhận đơn; gửi ACK, RESUME |
| Server → MySQL | Giao thức MySQL (JDBC) → TCP | 3306 | Đọc/ghi dữ liệu |

Điểm cần nhớ: **HTTP và WebSocket dùng chung cổng 8080**. WebSocket bắt đầu bằng một HTTP request rồi "nâng cấp" kết
nối TCP đó, nên chỉ cần mở một cổng (và chỉ cần một tunnel).

Ngăn xếp giao thức của kênh sự kiện:

```text
┌──────────────────────────────────────────────┐
│ Giao thức của nhóm: envelope {type, seq, ...}│  ← seq, ACK, RESUME, REPLAY_BATCH
├──────────────────────────────────────────────┤
│ STOMP 1.2: CONNECT, SUBSCRIBE, SEND, MESSAGE │  ← định tuyến theo "destination"
├──────────────────────────────────────────────┤
│ WebSocket (RFC 6455): frame văn bản          │  ← kênh hai chiều trên 1 kết nối
├──────────────────────────────────────────────┤
│ TCP: tin cậy, đúng thứ tự trong 1 kết nối    │
├──────────────────────────────────────────────┤
│ IP                                           │
└──────────────────────────────────────────────┘
```

### 2.2. Thiết lập kết nối

**Kết nối HTTP (REST):**

1. Trình duyệt mở kết nối TCP tới `server:8080` (bắt tay 3 bước SYN → SYN-ACK → ACK).
2. Gửi request, nhận response. HTTP/1.1 giữ kết nối mở (keep-alive) để dùng lại cho request sau.
3. Mỗi request mang thông tin xác thực trong header: khách gửi `X-Table-Token: <mã QR>`, nhân viên gửi
   `Authorization: Bearer <token>`. Server **không lưu phiên** (stateless): mỗi request tự chứng minh mình là ai.

**Kết nối WebSocket + STOMP:**

```text
Client                                                    Server
  │── TCP: SYN / SYN-ACK / ACK ─────────────────────────────▶│
  │── GET /ws HTTP/1.1                                       │
  │   Upgrade: websocket                                     │
  │   Connection: Upgrade                                    │
  │   Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==            │
  │   Sec-WebSocket-Version: 13 ────────────────────────────▶│
  │◀─ HTTP/1.1 101 Switching Protocols                       │
  │   Upgrade: websocket                                     │
  │   Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo= ────│
  │        (từ đây, kết nối TCP này chở frame WebSocket)     │
  │── STOMP CONNECT                                          │
  │   accept-version:1.2                                     │
  │   heart-beat:10000,10000                                 │
  │   Authorization:Bearer <token>   (hoặc tableToken:<QR>) ▶│ kiểm tra quyền
  │◀─ STOMP CONNECTED (heart-beat:10000,10000) ──────────────│
  │── SUBSCRIBE destination:/topic/kitchen ─────────────────▶│ kiểm tra được phép nghe không
  │── SUBSCRIBE destination:/user/queue/replay ─────────────▶│
  │── SEND /app/resume {"lastSeq": 41} ─────────────────────▶│
  │◀─ MESSAGE /user/queue/replay {REPLAY_BATCH ...} ─────────│
```

Bước 101 là bắt tay WebSocket theo RFC 6455: server lấy `Sec-WebSocket-Key`, ghép với một chuỗi cố định rồi băm SHA-1
để tạo `Sec-WebSocket-Accept`, chứng minh nó thực sự hiểu WebSocket. Phần này do Tomcat làm; phần STOMP phía client
do nhóm tự viết (`source/client/src/lib/stomp.js`).

Nếu mở kết nối WebSocket mà **10 giây** không gửi `CONNECT`, server tự đóng kết nối (chống giữ chỗ vô ích).

### 2.3. Luồng request/response và message

**Luồng đặt món (luồng chính):**

```text
Khách                    Server                        MySQL               Bếp
  │ POST /api/orders       │                              │                  │
  │ Idempotency-Key: K     │                              │                  │
  │───────────────────────▶│ kiểm tra rate limit, mã QR   │                  │
  │                        │ BEGIN                        │                  │
  │                        │── INSERT idempotency_key(K) ▶│                  │
  │                        │── INSERT orders, order_item ▶│                  │
  │                        │── INSERT order_event → seq=42▶│                 │
  │                        │ COMMIT                       │                  │
  │◀── 201 Created {đơn} ──│                              │                  │
  │                        │── MESSAGE ORDER_CREATED seq=42 ────────────────▶│
  │◀── MESSAGE (bàn mình) ─│                              │                  │
  │                        │◀──────────────────────────── SEND /app/ack {42} │
```

**Luồng bếp đổi trạng thái:**

```text
Bếp                          Server                         Khách
  │ PATCH /api/kitchen/order-items/58/status                 │
  │ {"status":"COOKING","version":1}                          │
  │─────────────────────────────▶│ kiểm tra chuyển trạng thái │
  │                              │ UPDATE ... WHERE version=1 │
  │◀── 200 {"version": 2} ───────│                            │
  │◀═ ITEM_STATUS_CHANGED ═══════│═══ ITEM_STATUS_CHANGED ═══▶│
```

**Sự kiện chỉ được gửi sau khi giao dịch commit.** Nếu giao dịch thất bại (món hết, lỗi DB) thì rollback và không có
sự kiện nào được gửi, nên bếp không bao giờ thấy một "đơn ma" không tồn tại trong DB.

### 2.4. Duy trì kết nối: heart-beat

Một kết nối TCP có thể "chết lặng": điện thoại mất sóng, rút dây mạng… mà không gửi được gói đóng kết nối (FIN). Khi
đó hai bên vẫn tưởng kết nối còn sống. Để phát hiện, STOMP dùng **heart-beat**:

* Khi `CONNECT`, client đề nghị `heart-beat:10000,10000` (gửi mỗi 10 s, muốn nhận mỗi 10 s); server trả lại giá trị
  của nó trong `CONNECTED`. Chu kỳ thực tế mỗi chiều là giá trị lớn hơn trong hai bên.
* Mỗi chu kỳ, bên nào không có gì để gửi thì gửi một ký tự xuống dòng `\n`.
* Client coi kết nối đã chết nếu **quá 2 chu kỳ (khoảng 20 s) không nhận được gì**, rồi tự đóng và kết nối lại.

### 2.5. Đóng kết nối

| Cách đóng | Diễn biến |
|---|---|
| Chủ động (client rời trang, đăng xuất) | Client gửi `DISCONNECT` → đóng WebSocket (close frame) → đóng TCP (FIN) |
| Bất thường (mất mạng, tắt trình duyệt) | TCP bị cắt, hoặc heart-beat hết hạn |
| Server từ chối | Server gửi frame `ERROR` rồi đóng (sai token, sai quyền, quá 8 kết nối/bàn, frame quá 64 KB) |

Trong mọi trường hợp, server nhận sự kiện `SessionDisconnectEvent` và **dọn phiên** khỏi `SessionRegistry` (giảm bộ
đếm kết nối của bàn). Đơn hàng không mất vì đã nằm trong DB và event log.

### 2.6. Kết nối lại: exponential backoff + jitter

Khi mất kết nối, client không thử lại liên tục mà chờ ngày càng lâu:

```text
lần thử n: chờ = min(30 s, 1 s × 2^n) × (hệ số ngẫu nhiên từ 0,5 đến 1,5)
           → khoảng 1 s, 2 s, 4 s, 8 s, 16 s, 30 s, 30 s, ...
```

* **Exponential**: tránh dội request vào server đang có sự cố.
* **Jitter (ngẫu nhiên)**: khi Wi-Fi cả quán có lại, hàng chục điện thoại không kết nối lại cùng một giây
  ("reconnect storm").

Sau khi kết nối lại: bếp gửi `RESUME` để nhận bù sự kiện bị lỡ; khách tải lại danh sách đơn qua REST.

---

## 3. Protocol và định dạng message (Instruction 3.5)

### 3.1. REST: định dạng JSON

**Request đặt món:**

```http
POST /api/orders HTTP/1.1
Content-Type: application/json
X-Table-Token: 9KfP2x...
Idempotency-Key: 3f9c0a1e5b7d4c2a8e6f1b0d9c7a5e3f

{"items":[{"menuItemId":12,"quantity":2,"note":"ít cay"},{"menuItemId":7,"quantity":1}]}
```

**Response:**

* `201 Created`: đơn mới được tạo.
* `200 OK` + header `Idempotent-Replayed: true`: request này là gửi lại, server trả đơn đã tạo trước đó.

**Lỗi luôn cùng một dạng:**

```json
{ "error": "VERSION_CONFLICT",
  "message": "Món vừa được người khác cập nhật, vui lòng tải lại",
  "details": { "currentVersion": 2, "currentStatus": "COOKING" },
  "timestamp": 1760692991123 }
```

| HTTP | `error` | Khi nào |
|---|---|---|
| 400 | `INVALID_REQUEST` | Thiếu trường, số lượng sai, JSON hỏng |
| 401 | `UNAUTHORIZED` / `INVALID_TABLE_TOKEN` | Chưa đăng nhập / mã QR sai |
| 403 | `FORBIDDEN` | Tài khoản bếp gọi API quản trị |
| 404 | `NOT_FOUND` | Không tìm thấy món/đơn |
| 409 | `TABLE_CLOSED`, `INVALID_STATE_TRANSITION`, `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED` | Xung đột trạng thái |
| 422 | `ITEM_UNAVAILABLE` | Món hết / không đủ số lượng |
| 429 | `RATE_LIMITED` | Gửi quá nhanh (kèm `Retry-After`) |
| 503 | `SERVICE_UNAVAILABLE` | DB lỗi tạm thời (kèm `Retry-After`) |

Danh sách endpoint chính:

| Method | Endpoint | Ai dùng |
|---|---|---|
| GET | `/api/public/tables/{qrToken}` | Khách: mã QR → bàn |
| GET | `/api/public/menu` | Khách: thực đơn (có `ETag` → `304 Not Modified`) |
| POST | `/api/orders` | Khách: đặt món |
| GET | `/api/orders` | Khách: đơn của bàn |
| POST | `/api/orders/{id}/cancel` | Khách: huỷ đơn |
| POST | `/api/auth/login` | Nhân viên: đăng nhập → token |
| GET | `/api/kitchen/orders` | Bếp: ảnh chụp đơn đang mở + `latestSeq` |
| PATCH | `/api/kitchen/order-items/{id}/status` | Bếp: đổi trạng thái `{status, version}` |

### 3.2. STOMP: định dạng frame

STOMP là giao thức **văn bản**. Mỗi frame có dạng:

```text
COMMAND
header1:value1
header2:value2

BODY^@
```

(dòng lệnh, các dòng header, một dòng trống, phần thân, rồi ký tự NUL `^@` kết thúc frame.)

Ví dụ một sự kiện server gửi xuống bếp:

```text
MESSAGE
destination:/topic/kitchen
content-type:application/json
subscription:sub-1
message-id:7

{"type":"ORDER_CREATED","seq":42,"eventId":"b3d1...","serverTime":1760692991123,"payload":{"id":17,"tableCode":"B05","items":[...]}}^@
```

Client tự viết cắt dữ liệu nhận được theo ký tự NUL, nên xử lý đúng cả khi một message WebSocket chứa nhiều frame hoặc
một frame bị chia làm hai lần nhận.

### 3.3. Các "đích" (destination)

| Hướng | Đích | Nội dung | Ai được dùng |
|---|---|---|---|
| Server → bếp | `/topic/kitchen` | `ORDER_CREATED`, `ITEM_STATUS_CHANGED`, `ORDER_CANCELLED` | Chỉ nhân viên |
| Server → khách | `/topic/table.{id}` | Sự kiện của riêng bàn đó, `TABLE_CLOSED` | Khách của bàn đó, nhân viên |
| Server → tất cả | `/topic/menu` | `MENU_UPDATED` | Tất cả |
| Bếp → server | `/app/ack` | `{"seq": 42}` | Chỉ nhân viên |
| Bếp → server | `/app/resume` | `{"lastSeq": 41}` | Chỉ nhân viên |
| Server → một phiên | `/user/queue/replay` | `{"type":"REPLAY_BATCH","latestSeq":44,"hasMore":false,"events":[...]}` | Phiên đã gửi RESUME |
| Server → một phiên | `/user/queue/errors` | Lỗi khi xử lý frame của phiên đó | Phiên gây lỗi |

Phân quyền được kiểm tra ở **từng frame** `SUBSCRIBE`/`SEND`: khách thử nghe `/topic/kitchen` hay topic của bàn khác
sẽ bị trả `ERROR FORBIDDEN`.

### 3.4. Envelope sự kiện (giao thức của nhóm)

```json
{ "type": "ORDER_CREATED", "seq": 1024, "eventId": "uuid", "serverTime": 1760692991123, "payload": { ... } }
```

| Trường | Ý nghĩa |
|---|---|
| `type` | Loại sự kiện |
| `seq` | **Số thứ tự toàn cục**, do cột AUTO_INCREMENT của bảng `order_event` cấp, tăng dần |
| `eventId` | Mã duy nhất của sự kiện (UUID) |
| `serverTime` | Thời điểm server tạo sự kiện (ms) |
| `payload` | Dữ liệu (đơn, món đổi trạng thái...) |

---

## 4. Giao đơn tin cậy: vì sao TCP chưa đủ

### 4.1. Vấn đề

TCP bảo đảm dữ liệu tới đủ và đúng thứ tự, nhưng **chỉ trong một kết nối**. Khi máy tính bảng ở bếp mất Wi-Fi:

```text
Bếp      ✕ mất mạng 8 giây      Server
                                  ├─ đơn seq=42 phát ra → kết nối đã chết, mất
                                  ├─ đơn seq=43 phát ra → mất
  kết nối lại (kết nối TCP MỚI)   │
                                  ├─ đơn seq=44 → tới nơi
```

Đơn 42, 43 đã được gửi vào kết nối cũ; TCP không gửi lại chúng vào kết nối mới. Nếu chỉ "đẩy rồi quên", bếp mất 2 đơn
mà không hề biết. Vì vậy ứng dụng phải tự bảo đảm tính tin cậy ở hai đầu.

### 4.2. Giải pháp: seq + ACK + RESUME

```text
Bếp                               Server
  │◀── MESSAGE seq=41 ──────────────│
  │─── ACK 41 ─────────────────────▶│   (server ghi nhận bếp đã nhận tới 41)
  │  ✕ mất mạng                      │── seq 42, 43, 44 phát ra, không tới bếp
  │  ... chờ backoff ...             │
  │─── CONNECT ────────────────────▶│
  │─── RESUME {lastSeq: 41} ───────▶│   SELECT * FROM order_event WHERE seq > 41
  │◀── REPLAY_BATCH [42, 43, 44] ───│
  │─── ACK 42, 43, 44 ─────────────▶│
```

Phía client bếp (`kitchenFeed.js`) nhớ:

* **Tập các `seq` đã nhận** → nhận lại một `seq` đã có thì bỏ qua (**chống trùng**, vì một sự kiện có thể tới cả qua
  đường đẩy trực tiếp lẫn qua gửi bù).
* **watermark** = `seq` lớn nhất mà mọi số nhỏ hơn đều đã nhận. Nếu đang ở 50 mà nhận 52 (thiếu 51), chờ 0,8 s; vẫn
  thiếu thì tự gửi `RESUME` (**phát hiện khoảng trống**).

Phía server: event log nằm trong MySQL nên server **không phải giữ hàng đợi riêng cho từng client**; client nói "tôi
có tới số mấy", server đọc log và gửi phần còn thiếu, tối đa 500 sự kiện mỗi lô.

### 4.3. Không trùng đơn khi khách gửi lại: Idempotency-Key

Khách bấm "Đặt món", đơn đã tới server và được tạo, nhưng **phản hồi bị mất trên đường về** (mất sóng). Khách không
biết đơn đã tạo chưa nên gửi lại. Nếu không xử lý, bếp sẽ có 2 đơn.

* Mỗi lần bấm đặt, client sinh một khoá ngẫu nhiên 128 bit (`Idempotency-Key`) và **dùng lại đúng khoá đó** cho mọi lần
  gửi lại; khoá được lưu trong `localStorage` cùng đơn chưa gửi được.
* Server lưu khoá trong bảng `idempotency_key` (khoá chính). Lần gửi sau có cùng khoá → trả lại đơn cũ (`200`,
  `Idempotent-Replayed: true`), không tạo đơn mới.
* Hai request cùng khoá tới **cùng lúc** (bấm 2 lần thật nhanh): ràng buộc khoá chính của MySQL chỉ cho một bên chèn
  được; bên kia đọc lại đơn của bên thắng.

---

## 5. Xử lý nhiều client đồng thời (Instruction mục 5)

### 5.1. Mô hình luồng (thread) của server

| Nơi | Cơ chế |
|---|---|
| Nhận kết nối TCP | Tomcat dùng **NIO**: một số ít thread theo dõi hàng nghìn kết nối; kết nối đang rảnh (kể cả WebSocket) **không chiếm thread**. Tối đa 2000 kết nối, hàng đợi chờ 100 |
| Xử lý request REST | **Thread pool** của Tomcat, tối đa 200 thread; mỗi request chạy trên một thread, trong một giao dịch DB riêng |
| Frame STOMP từ client lên | `clientInboundChannel`: pool 8–32 thread, hàng đợi 10 000 |
| Frame STOMP từ server xuống | `clientOutboundChannel`: pool 8–32 thread; bật "giữ thứ tự" để mỗi client nhận message đúng thứ tự phát |
| Heart-beat | 2 thread lập lịch riêng |
| Kết nối DB | Pool HikariCP tối đa 20 kết nối; chờ quá 3 s thì báo lỗi 503 thay vì treo |

### 5.2. Dữ liệu dùng chung và cách bảo vệ

| Dữ liệu dùng chung | Vấn đề | Cách xử lý |
|---|---|---|
| Danh sách phiên WebSocket (`SessionRegistry`) | Nhiều kết nối đến/đi cùng lúc | `ConcurrentHashMap` |
| Số kết nối của mỗi bàn | Hai kết nối cùng lúc có thể cùng vượt giới hạn 8 | `AtomicInteger` + `compareAndSet` (không cần khoá) |
| Token bucket của rate limit | Nhiều thread cùng trừ token | `computeIfAbsent` nguyên tử + `synchronized` trong bucket |
| Trạng thái một món | Hai đầu bếp cùng bấm → ghi đè nhau (lost update) | **Optimistic locking**: `UPDATE ... WHERE version = ?`, người thứ hai nhận 409 |
| Số suất còn lại | Nhiều bàn tranh suất cuối | `UPDATE ... SET stock = stock - ? WHERE stock >= ?` (nguyên tử trong DB) |
| Idempotency-Key | Hai request cùng khoá cùng lúc | Ràng buộc khoá chính của DB |
| Thứ tự sự kiện | Nhiều giao dịch song song | `seq` do DB cấp tăng dần |

### 5.3. Chống quá tải

| Lớp | Cơ chế |
|---|---|
| Theo IP | Token bucket: tối đa 60 request dồn, hồi 20 request/s → vượt thì `429` + `Retry-After` |
| Theo bàn | Đặt món tối đa 5 đơn liên tiếp, hồi 5 đơn/phút |
| WebSocket | Tối đa 8 kết nối mỗi bàn; frame tối đa 64 KB |
| Client nhận chậm | Gửi quá 10 s hoặc bộ đệm quá 512 KB → ngắt client đó, không làm nghẽn client khác |
| Phía client | Backoff + jitter khi kết nối lại; thử lại REST theo `Retry-After` |

Rate limit chạy **trước** controller nên request bị từ chối không chạm tới DB, chi phí rất thấp.

---

## 6. Xử lý lỗi (Instruction mục 6)

| Tình huống | Hệ thống xử lý |
|---|---|
| **Invalid request** | Kiểm tra dữ liệu → `400` JSON, không làm dừng server |
| **Invalid data** | Món không tồn tại/hết → `422`; mã QR sai → `401` |
| **Connection failure** | Client hiện trạng thái "Mất kết nối", tự kết nối lại bằng backoff + jitter |
| **Client disconnect** | Heart-beat phát hiện; server dọn phiên; bếp kết nối lại thì RESUME nhận bù |
| **Server unavailable** | Khách giữ đơn chưa gửi trong `localStorage`, bấm "Gửi lại" khi server có lại, cùng Idempotency-Key nên không trùng |
| **Timeout** | Request REST hết hạn sau 5 s; truy vấn DB tối đa 3 s; WebSocket không gửi CONNECT trong 10 s bị đóng |
| **Duplicate request** | Idempotency-Key |
| **Invalid state** | Máy trạng thái món → `409 INVALID_STATE_TRANSITION`; sai version → `409 VERSION_CONFLICT` |
| **Database error** | Giao dịch rollback, không gửi sự kiện, trả `503` |
| **Unexpected input** | Frame STOMP hỏng → báo lỗi riêng cho phiên đó qua `/user/queue/errors`; frame quá cỡ bị từ chối; sai quyền → frame `ERROR` |

Máy trạng thái của một món:

```text
PENDING ──▶ ACCEPTED ──▶ COOKING ──▶ READY ──▶ SERVED
   │
   └──▶ CANCELLED   (chỉ khi còn PENDING)
```

---

## 7. Đường đi của gói tin khi chạy qua tunnel

Khi demo, server chạy trên laptop và được mở ra Internet bằng Cloudflare Tunnel (hoặc ngrok):

```text
Điện thoại (4G)
   │ HTTPS / WSS (mã hoá TLS)
   ▼
Máy chủ Cloudflare (địa chỉ https://xxx.trycloudflare.com)
   │ kết nối do cloudflared trên laptop mở sẵn TỪ TRONG RA
   ▼
cloudflared trên laptop
   │ HTTP / WS thường
   ▼
Spring Boot localhost:8080
```

* **Không cần IP tĩnh, không cần mở port router**: `cloudflared` chủ động kết nối ra ngoài, giống như trình duyệt mở
  một trang web, nên vượt được NAT/firewall.
* Trang được mở bằng `https://` nên client tự dùng `wss://` cho WebSocket; đoạn từ điện thoại tới Cloudflare được mã
  hoá, đoạn từ `cloudflared` tới server chỉ chạy bên trong laptop.
* Hệ quả: server thấy **mọi request đều đến từ `127.0.0.1`** (từ `cloudflared`), nên giới hạn theo IP bị tính chung
  cho mọi người dùng. IP thật nằm trong header `X-Forwarded-For` do tunnel thêm vào.

---

## 8. Câu hỏi bảo vệ thường gặp (Instruction mục 17)

**Client và server giao tiếp thế nào?**
Hai kênh trên cùng cổng 8080: REST/HTTP cho lệnh (client gửi, server trả kết quả), WebSocket + STOMP cho sự kiện
(server chủ động đẩy). Lệnh cần phản hồi rõ ràng để thử lại an toàn; sự kiện cần tới ngay mà không phải hỏi liên tục.

**Protocol là gì?**
Ba lớp chồng lên nhau trên TCP: WebSocket (kênh hai chiều), STOMP 1.2 (frame văn bản, định tuyến theo destination,
heart-beat), và giao thức của nhóm (envelope có `seq`, ACK, RESUME/REPLAY_BATCH). REST dùng JSON với một định dạng lỗi
thống nhất.

**STOMP là gì, sao không dùng WebSocket thuần?**
WebSocket chỉ cho một đường truyền message, không quy định message nghĩa là gì hay gửi tới ai. STOMP thêm khái niệm
destination để đăng ký/gửi theo chủ đề (`/topic/kitchen`, `/topic/table.5`), có heart-beat và frame lỗi chuẩn, và
Spring hỗ trợ sẵn broker cho nó.

**Kết nối WebSocket được thiết lập thế nào?**
TCP 3 bước → HTTP `GET /ws` có `Upgrade: websocket` → server trả `101 Switching Protocols` → client gửi STOMP
`CONNECT` kèm token và đề nghị heart-beat → server kiểm tra rồi trả `CONNECTED` → client `SUBSCRIBE`.

**Đóng kết nối thế nào? Làm sao biết client đã mất?**
Đóng chủ động bằng `DISCONNECT` + close frame. Mất bất thường được phát hiện nhờ heart-beat: quá 2 chu kỳ không nhận
gì thì coi là chết. Server dọn phiên khi nhận `SessionDisconnectEvent`.

**Bếp mất mạng thì đơn có mất không?**
Không. Mọi sự kiện được lưu trong bảng `order_event` với `seq` tăng dần. Khi kết nối lại, bếp gửi `RESUME {lastSeq}`,
server đọc log và gửi bù mọi sự kiện có `seq` lớn hơn. Bếp chống trùng bằng tập `seq` đã nhận.

**Khách bấm đặt 2 lần hoặc mất phản hồi thì sao?**
Mỗi lần đặt có một `Idempotency-Key`; gửi lại cùng khoá thì server trả lại đơn cũ. Hai request cùng khoá tới cùng lúc
thì ràng buộc khoá chính của DB chỉ cho một cái tạo đơn.

**Xử lý nhiều client thế nào?**
Tomcat NIO giữ hàng nghìn kết nối mà kết nối rảnh không tốn thread; request chạy trên thread pool; WebSocket có pool
riêng cho chiều vào và chiều ra. Dữ liệu dùng chung trong RAM dùng `ConcurrentHashMap`/`AtomicInteger`; dữ liệu trong
DB dùng optimistic locking, câu `UPDATE` có điều kiện và ràng buộc khoá chính.

**Hai đầu bếp cùng bấm một món thì sao?**
Mỗi món có cột `version`. Request gửi kèm version đã thấy; server chạy `UPDATE ... WHERE version = ?`. Người đến trước
làm version tăng lên; người đến sau không khớp version nên nhận `409 VERSION_CONFLICT` và giao diện tự tải lại.

**Vì sao gửi sự kiện sau khi commit?**
Nếu gửi trước rồi giao dịch rollback (ví dụ món hết), bếp sẽ thấy một đơn không tồn tại. Gửi sau commit bảo đảm mọi sự
kiện bếp nhận đều ứng với dữ liệu thật trong DB.

**Server có bị sập khi client gửi dữ liệu rác không?**
Không. REST trả `400` JSON; frame STOMP hỏng chỉ làm phiên đó nhận báo lỗi; frame quá 64 KB hoặc sai quyền thì phiên đó
bị đóng; các client khác và server vẫn chạy (bộ test e2e có ca kiểm tra server còn sống sau loạt request lỗi).

---

Chi tiết hơn: [`report/report.md`](report/report.md) mục 4–7; code chính: `source/server/.../ws/`, `event/`,
`order/OrderService.java`, `ratelimit/`, và `source/client/src/lib/` (`stomp.js`, `connection.js`, `kitchenFeed.js`,
`api.js`).
