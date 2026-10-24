# Kế hoạch: Phiên bàn tự động, đơn chung, tên khách, thanh toán và trang thu ngân

> **Trạng thái: ĐÃ DUYỆT (24/10/2026) – đang thực hiện.** Không làm VietQR. Không commit (người dùng tự commit).
> Viết ngày 24/10/2026, dựa trên code hiện tại (commit `adb31f0`).

---

## 1. Các quyết định đã chốt

| # | Quyết định |
|---|---|
| 1 | **Phiên bàn tự mở** khi khách đầu tiên vào web bằng QR (nếu bàn đang phục vụ). Nhân viên không bấm mở phiên |
| 2 | **Mọi máy trong cùng phiên thấy đơn chung**. Mỗi đơn ghi rõ ai đặt; máy của mình thấy nhãn "BẠN ĐẶT". Chỉ máy đã đặt mới được huỷ đơn đó |
| 3 | **Tên khách**: hỏi ngay khi vào web (có nút Bỏ qua). Trình duyệt nhớ tên **trong một phiên** (localStorage kèm mã phiên); tên được **gửi kèm mỗi đơn** và lưu vào đơn. Bỏ qua thì tự đặt "Khách" + 4 ký tự ngẫu nhiên |
| 4 | **"Trả bàn"** (thay cho "Dọn bàn") = kết thúc phiên. **Chỉ nằm ở trang `/cashier`**. Bếp và trang quản trị bỏ nút Dọn bàn |
| 5 | **Admin "Đóng bàn / Mở bàn"** = **ngừng phục vụ / phục vụ lại** (bảo trì). Không cho đóng khi bàn đang có khách |
| 6 | **Thanh toán theo bàn** (cả phiên), hai cách: **tiền mặt** (thu ngân xác nhận) và **VNPay sandbox** (IPN + tra cứu dự phòng) |
| 7 | Trang **`/cashier`** riêng, vai trò **CASHIER**, tài khoản mẫu `thungan` / `thungan123` |
| 8 | Giới hạn đặt món tăng từ 5 lên **10 đơn/phút/bàn** |

---

## 2. Thay đổi dữ liệu (schema)

| Bảng | Thay đổi | Lý do |
|---|---|---|
| `restaurant_table` | **Đổi nghĩa** cột `status`: `OPEN` = đang phục vụ, `CLOSED` = ngừng phục vụ (khi làm: dùng lại cột có sẵn thay vì thêm `in_service`; `SchemaMigrator` chuyển mọi bàn cũ về `OPEN`) | Tách "đang phục vụ hay bảo trì" (admin) khỏi "có phiên hay trống" (`current_session_id`) |
| `table_session` | **Thêm** `end_reason VARCHAR(30) NULL` (`CHECKOUT`, `AUTO_IDLE`, `AUTO_AFTER_PAID`, `UNPAID_LEFT`, `COMPED`, `OTHER`), `end_note VARCHAR(200) NULL`, `ended_by VARCHAR(50) NULL` | Ghi lại phiên kết thúc vì sao, ai bấm (đối soát khi khách bỏ về không trả) |
| `orders` | **Thêm** `guest_name VARCHAR(30) NULL` | Tên người đặt, hiện cho máy khác và cho bếp |
| `payment` (**mới**) | `id`, `session_id`, `table_id`, `amount`, `method` (`CASH`/`VNPAY`), `status`, `version`, `idempotency_key UNIQUE`, `pending_session_id UNIQUE NULL`, `provider_txn_no`, `provider_pay_date`, `needs_refund BOOLEAN`, `created_at`, `expires_at`, `paid_at`, `confirmed_by` | Lưu từng lần thanh toán |

**Mẹo bảo đảm "mỗi phiên chỉ một lần thanh toán đang chờ":** cột `pending_session_id` bằng `session_id` khi trạng thái là PENDING và bằng NULL ở các trạng thái khác. Cột này có ràng buộc UNIQUE; MySQL và H2 cho phép nhiều giá trị NULL trong cột UNIQUE. Vì vậy database tự chặn việc hai máy cùng tạo hai lần thanh toán đang chờ cho một phiên.

**Nâng cấp database cũ:** mở rộng `SchemaMigrator.java` (đã có) để thêm các cột trên vào database đã tồn tại. Các bàn cũ được đặt `in_service = TRUE`.

---

## 3. Phiên bàn

### 3.1. Vào bàn (thay cho việc admin mở bàn)

Endpoint mới: `POST /api/public/tables/{qrToken}/join`, header `X-Device-Id`.

```text
bàn in_service = false  ──▶ 409 TABLE_OUT_OF_SERVICE ("Bàn tạm ngừng phục vụ")
bàn đang có phiên       ──▶ vào phiên đó
bàn trống               ──▶ mở phiên mới, nguyên tử:
     BEGIN
       INSERT table_session ...                        → sessionId mới
       UPDATE restaurant_table SET current_session_id = :new
         WHERE id = :table AND current_session_id IS NULL AND in_service = TRUE
       0 dòng (máy khác vừa mở trước) → ROLLBACK, đọc lại, vào phiên của máy kia
     COMMIT
trả về: { tableId, code, sessionId, sessionOpenedAt, paymentState }
```

Dùng `POST` chứ không dùng `GET`, vì vào bàn có thể **tạo** phiên (GET không được có tác dụng phụ). Sau khi mở phiên mới, server phát `TABLE_STATE_CHANGED` tới `/topic/cashier`.

### 3.2. Kết thúc phiên ("Trả bàn")

| Cách | Ai / khi nào | `end_reason` |
|---|---|---|
| Thu ngân bấm **Trả bàn** | Khách đã rời đi. Nếu còn tiền chưa trả hoặc còn món chưa phục vụ thì hỏi xác nhận và **bắt buộc chọn lý do** (Khách bỏ về / Mời khách / Khác + ghi chú) | `CHECKOUT` / `UNPAID_LEFT` / `COMPED` / `OTHER` |
| Tự động: đã trả đủ tiền và **30 phút** sau đó chưa ai bấm | Tác vụ định kỳ | `AUTO_AFTER_PAID` |
| Tự động: phiên mở **30 phút** mà chưa có đơn nào | Tác vụ định kỳ | `AUTO_IDLE` |

Khi phiên kết thúc: `current_session_id = NULL` (bàn trống). Server phát `TABLE_SESSION_ENDED` tới `/topic/table.{id}`, các điện thoại đang mở trang sẽ quay về màn hình nhập tên của phiên mới. Đồng thời phát `TABLE_STATE_CHANGED` tới `/topic/cashier`.

Các tác vụ định kỳ chạy mỗi phút bằng `@Scheduled` (dự án đã bật `@EnableScheduling`). Hai mốc 30 phút đặt trong `application.yml` để đổi được.

### 3.3. Admin: ngừng / phục vụ lại

- `POST /api/admin/tables/{id}/close` → `in_service = FALSE`. Nếu bàn đang có phiên → **409 `TABLE_HAS_GUESTS`** ("Bàn đang có khách, cần thanh toán và trả bàn trước").
- `POST /api/admin/tables/{id}/open` → `in_service = TRUE`. Không tạo phiên.
- Bỏ endpoint `POST /api/kitchen/tables/{id}/reset-session` và màn hình "Danh sách bàn / Dọn bàn" ở bếp.

---

## 4. Đơn chung và tên khách

### 4.1. Phía server

- `PlaceOrderRequest` thêm trường `guestName` (1–20 ký tự, tự cắt khoảng trắng). Tên đi trong **body JSON** chứ không trong header, vì header HTTP không hợp với tiếng Việt có dấu.
- `requireOpen` đổi nghĩa: bàn phải **đang phục vụ VÀ có phiên** (khách đã "vào bàn").
- Khi phiên đang có lần thanh toán PENDING → đặt món trả **409 `PAYMENT_IN_PROGRESS`** ("Bàn đang thanh toán, vui lòng đợi hoặc huỷ thanh toán để gọi thêm").
- `GET /api/orders` trả **mọi đơn của phiên**; mỗi đơn có `guestName` và `mine` (true nếu `device_id` của đơn trùng `X-Device-Id` của request). **Không bao giờ trả `device_id` ra ngoài**: mã thiết bị là bí mật dùng để xác định quyền huỷ.
- Huỷ đơn: giữ nguyên quy tắc **chỉ máy đã đặt mới huỷ được**.
- Sự kiện đơn (`ORDER_CREATED`, `ITEM_STATUS_CHANGED`, `ORDER_CANCELLED`) quay lại phát lên **`/topic/table.{id}`** cho cả bàn, kèm `guestName`, không kèm `device_id`. **Bỏ** kênh `/topic/guest.{deviceId}`.
- Đơn trên bếp có thêm `guestName` và cờ `firstInSession` (đơn đầu tiên của phiên) để hiện nhãn **"Bàn mới mở"**.

### 4.2. Phía khách (`Customer.jsx`)

```text
Mở link QR ──▶ POST /join ──▶ có sessionId
   ├─ localStorage có tên cho đúng sessionId này ──▶ vào thực đơn
   └─ chưa có ──▶ hộp "Bạn tên gì?" [Tiếp tục] [Bỏ qua]
                       └─ lưu localStorage: { sessionId, name } ──▶ vào thực đơn
```

- Góc trên: "Bạn là: **Minh** ✏️" (bấm để đổi tên; chỉ các đơn **mới** mang tên mới).
- Mục "**Đơn của bàn**": mọi đơn của phiên, đơn của mình có nhãn **BẠN ĐẶT** và nút Huỷ; cuối danh sách có **Tổng cả bàn** (cộng theo món) và **Tạm tính**.
- Nhận `TABLE_SESSION_ENDED` → xoá tên đã nhớ, quay lại bước vào bàn.

---

## 5. Thanh toán

### 5.1. Hóa đơn và trạng thái

- **Tổng hóa đơn** = tổng `đơn giá × số lượng` của mọi món **không bị huỷ** trong phiên.
- **Còn phải trả** = tổng hóa đơn − tổng các lần thanh toán đã `PAID` của phiên. Nhờ vậy, khách trả xong rồi gọi thêm tráng miệng thì vẫn trả tiếp được phần mới.
- Số tiền **luôn do server tính** từ database, không tin số client gửi lên.

```text
Lần thanh toán:  PENDING ──▶ PAID
                    ├──▶ FAILED      (VNPay báo thất bại)
                    ├──▶ CANCELLED   (khách huỷ để gọi thêm món)
                    └──▶ EXPIRED     (quá 15 phút) ──(tiền VNPay về muộn)──▶ PAID (+ needs_refund nếu đã trả đủ bằng cách khác)

Bàn trên sơ đồ thu ngân:
  TRỐNG ──▶ ĐANG ĂN ──▶ CHỜ THANH TOÁN ──▶ ĐÃ THANH TOÁN ──(Trả bàn)──▶ TRỐNG
                ▲                │                  │
                └── (huỷ / hết hạn) ┘   (gọi thêm món) ┘
```

### 5.2. Luồng chung

```text
Khách                         Server                                   Thu ngân (/cashier)
  │ GET /api/payments/bill      │ tính tổng, đã trả, còn phải trả         │
  │ POST /api/payments          │                                          │
  │  Idempotency-Key, method    │ INSERT payment (PENDING, hết hạn +15')   │
  │────────────────────────────▶│ (pending_session_id UNIQUE chặn trùng)   │
  │◀── 201 {payment hoáº·c     │── PAYMENT_UPDATED ───────────────────────▶│
  │      hoặc vnpayUrl}         │   /topic/cashier, /topic/table.{id}      │
  │                             │                                          │
  │  TIỀN MẶT:                  │◀── PATCH /api/cashier/payments/{id}/confirm {version}
  │                             │    UPDATE ... WHERE version = ? AND status = 'PENDING'
  │  VNPAY:                     │◀── IPN từ server VNPay (có chữ ký)       │
  │                             │                                          │
  │◀═ PAYMENT_UPDATED (PAID) ═══│══════════════════════════════════════════▶│ bàn → ĐÃ THANH TOÁN
```

Máy thứ hai bấm "Thanh toán" khi đã có lần đang chờ → server trả **lần đang chờ đó** (200), kèm thông báo "Bạn cùng bàn đang thanh toán".

### 5.3. Tiền mặt

Khách chọn "Tiền mặt" → thu ngân thấy bàn chuyển **CHỜ THANH TOÁN** kèm số tiền → thu tiền → bấm **Đã nhận tiền**. Thu ngân cũng có thể tự tạo lần thanh toán tiền mặt cho một bàn (khách ra quầy trả mà không bấm gì trên điện thoại).

### 5.4. VNPay sandbox (phiên bản API 2.1.0)

**Tạo link thanh toán** (server):

- Tham số: `vnp_Version=2.1.0`, `vnp_Command=pay`, `vnp_TmnCode`, `vnp_Amount` (= số tiền × 100), `vnp_CurrCode=VND`, `vnp_TxnRef` (= mã lần thanh toán), `vnp_OrderInfo`, `vnp_OrderType=other`, `vnp_Locale=vn`, `vnp_ReturnUrl`, `vnp_IpAddr`, `vnp_CreateDate`, `vnp_ExpireDate` (+15 phút, giờ GMT+7).
- Sắp xếp tham số theo tên, URL-encode, ký **HMAC-SHA512** bằng `VNPAY_HASH_SECRET` → `vnp_SecureHash`.

**Nhận kết quả, hai đường:**

| Đường | Endpoint | Cách xử lý |
|---|---|---|
| **IPN** (server VNPay gọi server mình) | `GET /api/payments/vnpay/ipn` | Kiểm tra chữ ký → tìm lần thanh toán → so số tiền → nếu đang PENDING thì cập nhật PAID/FAILED. Trả JSON đúng chuẩn VNPay: `00` thành công, `01` không tìm thấy, `02` đã xử lý rồi, `04` sai số tiền, `97` sai chữ ký, `99` lỗi khác. VNPay gọi lặp thì trả `02`, không xử lý hai lần |
| **Return URL** (trình duyệt khách quay về) | `GET /api/payments/vnpay/return` | Kiểm tra chữ ký. **Không tin kết quả trên URL**: nếu lần thanh toán còn PENDING thì server **gọi API tra cứu `querydr` của VNPay** để hỏi trạng thái thật, cập nhật, rồi chuyển khách về `/t/{qrToken}` |

**Dự phòng khi không có IPN:** tác vụ định kỳ gọi `querydr` cho các lần VNPay còn PENDING trước khi cho chúng hết hạn.

**Tiền về muộn** (IPN hoặc querydr báo thành công cho lần đã EXPIRED/CANCELLED): vẫn ghi `PAID`. Nếu khi đó hóa đơn đã trả đủ bằng cách khác thì bật `needs_refund = TRUE`; thu ngân thấy cảnh báo "Cần hoàn tiền".

**Cấu hình** (biến môi trường, không ghi vào code): `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `APP_PUBLIC_URL` (= `https://undrafted-espionage-ferret.ngrok-free.dev`, dùng để tạo Return URL). Thiếu cấu hình thì ẩn lựa chọn VNPay.

---

## 6. Trang thu ngân `/cashier`

```text
┌ Thu ngân · thungan ───────────────────────────── ● Kết nối ┐
│ ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐            │
│ │ B01    │ │ B02    │ │ B03      │ │ B04        │            │
│ │ TRỐNG  │ │ĐANG ĂN │ │CHỜ THANH │ │ĐÃ THANH    │            │
│ │        │ │320.000đ│ │TOÁN      │ │TOÁN        │            │
│ │        │ │45 phút │ │510.000đ  │ │[Trả bàn]   │            │
│ │        │ │        │ │Tiền mặt  │ │            │            │
│ │        │ │        │ │[Đã nhận] │ │            │            │
│ └────────┘ └────────┘ └──────────┘ └────────────┘            │
│ Bấm vào bàn: chi tiết hóa đơn, các lần thanh toán, Trả bàn  │
└─────────────────────────────────────────────────────────────┘
```

- Tải ảnh chụp ban đầu qua `GET /api/cashier/tables`, sau đó nghe `/topic/cashier`. Kết nối lại thì tải lại ảnh chụp.
- Hai thu ngân cùng bấm "Đã nhận tiền" → người sau nhận 409 (khoá lạc quan theo `version`).
- Bàn **ngừng phục vụ** hiện màu xám.
- Có cảnh báo cho các lần cần hoàn tiền.

---

## 7. API mới / thay đổi

| Method | Endpoint | Ai dùng | Ghi chú |
|---|---|---|---|
| POST | `/api/public/tables/{qrToken}/join` | Khách | **Mới**: vào bàn, mở phiên nếu trống |
| POST | `/api/orders` | Khách | Body thêm `guestName`; 409 khi đang thanh toán |
| GET | `/api/orders` | Khách | Trả **mọi đơn của phiên**, kèm `guestName`, `mine` |
| GET | `/api/payments/bill` | Khách | **Mới**: tổng, đã trả, còn phải trả, lần đang chờ |
| POST | `/api/payments` | Khách | **Mới**: `Idempotency-Key`, `{method}` |
| GET | `/api/payments/{id}` | Khách | **Mới** |
| POST | `/api/payments/{id}/cancel` | Khách | **Mới**: huỷ lần đang chờ để gọi thêm món |
| GET | `/api/payments/vnpay/return` | Trình duyệt khách | **Mới** |
| GET | `/api/payments/vnpay/ipn` | Server VNPay | **Mới** |
| GET | `/api/cashier/tables` | Thu ngân, admin | **Mới**: sơ đồ bàn |
| GET | `/api/cashier/tables/{id}` | Thu ngân, admin | **Mới**: chi tiết hóa đơn |
| POST | `/api/cashier/tables/{id}/payments` | Thu ngân, admin | **Mới**: tạo lần trả tiền mặt tại quầy |
| PATCH | `/api/cashier/payments/{id}/confirm` | Thu ngân, admin | **Mới**: `{version}` |
| POST | `/api/cashier/tables/{id}/checkout` | Thu ngân, admin | **Mới**: Trả bàn `{reason, note}` |
| POST | `/api/admin/tables/{id}/open` · `/close` | Admin | **Đổi nghĩa**: phục vụ / ngừng phục vụ |
| POST | `/api/kitchen/tables/{id}/reset-session` | – | **Bỏ** |

Phân quyền (`StaffAuthInterceptor`): `/api/admin/**` chỉ ADMIN; `/api/kitchen/**` KITCHEN hoặc ADMIN; `/api/cashier/**` CASHIER hoặc ADMIN.

---

## 8. WebSocket

| Kênh | Sự kiện | Ai được nghe |
|---|---|---|
| `/topic/kitchen` | Như cũ, đơn thêm `guestName`, `firstInSession` | KITCHEN, ADMIN |
| `/topic/table.{id}` | `ORDER_CREATED`, `ITEM_STATUS_CHANGED`, `ORDER_CANCELLED` (quay lại kênh bàn), `PAYMENT_UPDATED`, `TABLE_SESSION_ENDED`, `TABLE_OUT_OF_SERVICE` | Khách của bàn đó, nhân viên |
| `/topic/cashier` | `TABLE_STATE_CHANGED`, `PAYMENT_UPDATED` | **Mới**: CASHIER, ADMIN |
| ~~`/topic/guest.{deviceId}`~~ | – | **Bỏ** |

Giao thức tin cậy của bếp (seq, ACK, RESUME) **giữ nguyên**. Sự kiện thanh toán **không** đi vào event log có `seq`; trang khách và trang thu ngân đồng bộ lại bằng REST mỗi khi kết nối lại (giống cách khách đang làm).

---

## 9. Giao diện

| Trang | Thay đổi |
|---|---|
| Khách `/t/:token` | Hộp nhập tên; "Bạn là … ✏️"; "Đơn của bàn" chung với nhãn BẠN ĐẶT; Tổng cả bàn; nút **Thanh toán** → chọn cách → (tiền mặt: "Vui lòng ra quầy" / VNPay: chuyển sang trang VNPay) → màn hình "Đã thanh toán"; xử lý "bạn cùng bàn đang thanh toán" |
| Bếp `/kitchen` | Đơn hiện tên khách, nhãn "Bàn mới mở"; **bỏ** mục Danh sách bàn / Dọn bàn |
| Quản trị `/admin` | Nút Mở bàn / Đóng bàn đổi nhãn thành **Phục vụ / Ngừng phục vụ**; bỏ Dọn bàn; thêm mục **Lịch sử thanh toán** (chỉ xem) |
| Thu ngân `/cashier` | **Mới** (mục 6), thêm route trong `main.jsx` và `WebConfig` |

---

## 10. Cấu hình mới (`application.yml` + biến môi trường)

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `app.rate-limit.order-capacity` / `order-refill-per-minute` | `10` / `10` | Tăng từ 5 |
| `app.session.idle-timeout-minutes` | `30` | Tự kết thúc phiên không có đơn |
| `app.session.auto-checkout-after-paid-minutes` | `30` | Tự trả bàn sau khi trả đủ tiền |
| `app.payment.expire-minutes` | `15` | Hạn mỗi lần thanh toán |
| `APP_PUBLIC_URL` | (trống) | Địa chỉ ngrok, dùng cho Return URL của VNPay |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | (trống) | Thiếu thì ẩn VNPay |
| `VNPAY_PAY_URL` | `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` | |
| `VNPAY_API_URL` | `https://sandbox.vnpayment.vn/merchant_webapi/api/transaction` | API tra cứu `querydr` |

---

## 11. Kiểm thử

**JUnit (mới / sửa):**
- Ký và kiểm tra chữ ký VNPay (HMAC-SHA512).
- Hai máy cùng vào bàn trống cùng lúc → chỉ một phiên.
- Hai máy cùng tạo thanh toán → chỉ một lần PENDING.
- IPN: sai chữ ký → `97`; sai số tiền → `04`; gọi lặp → `02`; thành công → `00` và trạng thái PAID.
- Admin đóng bàn đang có khách → 409.
- Sửa các test hiện có đang dựa vào việc admin mở bàn.

**e2e (`e2e-test.js`):**
- Sửa các phần dùng `/topic/guest.*`, `reset-session`, mở/đóng bàn.
- Thêm nhóm: vào bàn và phiên tự động, đơn chung + `mine` + `guestName`, chặn đặt món khi đang thanh toán, thanh toán tiền mặt, trả bàn, IPN VNPay giả lập (test tự ký bằng khoá giả của môi trường test), phân quyền `/api/cashier` và `/topic/cashier`.

**Bộ thực nghiệm (`experiment.js`, `lib/common.js`):** các bàn `LT…` được vào phiên tự động trước khi đo, để E1–E6 chạy như cũ.

**Test tay:** thêm vào `TEST_CASES.md`: nhập tên, đơn chung trên 2 điện thoại, hai cách thanh toán, trả bàn, VNPay bằng thẻ test NCB qua ngrok.

---

## 12. Tài liệu cần cập nhật

`README.md`, `source/README.md`, `SETUP.md` (biến môi trường VNPay, tài khoản thu ngân), `TEST_CASES.md`, `NETWORK.md`, `NETWORK_DE_HIEU.md`, `TRINH_BAY.md`, `report/report.md` (mô tả chức năng; mục Novelty có thể thêm "xác nhận thanh toán server-to-server có chữ ký, idempotent").

---

## 13. Thứ tự làm

1. Schema + `SchemaMigrator`, vai trò CASHIER, tài khoản `thungan`.
2. Phiên bàn: `join`, `in_service`, kết thúc phiên, tác vụ định kỳ; bỏ reset-session.
3. Đơn chung + `guestName` + `firstInSession`; sự kiện về `/topic/table.{id}`.
4. Thanh toán lõi (bill, tạo, huỷ, hết hạn) + tiền mặt + API thu ngân + `/topic/cashier`.
5. VNPay (tạo link, IPN, return, querydr, tiền về muộn).
6. Giao diện: khách → thu ngân → bếp → quản trị.
7. Test JUnit + e2e + thực nghiệm; chạy toàn bộ.
8. Cập nhật tài liệu.

---

## 14. Các quyết định (đã chốt 24/10/2026)

1. **Chạy test:** không cài thêm gì. Phần Java chạy bằng Maven và JDK có sẵn trong IntelliJ trên máy này; phần giao diện và e2e (cần Node.js) do người dùng chạy và gửi kết quả.
2. **VietQR:** bỏ.
3. **VNPay:** người dùng cung cấp `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`. Chỉ dùng qua biến môi trường khi chạy thử, **không ghi vào file nào** trong dự án.
4. **Commit:** không commit, người dùng tự làm.
