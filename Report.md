# Kịch bản trình bày bảo vệ – QR Order

**Thời lượng gợi ý:** khoảng 13 phút nói + 6 phút demo, rồi tới phần thầy hỏi.
Nếu thầy cho ít thời gian hơn, nói các phần có dấu ⭐ trước.

Bố cục bám theo 4 câu hỏi mà `Instruction.md` (mục 19) nói giảng viên quan tâm nhất:

1. Bài toán là gì?
2. Hệ thống giải quyết thế nào?
3. Điểm cải tiến của nhóm là gì?
4. Có bằng chứng thực nghiệm nào?

Mỗi phần dưới đây gồm: **màn hình nên chiếu**, **lời nói** (nói tự nhiên, không cần thuộc từng chữ), và **ý chính
phải nhớ** nếu bị quên lời.

---

## Chuẩn bị trước khi vào phòng

- [ ] Server chạy bằng MySQL, `AUTH_SECRET` đã đặt.
- [ ] Mở sẵn 4 cửa sổ: Quản trị, Bếp (cửa sổ ẩn danh), Thu ngân `/cashier` (cửa sổ ẩn danh / trình duyệt khác,
      `thungan` / `thungan123`), Khách (hoặc điện thoại thật đã quét QR). Nên có **hai** điện thoại (hoặc hai cửa sổ)
      cho cùng một bàn để demo đơn chung.
- [ ] Nếu demo VNPay: server có biến môi trường `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` (mã sandbox, **không** ghi vào
      file nào), chạy ngrok tên miền cố định, IPN URL đã khai báo với VNPay; chuẩn bị sẵn thẻ test NCB của sandbox.
- [ ] Tunnel đang chạy nếu demo bằng điện thoại 4G; đã in hoặc hiện sẵn mã QR của 1–2 bàn.
- [ ] Màn hình bếp đang ở chế độ **RELIABLE_PUSH**.
- [ ] Trên trình duyệt bếp, mở sẵn F12 → Network → WS để cho thầy xem frame khi được hỏi.
- [ ] Mở sẵn các file: `ws/WebSocketConfig.java`, `ws/KitchenWsController.java`, `order/OrderService.java`,
      `payment/PaymentService.java`, `payment/VnpayGateway.java`, `client/src/lib/stomp.js`,
      `client/src/lib/kitchenFeed.js`.
- [ ] Dọn dữ liệu cũ để màn hình bếp sạch (bếp phục vụ hết đơn cũ; thu ngân **Trả bàn** các bàn còn khách, để bàn
      demo ở trạng thái "Trống").

---

## 1. Mở đầu (30 giây)

**Chiếu (trang bìa):**

```text
            QR ORDER
  Gọi món bằng mã QR với màn hình bếp thời gian thực
  Giao đơn tin cậy trên WebSocket / STOMP

  Môn: Lập trình mạng – Năm học 2026–2027
  Nhóm: [số nhóm, họ tên, MSSV]
  Giảng viên: [tên giảng viên]
```

**Nói:**
> Em xin trình bày đề tài **QR Order – hệ thống gọi món bằng mã QR với màn hình bếp thời gian thực**. Khách quét mã QR
> trên bàn để gọi món bằng điện thoại, đơn được gửi về server và hiện ngay trên màn hình của bếp; bếp cập nhật trạng
> thái món thì điện thoại của khách cũng thấy ngay. Cuối bữa, khách thanh toán cả bàn bằng tiền mặt hoặc qua cổng
> VNPay, thu ngân thấy ngay trên màn hình của quầy.
>
> Trọng tâm của nhóm em không nằm ở giao diện, mà ở **phần mạng**: làm sao để đơn tới bếp **không bị mất, không bị
> trùng** kể cả khi mạng chập chờn.

---

## 2. ⭐ Bài toán (1 phút 30 giây)

**Chiếu:**

```text
 Mọi thiết bị đi qua Wi-Fi nhà hàng → mạng hay chập chờn

 ① MẤT ĐƠN       Server đẩy đơn xuống bếp   ──▶  ✕ máy bếp đang mất Wi-Fi
                  → đơn mất hẳn, bếp không biết mình bị thiếu

 ② TRÙNG ĐƠN     Khách bấm "Đặt món" ──▶ server tạo đơn ──▶ ✕ câu trả lời bị mất
                  → khách bấm lại → bếp nhận 2 đơn giống hệt

 ③ GHI ĐÈ        Đầu bếp A bấm "Nhận"   ┐
                  Đầu bếp B bấm "Từ chối" ┘ cùng lúc trên 1 món
                  → kết quả người này đè lên người kia

 Mục tiêu: đơn tới bếp ĐÚNG MỘT LẦN – không mất, không trùng, độ trễ thấp
```

**Nói:**
> Trong nhà hàng, mọi thiết bị đều đi qua Wi-Fi: điện thoại của khách, máy tính bảng ở bếp. Wi-Fi thì hay chập chờn.
> Nhóm em xác định ba vấn đề mạng mà một ứng dụng gọi món đơn giản sẽ gặp:
>
> **Thứ nhất, mất đơn.** Nếu server chỉ đẩy đơn xuống bếp rồi thôi, thì đúng lúc máy bếp mất Wi-Fi vài giây, các đơn
> phát ra trong lúc đó sẽ mất hẳn, và bếp không hề biết mình bị thiếu đơn.
>
> **Thứ hai, trùng đơn.** Khách bấm "Đặt món", đơn đã tới server nhưng câu trả lời bị mất trên đường về. Khách tưởng
> chưa gửi được nên bấm lại, thế là bếp nhận hai đơn giống hệt nhau.
>
> **Thứ ba, ghi đè.** Hai đầu bếp cùng bấm trên một món, ví dụ một người bấm "Nhận", một người bấm "Từ chối" cùng lúc.
> Kết quả của người này đè lên người kia.
>
> Vậy bài toán là: **thiết kế hệ thống để đơn hàng tới bếp đúng một lần, không mất, không trùng, độ trễ thấp**, trong
> điều kiện mạng không ổn định và nhiều người dùng cùng lúc.

**Ý chính:** mất đơn – trùng đơn – ghi đè. Mục tiêu: đúng một lần, không mất, không trùng.

---

## 3. ⭐ Kiến trúc hệ thống (1 phút 30 giây)

**Chiếu (sơ đồ kiến trúc):**

```text
 ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
 │ Khách       │  │ Bếp         │  │ Thu ngân    │  │ Quản trị    │
 │ điện thoại  │  │ máy t.bảng  │  │ máy quầy    │  │ laptop      │
 └─┬───────▲───┘  └─┬───────▲───┘  └─┬───────▲───┘  └─┬───────────┘
   │ REST  │ WS     │ REST  │ WS     │ REST  │ WS     │ REST
   │(lệnh) │(sự kiện)       │        │       │        │
 ══╪═══════╪════════╪═══════╪════════╪═══════╪════════╪════  Mạng (Wi-Fi / 4G qua tunnel)
   ▼       │        ▼       │        ▼       │        ▼
 ┌──────────────────────────────────────────────────────┐      ┌───────────────┐
 │ Spring Boot server – cổng 8080                        │◀─IPN─│ VNPay sandbox │
 │  ├─ Tầng REST: nhận lệnh, trả kết quả                 │      │ (cổng thanh   │
 │  ├─ Tầng WebSocket/STOMP: giữ kết nối, đẩy sự kiện    │─────▶│  toán)        │
 │  ├─ Tầng nghiệp vụ: đặt món, đổi trạng thái, huỷ,     │ tra  └───────────────┘
 │  │   phiên bàn, thanh toán                            │ cứu
 │  └─ Nhật ký sự kiện + gửi sau khi commit              │
 └──────────────────────────┬───────────────────────────┘
                            │ JDBC (cổng 3306)
                            ▼
                 ┌──────────────────────┐
                 │ MySQL                │
                 └──────────────────────┘

        REST/HTTP  = LỆNH   (client hỏi → server đáp)
        WebSocket  = SỰ KIỆN (server tự đẩy xuống)
```

**Nói:**
> Hệ thống theo mô hình **client – server**. Có bốn loại client đều là trang web: trang của khách trên điện thoại, màn
> hình bếp, trang thu ngân và trang quản trị. Server viết bằng **Java Spring Boot**, dữ liệu lưu trong **MySQL**. Bên
> ngoài còn có **cổng thanh toán VNPay** (môi trường thử), là một server khác gọi về server của nhóm.
>
> Client và server nói chuyện qua **hai kênh**, cùng chạy trên cổng 8080:
>
> - **Kênh REST trên HTTP** dùng cho **lệnh**: đặt món, huỷ đơn, đổi trạng thái món. Kiểu này là hỏi một câu, đáp một
>   câu, nên client biết chắc lệnh thành công hay thất bại qua mã trạng thái như 201, 409, 422.
> - **Kênh WebSocket với giao thức STOMP** dùng cho **sự kiện**: server **chủ động đẩy** xuống khi có đơn mới hoặc món
>   đổi trạng thái. Kết nối này được giữ mở liên tục nên không cần client hỏi đi hỏi lại.
>
> Khách và bếp không bao giờ nói chuyện trực tiếp với nhau; mọi thứ đều qua server.

**Ý chính:** client–server (khách, bếp, thu ngân, quản trị); REST cho lệnh, WebSocket/STOMP cho sự kiện; chung cổng
8080; VNPay là server bên ngoài.

---

## 4. ⭐ Giao tiếp mạng và giao thức (2 phút)

**Chiếu (các lớp giao thức):**

```text
┌──────────────────────────────────────────────┐
│ Giao thức của nhóm: {type, seq, eventId, ...}│  ← số thứ tự, ACK, RESUME
├──────────────────────────────────────────────┤
│ STOMP 1.2: CONNECT, SUBSCRIBE, SEND, MESSAGE │  ← kênh /topic/kitchen, /topic/table.5, /topic/cashier
├──────────────────────────────────────────────┤
│ WebSocket: kênh hai chiều, giữ mở liên tục   │
├──────────────────────────────────────────────┤
│ TCP / IP                                     │
└──────────────────────────────────────────────┘
```

**Chiếu tiếp (trình tự kết nối):**

```text
Client                                              Server
  │── TCP: SYN / SYN-ACK / ACK ───────────────────────▶│
  │── GET /ws   Upgrade: websocket ───────────────────▶│
  │◀─ 101 Switching Protocols ─────────────────────────│
  │── STOMP CONNECT  (token, heart-beat:10000,10000) ─▶│ kiểm tra quyền
  │◀─ STOMP CONNECTED ─────────────────────────────────│
  │── SUBSCRIBE /topic/kitchen ───────────────────────▶│ kiểm tra được nghe kênh này không
  │◀─ MESSAGE {"type":"ORDER_CREATED","seq":42,...} ───│ có đơn mới
  │── SEND /app/ack {"seq":42} ───────────────────────▶│ báo đã nhận
  │   ... heart-beat mỗi 10 giây ...                   │
  │   ✕ mất mạng → chờ 1 s, 2 s, 4 s ... (tối đa 30 s) → kết nối lại
```

**Nói:**
> Về giao thức, kênh sự kiện có ba lớp chồng lên nhau trên TCP.
>
> - Dưới cùng là **WebSocket**. Client gửi một HTTP request tới `/ws` có header `Upgrade: websocket`, server trả mã
>   **101 Switching Protocols**, từ đó kết nối TCP này chuyển thành kênh hai chiều.
> - Lớp giữa là **STOMP**, một giao thức dạng văn bản. Nó cho phép đăng ký nghe theo **kênh**: bếp nghe kênh
>   `/topic/kitchen`, **mọi điện thoại** của bàn 5 nghe chung kênh `/topic/table.5` nên cả bàn thấy đơn chung, thu ngân
>   nghe `/topic/cashier`. Khách chỉ được nghe kênh của bàn mình, chỉ thu ngân và quản trị được nghe kênh thu ngân;
>   server kiểm tra quyền ở từng lệnh đăng ký.
> - Lớp trên cùng là **giao thức của nhóm**: mỗi sự kiện có một **số thứ tự `seq`** tăng dần, cùng loại sự kiện, mã sự
>   kiện, thời gian và dữ liệu.
>
> Luồng kết nối: client mở WebSocket, gửi STOMP `CONNECT` kèm token đăng nhập (hoặc mã QR của bàn), server kiểm tra
> rồi trả `CONNECTED`, sau đó client đăng ký kênh.
>
> Để biết kết nối còn sống, hai bên gửi **heart-beat** mỗi 10 giây; quá khoảng 20 giây không nghe gì thì coi như đứt
> và client tự kết nối lại. Khi kết nối lại, client chờ lâu dần, 1 giây, 2 giây, 4 giây, tối đa 30 giây, có thêm một
> phần ngẫu nhiên, để cả quán có Wi-Fi lại thì các máy không cùng kết nối vào một giây làm server quá tải.
>
> Phần client STOMP này nhóm em **tự viết**, không dùng thư viện, để thấy rõ từng frame đi trên đường truyền.

**Có thể chỉ:** F12 → Network → WS → Messages để thấy frame `CONNECT`, `CONNECTED`, `SUBSCRIBE`, `MESSAGE`.

**Ý chính:** WebSocket (101) → STOMP (kênh, phân quyền) → envelope có `seq`; heart-beat 10 s; backoff + jitter.

---

## 5. ⭐ Giải pháp cho ba vấn đề – đây là điểm mới (3 phút)

**Chiếu (a – chống mất đơn):**

```text
Bếp                               Server                    MySQL (order_event)
  │◀── MESSAGE seq=41 ──────────────│                          │ 41 ORDER_CREATED
  │─── ACK 41 ─────────────────────▶│                          │
  │  ✕ mất mạng                      │── seq 42 → không tới ──▶ │ 42 ORDER_CREATED
  │                                  │── seq 43 → không tới ──▶ │ 43 ORDER_CREATED
  │  ... kết nối lại ...             │                          │
  │─── RESUME {lastSeq: 41} ───────▶│── SELECT ... seq > 41 ──▶│
  │◀── REPLAY_BATCH [42, 43] ───────│                          │
  │─── ACK 42, ACK 43 ─────────────▶│
```

**Chiếu (b – chống trùng đơn):**

```text
Khách                                   Server
  │── POST /api/orders  Key: K ─────────▶│ chưa có K → tạo đơn #17, lưu K
  │   ✕ câu trả lời bị mất               │
  │── POST /api/orders  Key: K (gửi lại)▶│ đã có K → KHÔNG tạo đơn mới
  │◀── 200 đơn #17 (Idempotent-Replayed) │
```

**Chiếu (c – chống ghi đè):**

```text
Chờ nhận ──▶ Đã nhận ──▶ Đang nấu ──▶ Sẵn sàng ──▶ Đã phục vụ
   └──▶ Đã huỷ  (chỉ khi còn Chờ nhận)

Bếp A: "Nhận",    version=0 ──▶ UPDATE ... WHERE version=0  → thành công, version = 1
Bếp B: "Từ chối", version=0 ──▶ version đã là 1 ≠ 0         → 409 VERSION_CONFLICT
```

**Nói:**

**a) Chống mất đơn:**
> TCP chỉ bảo đảm dữ liệu tới đủ trong **một** kết nối. Khi kết nối đứt và mở kết nối mới, những gì đang gửi dở trong
> kết nối cũ sẽ mất. Nên nhóm em làm thêm cơ chế ở tầng ứng dụng:
>
> - Mọi sự kiện được **lưu vào MySQL** trong bảng `order_event`, **cùng một giao dịch** với đơn hàng, và được đánh số
>   thứ tự `seq`.
> - Bếp nhận sự kiện nào thì gửi **ACK** báo đã nhận tới số đó.
> - Khi kết nối lại, bếp gửi **RESUME** kèm số cuối cùng nó có, ví dụ 41. Server đọc trong MySQL mọi sự kiện có số lớn
>   hơn 41 và **gửi bù**.
> - Nếu một sự kiện tới hai lần, bếp thấy trùng số thì bỏ qua. Nếu thấy số nhảy cóc, ví dụ đang 50 mà nhận 52, bếp tự
>   xin gửi bù.
>
> Ngoài ra, server chỉ đẩy sự kiện **sau khi giao dịch database đã commit**, nên bếp không bao giờ thấy một đơn mà
> database đã huỷ bỏ.

**b) Chống trùng đơn:**
> Mỗi lần khách bấm đặt, điện thoại sinh một mã ngẫu nhiên gọi là **Idempotency-Key** và gửi kèm. Gửi lại bao nhiêu
> lần cũng dùng đúng mã đó. Server lưu mã này với ràng buộc khoá chính; thấy mã đã có thì trả lại đơn cũ, không tạo đơn
> mới. Kể cả hai request cùng mã tới **cùng một lúc** thì database cũng chỉ cho một cái tạo được đơn.

**c) Chống ghi đè:**
> Mỗi món có một **máy trạng thái**: Chờ nhận → Đã nhận → Đang nấu → Sẵn sàng → Đã phục vụ; chuyển sai thứ tự thì bị
> từ chối. Thêm vào đó là **khoá lạc quan**: mỗi món có số phiên bản `version`, câu lệnh cập nhật chỉ chạy khi version
> trong database vẫn bằng version đầu bếp đã thấy. Hai người cùng bấm thì người sau nhận lỗi 409 và màn hình tự tải
> lại.

**d) Chống quá tải:**
> Nhóm tự cài thuật toán **token bucket** để giới hạn số request theo IP và số đơn theo bàn; giới hạn tối đa 8 kết nối
> WebSocket mỗi bàn; client nhận chậm bị ngắt để không làm nghẽn người khác.

**Ý chính:** seq + ACK + RESUME + gửi sau commit (không mất); Idempotency-Key (không trùng); state machine + version
(không ghi đè); token bucket (không quá tải).

---

## 6. ⭐ Phiên bàn và thanh toán (1 phút 30 giây)

**Chiếu (a – phiên bàn và đơn chung):**

```text
 Điện thoại A ─┐ POST /join          bàn trống → mở phiên mới:
 Điện thoại B ─┘ (cùng lúc)          UPDATE restaurant_table SET current_session_id = :mới
                                     WHERE id = :bàn AND current_session_id IS NULL
                                     → chỉ 1 máy thành công, máy kia vào phiên đó

 Cùng phiên → cùng nghe /topic/table.5 → ĐƠN CHUNG (ghi tên người đặt, "BẠN ĐẶT" cho đơn của mình)
 Thu ngân bấm "Trả bàn" → TABLE_SESSION_ENDED → mọi máy hiện "Cảm ơn quý khách"
```

**Chiếu (b – thanh toán, xác nhận server-to-server):**

```text
Khách                     Server nhóm                                 VNPay sandbox
  │ POST /api/payments ──▶│ server tự tính tiền; mỗi phiên 1 lần chờ   │
  │                       │ (UNIQUE pending_session_id)                │
  │ TIỀN MẶT ............ │◀── thu ngân "Đã nhận tiền" (khoá version)  │
  │ VNPAY: ◀── link có chữ ký HMAC-SHA512                              │
  │── trang VNPay, nhập thẻ test ─────────────────────────────────────▶│
  │                       │◀── IPN (có chữ ký): kiểm chữ ký, số tiền ──│
  │                       │──── 00 ghi nhận | 02 đã xử lý | 97 sai chữ ký ─▶│
  │◀── Return URL (có chữ ký) → về trang gọi món                       │
  │                       │── quá hạn chưa có tin: tra cứu querydr ───▶│
  │◀═ PAYMENT_UPDATED ════│═══▶ /topic/cashier: bàn "Đã thanh toán"
```

**Nói:**
> Nhóm em bổ sung nghiệp vụ trọn một lượt khách. Khách quét QR là điện thoại gọi `POST /join` để **vào bàn**; bàn trống
> thì server tự mở **phiên bàn**, nhân viên không phải bấm gì. Hai máy quét cùng lúc vẫn chỉ một phiên, vì câu `UPDATE`
> chỉ chạy được khi bàn **chưa có** phiên. Mọi điện thoại trong phiên nghe chung kênh của bàn nên thấy **đơn chung**,
> mỗi đơn ghi tên người đặt; mã thiết bị chỉ dùng để biết ai được huỷ đơn nào, không gửi cho máy khác.
>
> Thanh toán theo cả bàn, số tiền **do server tính**. Mỗi phiên chỉ có **một** lần thanh toán đang chờ, nhờ ràng buộc
> `UNIQUE` trong database, nên hai người cùng bấm cũng chỉ tạo một lần. Tiền mặt thì thu ngân bấm "Đã nhận tiền", có
> khoá lạc quan như ở bếp.
>
> Với VNPay, điểm quan trọng là **không tin trình duyệt**. Server VNPay gọi thẳng server của nhóm, gọi là **IPN**, kèm
> **chữ ký HMAC-SHA512** tính bằng khoá bí mật. Server tính lại chữ ký và so số tiền; sai thì từ chối. Việc ghi nhận là
> một câu `UPDATE` có điều kiện trạng thái, nên VNPay gọi lặp thì lần sau chỉ nhận mã `02`, **không cộng tiền hai lần**.
> Nếu IPN bị lạc, còn hai đường dự phòng: Return URL cũng có chữ ký, và server tự **tra cứu** giao dịch với VNPay
> trước khi cho lần thanh toán hết hạn sau 15 phút.

**Ý chính:** phiên bàn tự mở (UPDATE có điều kiện) → đơn chung; thanh toán: server tính tiền, 1 lần chờ (UNIQUE), IPN
server-to-server có chữ ký, idempotent (`02`), dự phòng Return URL + querydr. Phần này **chưa có số liệu đo**, chỉ có
test chức năng.

---

## 7. Xử lý nhiều client đồng thời (1 phút)

**Nói:**
> Về đồng thời: server dùng Tomcat với NIO, nên hàng nghìn kết nối WebSocket đang rảnh không chiếm thread nào. Request
> REST được xử lý bằng thread pool, mỗi request một giao dịch riêng. WebSocket có pool thread riêng cho chiều nhận và
> chiều gửi, và được cấu hình để mỗi client nhận tin đúng thứ tự.
>
> Dữ liệu dùng chung trong bộ nhớ, như danh sách kết nối và số kết nối mỗi bàn, dùng `ConcurrentHashMap` và
> `AtomicInteger`. Dữ liệu dùng chung trong database thì dùng khoá lạc quan, câu `UPDATE` có điều kiện và ràng buộc
> khoá chính / `UNIQUE` như em vừa trình bày: cho món ăn, cho phiên bàn và cho lần thanh toán.

---

## 8. Xử lý lỗi (30 giây)

**Nói:**
> Mọi lỗi đều trả về một định dạng JSON thống nhất gồm mã lỗi, thông báo và chi tiết. Request sai trả 400, mã QR sai
> 401, xung đột 409 (kể cả đặt món khi bàn đang thanh toán, hay điện thoại của lượt khách cũ), món hết 422, gửi quá
> nhanh 429, database lỗi thì rollback và trả 503. Dữ liệu VNPay sai chữ ký thì bị từ chối, không ghi nhận tiền. Frame STOMP sai chỉ làm phiên
> đó nhận báo lỗi, server không bị dừng. Bộ test tự động của nhóm có ca kiểm tra server vẫn sống sau một loạt request
> lỗi.

---

## 9. ⭐ Demo (6 phút)

Làm theo thứ tự, vừa làm vừa nói ngắn.

| Bước | Làm gì | Nói gì |
|---|---|---|
| 1 | Điện thoại quét QR, chọn món, bấm **Đặt món** | "Khách đặt món qua REST" |
| 2 | Chỉ màn hình bếp: đơn hiện ngay | "Server đẩy xuống bếp qua WebSocket, không cần tải lại" |
| 3 | Bếp bấm **Nhận** → **Bắt đầu nấu** → **Xong** | "Điện thoại khách cập nhật theo từng bước" |
| 4 | ⭐ Bếp bấm **Giả lập mất mạng 5s**, trong 5 giây đó điện thoại đặt thêm một đơn | "Bếp đang mất mạng, đơn vẫn được đặt" |
| 5 | Chờ bếp kết nối lại, chỉ đơn vừa đặt và ô **Gửi bù** | "Bếp kết nối lại, gửi RESUME, server gửi bù đơn bị lỡ, không mất đơn" |
| 6 | Điện thoại bật chế độ máy bay, bấm **Đặt món**; tắt chế độ máy bay, bấm **Gửi lại** | "Khách mất mạng khi đặt, gửi lại vẫn chỉ có một đơn nhờ Idempotency-Key" |
| 7 | Hai tab bếp cùng bấm **Nhận** một món | "Một bên thành công, bên kia nhận 409, không ghi đè" |
| 8 | Điện thoại thứ hai quét QR cùng bàn, nhập tên khác, đặt một món | "Hai máy cùng một phiên bàn: máy kia thấy ngay đơn mới, có tên người đặt, chỉ máy đặt mới huỷ được" |
| 9 | ⭐ Khách bấm **Thanh toán** → **Tiền mặt tại quầy**; chỉ màn hình Thu ngân | "Cả hai điện thoại hiện đang thanh toán, nút gọi món bị khoá; thu ngân thấy bàn chuyển cam 'Chờ thanh toán' qua `/topic/cashier`" |
| 10 | Thu ngân bấm vào bàn → **Đã nhận tiền** → **Trả bàn** | "Điện thoại hiện đã thanh toán đủ; trả bàn thì mọi máy hiện 'Cảm ơn quý khách', bàn về Trống" |
| 11 | (Nếu đã cấu hình VNPay qua ngrok) bàn khác: **Thanh toán → VNPay**, trả bằng thẻ test NCB | "VNPay gọi IPN về server có chữ ký; server kiểm rồi mới ghi đã trả, thu ngân thấy 'Đã thanh toán'" |
| 12 | (Nếu còn thời gian) F12 → WS → Messages | "Đây là các frame STOMP thật, có `seq`, có ACK" |

Nếu demo bị lỗi mạng thật trong phòng: bình tĩnh nói "đây chính là tình huống hệ thống được thiết kế để chịu", chờ kết
nối lại hoặc chuyển sang cửa sổ chạy trên máy (`localhost`).

---

## 10. ⭐ Kết quả thực nghiệm (1 phút 30 giây)

**Chiếu:** bảng kết quả bên dưới.

**Nói:**
> Để chứng minh, nhóm em viết công cụ đo tự động và so sánh với cách làm thông thường trên **cùng một mã nguồn**, chỉ
> bật tắt từng cơ chế.

> ⚠️ Các số dưới đây là lần đo **trên H2 (cơ sở dữ liệu chạy trong RAM)**, bản rút gọn. Nếu nhóm đã chạy lại bằng
> MySQL thì thay bằng số MySQL. Nếu chưa, phải nói rõ với thầy là số đo trên H2.

| Thực nghiệm | Không có cơ chế | Có cơ chế của nhóm |
|---|---:|---:|
| Bếp mất mạng 3 giây, 200 đơn | Mất **31** đơn (15,5%) | Mất **0** đơn |
| Mất phản hồi / bấm 2 lần, 100 đơn | Trùng **34%** | Trùng **0%** |
| 10 bếp cùng sửa một món, 20 lượt | **134** lần ghi đè | **0** |
| Độ trễ đặt món → bếp nhận (trung vị) | 1342 ms (hỏi định kỳ 3 giây) | **7,7 ms** (đẩy qua WebSocket) |
| Một máy gửi spam 15 giây | 45 708 đơn rác lọt vào | chỉ **6** lọt vào, CPU giảm từ 14% xuống 4,4% |

**Nói thêm (thành thật, thầy đánh giá cao):**
> Có hai điểm nhóm em ghi nhận là chưa tốt: trong kịch bản đo, đẩy qua WebSocket tốn nhiều byte hơn hỏi định kỳ một
> chút; và rate limit giúp bảo vệ database và CPU rõ ràng, nhưng độ trễ của khách bình thường thay đổi không đáng kể.
>
> Các số này đo **trước** khi nhóm thêm phiên bàn và thanh toán (khi đó giới hạn là 5 đơn/phút mỗi bàn, nay là 10).
> Phần thanh toán chưa có số đo, chỉ có test tự động: sai chữ ký trả `97`, sai số tiền `04`, gọi lặp `02`.

---

## 11. Điểm mới và đóng góp (30 giây)

**Nói:**
> Tóm lại, điểm mới của nhóm không phải một thuật toán mới, mà là **thiết kế và tích hợp một giao thức giao đơn tin
> cậy** trên WebSocket/STOMP, gồm số thứ tự, ACK, gửi bù từ nhật ký sự kiện và chỉ gửi sau commit; cùng với đặt món
> idempotent, khoá lạc quan và chống quá tải; và **có số liệu đo** so với cách làm thông thường. Thêm vào đó là
> **xác nhận thanh toán server-to-server có chữ ký và idempotent**, cùng phiên bàn và thanh toán an toàn khi nhiều
> điện thoại thao tác cùng lúc.

---

## 12. Hạn chế và hướng phát triển (30 giây)

**Nói:**
> Hệ thống còn một số hạn chế: mới chạy trên một server; số liệu chủ yếu đo trên một máy; nhật ký sự kiện chưa có cơ
> chế dọn dẹp; chưa dùng HTTPS khi chạy trong mạng nội bộ; thanh toán mới chạy trên môi trường thử của VNPay, chưa có
> số đo, hoàn tiền vẫn làm tay. Hướng phát triển là chạy nhiều server với broker riêng, đo
> trong mạng thật, và thêm bảo mật.

---

## 13. Kết thúc (15 giây)

**Nói:**
> Phần trình bày của nhóm em đến đây là hết. Em cảm ơn thầy đã lắng nghe, mời thầy đặt câu hỏi.

---

## Phụ lục: câu thầy hay hỏi và trả lời ngắn

| Câu hỏi | Trả lời ngắn |
|---|---|
| Client và server giao tiếp thế nào? | REST/HTTP cho lệnh, WebSocket/STOMP cho sự kiện, chung cổng 8080 |
| Sao không dùng WebSocket cho cả lệnh? | Lệnh cần phản hồi rõ ràng (201/409/422) để biết thành công hay không và thử lại an toàn; REST làm việc này tự nhiên |
| STOMP là gì, sao không dùng WebSocket thuần? | WebSocket chỉ là đường truyền; STOMP thêm kênh để đăng ký nghe, heart-beat, frame lỗi; Spring hỗ trợ sẵn |
| Kết nối WebSocket thiết lập thế nào? | HTTP GET có `Upgrade: websocket` → 101 → STOMP CONNECT kèm token → CONNECTED → SUBSCRIBE |
| Làm sao biết client mất kết nối? | Heart-beat mỗi 10 s, quá 2 chu kỳ không nhận gì thì coi là đứt; server dọn phiên khi nhận sự kiện ngắt kết nối |
| TCP đã tin cậy rồi, sao còn làm seq/ACK? | TCP tin cậy trong một kết nối; đứt kết nối thì phần đang gửi mất, kết nối mới không gửi lại |
| Bếp mất mạng lâu, hàng trăm đơn thì sao? | Gửi bù theo lô 500 sự kiện; còn thiếu thì client tự xin lô tiếp |
| Hai request cùng Idempotency-Key tới cùng lúc? | Cả hai cùng chèn khoá vào DB, khoá chính chỉ cho một cái thắng; cái kia đọc lại đơn của cái thắng |
| Sao gửi sự kiện sau commit? | Nếu gửi trước mà giao dịch rollback (món hết, lỗi DB) thì bếp thấy đơn không tồn tại |
| Xử lý nhiều client thế nào? | Tomcat NIO + thread pool; dữ liệu trong RAM dùng ConcurrentHashMap/AtomicInteger; dữ liệu trong DB dùng khoá lạc quan và UPDATE có điều kiện |
| Hai điện thoại quét QR bàn trống cùng lúc thì sao? | Cả hai gọi `POST /join`; câu `UPDATE ... WHERE current_session_id IS NULL` chỉ cho một máy mở phiên, máy kia vào phiên đó |
| Sao khách thấy đơn của người khác cùng bàn? | Cùng phiên bàn nghe chung `/topic/table.{id}`; mã thiết bị chỉ để xác định quyền huỷ, không gửi cho máy khác |
| Sao không tin kết quả VNPay trên trình duyệt? | Trình duyệt có thể bị sửa hoặc bị đóng giữa chừng; kết quả chỉ ghi nhận khi chữ ký HMAC-SHA512 khớp và số tiền khớp số server tính; kênh chính là IPN server-to-server |
| VNPay gửi IPN hai lần thì sao? | Ghi nhận bằng `UPDATE` có điều kiện trạng thái; lần sau thấy đã `PAID` nên trả `02`, không cộng tiền hai lần |
| IPN không tới thì sao? | Return URL cũng có chữ ký nên vẫn ghi nhận được; ngoài ra server tra cứu `querydr` trước khi cho lần thanh toán hết hạn (15 phút) |
| Hai người cùng bấm Thanh toán? | Cột `pending_session_id` có ràng buộc `UNIQUE`: database chỉ cho một lần đang chờ, người sau nhận lại lần đó |
| Optimistic locking là gì? | Không khoá trước; lúc ghi kiểm tra version còn như lúc đọc không, khác thì báo xung đột 409 |
| Token bucket hoạt động thế nào? | Mỗi IP/bàn có một "thùng" token, mỗi request lấy 1 token, token được nạp lại đều theo thời gian; hết token thì trả 429 |
| Số liệu đo thế nào? | Công cụ Node.js tự viết đóng cả vai khách và bếp trong cùng một tiến trình, đo bằng cùng một đồng hồ; baseline và đề xuất chạy cùng mã nguồn, chỉ đổi cấu hình |
| Hạn chế của thực nghiệm? | Đo trên một máy qua localhost; mất mạng được giả lập bằng cách cắt kết nối từ phía client; (nếu chưa đo MySQL) số liệu hiện có đo trên H2 |

Thầy có thể yêu cầu **giải thích một đoạn code**. Nên tập trước với 4 chỗ:

1. `EventPublisher.afterCommit()` – gửi sự kiện sau commit.
2. `OrderService.placeOrder()` – xử lý Idempotency-Key.
3. `OrderRepository.updateItemStatus()` – câu `UPDATE ... WHERE version = ?`.
4. `kitchenFeed.js` hàm `_accept()` và `_onReplay()` – chống trùng, phát hiện thiếu, nhận gửi bù.
5. `TableService.join()` – mở phiên bàn bằng `UPDATE ... WHERE current_session_id IS NULL`.
6. `PaymentService.handleVnpayCallback()` và `VnpayGateway.verify()` – kiểm chữ ký, số tiền, trả mã `00/02/04/97`.