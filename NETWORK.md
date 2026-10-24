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
   (4.4: [Xác nhận thanh toán qua mạng](#44-xác-nhận-thanh-toán-qua-mạng-tiền-mặt-và-vnpay))
5. [Xử lý nhiều client đồng thời](#5-xử-lý-nhiều-client-đồng-thời-instruction-mục-5)
6. [Xử lý lỗi](#6-xử-lý-lỗi-instruction-mục-6)
7. [Đường đi của gói tin khi chạy qua tunnel](#7-đường-đi-của-gói-tin-khi-chạy-qua-tunnel)
8. [Câu hỏi bảo vệ thường gặp](#8-câu-hỏi-bảo-vệ-thường-gặp-instruction-mục-17)

---

## 1. Kiến trúc hệ thống (Instruction 3.3)

### 1.1. Mô hình

Hệ thống theo mô hình **client–server**: nhiều client (trình duyệt) kết nối tới **một** server trung tâm; server là
nơi duy nhất truy cập cơ sở dữ liệu. Client không bao giờ nói chuyện trực tiếp với nhau: khách gửi đơn lên server,
server đẩy đơn xuống bếp. Ngoại lệ duy nhất là **cổng thanh toán VNPay**: một server bên ngoài, nói chuyện với server
của nhóm theo kiểu server-to-server (mục 4.4).

```text
 ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
 │ Khách       │  │ Bếp (KDS)   │  │ Thu ngân    │  │ Quản trị    │
 │ điện thoại  │  │ máy t.bảng  │  │ máy quầy    │  │ laptop      │
 └─┬───────▲───┘  └─┬───────▲───┘  └─┬───────▲───┘  └─┬───────────┘
   │ REST  │ WS     │ REST  │ WS     │ REST  │ WS     │ REST
   │(lệnh) │(sự kiện)       │        │       │        │
 ══╪═══════╪════════╪═══════╪════════╪═══════╪════════╪════  Mạng (Wi-Fi/4G, Internet qua tunnel)
   ▼       │        ▼       │        ▼       │        ▼
 ┌──────────────────────────────────────────────────────┐       ┌──────────────────┐
 │ Spring Boot server – một cổng TCP 8080                │◀─IPN──│ VNPay sandbox    │
 │  ├─ Tầng REST: Controllers + interceptor rate limit   │       │ (cổng thanh toán)│
 │  ├─ Tầng WebSocket/STOMP: /ws, broker trong RAM       │─HTTPS▶│ API querydr      │
 │  ├─ Tầng nghiệp vụ: OrderService, TableService,       │       └──────────────────┘
 │  │   PaymentService, CashierService                   │
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
| Ứng dụng khách | Client HTTP (vào bàn, đặt/huỷ món, thanh toán) + client WebSocket (nhận **đơn chung** của bàn, trạng thái thanh toán, trả bàn) |
| Màn hình bếp | Client HTTP (đổi trạng thái món) + client WebSocket (nhận đơn, gửi ACK, RESUME) |
| Thu ngân | Client HTTP (sơ đồ bàn, xác nhận tiền mặt, trả bàn) + client WebSocket (nghe `/topic/cashier`) |
| Quản trị | Client HTTP (quản lý bàn, thực đơn, lịch sử thanh toán, xem giám sát) |
| VNPay sandbox | Server bên ngoài: gọi **IPN** vào server của nhóm khi có kết quả; trả lời API tra cứu `querydr` |
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
| Khách → Server | HTTP/1.1 → TCP → IP | 8080 | Vào bàn, lấy thực đơn; đặt/huỷ món; tạo/huỷ thanh toán |
| Server → Khách | STOMP 1.2 → WebSocket → TCP → IP | 8080 | Đơn chung của bàn, trạng thái món, thanh toán, trả bàn, thực đơn đổi, bàn ngừng phục vụ |
| Bếp → Server | HTTP/1.1 → TCP | 8080 | Đăng nhập, lấy ảnh chụp đơn, đổi trạng thái |
| Bếp ↔ Server | STOMP 1.2 → WebSocket → TCP | 8080 | Nhận đơn; gửi ACK, RESUME |
| Thu ngân → Server | HTTP/1.1 → TCP | 8080 | Sơ đồ bàn, "Đã nhận tiền", "Trả bàn" |
| Server → Thu ngân | STOMP 1.2 → WebSocket → TCP | 8080 | `TABLE_STATE_CHANGED`, `PAYMENT_UPDATED` |
| VNPay → Server | HTTPS (qua tunnel) | 443 → 8080 | IPN: báo kết quả giao dịch, có chữ ký |
| Server → VNPay | HTTPS | 443 | Tra cứu giao dịch (`querydr`) |
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
   `Authorization: Bearer <token>`. Server **không lưu phiên đăng nhập** (stateless): mỗi request tự chứng minh mình
   là ai. Khách gửi thêm hai header:
   * `X-Device-Id`: mã ngẫu nhiên trình duyệt tự sinh (lưu `localStorage`). Server chỉ dùng nó để biết **máy nào đặt
     đơn nào** (máy đó mới được huỷ đơn, thấy nhãn "BẠN ĐẶT"); mã này **không bao giờ được trả ra** cho máy khác.
   * `X-Session-Id`: mã **phiên bàn** (lượt khách) mà máy nhận được khi vào bàn. Nếu phiên đó đã kết thúc (thu ngân đã
     "Trả bàn") thì server trả `409 SESSION_ENDED`, nên máy của lượt cũ không đặt nhầm vào lượt của khách sau.

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

**Luồng vào bàn (phiên bàn tự mở):**

Khách không cần nhân viên "mở bàn". Lần đầu mở link QR, trình duyệt gọi `POST /api/public/tables/{qrToken}/join`
(dùng `POST` vì request này có thể **tạo** phiên, mà `GET` không được có tác dụng phụ):

```text
Điện thoại A, B quét cùng lúc     Server                                       MySQL
  │ POST /join ────────────────▶│ bàn ngừng phục vụ → 409 TABLE_CLOSED           │
  │                             │ bàn đã có phiên  → vào phiên đó                │
  │                             │ bàn trống:                                     │
  │                             │  BEGIN                                         │
  │                             │  INSERT table_session ───────────────────────▶│ → id mới
  │                             │  UPDATE restaurant_table                       │
  │                             │    SET current_session_id = :id_mới            │
  │                             │    WHERE id = :bàn AND current_session_id IS NULL
  │                             │      AND status = 'OPEN' ────────────────────▶│ chỉ 1 máy được 1 dòng
  │                             │  0 dòng → ROLLBACK, đọc lại phiên của máy kia  │
  │◀── 200 {sessionId, ...} ────│  COMMIT; phát TABLE_STATE_CHANGED → /topic/cashier
```

Hai máy cùng quét một bàn trống thì cả hai đều chạy INSERT, nhưng câu `UPDATE` có điều kiện chỉ thành công với một
máy; máy thua rollback và vào phiên của máy thắng. Kết quả: **một bàn chỉ có một phiên**, mọi máy dùng chung.

**Luồng đặt món (luồng chính):**

```text
Khách                    Server                        MySQL               Bếp
  │ POST /api/orders       │                              │                  │
  │ Idempotency-Key: K     │                              │                  │
  │ X-Session-Id: 31       │                              │                  │
  │───────────────────────▶│ rate limit, mã QR, phiên,    │                  │
  │                        │ bàn không đang thanh toán    │                  │
  │                        │ BEGIN                        │                  │
  │                        │── INSERT idempotency_key(K) ▶│                  │
  │                        │── INSERT orders, order_item ▶│                  │
  │                        │── INSERT order_event → seq=42▶│                 │
  │                        │ COMMIT                       │                  │
  │◀── 201 Created {đơn} ──│                              │                  │
  │                        │── MESSAGE ORDER_CREATED seq=42 ────────────────▶│
  │◀── MESSAGE /topic/table.{id} (mọi máy của bàn)        │                  │
  │                        │◀──────────────────────────── SEND /app/ack {42} │
```

Sự kiện đơn được phát tới `/topic/kitchen` **và** `/topic/table.{id}`, nên mọi điện thoại trong phiên thấy đơn mới
ngay (đơn chung của bàn, kèm `guestName` là tên người đặt, không kèm mã thiết bị). Quầy thu ngân nhận thêm
`TABLE_STATE_CHANGED` trên `/topic/cashier` để cập nhật tạm tính của bàn.

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

**Luồng thanh toán (tóm tắt, chi tiết ở mục 4.4):**

```text
Khách                         Server                                     Thu ngân (/cashier)
  │ GET /api/payments/bill      │ tổng, đã trả, còn phải trả (server tính)  │
  │ POST /api/payments          │                                           │
  │  Idempotency-Key, {method}  │ INSERT payment PENDING, hết hạn +15 phút  │
  │────────────────────────────▶│ (UNIQUE pending_session_id chặn lần thứ 2)│
  │◀── 201 {payment, payUrl?} ──│── PAYMENT_UPDATED ───────────────────────▶│ bàn "Chờ thanh toán"
  │                             │                                           │
  │  TIỀN MẶT:                  │◀── PATCH /api/cashier/payments/{id}/confirm {version}
  │                             │    UPDATE ... WHERE version = ? AND status = 'PENDING'
  │  VNPAY: trình duyệt sang    │◀── IPN từ server VNPay (có chữ ký)        │
  │  trang VNPay rồi quay về    │◀── Return URL (có chữ ký)                 │
  │                             │                                           │
  │◀═ PAYMENT_UPDATED (PAID) ═══│══════════════════════════════════════════▶│ bàn "Đã thanh toán"
```

Trong lúc có lần thanh toán đang chờ, đặt món bị từ chối `409 PAYMENT_IN_PROGRESS` (khách huỷ lần chờ để gọi thêm).
Thu ngân bấm **Trả bàn** (`POST /api/cashier/tables/{id}/checkout`) để kết thúc phiên: server đặt
`current_session_id = NULL` và phát `TABLE_SESSION_ENDED` tới `/topic/table.{id}`, mọi điện thoại của bàn hiện "Cảm ơn
quý khách".

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

Sau khi kết nối lại: bếp gửi `RESUME` để nhận bù sự kiện bị lỡ; khách tải lại danh sách đơn và hóa đơn qua REST;
thu ngân tải lại sơ đồ bàn (`GET /api/cashier/tables`).

---

## 3. Protocol và định dạng message (Instruction 3.5)

### 3.1. REST: định dạng JSON

**Request đặt món:**

```http
POST /api/orders HTTP/1.1
Content-Type: application/json
X-Table-Token: 9KfP2x...
X-Device-Id: 5d1c...
X-Session-Id: 31
Idempotency-Key: 3f9c0a1e5b7d4c2a8e6f1b0d9c7a5e3f

{"guestName":"Minh","items":[{"menuItemId":12,"quantity":2,"note":"ít cay"},{"menuItemId":7,"quantity":1}]}
```

**Response:**

* `201 Created`: đơn mới được tạo.
* `200 OK` + header `Idempotent-Replayed: true`: request này là gửi lại, server trả đơn đã tạo trước đó.

Tên khách nằm trong **body JSON** chứ không trong header, vì header HTTP không hợp với tiếng Việt có dấu.

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
| 403 | `FORBIDDEN` | Tài khoản bếp gọi API quản trị / thu ngân |
| 404 | `NOT_FOUND` | Không tìm thấy món/đơn/lần thanh toán |
| 409 | `TABLE_CLOSED`, `INVALID_STATE_TRANSITION`, `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED` | Xung đột trạng thái |
| 409 | `SESSION_ENDED`, `PAYMENT_IN_PROGRESS`, `TABLE_HAS_GUESTS`, `CONFIRM_REQUIRED` | Phiên đã kết thúc; bàn đang thanh toán; đóng bàn đang có khách; trả bàn khi còn nợ/còn món mà chưa chọn lý do |
| 422 | `ITEM_UNAVAILABLE`, `NOTHING_TO_PAY`, `PAYMENT_METHOD_UNAVAILABLE` | Món hết; không còn gì để trả; VNPay chưa được cấu hình |
| 429 | `RATE_LIMITED` | Gửi quá nhanh (kèm `Retry-After`) |
| 503 | `SERVICE_UNAVAILABLE` | DB lỗi tạm thời (kèm `Retry-After`) |

Danh sách endpoint chính:

| Method | Endpoint | Ai dùng |
|---|---|---|
| GET | `/api/public/tables/{qrToken}` | Khách: mã QR → bàn |
| POST | `/api/public/tables/{qrToken}/join` | Khách: vào bàn (vào phiên đang có hoặc mở phiên mới) → `sessionId` |
| GET | `/api/public/menu` | Khách: thực đơn (có `ETag` → `304 Not Modified`) |
| POST | `/api/orders` | Khách: đặt món (body có `guestName`) |
| GET | `/api/orders` | Khách: **mọi đơn của phiên** + `mineOrderIds` (các đơn do máy này đặt) |
| POST | `/api/orders/{id}/cancel` | Khách: huỷ đơn (chỉ máy đã đặt, khi mọi món còn PENDING) |
| GET | `/api/payments/bill` | Khách: tổng, đã trả, còn phải trả, lần đang chờ |
| POST | `/api/payments` | Khách: tạo lần thanh toán `{method}` (`CASH` hoặc `VNPAY`) + `Idempotency-Key`; VNPay trả kèm `payUrl` |
| GET | `/api/payments/{id}` | Khách: xem một lần thanh toán |
| POST | `/api/payments/{id}/cancel` | Khách: huỷ lần đang chờ để gọi thêm món |
| GET | `/api/payments/vnpay/ipn` | **Server VNPay** gọi: trả `{"RspCode","Message"}` |
| GET | `/api/payments/vnpay/return` | Trình duyệt quay về từ VNPay → chuyển về trang gọi món |
| POST | `/api/auth/login` | Nhân viên: đăng nhập → token |
| GET | `/api/kitchen/orders` | Bếp: ảnh chụp đơn đang mở + `latestSeq` |
| PATCH | `/api/kitchen/order-items/{id}/status` | Bếp: đổi trạng thái `{status, version}` |
| GET | `/api/cashier/tables`, `/api/cashier/tables/{id}` | Thu ngân: sơ đồ bàn / chi tiết hóa đơn |
| POST | `/api/cashier/tables/{id}/payments` | Thu ngân: tạo lần thu tiền mặt tại quầy |
| PATCH | `/api/cashier/payments/{id}/confirm` | Thu ngân: "Đã nhận tiền" `{version}` |
| POST | `/api/cashier/tables/{id}/checkout` | Thu ngân: **Trả bàn** `{reason, note}` |
| POST | `/api/admin/tables/{id}/open` · `/close` | Quản trị: phục vụ lại / ngừng phục vụ (không đóng được bàn đang có khách) |

Phân quyền REST: `/api/admin/**` chỉ ADMIN; `/api/kitchen/**` KITCHEN hoặc ADMIN; `/api/cashier/**` CASHIER hoặc
ADMIN. Tài khoản mẫu: `admin`, `bep`, `thungan` (vai trò CASHIER).

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
| Server → khách | `/topic/table.{id}` | Đơn chung của bàn (`ORDER_CREATED`, `ITEM_STATUS_CHANGED`, `ORDER_CANCELLED`, kèm `guestName`, không kèm mã thiết bị), `PAYMENT_UPDATED`, `TABLE_SESSION_ENDED`, `TABLE_CLOSED` | Khách của bàn đó, nhân viên |
| Server → thu ngân | `/topic/cashier` | `TABLE_STATE_CHANGED {tableId}`, `PAYMENT_UPDATED {tableId, payment}` | Chỉ CASHIER, ADMIN |
| Server → tất cả | `/topic/menu` | `MENU_UPDATED` | Tất cả |
| Bếp → server | `/app/ack` | `{"seq": 42}` | Chỉ nhân viên |
| Bếp → server | `/app/resume` | `{"lastSeq": 41}` | Chỉ nhân viên |
| Server → một phiên | `/user/queue/replay` | `{"type":"REPLAY_BATCH","latestSeq":44,"hasMore":false,"events":[...]}` | Phiên đã gửi RESUME |
| Server → một phiên | `/user/queue/errors` | Lỗi khi xử lý frame của phiên đó | Phiên gây lỗi |

Phân quyền được kiểm tra ở **từng frame** `SUBSCRIBE`/`SEND`: khách thử nghe `/topic/kitchen`, `/topic/cashier` hay
topic của bàn khác sẽ bị trả `ERROR FORBIDDEN`; tài khoản bếp (KITCHEN) cũng không được nghe `/topic/cashier`.
Khách `CONNECT` chỉ bằng `tableToken` (mã QR): mọi máy cùng bàn nghe chung `/topic/table.{id}`.

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

Envelope có `seq` chỉ dùng cho **sự kiện đơn hàng**. Các thông báo `PAYMENT_UPDATED`, `TABLE_STATE_CHANGED`,
`TABLE_SESSION_ENDED`, `TABLE_CLOSED`, `MENU_UPDATED` là JSON đơn giản `{type, ...}`, không vào event log: trang khách
và trang thu ngân đồng bộ lại bằng REST mỗi khi kết nối lại, nên không cần gửi bù.

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

### 4.4. Xác nhận thanh toán qua mạng (tiền mặt và VNPay)

Số tiền **luôn do server tính** từ database (tổng món không huỷ của phiên trừ các lần đã `PAID`), không tin số client
gửi lên. Mỗi lần thanh toán có trạng thái:

```text
PENDING ──▶ PAID
   ├──▶ FAILED      (VNPay báo thất bại)
   ├──▶ CANCELLED   (khách / thu ngân huỷ)
   └──▶ EXPIRED     (quá 15 phút) ──(tiền VNPay về muộn)──▶ PAID (+ needs_refund nếu đã trả đủ bằng cách khác)
```

**Mỗi phiên tối đa một lần đang chờ.** Bảng `payment` có cột `pending_session_id` = `session_id` khi `PENDING`, `NULL`
ở trạng thái khác, kèm ràng buộc `UNIQUE` (MySQL cho phép nhiều `NULL`). Hai điện thoại cùng bấm "Thanh toán" thì
database chỉ cho một bên chèn; bên kia nhận lại đúng lần đang chờ đó (kèm thông báo "Bạn cùng bàn đang thanh toán").
Bấm hai lần trên cùng máy thì `Idempotency-Key` trả lại lần đã tạo.

**Tiền mặt:** thu ngân thu tiền rồi bấm "Đã nhận tiền" → `UPDATE payment ... WHERE version = ? AND status = 'PENDING'`.
Hai thu ngân cùng bấm thì người sau không khớp `version` và nhận `409 VERSION_CONFLICT`.

**VNPay sandbox (API 2.1.0):**

```text
Khách            Server nhóm                               VNPay sandbox
  │ POST /api/payments {VNPAY}                                │
  │─────────────▶│ tạo link: tham số vnp_* sắp xếp theo tên,  │
  │              │ URL-encode, ký HMAC-SHA512 bằng khoá bí mật│
  │◀─ payUrl ────│ → vnp_SecureHash                           │
  │── trình duyệt chuyển sang trang VNPay ───────────────────▶│ khách nhập thẻ test
  │              │◀── (1) IPN: GET /api/payments/vnpay/ipn?vnp_...&vnp_SecureHash=...
  │              │    kiểm chữ ký → tìm lần thanh toán → so số tiền → UPDATE có điều kiện
  │              │──── {"RspCode":"00","Message":"Confirm Success"} ─▶│
  │◀─ (2) VNPay chuyển trình duyệt về Return URL /api/payments/vnpay/return?vnp_... (có chữ ký)
  │─────────────▶│ kiểm chữ ký, ghi nhận như IPN → 302 về /t/{qrToken}
  │◀═ PAYMENT_UPDATED (PAID) qua /topic/table.{id}; thu ngân nhận qua /topic/cashier
  │              │── (3) quá hạn mà còn PENDING: POST querydr (HTTPS, có chữ ký) ─▶│
  │              │◀── trạng thái thật của giao dịch ─────────────────────────────│
```

* **IPN là kênh server-to-server**: VNPay gọi thẳng server của nhóm (qua tunnel), không đi qua điện thoại khách, nên
  khách tắt trình duyệt giữa chừng thì tiền vẫn được ghi nhận.
* **Chữ ký HMAC-SHA512**: server tính lại chữ ký trên mọi tham số `vnp_*` (trừ `vnp_SecureHash`, `vnp_SecureHashType`)
  bằng khoá bí mật và so sánh bằng `MessageDigest.isEqual`. Ai sửa số tiền hay kết quả trên URL mà không có khoá thì
  sai chữ ký.
* **Mã trả lời IPN** theo chuẩn VNPay: `00` đã ghi nhận, `01` không tìm thấy, `02` đã xử lý trước đó, `04` sai số tiền,
  `97` sai chữ ký. IPN luôn trả HTTP 200 với JSON `{RspCode, Message}`.
* **Idempotent**: IPN, Return URL và tra cứu đều ghi nhận bằng một câu `UPDATE ... WHERE status IN (...)` có điều kiện.
  VNPay gọi IPN lặp lại (hoặc IPN và Return URL cùng tới) thì lần sau nhận `02`, không ghi nhận tiền hai lần.
* **Dự phòng khi IPN bị lạc**: Return URL cũng có chữ ký nên được ghi nhận giống IPN. Ngoài ra, tác vụ định kỳ (mỗi phút)
  gọi API tra cứu **`querydr`** của VNPay (POST JSON qua HTTPS, chữ ký HMAC-SHA512 trên các trường nối bằng `|`) cho
  các lần VNPay quá hạn mà còn `PENDING`, trước khi đánh dấu `EXPIRED`.
* **Tiền về muộn** cho lần đã `EXPIRED`/`CANCELLED`/`FAILED`: vẫn ghi `PAID` (không bỏ qua tiền thật); nếu lúc đó hóa
  đơn đã trả đủ bằng cách khác thì bật `needs_refund` để thu ngân hoàn tiền.
* Mã merchant (`VNPAY_TMN_CODE`) và khoá bí mật (`VNPAY_HASH_SECRET`) chỉ khai báo bằng biến môi trường; thiếu thì
  trang khách ẩn lựa chọn VNPay.

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
| Phiên bàn | Hai điện thoại vào bàn trống cùng lúc → hai phiên | `UPDATE ... SET current_session_id = ? WHERE current_session_id IS NULL` |
| Lần thanh toán đang chờ | Hai máy cùng bấm "Thanh toán" | Ràng buộc `UNIQUE` trên `pending_session_id` |
| Xác nhận tiền mặt | Hai thu ngân cùng bấm "Đã nhận tiền" | Optimistic locking theo `version` |
| Kết quả VNPay | IPN gọi lặp, IPN và Return URL tới cùng lúc | `UPDATE ... WHERE status IN (...)` chỉ đổi được một lần |
| Thứ tự sự kiện | Nhiều giao dịch song song | `seq` do DB cấp tăng dần |

### 5.3. Chống quá tải

| Lớp | Cơ chế |
|---|---|
| Theo IP | Token bucket: tối đa 60 request dồn, hồi 20 request/s → vượt thì `429` + `Retry-After` |
| Theo bàn | Đặt món tối đa 10 đơn liên tiếp, hồi 10 đơn/phút |
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
| **Invalid state** | Máy trạng thái món → `409 INVALID_STATE_TRANSITION`; sai version → `409 VERSION_CONFLICT`; máy của lượt khách cũ → `409 SESSION_ENDED`; đặt món khi đang thanh toán → `409 PAYMENT_IN_PROGRESS` |
| **Dữ liệu thanh toán giả** | Sai chữ ký VNPay → `97`; sai số tiền → `04`; không ghi nhận gì |
| **Mất xác nhận thanh toán** | IPN bị lạc → Return URL (có chữ ký) hoặc tra cứu `querydr` trước khi cho hết hạn; IPN gọi lặp → `02` |
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
* **IPN của VNPay cũng đi qua tunnel**: server VNPay gọi `https://<tên-miền-tunnel>/api/payments/vnpay/ipn`. Địa chỉ IPN
  khai báo với VNPay phải cố định, nên khi thử VNPay nên dùng ngrok có tên miền cố định thay vì quick tunnel đổi địa
  chỉ mỗi lần chạy. Return URL lấy từ biến `APP_PUBLIC_URL` (trống thì lấy theo địa chỉ khách đang mở trang).

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

**Nhiều điện thoại cùng bàn thì sao?**
Lần đầu mở link QR, máy gọi `POST /join`. Bàn trống thì server mở **phiên bàn** mới bằng câu `UPDATE` có điều kiện
`current_session_id IS NULL`, nên hai máy quét cùng lúc vẫn chỉ tạo một phiên. Mọi máy trong phiên nghe chung
`/topic/table.{id}` và thấy **đơn chung** (ghi tên người đặt); mã thiết bị chỉ dùng để biết ai được huỷ đơn nào.

**Làm sao tin được kết quả thanh toán VNPay?**
Không tin trình duyệt. Kết quả chỉ được ghi nhận khi chữ ký HMAC-SHA512 tính lại bằng khoá bí mật khớp với
`vnp_SecureHash`, và số tiền khớp với số server đã tính. Kênh chính là IPN (VNPay gọi thẳng server, server-to-server);
gọi lặp nhận `02` nên không ghi nhận hai lần. Mất IPN thì có Return URL (cũng có chữ ký) và tra cứu `querydr`.

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
`order/OrderService.java`, `table/TableService.java` (vào bàn, trả bàn), `payment/` (`PaymentService.java`,
`VnpayGateway.java`, `CashierService.java`), `ratelimit/`, và `source/client/src/lib/` (`stomp.js`, `connection.js`,
`kitchenFeed.js`, `api.js`).
