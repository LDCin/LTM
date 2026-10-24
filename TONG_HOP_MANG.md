# Tổng hợp: các vấn đề mạng, cách xử lý và điểm mới

Tài liệu ôn bảo vệ. Số liệu lấy từ báo cáo (`report/report.md`, mục 9), đo bằng H2 trên một máy (bản rút gọn ngày
17/10/2026); số liệu MySQL chưa có.

---

## 1. Các vấn đề về mạng và cách xử lý

### Nhóm A – Giao sự kiện tới bếp (trọng tâm đề tài)

| # | Vấn đề | Vì sao xảy ra | Cách xử lý | Bằng chứng |
|---|---|---|---|---|
| 1 | **Mất đơn khi bếp rớt mạng** | TCP chỉ đảm bảo trong *một* kết nối; kết nối đứt thì phần đang gửi dở mất, kết nối mới không gửi lại | Mỗi sự kiện có số thứ tự `seq`, lưu trong nhật ký `order_event`; bếp ACK; kết nối lại thì gửi RESUME kèm `seq` cuối, máy chủ gửi bù theo lô (REPLAY_BATCH) | E2: mất 31/200 → 0/200 |
| 2 | **Nhận trùng, lủng số thứ tự** | Một sự kiện có thể tới hai lần (đẩy + gửi bù); giao dịch rollback để lại "lỗ" `seq` | Tập `seq` đã thấy để bỏ trùng; `watermark` để phát hiện thiếu; số máy chủ báo không tồn tại thì coi là lỗ do rollback | e2e nhóm 14 |
| 3 | **"Đơn ma"** (bếp thấy đơn đã bị huỷ do lỗi) | Gửi sự kiện trước khi dữ liệu được commit | Chỉ gửi sau commit (`afterCommit`); ghi nhật ký cùng giao dịch với đơn | Thiết kế mục 4.4 |
| 4 | **Độ trễ cao** | Polling: bếp hỏi 3 giây/lần | Máy chủ chủ động đẩy qua WebSocket + STOMP | E1: p50 1341,68 ms → 7,71 ms |
| 5 | **Kết nối "chết" mà không biết** | Wi-Fi rớt nhưng TCP không báo đóng (half-open) | STOMP heart-beat 10 s; im lặng quá 2 chu kỳ thì coi là chết, kết nối lại | |
| 6 | **Nhiều máy kết nối lại cùng lúc** (reconnect storm) | Máy chủ khởi động lại, mọi client lao vào kết nối một lúc | Exponential backoff 1 s → 30 s + jitter ±50% | |

### Nhóm B – Request lặp và cập nhật đồng thời

| # | Vấn đề | Cách xử lý | Bằng chứng |
|---|---|---|---|
| 7 | **Đơn trùng** (bấm 2 lần, mất phản hồi nên client tự gửi lại) | `Idempotency-Key` + băm SHA-256 nội dung; khoá chính trong CSDL phân xử request trùng tới cùng lúc; client lưu khoá trong `localStorage` | E3: trùng 34% → 0% |
| 8 | **Ghi đè lẫn nhau** (hai bếp cùng bấm một món, hai thu ngân cùng xác nhận tiền) | Máy trạng thái + khoá lạc quan `UPDATE … WHERE version = ?`; người sau nhận `409` | E4: lost update 134 → 0 |
| 9 | **Nhiều điện thoại cùng bàn thao tác cùng lúc** (mở bàn, thanh toán, gọi phục vụ) | `UPDATE` có điều kiện và ràng buộc `UNIQUE`: một phiên mỗi bàn, một lần thanh toán chờ mỗi phiên, một lượt gọi phục vụ mỗi phiên | JUnit; e2e nhóm 15–17 |
| 10 | **Máy của lượt khách trước** gửi request vào phiên của khách sau | Header `X-Session-Id`; phiên đã kết thúc → `409 SESSION_ENDED` | |

### Nhóm C – Quá tải và an toàn kênh truyền

| # | Vấn đề | Cách xử lý | Bằng chứng |
|---|---|---|---|
| 11 | **Spam / client bất thường** | Token bucket theo IP và theo bàn → `429` + `Retry-After`; giới hạn số kết nối WebSocket mỗi bàn | E6: spam lọt 45 708 → 6; CPU 14,00% → 4,38% |
| 12 | **Client nhận chậm làm nghẽn máy chủ** | Giới hạn bộ đệm và thời gian gửi; client quá chậm bị ngắt | |
| 13 | **CSDL quá tải** | Giới hạn pool và thời gian chờ → `503` + `Retry-After`; thực đơn có `ETag` → `304` | |
| 14 | **Timeout, máy chủ tạm không phản hồi** | REST timeout 5 s; chỉ thử lại lỗi tạm thời; đơn chưa gửi được giữ lại để gửi lại với cùng khoá | |
| 15 | **Nghe lén / gửi frame sai quyền** | Xác thực ở `CONNECT`, kiểm quyền ở `SUBSCRIBE` / `SEND`; frame lỗi hoặc quá 64 KB → `ERROR`, máy chủ không sập | |

### Nhóm D – Giao tiếp với hệ thống bên ngoài (VNPay)

| # | Vấn đề | Cách xử lý |
|---|---|---|
| 16 | **Dữ liệu thanh toán bị giả mạo** | Kiểm chữ ký HMAC-SHA512 và số tiền |
| 17 | **Mất xác nhận thanh toán** (IPN lạc, khách đóng trình duyệt) | Ba đường: IPN, Return URL, tra cứu `querydr`; ghi nhận idempotent nên VNPay gọi lặp không ghi hai lần |
| 18 | **Máy chủ nằm sau NAT**, không có IP công khai | Tunnel (ngrok / Cloudflare) |

---

## 2. Điểm mới: đánh giá thẳng

**Về mặt kỹ thuật mạng, dự án hiện chưa có kỹ thuật nào thật sự mới.** Số thứ tự + ACK + gửi lại, idempotency key,
outbox / phát sau commit, khoá lạc quan, token bucket, heart-beat, backoff + jitter đều là kỹ thuật kinh điển. Cái nhóm
làm được là **áp dụng đúng cho bài toán gọi món và đo được bằng số liệu**, không phải phát minh.

**Đề bài vẫn chấp nhận mức này.** `Instruction.md` mục 7: điểm mới "không nhất thiết phải là một thuật toán hoàn toàn
mới trên thế giới", có thể là "một protocol/message format", "một cơ chế fault tolerance", "một cơ chế adaptive", "một
cải tiến dựa trên baseline"..., miễn là có bằng chứng từ hiện thực hoặc thực nghiệm. Phần hiện tại đạt mức đó (giao
thức tin cậy được so với hai baseline POLLING và NAIVE_PUSH, có số liệu E1–E6). Nhưng nếu bị hỏi "có gì mới về mạng?",
câu trả lời hiện tại yếu.

**Không nên nói** "nhóm phát minh ra" các kỹ thuật ở mục 1. **Nên nói:**

> "Các vấn đề mất tin, trùng tin, ghi đè đồng thời và quá tải đều đã được biết, các kỹ thuật cũng đã có. Nhóm áp dụng
> chúng thành một giao thức giao nhận tin cậy cho màn hình bếp và chứng minh bằng thực nghiệm so với baseline trên cùng
> mã nguồn."

---

## 3. Ứng viên điểm mới thật sự về mạng

Cả ba đều xuất phát từ vấn đề **chính dự án này đã gặp**, mà cách làm thông thường xử lý chưa tốt.

| # | Vấn đề thật đã gặp | Cách làm thông thường hỏng ở đâu | Đề xuất (điểm mới) | Đo bằng gì |
|---|---|---|---|---|
| **1** | Màn hình bếp ghi **RESUME 48–112 lần** trong khi chỉ nhận 8 đơn (ảnh chụp trang Giám sát / thanh thống kê bếp, 25/10/2026) | Heart-beat cố định 10 s. Khi tab hoặc máy tính bảng chạy nền, trình duyệt hãm bộ hẹn giờ, nên máy chủ tưởng client chết và cắt kết nối, client lại kết nối lại, lặp mãi | **Heart-beat thích ứng theo trạng thái thiết bị**: trang ẩn thì client báo máy chủ giãn chu kỳ (hoặc chuyển chế độ "ngủ" nối lại phiên nhanh); trang hiện lại thì RESUME ngay | Số lần kết nối lại / giờ, số byte, độ trễ nhận đơn sau khi bật lại màn hình; so với heart-beat cố định |
| **2** | Qua tunnel / NAT, **mọi điện thoại cùng một IP** `127.0.0.1` | Rate limit theo IP: hoặc chặn oan cả nhà hàng, hoặc phải tin header `X-Forwarded-For` giả mạo được | **Rate limit theo danh tính ứng dụng** (thiết bị đã gắn với phiên bàn) thay vì IP, kèm giới hạn chung cho cả cổng; không cần tin header nào | Tỉ lệ chặn oan khách thường và tỉ lệ chặn spam khi nhiều khách sau một NAT; so với rate limit theo IP |
| **3** | **Thứ tự commit ≠ thứ tự `seq`** (báo cáo mục 12, hạn chế 5) | Client đẩy `watermark` qua "lỗ" quá sớm, có thể bỏ sót một đơn commit muộn | Cấp `seq` theo thứ tự commit, hoặc chỉ coi là lỗ sau một khoảng an toàn | Số đơn bị bỏ sót khi ép hai giao dịch commit đảo thứ tự |

**Khuyến nghị: số 1.** Có triệu chứng thật đo được ngay trên hệ thống; đúng bối cảnh (máy tính bảng bếp tắt màn hình
là chuyện hằng ngày); thuần mạng (chu kỳ heart-beat, phát hiện kết nối chết, chi phí kết nối lại); vừa phạm vi đồ án.
Số 2 là lựa chọn thứ hai, đồng thời giải quyết luôn chuyện `X-Forwarded-For`.

**Lưu ý:** nguyên nhân của số 1 (trình duyệt hãm bộ hẹn giờ của tab nền) **chưa được kiểm chứng**. Bước đầu tiên là tái
hiện: để tab bếp chạy nền vài phút, đếm số lần kết nối lại, xem log máy chủ để xác nhận lý do cắt kết nối, rồi mới thiết
kế.

### Lưu ý khi trình bày

* Số liệu hiện tại đo bằng H2 trên một máy, chưa có MySQL và mạng thật; nếu bị hỏi thì nói thẳng, đây là hạn chế đã
  ghi trong báo cáo.
* Thanh toán, gọi phục vụ và huỷ món mới được kiểm thử chức năng, chưa có số đo hiệu năng.

---

## 4. Bổ sung: trợ lý gợi ý món (điểm mới không thuần mạng)

Đề bài cho phép điểm mới không chỉ về mạng ("một cách tích hợp các thành phần", "một cách sử dụng ML"). Chatbot gợi ý
món **tự nó không mới**; điểm khác của dự án (báo cáo mục 4.12):

* **Neo vào trạng thái thời gian thực**: mô hình nhận tồn kho, tải bếp, đơn chung của bàn, nên không gợi ý món đã hết,
  tránh món bếp đang dồn khi khách cần nhanh, không gợi ý trùng món bàn đã gọi.
* **Client bị ràng buộc**: đầu ra JSON theo lược đồ, máy chủ kiểm lại từng gợi ý (giá, tên lấy từ thực đơn), trợ lý không
  có quyền đặt món.
* **Phần mạng của nó**: gọi dịch vụ HTTPS bên ngoài có hạn mức thấp → giới hạn mỗi bàn, timeout, tôn trọng
  `Retry-After` khi Gemini báo 429, circuit breaker khi lỗi liên tiếp, gợi ý dự phòng khi AI không dùng được.
* **Bằng chứng**: E7 so "AI có ngữ cảnh thời gian thực" với "AI chỉ biết thực đơn in sẵn" trên 24 câu hỏi; **chưa chạy**
  vì cần khoá Gemini (`GEMINI_API_KEY`).
