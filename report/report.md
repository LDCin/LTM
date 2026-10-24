# QR Order: Hệ thống gọi món qua mã QR với kênh giao đơn tới bếp tin cậy, thời gian thực trên WebSocket/STOMP

> **BẢN NHÁP** – soạn ngày 17/10/2026 để chuyển sang `NhomXX_QROrder_Report.docx`.
> Các chỗ đánh dấu `[CẦN ĐIỀN ...]` phải được nhóm bổ sung trước khi nộp.
> Toàn bộ số liệu trong mục 9 lấy nguyên từ `statics/results/` (lần chạy rút gọn `run-all.js --quick` ngày 17/10/2026, **cơ sở dữ liệu H2 chạy trong RAM**). Chưa có số liệu đo với MySQL.
> Ngày 24/10/2026 hệ thống được bổ sung **phiên bàn tự mở, đơn chung của bàn, trang thu ngân và thanh toán (tiền mặt, VNPay sandbox)** (mục 4.9). Các số liệu E1–E6 được đo **trước** thay đổi này (khi đó rate limit đặt món là 5 đơn/phút/bàn, nay là 10); chức năng thanh toán chưa có số liệu thực nghiệm, chỉ có kiểm thử chức năng (mục 7.5).

| | |
|---|---|
| Môn học | Lập trình mạng – Năm học 2026–2027 |
| Chủ đề | [CẦN ĐIỀN: mã topic – Chủ đề 3, Ứng dụng mạng] |
| Nhóm | [CẦN ĐIỀN: số nhóm, họ tên, MSSV các thành viên] |
| Giảng viên | [CẦN ĐIỀN] |

---

## Tóm tắt (Abstract)

Ở nhà hàng, khách gọi món qua điện thoại kết nối Wi-Fi, còn màn hình bếp (Kitchen Display System – KDS) thường là một máy tính bảng có thể rớt mạng bất kỳ lúc nào. Nếu chỉ đẩy đơn qua WebSocket kiểu "gửi rồi quên", những đơn phát ra đúng lúc bếp mất kết nối sẽ biến mất; nếu khách bấm "Đặt món" hai lần hoặc trình duyệt tự gửi lại do không nhận được phản hồi, đơn sẽ bị nhân đôi; nếu hai đầu bếp cùng bấm trên một món, cập nhật của người này đè lên người kia. Báo cáo trình bày **QR Order**, một hệ thống client–server gồm ứng dụng web cho khách, cho bếp, cho thu ngân và cho quản trị, máy chủ Spring Boot và cơ sở dữ liệu quan hệ. Khách quét QR là tự vào **phiên bàn** chung với các điện thoại khác cùng bàn, thấy đơn chung của bàn, và thanh toán cả bàn bằng tiền mặt (thu ngân xác nhận) hoặc qua cổng VNPay sandbox. Lệnh nghiệp vụ đi qua REST/HTTP, còn sự kiện được máy chủ đẩy qua WebSocket với giao thức con STOMP 1.2. Phần đóng góp nằm ở tầng giao thức ứng dụng: (1) mỗi sự kiện mang số thứ tự toàn cục `seq` lấy từ bảng nhật ký sự kiện; client bếp ACK, loại trùng, phát hiện khoảng trống và gửi `RESUME` để máy chủ phát bù từ nhật ký; (2) sự kiện chỉ được phát sau khi giao dịch cơ sở dữ liệu commit; (3) đặt món idempotent bằng header `Idempotency-Key` kèm băm nội dung; (4) máy trạng thái cho từng món kết hợp khoá lạc quan theo `version`; (5) nhiều lớp chống quá tải gồm token bucket, giới hạn kết nối WebSocket theo bàn, giới hạn bộ đệm gửi và kết nối lại có backoff + jitter. Baseline và giải pháp đề xuất chạy trên cùng mã nguồn, chuyển đổi lúc chạy qua API cấu hình. Trong lần thực nghiệm rút gọn trên H2: khi bếp mất mạng 3 giây, chế độ đẩy thông thường mất 31/200 đơn (15,5%) còn chế độ đề xuất mất 0/200; khi có mất phản hồi và bấm hai lần, tỷ lệ đơn trùng giảm từ 34% xuống 0%; với 10 client cùng sửa một món, số lost update giảm từ 134 xuống 0; độ trễ trung vị từ lúc đặt món đến lúc bếp nhận giảm từ 1341,68 ms (polling 3 s) xuống 7,71 ms. Số liệu với MySQL đang được bổ sung. Ngoài ra, kết quả thanh toán VNPay được xác nhận theo kiểu server-to-server (IPN) có chữ ký HMAC-SHA512 và xử lý idempotent; phần này mới được kiểm thử chức năng, chưa đo hiệu năng.

## Từ khóa (Keywords)

WebSocket; STOMP; giao đơn tin cậy (reliable delivery); idempotency; optimistic locking; rate limiting; thanh toán trực tuyến (IPN, HMAC-SHA512).

---

## 1. Giới thiệu (Introduction)

### 1.1. Bối cảnh

Gọi món bằng mã QR đặt sẵn trên bàn đã trở nên quen thuộc: khách quét mã, mở trang web thực đơn trên điện thoại và tự gửi đơn, không cần chờ nhân viên ghi order. Ở phía sau, đơn cần đến được bếp càng nhanh càng tốt, và trạng thái chế biến cần quay lại màn hình của khách. Toàn bộ chuỗi này chạy trên một mạng không hoàn hảo: Wi-Fi nhà hàng thường đông thiết bị, tín hiệu trong khu bếp yếu, máy tính bảng tự tắt màn hình hoặc chuyển điểm truy cập.

### 1.2. Vấn đề và động lực

Phần lớn ứng dụng gọi món đơn giản dùng một trong hai cách để báo đơn cho bếp:

* **Polling**: màn hình bếp hỏi máy chủ định kỳ. Cách này dễ làm và không mất đơn, nhưng đơn chỉ hiện ra ở lần hỏi kế tiếp, nghĩa là độ trễ trung bình xấp xỉ một nửa chu kỳ hỏi, đồng thời máy chủ phải trả lời cả những lần hỏi không có gì mới.
* **Đẩy qua WebSocket kiểu "fire-and-forget"**: máy chủ phát sự kiện tới mọi kết nối đang mở. Độ trễ thấp, nhưng nếu kết nối của bếp đang đứt thì sự kiện không được lưu lại cho ai cả.

TCP chỉ bảo đảm thứ tự và toàn vẹn dữ liệu **trong phạm vi một kết nối** [21]. Khi kết nối bị cắt và mở lại, những gì đã gửi vào kết nối cũ mà chưa tới nơi sẽ không được TCP gửi lại. Đây đúng là trường hợp mà lập luận end-to-end của Saltzer, Reed và Clark mô tả: tính tin cậy mà ứng dụng cần phải được kiểm tra ở hai đầu ứng dụng chứ không thể giao hết cho tầng vận chuyển [16]. Bên cạnh mất sự kiện, hệ thống còn gặp hai lỗi kinh điển khác của ứng dụng mạng: **request bị gửi lặp** (khách bấm hai lần, client tự thử lại khi hết thời gian chờ) và **ghi đè đồng thời** (hai đầu bếp cùng thao tác trên một món).

### 1.3. Phát biểu bài toán

Thiết kế và hiện thực một hệ thống gọi món qua QR trong đó mỗi đơn hợp lệ được tạo **đúng một lần** trong cơ sở dữ liệu và được hiển thị ở màn hình bếp **không mất, không trùng**, với độ trễ thấp, kể cả khi: (a) kết nối của màn hình bếp bị gián đoạn; (b) client gửi lại cùng một yêu cầu; (c) nhiều màn hình bếp cùng cập nhật một món; (d) một client gửi request với tốc độ bất thường.

### 1.4. Mục tiêu

1. Khách quét QR, xem thực đơn và đặt món qua REST API; theo dõi trạng thái món theo thời gian thực.
2. Đơn được đẩy tới màn hình bếp qua WebSocket/STOMP; bếp cập nhật trạng thái từng món và mọi bên liên quan nhận được ngay.
3. Không mất sự kiện khi bếp mất kết nối tạm thời (seq + ACK + RESUME/replay).
4. Không tạo đơn trùng khi client gửi lại (Idempotency-Key).
5. Không mất cập nhật khi nhiều bếp thao tác cùng lúc (state machine + optimistic locking).
6. Hạn chế ảnh hưởng của client gửi dồn dập tới các client khác (rate limiting và các giới hạn tài nguyên).
7. Đo lường và so sánh định lượng giải pháp với baseline trên cùng mã nguồn.
8. Phiên bàn tự mở khi khách đầu tiên quét QR; mọi điện thoại cùng bàn thấy đơn chung (ghi tên người đặt); thu ngân kết thúc phiên bằng "Trả bàn".
9. Thanh toán theo bàn bằng tiền mặt hoặc VNPay sandbox: số tiền do máy chủ tính, mỗi phiên tối đa một lần thanh toán đang chờ, kết quả VNPay chỉ được ghi nhận khi có chữ ký hợp lệ và không bị ghi nhận hai lần.

### 1.5. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
|---|---|
| QR theo bàn, phiên bàn (table session) tự mở khi quét QR, ngừng/phục vụ lại bàn, đổi mã QR | Thanh toán thật (môi trường production), hoàn tiền tự động, chia hóa đơn |
| Thực đơn, giỏ hàng, ghi chú món, giới hạn số lượng (stock) | Nhiều chi nhánh, nhiều nhà hàng |
| Màn hình bếp thời gian thực, cập nhật trạng thái từng món | Giao hàng, đặt bàn trước |
| Đăng nhập nhân viên (bếp, thu ngân, quản trị) | Ứng dụng di động native |
| Đơn chung của bàn, tên khách; thanh toán theo bàn: tiền mặt và VNPay **sandbox** | |
| Giao đơn tin cậy, idempotency, đồng bộ nhiều bếp, chống quá tải | Triển khai cloud, nhiều máy chủ |
| Bộ công cụ thực nghiệm E1–E6 | HTTPS/WSS (chạy trong mạng LAN) |

### 1.6. Đóng góp chính

* Một **giao thức sự kiện tin cậy** chạy trên STOMP: envelope có `seq`, `eventId`, `serverTime`; ACK; RESUME/REPLAY_BATCH theo trang; thuật toán watermark phía client xử lý trùng, khoảng trống và "lỗ" seq do giao dịch rollback.
* Kết hợp **event log trong cùng giao dịch + phát sau commit** để kênh WebSocket chỉ còn là đường vận chuyển, còn cơ sở dữ liệu là nguồn sự thật cho việc phát bù.
* **Đặt món idempotent** chịu được cả request lặp tuần tự lẫn request lặp đồng thời, dựa trên ràng buộc khoá chính và băm SHA-256 nội dung.
* **Đồng bộ nhiều màn hình bếp** bằng máy trạng thái và khoá lạc quan.
* **Chống quá tải nhiều lớp** với token bucket tự cài đặt.
* Một **khung thực nghiệm** so sánh baseline và đề xuất trên cùng mã nguồn, bật/tắt lúc chạy; client STOMP do nhóm tự viết được dùng chung cho trình duyệt và bộ sinh tải.
* **Xác nhận thanh toán server-to-server có chữ ký, idempotent**: IPN của VNPay được kiểm chữ ký HMAC-SHA512 và số tiền, ghi nhận bằng `UPDATE` có điều kiện trạng thái nên gọi lặp không ghi nhận hai lần; có đường dự phòng (Return URL có chữ ký, tra cứu `querydr`) khi IPN bị lạc. Phiên bàn và lần thanh toán đang chờ được giữ duy nhất bằng `UPDATE` có điều kiện và ràng buộc `UNIQUE` của cơ sở dữ liệu.

### 1.7. Cấu trúc báo cáo

Mục 2 trình bày kiến thức nền và các giải pháp liên quan. Mục 3 định nghĩa bài toán. Mục 4 mô tả giải pháp đề xuất; mục 5 và 6 trình bày kiến trúc và thiết kế giao tiếp mạng. Mục 7 mô tả hiện thực. Mục 8–10 trình bày thiết lập thực nghiệm, kết quả và thảo luận. Mục 11 tổng hợp đóng góp; mục 12–14 nêu hạn chế, hướng phát triển và kết luận.

---

## 2. Kiến thức nền và các nghiên cứu liên quan (Background / Related Work)

### 2.1. HTTP và REST

HTTP là giao thức request/response: client mở kết nối TCP, gửi request gồm phương thức, đường dẫn, header và thân; máy chủ trả mã trạng thái, header và thân [3]. Ngữ nghĩa HTTP định nghĩa sẵn nhiều công cụ hữu ích cho hệ thống này: mã `409 Conflict` cho xung đột trạng thái, `ETag`/`If-None-Match` và `304 Not Modified` cho cache có kiểm tra lại, header `Retry-After` cho biết client nên chờ bao lâu [3]; mã `429 Too Many Requests` được bổ sung trong RFC 6585 [4]. HTTP cũng phân biệt phương thức idempotent (GET, PUT, DELETE) và không idempotent (POST) [3]. Tạo đơn là POST, nên nếu không có cơ chế bổ sung thì gửi lại một request POST có thể tạo ra đơn mới.

### 2.2. Các cách đẩy dữ liệu từ máy chủ tới client

* **Polling ngắn**: client gửi request định kỳ. Độ trễ phụ thuộc chu kỳ hỏi; chi phí tăng theo số client và tần suất hỏi.
* **Long polling và HTTP streaming**: máy chủ giữ request tới khi có dữ liệu. RFC 6202 phân tích các vấn đề của hai kỹ thuật này như chi phí header lặp lại, ảnh hưởng của proxy và giới hạn số kết nối [5].
* **Server-Sent Events**: một luồng HTTP một chiều từ máy chủ tới client [6].
* **WebSocket** (RFC 6455): bắt đầu bằng một HTTP request có header `Upgrade: websocket`, máy chủ trả `101 Switching Protocols`, sau đó hai bên trao đổi các frame hai chiều trên cùng kết nối TCP; giao thức có frame điều khiển ping/pong và close [1]. WebSocket chỉ cung cấp kênh truyền message, không quy định ý nghĩa của message.

### 2.3. STOMP

STOMP (Simple Text Oriented Messaging Protocol) là giao thức nhắn tin dạng văn bản. Mỗi frame gồm một dòng lệnh, các dòng header `khoá:giá trị`, một dòng trống, phần thân và ký tự NUL kết thúc [2]. Client gửi `CONNECT`, nhận `CONNECTED`; đăng ký nhận bằng `SUBSCRIBE`; gửi bằng `SEND`; máy chủ chuyển message tới người đăng ký bằng `MESSAGE`; lỗi được báo bằng `ERROR`. STOMP 1.2 có cơ chế heart-beat được thương lượng trong `CONNECT`/`CONNECTED` [2]. Spring Framework hỗ trợ STOMP trên WebSocket với một broker đơn giản trong bộ nhớ, tiền tố đích `/app` cho message gửi vào ứng dụng và `/user` cho message gửi riêng một phiên [7].

STOMP có ACK ở mức subscription (`ack: client`), nhưng broker đơn giản của Spring không lưu message lâu dài, và một khi kết nối đứt thì message đang chờ cũng mất theo phiên. Vì vậy ACK của STOMP không giải quyết được việc phát bù sau khi kết nối lại.

### 2.4. Ngữ nghĩa giao nhận

Các hệ thống nhắn tin thường phân biệt ba mức: *at-most-once* (có thể mất, không trùng), *at-least-once* (không mất, có thể trùng) và *exactly-once*. MQTT 5.0 hiện thực at-least-once (QoS 1) bằng cách lưu message và gửi lại tới khi nhận `PUBACK` [8]. Kleppmann chỉ ra rằng "đúng một lần" trên thực tế thường đạt được bằng at-least-once cộng với xử lý idempotent hoặc loại trùng ở phía nhận [14]. Thiết kế của nhóm đi theo hướng đó: máy chủ có thể gửi một sự kiện nhiều lần (đẩy trực tiếp và phát bù), còn client loại trùng theo `seq`.

### 2.5. Idempotency key

Stripe công bố cơ chế cho phép client gắn một khoá duy nhất vào request tạo mới; máy chủ lưu kết quả của lần đầu và trả lại kết quả đó cho các lần gửi sau có cùng khoá [9]. Brandur Leach mô tả cách hiện thực cơ chế tương tự trên cơ sở dữ liệu quan hệ, dùng ràng buộc duy nhất và giao dịch để xử lý các request đến đồng thời [10]. Nhóm làm việc HTTPAPI của IETF đang chuẩn hoá header `Idempotency-Key`, trong đó có khuyến nghị phát hiện trường hợp dùng lại khoá cho nội dung khác [11].

### 2.6. Transactional outbox

Khi một thao tác vừa ghi cơ sở dữ liệu vừa phát message, nếu hai việc này không nằm trong cùng giao dịch thì có thể xảy ra hai lỗi ngược nhau: ghi thành công nhưng không phát, hoặc phát rồi nhưng giao dịch rollback. Mẫu *transactional outbox* giải quyết bằng cách ghi message vào một bảng outbox trong cùng giao dịch với dữ liệu nghiệp vụ, sau đó một tiến trình khác đọc bảng và chuyển đi [12]. Spring cung cấp `TransactionSynchronization` và `@TransactionalEventListener` để chạy mã ở pha sau commit [13].

### 2.7. Điều khiển đồng thời lạc quan

Kung và Robinson đề xuất phương pháp lạc quan: giao dịch thực hiện mà không khoá, đến lúc ghi mới kiểm tra xem dữ liệu đã đọc có bị thay đổi hay chưa [15]. Fowler mô tả biến thể *Optimistic Offline Lock* dùng một cột phiên bản: câu `UPDATE` chỉ thành công khi phiên bản trong cơ sở dữ liệu vẫn bằng phiên bản client đã đọc [17]. Hiện tượng mà kỹ thuật này ngăn chặn được gọi là *lost update* [14].

### 2.8. Token bucket, backoff và jitter

Token bucket là thuật toán định hình lưu lượng kinh điển trong mạng máy tính: thùng chứa tối đa *b* token, được nạp *r* token mỗi giây; mỗi gói tin (ở đây là mỗi request) tiêu tốn một token, cho phép bùng nổ ngắn tối đa *b* request nhưng giới hạn tốc độ trung bình ở *r* [18], [19]. Khi nhiều client cùng mất kết nối rồi thử lại theo cùng một lịch, chúng tạo ra các đợt tải dồn dập; Brooker cho thấy thêm thành phần ngẫu nhiên (jitter) vào exponential backoff làm giảm rõ rệt số lần va chạm và tổng công việc của máy chủ [20].

### 2.9. Hạn chế của các cách tiếp cận thường gặp

| Cách tiếp cận | Ưu điểm | Hạn chế đối với bài toán |
|---|---|---|
| Polling | Đơn giản, không mất dữ liệu nếu hỏi theo mốc | Độ trễ ≈ ½ chu kỳ; tốn request khi rảnh |
| WebSocket broadcast "fire-and-forget" | Độ trễ thấp | Mất sự kiện khi client đang mất kết nối; không phát hiện được mất |
| STOMP ACK với broker trong bộ nhớ | Có xác nhận | Không phát bù sau khi kết nối lại |
| Broker bền vững (RabbitMQ, Kafka, MQTT broker) | Có lưu trữ, có QoS | Thêm một hệ thống cần vận hành; vẫn cần xử lý trùng và giao dịch với DB nghiệp vụ |
| POST không có idempotency | Đơn giản | Gửi lại tạo đơn trùng |
| Ghi đè trạng thái "last write wins" | Đơn giản | Lost update khi nhiều người thao tác |

Hệ thống của nhóm không dùng broker bền vững bên ngoài; thay vào đó, bảng nhật ký sự kiện trong chính cơ sở dữ liệu nghiệp vụ đóng vai trò nơi lưu trữ để phát bù, nên tính nhất quán giữa dữ liệu và sự kiện được bảo đảm bằng một giao dịch duy nhất.

---

## 3. Định nghĩa bài toán (Problem Definition)

### 3.1. Input và output

| | Mô tả |
|---|---|
| Input | Mã QR của bàn (`qrToken`); yêu cầu vào bàn; yêu cầu đặt món gồm `guestName`, danh sách `{menuItemId, quantity, note}` và một `Idempotency-Key`; lệnh đổi trạng thái món `{status, version}` từ nhân viên bếp; yêu cầu thanh toán `{method}`; xác nhận tiền mặt `{version}` và "Trả bàn" `{reason, note}` từ thu ngân; thông báo kết quả giao dịch (IPN) từ máy chủ VNPay; các thao tác quản trị (bàn, thực đơn, cấu hình) |
| Output | Đơn được lưu bền vững; sự kiện `ORDER_CREATED`, `ITEM_STATUS_CHANGED`, `ORDER_CANCELLED` được giao tới màn hình bếp và tới mọi điện thoại của bàn; trạng thái thanh toán và trạng thái bàn được đẩy tới khách và thu ngân; mã lỗi rõ ràng cho request không hợp lệ |

### 3.2. Mô hình mạng

* Một máy chủ duy nhất trong mạng LAN (khi demo qua Internet thì mở ra ngoài bằng tunnel); các client là trình duyệt trên điện thoại của khách, máy tính bảng ở bếp, máy tính ở quầy thu ngân và máy tính của quản lý, kết nối qua Wi-Fi. Cổng thanh toán VNPay (sandbox) là một máy chủ bên ngoài: gọi IPN vào máy chủ của nhóm qua HTTPS và trả lời API tra cứu giao dịch.
* Mỗi client dùng hai kênh: HTTP/1.1 cho request/response và một kết nối WebSocket lâu dài cho sự kiện.
* **Mô hình lỗi**: kết nối TCP của client có thể đứt bất kỳ lúc nào, có khi không có gói FIN (rút mạng, mất sóng); phản hồi HTTP có thể mất sau khi máy chủ đã xử lý xong; client có thể gửi lại request; nhiều client có thể gửi request mâu thuẫn cùng lúc; một client có thể gửi request với tốc độ rất cao. Máy chủ và cơ sở dữ liệu được giả định không hỏng vĩnh viễn (giao dịch có thể rollback, kết nối DB có thể hết).

### 3.3. Giả định

* Đồng hồ của các client không cần đồng bộ: thứ tự sự kiện dựa trên `seq` do cơ sở dữ liệu cấp chứ không dựa trên thời gian.
* Mỗi lần đặt món, client sinh một `Idempotency-Key` ngẫu nhiên đủ dài và giữ nguyên khoá đó cho mọi lần gửi lại.
* Mạng LAN tin cậy ở mức nhất định; hệ thống chưa mã hoá đường truyền (xem mục 12).

### 3.4. Ràng buộc

* Quy mô một nhà hàng: cỡ vài chục bàn, mỗi bàn vài điện thoại, vài màn hình bếp, tức khoảng vài trăm kết nối đồng thời. Rủi ro tải chủ yếu đến từ đột biến (giờ cao điểm, cả quán kết nối lại cùng lúc khi Wi-Fi có lại) và từ client lỗi.
* Phải chạy được trên một máy tính cá nhân, không bắt buộc hạ tầng ngoài ngoài cơ sở dữ liệu.

### 3.5. Yêu cầu hệ thống

**Chức năng**: quét QR → vào phiên bàn (nhập tên, có thể bỏ qua) → xem thực đơn → đặt món → theo dõi trạng thái đơn chung của bàn → thanh toán (tiền mặt hoặc VNPay); bếp xem hàng đợi món, đổi trạng thái; thu ngân xem sơ đồ bàn, xác nhận tiền mặt, trả bàn; quản trị bàn (phục vụ/ngừng phục vụ), mã QR, thực đơn, lịch sử thanh toán, xem giám sát kết nối và đổi cấu hình thực nghiệm.

**Tính chất cần bảo đảm** (dùng làm tiêu chí đánh giá):

| Ký hiệu | Tính chất | Đo bằng |
|---|---|---|
| P1 | Không mất: mọi đơn đã commit đều tới màn hình bếp đang hoạt động | E2 – số đơn mất |
| P2 | Không trùng tới giao diện: mỗi sự kiện được xử lý tối đa một lần ở client | E2 – số sự kiện trùng tới ứng dụng |
| P3 | Không đơn trùng: một lần đặt món logic tạo tối đa một đơn | E3 – số đơn trùng trong DB |
| P4 | Không lost update khi cập nhật đồng thời | E4 – số lost update |
| P5 | Độ trễ thấp từ lúc đặt món tới lúc bếp nhận | E1 – p50/p95/p99 |
| P6 | Client bất thường không làm suy giảm client bình thường | E6 |

---

## 4. Phương pháp đề xuất (Proposed Approach)

### 4.1. Ý tưởng tổng quát

Hệ thống tách bạch hai loại giao tiếp:

* **Lệnh (command) đi qua REST**. Đặt món, đổi trạng thái, huỷ đơn đều là request HTTP có phản hồi rõ ràng (201, 200, 409, 422, 429...). Client biết chắc lệnh thành công hay thất bại và có thể thử lại an toàn nhờ idempotency.
* **Sự kiện (event) đi qua WebSocket/STOMP**. Máy chủ chỉ dùng WebSocket để thông báo những thay đổi đã xảy ra.

Mọi thay đổi trạng thái đơn được ghi thành một dòng trong bảng `order_event` **cùng giao dịch** với thay đổi dữ liệu. Cột `seq` (AUTO_INCREMENT) của bảng này là số thứ tự toàn cục của sự kiện. Kênh WebSocket được coi là có thể mất; khi nghi ngờ đã bỏ lỡ sự kiện, client hỏi lại nhật ký theo `seq`.

### 4.2. Giao thức giao sự kiện tin cậy

**Envelope**. Mọi sự kiện đơn hàng có dạng:

```json
{ "type": "ORDER_CREATED", "seq": 1024, "eventId": "b3d1…", "serverTime": 1760692991123, "payload": { … } }
```

**Thuật toán phía client bếp** (`kitchenFeed.js`). Client giữ:

* `seen`: tập các `seq` đã xử lý (giới hạn 20 000 phần tử gần nhất);
* `watermark`: `seq` lớn nhất mà mọi `seq` nhỏ hơn hoặc bằng nó đều đã nhận;
* `maxSeen`: `seq` lớn nhất từng thấy.

```text
khi kết nối (lần đầu hoặc kết nối lại) thành công:
    SUBSCRIBE /topic/kitchen
    SUBSCRIBE /user/queue/replay
    SEND /app/resume {lastSeq: watermark}

accept(env):
    nếu env.seq ∈ seen: đếm trùng, bỏ qua                 # loại trùng
    thêm env.seq vào seen; giao env cho giao diện
    SEND /app/ack {seq: env.seq}
    maxSeen ← max(maxSeen, env.seq)
    trong khi (watermark + 1) ∈ seen: watermark ← watermark + 1
    nếu maxSeen > watermark: hẹn kiểm tra sau gapGraceMs (800 ms)

kiểm tra khoảng trống:
    nếu vẫn maxSeen > watermark: SEND /app/resume {lastSeq: watermark}

nhận REPLAY_BATCH {events, latestSeq, hasMore}:
    với mỗi env trong events: accept(env)
    nếu hasMore: SEND /app/resume {lastSeq: seq cuối của lô}; dừng
    watermark ← max(watermark, latestSeq)                  # bỏ qua "lỗ" do rollback
```

**Phía máy chủ** (`KitchenWsController`): `/app/resume` đọc `SELECT … FROM order_event WHERE seq > ? ORDER BY seq LIMIT 500` và trả về riêng phiên đó qua `/user/queue/replay` một `REPLAY_BATCH` gồm `fromSeq`, `latestSeq`, `hasMore` và danh sách sự kiện. `/app/ack` cập nhật `lastAckSeq` của phiên trong `SessionRegistry`, dùng cho trang giám sát.

**"Lỗ" seq**. Giá trị AUTO_INCREMENT đã cấp cho một giao dịch bị rollback không được dùng lại [22], nên dãy `seq` có thể có khoảng trống vĩnh viễn. Nếu client chờ mãi những `seq` đó, watermark sẽ đứng yên và client sẽ RESUME liên tục. Vì máy chủ trả về `latestSeq` đọc tại thời điểm phát bù, mọi `seq ≤ latestSeq` không có trong lô phát bù được coi là không tồn tại, và watermark được đẩy lên `latestSeq`.

**Ảnh chụp ban đầu**. Khi mở trang bếp, client gọi `GET /api/kitchen/orders`; máy chủ đọc `latestSeq` **trước** rồi mới đọc danh sách đơn đang mở, để sự kiện nào xảy ra giữa hai câu truy vấn sẽ được phát bù chứ không bị bỏ sót. Client khởi động feed với `watermark = latestSeq`.

### 4.3. Đặt món idempotent

```text
placeOrder(tableToken, key, body):
    kiểm tra key khớp ^[A-Za-z0-9_-]{8,64}$ ; bàn đang OPEN
    hash ← SHA-256(tableId | menuItemId:quantity:note …)
    nếu tồn tại idempotency_key(key) đã gắn order_id:
        nếu hash khác: 409 IDEMPOTENCY_KEY_REUSED
        trả 200 + đơn cũ + header Idempotent-Replayed: true
    BEGIN
        INSERT idempotency_key(key, hash)                    # chiếm khoá trước tiên
        kiểm tra món, trừ tồn kho nguyên tử, INSERT orders, order_item
        UPDATE idempotency_key SET order_id
        INSERT order_event(ORDER_CREATED)  → seq
        đăng ký "phát sự kiện sau commit"
    COMMIT → 201 Created
    nếu INSERT key vi phạm khoá chính (request song song cùng key đã thắng):
        đọc lại tối đa 40 lần × 50 ms; thấy đơn → 200 + đơn đó
        không thấy → 503 + Retry-After: 1
```

Khoá chính của bảng `idempotency_key` là điểm tuần tự hoá: dù hai request cùng khoá đến cùng lúc trên hai thread khác nhau, cơ sở dữ liệu chỉ cho một giao dịch chèn được dòng đó. Nếu giao dịch thắng bị rollback (ví dụ món hết hàng) thì dòng khoá cũng biến mất và client có thể thử lại. Phía khách (`Customer.jsx`), khoá được sinh một lần cho mỗi lần bấm đặt món bằng `crypto.getRandomValues` (128 bit) và lưu cùng đơn đang chờ trong `localStorage`, nên kể cả khi tải lại trang, lần gửi lại vẫn dùng đúng khoá cũ.

### 4.4. Phát sau commit và nhật ký sự kiện

`EventPublisher.publishOrderEvent` không gửi ngay mà đăng ký một `TransactionSynchronization` có `afterCommit()` [13]. Nếu giao dịch rollback, callback không chạy và bếp không bao giờ thấy "đơn ma". Ngược lại, nếu giao dịch đã commit mà việc gửi qua broker thất bại, lỗi chỉ được ghi log: sự kiện vẫn nằm trong `order_event` và sẽ được phát bù khi client RESUME. Cách này giống mẫu outbox [12] ở chỗ ghi sự kiện cùng giao dịch, nhưng thay vì một tiến trình chuyển tiếp chạy nền, việc chuyển tiếp được thực hiện ngay sau commit, còn nhật ký được dùng khi client yêu cầu.

### 4.5. Máy trạng thái và khoá lạc quan

```text
PENDING ──▶ ACCEPTED ──▶ COOKING ──▶ READY ──▶ SERVED
   │
   └──▶ CANCELLED   (chỉ khi còn PENDING)
```

Mọi chuyển trạng thái khác bị từ chối với `409 INVALID_STATE_TRANSITION` kèm danh sách trạng thái được phép. Mỗi món có cột `version`. Request đổi trạng thái gửi kèm `version` client đã thấy; máy chủ chạy

```sql
UPDATE order_item SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?
```

Nếu số dòng bị ảnh hưởng bằng 0, có người khác đã cập nhật xen giữa, máy chủ trả `409 VERSION_CONFLICT` kèm `currentVersion`/`currentStatus` và giao diện bếp tự tải lại ảnh chụp. Trạng thái tổng của đơn (`NEW`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) được suy ra từ trạng thái các món. Tồn kho được trừ bằng một câu `UPDATE … WHERE stock >= ?` nguyên tử; huỷ đơn chỉ thành công khi số món được chuyển sang `CANCELLED` đúng bằng số món của đơn, nếu không toàn bộ giao dịch rollback.

### 4.6. Chống quá tải nhiều lớp

| Lớp | Cơ chế trong mã nguồn | Giá trị mặc định |
|---|---|---|
| Kết nối TCP | Tomcat NIO: kết nối rảnh (kể cả WebSocket) không giữ thread | `threads.max=200`, `max-connections=2000`, `accept-count=100` |
| Rate limit theo IP | Token bucket cho mọi `/api/**` → `429` + `Retry-After` | sức chứa 60, nạp 20 request/s |
| Rate limit theo bàn | Token bucket riêng cho `POST /api/orders` theo `X-Table-Token` | sức chứa 10, nạp 10 đơn/phút (khi chạy E6: 5 / 5) |
| Kết nối WebSocket | Tối đa N kết nối mỗi bàn, đếm bằng `AtomicInteger` + CAS | N = 8 |
| Phân quyền STOMP | Khách chỉ SUBSCRIBE `/topic/table.{bàn mình}`; chỉ nhân viên SUBSCRIBE `/topic/kitchen` và SEND `/app/ack`, `/app/resume`; chỉ CASHIER, ADMIN SUBSCRIBE `/topic/cashier` | – |
| Backpressure WebSocket | Client nhận chậm bị ngắt thay vì làm nghẽn thread gửi | `sendTimeLimit=10s`, `sendBufferSizeLimit=512KB`, `messageSizeLimit=64KB`, `timeToFirstMessage=10s` |
| Bảo vệ DB | Pool HikariCP giới hạn, chờ kết nối tối đa 3 s, query timeout 3 s; hết tài nguyên → `503` + `Retry-After` | `maximum-pool-size=20` |
| Giảm tải đọc | Thực đơn cache trong RAM theo số phiên bản; `ETag` → `304 Not Modified` | – |
| Phía client | Kết nối lại bằng exponential backoff có jitter; REST retry tôn trọng `Retry-After` | WS: 1 s → 30 s, jitter ±50%; REST: 4 lần, 500 ms → 8 s |

### 4.7. Baseline và cách so sánh công bằng

Để so sánh công bằng, baseline và đề xuất chạy trên **cùng một mã nguồn**, chỉ khác cờ cấu hình, đổi lúc chạy qua `PUT /api/admin/settings` mà không cần khởi động lại máy chủ:

| Cờ | Baseline | Đề xuất |
|---|---|---|
| `deliveryMode` | `POLLING` (bếp hỏi `GET /api/kitchen/events?afterSeq=` mỗi 3 s) hoặc `NAIVE_PUSH` (nhận `/topic/kitchen`, không ACK/RESUME/loại trùng) | `RELIABLE_PUSH` |
| `idempotencyEnabled` | `false` (bỏ qua header) | `true` |
| `optimisticLockEnabled` | `false` (UPDATE không có điều kiện `version`) | `true` |
| `rateLimitEnabled` | `false` | `true` |

Lưu ý: ở `NAIVE_PUSH`, máy chủ vẫn ghi nhật ký sự kiện như bình thường; sự khác biệt nằm ở việc client không dùng `seq` để ACK, RESUME hay loại trùng. Như vậy phép so sánh E2 cô lập đúng tác dụng của phần giao thức phía client.

### 4.8. Các quyết định thiết kế

| Quyết định | Phương án khác | Lý do chọn |
|---|---|---|
| REST cho lệnh, WebSocket cho sự kiện | Gửi cả lệnh qua STOMP | Lệnh cần phản hồi đồng bộ có mã lỗi; dễ kiểm thử, dễ áp dụng rate limit và idempotency |
| Nhật ký sự kiện trong DB nghiệp vụ | Broker bền vững bên ngoài | Cùng giao dịch với dữ liệu, không thêm hệ thống phải vận hành |
| `seq` toàn cục do DB cấp | Đồng hồ máy chủ, `seq` theo từng client | Không phụ thuộc đồng hồ; một bộ đếm duy nhất cho mọi màn hình bếp |
| Client RESUME (kéo) khi kết nối lại | Máy chủ tự gửi lại theo ACK | Máy chủ không phải giữ hàng đợi cho từng client; client biết rõ mình thiếu gì |
| JdbcTemplate với SQL tường minh | JPA/Hibernate | Thấy rõ câu `UPDATE … WHERE version = ?` và ranh giới giao dịch |
| `TransactionTemplate` tường minh | `@Transactional` | Thấy rõ ranh giới commit/rollback trong mã |
| Token nhân viên tự ký HMAC-SHA256 | Spring Security + JWT | Ít phụ thuộc; máy chủ không cần lưu phiên |
| Client STOMP tự viết | `@stomp/stompjs` | Hiểu và kiểm soát từng frame; dùng chung cho trình duyệt và bộ sinh tải |
| QR tĩnh theo bàn, quản trị có nút đổi mã | Mã đổi mỗi lần đóng bàn | Không phải in lại QR mỗi phiên; máy của lượt khách cũ bị chặn bằng `X-Session-Id` (`409 SESSION_ENDED`) |
| Phiên bàn tự mở khi khách quét QR (`POST /join`, `UPDATE … WHERE current_session_id IS NULL`) | Nhân viên bấm mở bàn | Không cần thao tác của nhân viên; hai máy quét cùng lúc vẫn chỉ một phiên |
| Đơn chung của bàn trên `/topic/table.{id}`; mã thiết bị chỉ dùng để xác định quyền huỷ, không trả ra ngoài | Mỗi máy chỉ thấy đơn của mình | Cả bàn theo dõi và thanh toán chung một hóa đơn |
| Xác nhận VNPay bằng IPN có chữ ký + tra cứu `querydr` dự phòng | Chỉ tin kết quả trên Return URL của trình duyệt | Trình duyệt có thể bị đóng giữa chừng; mọi kết quả đều phải có chữ ký và số tiền khớp |
| Một lần thanh toán đang chờ mỗi phiên bằng `UNIQUE (pending_session_id)` | Khoá bằng `synchronized` trong RAM | Database tự phân xử, đúng cả khi request đi qua nhiều thread |

### 4.9. Phiên bàn, đơn chung và thanh toán

Phần này bổ sung nghiệp vụ hoàn chỉnh cho một lượt khách, dùng lại các cơ chế ở mục 4.3–4.5 (idempotency, `UPDATE` có điều kiện, phát sau commit).

**Phiên bàn.** Bảng `restaurant_table` có `status` (`OPEN` = đang phục vụ, `CLOSED` = ngừng phục vụ để bảo trì) và `current_session_id` (lượt khách hiện tại, `NULL` = bàn trống). Khi mở link QR, trình duyệt gọi `POST /api/public/tables/{qrToken}/join`. Bàn đã có phiên thì vào phiên đó; bàn trống thì máy chủ, trong một giao dịch, chèn `table_session` mới rồi chạy

```sql
UPDATE restaurant_table SET current_session_id = ? WHERE id = ? AND current_session_id IS NULL AND status = 'OPEN'
```

Nếu 0 dòng bị ảnh hưởng (máy khác vừa mở trước), giao dịch rollback và máy này vào phiên của máy kia. Máy khách gửi kèm `X-Session-Id` trong các request sau; phiên đã kết thúc thì máy chủ trả `409 SESSION_ENDED`. Phiên kết thúc khi thu ngân bấm **Trả bàn** (còn nợ hoặc còn món chưa phục vụ thì phải chọn lý do: khách bỏ về, mời khách, khác), hoặc tự động bởi tác vụ chạy mỗi phút: 30 phút không có đơn nào (`AUTO_IDLE`), hoặc 30 phút sau khi đã trả đủ (`AUTO_AFTER_PAID`). Quản trị không đóng được bàn đang có khách (`409 TABLE_HAS_GUESTS`).

**Đơn chung và tên khách.** `GET /api/orders` trả mọi đơn của phiên kèm `mineOrderIds` (các đơn do máy đang hỏi đặt). Sự kiện đơn hàng được phát lên `/topic/table.{id}` cho mọi máy của bàn, kèm `guestName`, không kèm mã thiết bị (`X-Device-Id`); mã thiết bị chỉ dùng để giữ quy tắc "chỉ máy đã đặt mới huỷ được đơn". Tên khách đi trong thân JSON của request đặt món vì header HTTP không hợp với chữ tiếng Việt có dấu.

**Thanh toán.** Số tiền luôn do máy chủ tính: còn phải trả = tổng các món không huỷ của phiên − tổng các lần đã `PAID`. Mỗi lần thanh toán có máy trạng thái `PENDING → PAID | FAILED | CANCELLED | EXPIRED` (hết hạn sau 15 phút). Cột `pending_session_id` bằng `session_id` khi `PENDING` và `NULL` ở trạng thái khác, có ràng buộc `UNIQUE`: hai điện thoại cùng bấm "Thanh toán" thì chỉ một bên chèn được, bên kia nhận lại lần đang chờ. Trong lúc có lần đang chờ, đặt món bị từ chối `409 PAYMENT_IN_PROGRESS`. Với **tiền mặt**, thu ngân bấm "Đã nhận tiền" → `UPDATE … WHERE version = ? AND status = 'PENDING'` (khoá lạc quan; hai thu ngân cùng bấm thì người sau nhận 409).

**VNPay sandbox (API 2.1.0).** Máy chủ tạo link thanh toán: các tham số `vnp_*` được sắp xếp theo tên, URL-encode và ký HMAC-SHA512 bằng khoá bí mật của merchant. Kết quả được nhận qua ba đường, đều kiểm chữ ký và số tiền, và đều ghi nhận bằng cùng một câu `UPDATE … WHERE status IN (…)`:

1. **IPN** (`GET /api/payments/vnpay/ipn`): máy chủ VNPay gọi thẳng máy chủ của nhóm. Trả JSON `{RspCode, Message}` theo chuẩn VNPay: `00` ghi nhận, `01` không tìm thấy, `02` đã xử lý, `04` sai số tiền, `97` sai chữ ký. VNPay gọi lặp thì nhận `02`.
2. **Return URL** (`GET /api/payments/vnpay/return`): trình duyệt khách được chuyển về kèm dữ liệu có chữ ký; máy chủ kiểm tra, ghi nhận như IPN rồi chuyển về trang gọi món.
3. **Tra cứu `querydr`**: trước khi đánh dấu `EXPIRED` một lần VNPay còn `PENDING`, tác vụ định kỳ hỏi API tra cứu của VNPay (HTTPS, chữ ký HMAC-SHA512).

Tiền VNPay về muộn cho lần đã hết hạn hoặc đã huỷ vẫn được ghi `PAID`; nếu khi đó hóa đơn đã được trả đủ bằng cách khác thì bật cờ `needs_refund` để thu ngân hoàn tiền. Mã merchant và khoá bí mật chỉ được cấu hình bằng biến môi trường; thiếu thì lựa chọn VNPay bị ẩn.

Mọi thay đổi về thanh toán và trạng thái bàn được phát sau commit dưới dạng `PAYMENT_UPDATED`, `TABLE_STATE_CHANGED`, `TABLE_SESSION_ENDED` tới `/topic/table.{id}` và `/topic/cashier`. Các thông báo này **không** đi vào nhật ký `order_event`: trang khách và trang thu ngân tải lại trạng thái qua REST mỗi khi kết nối lại.

---

## 5. Kiến trúc hệ thống (System Architecture)

### 5.1. Sơ đồ

> [CHÈN HÌNH: `statics/architecture.png` – nhóm vẽ lại từ sơ đồ dưới đây]

```text
 ┌──────────────────┐ ┌───────────────────┐ ┌──────────────────┐ ┌────────────────┐
 │ Ứng dụng khách   │ │ Màn hình bếp (KDS)│ │ Thu ngân         │ │ Quản trị       │
 │ /t/:token        │ │ /kitchen          │ │ /cashier         │ │ /admin         │
 │ api.js,connection│ │ kitchenFeed.js    │ │                  │ │                │
 └──┬──────▲────────┘ └──┬──────▲─────────┘ └──┬──────▲────────┘ └──┬─────────────┘
    │REST  │STOMP        │REST  │STOMP          │REST  │STOMP         │REST
    │      │/topic/      │      │/topic/kitchen │      │/topic/cashier│
    │      │ table.N     │      │/user/queue/   │      │              │
    ▼      │             ▼      │ replay        ▼      │              ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Spring Boot (Tomcat NIO, cổng 8080)                                        │
 │  RateLimitInterceptor ─▶ REST controllers      WebSocket /ws + STOMP       │
 │  StaffAuthInterceptor    (Public, Order,        StompAuthInterceptor       │
 │                           Kitchen, Payment,     KitchenWsController        │
 │                           Cashier, Admin)       SessionRegistry            │
 │                               │                 Simple broker (RAM)        │
 │                               ▼                         ▲                  │
 │        OrderService ──▶ EventStore (order_event)        │                  │
 │        TableService     EventPublisher ──afterCommit────┘                  │
 │        PaymentService, CashierService (tác vụ định kỳ mỗi phút)            │
 │        VnpayGateway (ký/kiểm HMAC-SHA512, querydr) ◀──IPN──┐  ──HTTPS──┐   │
 │        MenuService (cache + ETag), AuthService (HMAC)      │           │   │
 └──────────────────────────────┬─────────────────────────────┼───────────┼───┘
                                │ JDBC (HikariCP, 20 kết nối) │           ▼
                                ▼                       ┌─────┴──────────────┐
            ┌──────────────────────────────────────┐    │ VNPay sandbox      │
            │ MySQL 8 (hoặc H2 chế độ MySQL)        │    │ (cổng thanh toán)  │
            │ restaurant_table, table_session,      │    └────────────────────┘
            │ category, menu_item, orders,          │
            │ order_item, order_event,              │
            │ idempotency_key, payment, staff       │
            └──────────────────────────────────────┘
```

### 5.2. Các thành phần

| Thành phần | Trách nhiệm |
|---|---|
| Ứng dụng khách | Mở từ QR, vào phiên bàn, hỏi tên (nhớ theo phiên); xem thực đơn (có ETag); đặt món kèm Idempotency-Key, giữ đơn chưa gửi được trong `localStorage`; nhận **đơn chung** của bàn (nhãn "BẠN ĐẶT" cho đơn của máy mình); thanh toán tiền mặt hoặc VNPay; khi kết nối lại thì tải lại đơn và hóa đơn qua REST |
| Trang thu ngân | Đăng nhập (vai trò CASHIER); sơ đồ bàn (Trống / Đang ăn / Chờ thanh toán / Đã thanh toán / Ngừng phục vụ) từ `GET /api/cashier/tables`, cập nhật qua `/topic/cashier`; "Đã nhận tiền", thu tiền mặt tại quầy, "Trả bàn"; cảnh báo lần cần hoàn tiền |
| Màn hình bếp | Đăng nhập; tải ảnh chụp đơn đang mở; nhận sự kiện theo một trong ba chế độ; đổi trạng thái món kèm `version`; có nút "Giả lập mất mạng 5s" để trình diễn |
| Ứng dụng quản trị | Quản lý bàn (phục vụ / ngừng phục vụ), mã QR (sinh ở frontend bằng `qrcode.react`), thực đơn; xem lịch sử thanh toán; giám sát kết nối và lag ACK; đổi cấu hình thực nghiệm |
| Tầng REST | Xác thực (`X-Table-Token` cho khách, `Authorization: Bearer` cho nhân viên), rate limit, kiểm tra dữ liệu, ánh xạ lỗi thống nhất |
| Tầng WebSocket | Handshake, xác thực và phân quyền từng frame STOMP, heart-beat, ACK/RESUME, giới hạn kết nối, backpressure |
| Dịch vụ nghiệp vụ | `OrderService` (đặt, đổi trạng thái, huỷ), `TableService` (vào bàn, kết thúc phiên), `PaymentService` (hóa đơn, tạo/huỷ/xác nhận thanh toán, xử lý kết quả VNPay), `CashierService` (sơ đồ bàn, trả bàn, tác vụ định kỳ), `VnpayGateway`, `MenuService`, `AuthService` |
| Nhật ký và phát sự kiện | `EventStore` ghi/đọc `order_event`; `EventPublisher` phát sau commit |
| Cơ sở dữ liệu | Lưu trữ bền vững và nhật ký sự kiện phục vụ phát bù |

### 5.3. Luồng dữ liệu

1. Khách quét QR → trình duyệt mở `/t/{qrToken}` → `POST /api/public/tables/{qrToken}/join` (vào phiên đang có hoặc mở phiên mới, trả `sessionId`) và `GET /api/public/menu`.
2. Khách mở kết nối WebSocket, `CONNECT` với header `tableToken`, `SUBSCRIBE /topic/table.{id}` và `/topic/menu`.
3. Khách đặt món: `POST /api/orders` (kèm `X-Session-Id`, `guestName`) → giao dịch ghi `orders`, `order_item`, `idempotency_key`, `order_event` → commit → `201`.
4. Sau commit, `EventPublisher` phát envelope tới `/topic/kitchen` (trừ chế độ POLLING) và `/topic/table.{id}` (mọi máy của bàn), đồng thời báo `TABLE_STATE_CHANGED` tới `/topic/cashier`.
5. Bếp nhận `ORDER_CREATED`, ACK; đầu bếp bấm nút → `PATCH /api/kitchen/order-items/{id}/status` → giao dịch kiểm tra trạng thái và `version` → sự kiện `ITEM_STATUS_CHANGED` tới mọi màn hình bếp và tới bàn.
6. Nếu bếp mất kết nối, sau khi kết nối lại nó gửi RESUME và nhận `REPLAY_BATCH` các sự kiện bị lỡ.
7. Khách bấm "Thanh toán" → `POST /api/payments` → lần thanh toán `PENDING` → `PAYMENT_UPDATED` tới bàn và thu ngân. Tiền mặt: thu ngân `PATCH /api/cashier/payments/{id}/confirm`. VNPay: trình duyệt sang trang VNPay; VNPay gọi IPN về máy chủ; trình duyệt quay về Return URL. Trạng thái `PAID` được đẩy tới mọi máy của bàn và tới thu ngân.
8. Thu ngân bấm "Trả bàn" → `POST /api/cashier/tables/{id}/checkout` → `current_session_id = NULL`, phát `TABLE_SESSION_ENDED` → mọi máy của bàn hiện màn hình kết thúc lượt.

### 5.4. Mô hình đồng thời

| Nơi | Cơ chế |
|---|---|
| Request REST | Thread pool của Tomcat (tối đa 200); mỗi request một giao dịch riêng |
| Frame STOMP vào | `clientInboundChannel`: pool 8–32 thread, hàng đợi 10 000 |
| Frame STOMP ra | `clientOutboundChannel`: pool 8–32 thread, hàng đợi 10 000; bật `preservePublishOrder` để mỗi phiên nhận message đúng thứ tự phát [7] |
| Heart-beat | `ThreadPoolTaskScheduler` 2 thread |
| `SessionRegistry` | `ConcurrentHashMap` cho phiên; `AtomicInteger` + `compareAndSet` cho số kết nối mỗi bàn; `volatile` cho `lastAckSeq` |
| `RateLimiter` | `ConcurrentHashMap.computeIfAbsent` (nguyên tử) tạo bucket; `TokenBucket.tryConsume` là `synchronized`; dọn bucket rảnh quá 10 phút mỗi phút |
| Cache thực đơn | `AtomicLong` số phiên bản; tăng phiên bản sau commit |
| Dữ liệu dùng chung trong DB | Khoá chính `idempotency_key`; `UPDATE … WHERE version = ?`; `UPDATE … WHERE stock >= ?`; `UPDATE … WHERE current_session_id IS NULL` (phiên bàn); `UNIQUE (pending_session_id)` (lần thanh toán đang chờ); `UPDATE payment … WHERE status IN (…)` (kết quả VNPay) |
| Tác vụ định kỳ | `@Scheduled` mỗi phút: tra cứu/cho hết hạn lần thanh toán quá 15 phút, tự kết thúc phiên bỏ trống hoặc đã trả đủ |

---

## 6. Thiết kế giao tiếp mạng (Network Communication Design)

### 6.1. Các kênh giao tiếp

| Từ → Đến | Giao thức | Mục đích |
|---|---|---|
| Khách → Máy chủ | HTTP/1.1, JSON | Vào bàn, thực đơn, đặt món, xem/huỷ đơn, hóa đơn, tạo/huỷ thanh toán |
| Máy chủ → Khách | WebSocket + STOMP 1.2, `/topic/table.{id}`, `/topic/menu` | Đơn chung của bàn, trạng thái món, thanh toán, trả bàn, thực đơn thay đổi, bàn ngừng phục vụ |
| Bếp → Máy chủ | HTTP/1.1, JSON | Đăng nhập, ảnh chụp, đổi trạng thái, polling (baseline) |
| Bếp ↔ Máy chủ | WebSocket + STOMP 1.2, `/topic/kitchen`, `/app/ack`, `/app/resume`, `/user/queue/replay` | Sự kiện, xác nhận, phát bù |
| Thu ngân → Máy chủ | HTTP/1.1, JSON | Sơ đồ bàn, xác nhận tiền mặt, trả bàn |
| Máy chủ → Thu ngân | WebSocket + STOMP 1.2, `/topic/cashier` | Trạng thái bàn, thanh toán |
| VNPay → Máy chủ | HTTPS (qua tunnel), query string có chữ ký | IPN: kết quả giao dịch |
| Máy chủ → VNPay | HTTPS, JSON có chữ ký | Tra cứu giao dịch (`querydr`) |
| Trình duyệt khách ↔ VNPay | HTTPS (chuyển hướng) | Trang thanh toán; Return URL quay về máy chủ |
| Máy chủ → CSDL | JDBC qua HikariCP | Lưu trữ |

### 6.2. Vòng đời kết nối WebSocket

1. **Thiết lập**. Client gửi `GET /ws` với `Upgrade: websocket`; máy chủ trả `101 Switching Protocols` [1]. Ngay khi `onopen`, client gửi frame `CONNECT` có `accept-version:1.2`, `heart-beat:10000,10000` và thông tin xác thực (`Authorization: Bearer <token>` với nhân viên, `tableToken: <qrToken>` với khách). Nếu trong 10 s sau khi mở kết nối mà chưa có frame nào, máy chủ đóng kết nối.
2. **Xác thực và phân quyền**. `StompAuthInterceptor` kiểm tra frame `CONNECT` (token hợp lệ, bàn chưa vượt 8 kết nối), mỗi `SUBSCRIBE` (đích được phép theo vai trò) và mỗi `SEND`. Vi phạm → interceptor ném `MessageDeliveryException`, Spring trả frame `ERROR` cho client (theo STOMP, kết nối được đóng sau frame `ERROR` [2]); các phiên khác và máy chủ không bị ảnh hưởng.
3. **Duy trì**. Hai bên thoả thuận heart-beat theo STOMP 1.2 [2]: client gửi một ký tự xuống dòng mỗi `max(cx, sy)` ms và mong nhận dữ liệu mỗi `max(cy, sx)` ms. Client tự viết coi kết nối đã chết nếu quá **2 chu kỳ** không nhận được gì, rồi tự đóng để kích hoạt kết nối lại; cách này phát hiện được cả trường hợp mất mạng không có gói FIN.
4. **Đóng**. Đóng chủ động: client gửi `DISCONNECT` rồi đóng WebSocket. Đóng bất thường: lỗi TCP hoặc hết heart-beat. Trong cả hai trường hợp máy chủ nhận `SessionDisconnectEvent` và xoá phiên khỏi `SessionRegistry` (giảm bộ đếm kết nối của bàn).
5. **Kết nối lại**. `RealtimeConnection` chờ `min(30 s, 1 s × 2^n) × hệ số ngẫu nhiên ∈ [0,5; 1,5]` rồi tạo một `StompClient` mới, đăng ký lại subscription; bếp gửi RESUME ngay sau đó, khách tải lại danh sách đơn qua REST.

### 6.3. Định dạng frame STOMP (ví dụ trên đường truyền)

```text
CONNECT
accept-version:1.2
host:192.168.1.10:8080
heart-beat:10000,10000
Authorization:Bearer MTpiZXA6S0lUQ0hFTjox….Zk3a…

^@
```

```text
MESSAGE
destination:/topic/kitchen
content-type:application/json
subscription:sub-1
message-id:…

{"type":"ORDER_CREATED","seq":42,"eventId":"…","serverTime":1760692991123,"payload":{"id":17,"tableCode":"B05","items":[…]}}^@
```

(`^@` là ký tự NUL kết thúc frame.) Bộ giải mã của client cắt luồng theo NUL nên xử lý đúng cả khi một message WebSocket chứa nhiều frame hoặc một frame bị cắt làm đôi; header được escape/unescape theo STOMP 1.2 (trừ frame `CONNECT`) [2].

### 6.4. Định dạng message REST

**Đặt món**

```http
POST /api/orders HTTP/1.1
Content-Type: application/json
X-Table-Token: 9KfP2x…
X-Device-Id: 5d1c…
X-Session-Id: 31
Idempotency-Key: 3f9c0a1e5b7d4c2a8e6f1b0d9c7a5e3f

{"guestName":"Minh","items":[{"menuItemId":12,"quantity":2,"note":"ít cay"},{"menuItemId":7,"quantity":1}]}
```

`X-Device-Id` là mã ngẫu nhiên do trình duyệt sinh, chỉ dùng để xác định máy nào được huỷ đơn nào và không bao giờ được trả ra ngoài; `X-Session-Id` là mã phiên bàn nhận khi vào bàn.

Phản hồi: `201 Created` khi tạo mới; `200 OK` kèm `Idempotent-Replayed: true` khi trả lại đơn đã tạo. Thân phản hồi là đơn hàng đầy đủ (id, bàn, trạng thái, tổng tiền, danh sách món có `id`, `status`, `version`).

**Đổi trạng thái món**

```http
PATCH /api/kitchen/order-items/58/status HTTP/1.1
Authorization: Bearer …
Content-Type: application/json

{"status":"COOKING","version":1}
```

**Lỗi thống nhất**

```json
{ "error": "VERSION_CONFLICT", "message": "Món vừa được người khác cập nhật, vui lòng tải lại",
  "details": { "currentVersion": 2, "currentStatus": "COOKING" }, "timestamp": 1760692991123 }
```

(`timestamp` là epoch mili-giây.)

| HTTP | `error` | Tình huống |
|---|---|---|
| 400 | `INVALID_REQUEST` | Thiếu trường, `quantity` không hợp lệ, JSON hỏng, thiếu header, Idempotency-Key sai định dạng |
| 401 | `UNAUTHORIZED`, `INVALID_TABLE_TOKEN` | Nhân viên chưa đăng nhập/token sai; mã QR không hợp lệ |
| 403 | `FORBIDDEN` | Sai vai trò (`/api/kitchen/**` cho KITCHEN hoặc ADMIN, `/api/cashier/**` cho CASHIER hoặc ADMIN, `/api/admin/**` chỉ cho ADMIN) |
| 404 | `NOT_FOUND` | Món/đơn/lần thanh toán không tồn tại |
| 409 | `TABLE_CLOSED` | Bàn đang ngừng phục vụ |
| 409 | `SESSION_ENDED` | Máy đang giữ phiên bàn đã kết thúc (đã trả bàn) |
| 409 | `PAYMENT_IN_PROGRESS` | Đặt món khi bàn đang có lần thanh toán chờ; trả bàn khi còn lần chờ |
| 409 | `TABLE_HAS_GUESTS` | Quản trị đóng bàn đang có khách |
| 409 | `CONFIRM_REQUIRED` | Trả bàn khi còn nợ/còn món chưa phục vụ mà chưa chọn lý do |
| 409 | `INVALID_STATE_TRANSITION` | Ví dụ `READY → COOKING`; huỷ đơn khi bếp đã nhận |
| 409 | `VERSION_CONFLICT` | Hai người cùng sửa một món |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Cùng khoá nhưng nội dung khác |
| 409 | `DUPLICATE` | Vi phạm ràng buộc dữ liệu khác (ví dụ trùng mã bàn) |
| 422 | `ITEM_UNAVAILABLE` | Món hết hoặc không đủ số lượng |
| 422 | `NOTHING_TO_PAY`, `PAYMENT_METHOD_UNAVAILABLE` | Không còn khoản cần trả; VNPay chưa được cấu hình |
| 429 | `RATE_LIMITED` | Vượt token bucket; có `Retry-After` |
| 503 | `SERVICE_UNAVAILABLE` | Hết kết nối DB, lỗi DB tạm thời, request trùng đang xử lý; có `Retry-After` |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước (đã ghi log) |

### 6.5. Các loại message WebSocket

| Hướng | Đích | `type` / nội dung |
|---|---|---|
| Máy chủ → Bếp, Khách | `/topic/kitchen`, `/topic/table.{id}` | `ORDER_CREATED` (đơn đầy đủ, có `guestName` và cờ `firstInSession` – bếp hiện nhãn "Bàn mới mở"), `ITEM_STATUS_CHANGED` (`orderItemId`, `from`, `to`, `version`, `orderStatus`, `by`…), `ORDER_CANCELLED`. Không chứa mã thiết bị |
| Máy chủ → Khách | `/topic/table.{id}` | `PAYMENT_UPDATED {tableId, payment}`, `TABLE_SESSION_ENDED {tableId, sessionId}`, `TABLE_CLOSED` (không có `seq`) |
| Máy chủ → Thu ngân | `/topic/cashier` | `TABLE_STATE_CHANGED {tableId}`, `PAYMENT_UPDATED {tableId, payment}` (không có `seq`) |
| Máy chủ → Tất cả | `/topic/menu` | `MENU_UPDATED {version}` |
| Máy chủ → Bếp | `/topic/kitchen` | `CONFIG_CHANGED {settings}` (không có `seq`) |
| Bếp → Máy chủ | `/app/ack` | `{seq}` |
| Bếp → Máy chủ | `/app/resume` | `{lastSeq}` |
| Máy chủ → một phiên bếp | `/user/queue/replay` | `{type:"REPLAY_BATCH", fromSeq, latestSeq, hasMore, events[]}` |
| Máy chủ → một phiên | `/user/queue/errors` | `{error:"INVALID_MESSAGE", …}` khi frame không xử lý được |

### 6.6. Trình tự giao tiếp

**(a) Đặt món và giao tới bếp**

```text
Khách               Máy chủ                         CSDL                  Bếp
  │ POST /api/orders   │                               │                    │
  │ Idempotency-Key: K │                               │                    │
  │───────────────────▶│ rate limit, token bàn         │                    │
  │                    │ BEGIN                         │                    │
  │                    │── INSERT idempotency_key(K) ─▶│                    │
  │                    │── INSERT orders, order_item ─▶│                    │
  │                    │── INSERT order_event → seq=n ▶│                    │
  │                    │ COMMIT                        │                    │
  │◀── 201 {order} ────│ afterCommit:                  │                    │
  │                    │── MESSAGE ORDER_CREATED seq=n ───────────────────────▶│
  │◀── MESSAGE (bàn) ──│                               │                    │
  │                    │◀────────────────────────────────── SEND /app/ack n ─│
```

**(b) Mất phản hồi và gửi lại**

```text
Khách                         Máy chủ
  │ POST (K, body) ───────────▶│ tạo đơn #17, commit
  │   ✕ phản hồi bị mất         │
  │ (timeout 5 s, backoff)      │
  │ POST (K, body) ───────────▶│ K đã có, hash khớp
  │◀── 200 #17, Idempotent-Replayed: true
```

**(c) Hai đầu bếp cùng cập nhật**

```text
Bếp A                    Máy chủ                    Bếp B
  │ PATCH {ACCEPTED, v=0} ──▶│◀── PATCH {CANCELLED, v=0} │
  │                          │ A: UPDATE … WHERE version=0 → 1 dòng
  │◀── 200 {version: 1} ─────│ B: version hiện tại 1 ≠ 0
  │                          │──── 409 VERSION_CONFLICT ─▶│ (tải lại ảnh chụp)
  │◀═ ITEM_STATUS_CHANGED ═══│═══ ITEM_STATUS_CHANGED ═══▶│
```

**(d) Mất kết nối và phát bù**

```text
Bếp                              Máy chủ
  │◀── MESSAGE seq=41 ─────────────│
  │─── SEND /app/ack {41} ────────▶│
  │  ✕ mất mạng (TCP bị cắt)        │  seq 42, 43, 44 được phát, không tới bếp
  │  … backoff 1 s × jitter …       │
  │─── WebSocket + CONNECT ───────▶│
  │◀── CONNECTED ──────────────────│
  │─── SUBSCRIBE /topic/kitchen ──▶│
  │─── SUBSCRIBE /user/queue/replay▶│
  │─── SEND /app/resume {41} ─────▶│  SELECT … WHERE seq > 41 ORDER BY seq LIMIT 500
  │◀── REPLAY_BATCH [42,43,44], latestSeq=44, hasMore=false
  │─── ACK 42, ACK 43, ACK 44 ────▶│
```

**(e) Thanh toán VNPay và xác nhận server-to-server**

```text
Khách                Máy chủ                                   VNPay sandbox
  │ POST /api/payments {VNPAY}, Idempotency-Key                    │
  │─────────────────▶│ INSERT payment PENDING (UNIQUE pending_session_id)
  │◀── 201 {payUrl} ─│ payUrl = tham số vnp_* đã sắp xếp + vnp_SecureHash (HMAC-SHA512)
  │── chuyển hướng tới payUrl ────────────────────────────────────▶│
  │                  │◀── IPN ?vnp_…&vnp_SecureHash=… ─────────────│
  │                  │ kiểm chữ ký, tìm giao dịch, so số tiền      │
  │                  │ UPDATE payment SET status='PAID' … WHERE status IN (…)
  │                  │──── {"RspCode":"00"} ──────────────────────▶│
  │◀═ PAYMENT_UPDATED (PAID) ═│ (cũng tới /topic/cashier)          │
  │                  │◀── IPN gửi lại ─────────────────────────────│
  │                  │──── {"RspCode":"02"} (đã xử lý) ───────────▶│
  │◀── 302 Return URL ?vnp_… (có chữ ký) ──────────────────────────│
  │─────────────────▶│ kiểm chữ ký → đã PAID → 302 về /t/{qrToken}
```

> [CHÈN HÌNH: `statics/protocol.png` – nhóm vẽ lại các sơ đồ trình tự trên]

### 6.7. Xử lý lỗi

| Tình huống (theo mục 6 của Instruction) | Cách xử lý |
|---|---|
| Invalid request | Bean Validation + `@RestControllerAdvice` → `400 INVALID_REQUEST` dạng JSON; không bao giờ để exception làm dừng máy chủ |
| Invalid data | Kiểm tra món tồn tại, còn bán, đủ tồn kho → `422`; kiểm tra định dạng Idempotency-Key |
| Connection failure | Client: banner trạng thái kết nối, exponential backoff + jitter; REST retry với cùng Idempotency-Key |
| Client disconnect | Heart-beat phát hiện; `SessionDisconnectEvent` dọn phiên; sự kiện vẫn nằm trong nhật ký để phát bù |
| Server unavailable | Khách giữ đơn chưa gửi trong `localStorage` và gửi lại với cùng khoá |
| Timeout | Client REST hết hạn sau 5 s; query DB tối đa 3 s; chờ kết nối DB tối đa 3 s → `503` + `Retry-After` |
| Duplicate request | Idempotency-Key + băm nội dung; request song song cùng khoá được ràng buộc khoá chính phân xử |
| Invalid state | Máy trạng thái → `409 INVALID_STATE_TRANSITION`; `version` sai → `409 VERSION_CONFLICT`; máy của lượt khách cũ → `409 SESSION_ENDED`; đặt món khi đang thanh toán → `409 PAYMENT_IN_PROGRESS` |
| Dữ liệu thanh toán giả mạo | Sai chữ ký VNPay → `RspCode 97`; sai số tiền → `04`; không ghi nhận |
| Mất xác nhận thanh toán | IPN không tới → Return URL có chữ ký, hoặc tra cứu `querydr` trước khi cho hết hạn; IPN gọi lặp → `02`, không ghi nhận hai lần; tiền về muộn → vẫn ghi nhận, bật `needs_refund` nếu đã trả đủ |
| Database error | Giao dịch rollback, không phát sự kiện, trả `503` |
| Unexpected input (WebSocket) | Frame không parse được → `@MessageExceptionHandler` gửi lỗi riêng cho phiên qua `/user/queue/errors`; frame quá 64 KB bị từ chối; frame từ phiên chưa CONNECT hoặc sai quyền → `ERROR` |

---

## 7. Hiện thực (Implementation)

### 7.1. Tổ chức mã nguồn

```text
source/
├── server/   Spring Boot 3.3.5, Java 17, Maven
│   └── com.ltm.qrorder/
│       ├── auth/       AuthService, AuthController, StaffAuthInterceptor, StaffPrincipal
│       ├── ratelimit/  TokenBucket, RateLimiter, RateLimitInterceptor
│       ├── table/      TableService (vào bàn, kết thúc phiên), TableInfo
│       ├── payment/    PaymentService, PaymentController, PaymentRepository, VnpayGateway,
│       │               CashierService, CashierController, PaymentDtos
│       ├── menu/       MenuService (cache + ETag), MenuDtos
│       ├── order/      OrderService, OrderRepository, IdempotencyRepository,
│       │               OrderItemStatus, OrderStatus, OrderController, KitchenController
│       ├── event/      EventEnvelope, EventStore, EventPublisher
│       ├── ws/         WebSocketConfig, StompAuthInterceptor, KitchenWsController,
│       │               SessionRegistry, WsPrincipal
│       ├── admin/      AdminController (bàn, thực đơn, lịch sử thanh toán, giám sát, cấu hình, dọn dữ liệu thực nghiệm)
│       └── common/     ErrorCode, ApiError, ApiException, GlobalExceptionHandler, Metrics, Jdbc
├── client/   React 18.3 + Vite 5.4
│   └── src/  pages/ (Customer, Kitchen, Cashier, Admin, Home), components/, lib/ (stomp, connection, kitchenFeed, api)
└── loadtest/ Node.js + thư viện ws 8.18; dùng lại lib/ của client
```

### 7.2. Các lớp quan trọng phía máy chủ

* **`OrderService`**: toàn bộ nghiệp vụ đơn hàng. `placeOrder` hiện thực thuật toán ở mục 4.3; `createOrder` chạy bên trong `TransactionTemplate` nên bất kỳ exception nào cũng dẫn tới rollback; `updateItemStatus` kiểm tra `version`, máy trạng thái, chạy `UPDATE … WHERE version = ?` và bắt `ConcurrencyFailureException` (deadlock/lock timeout) để trả về `VERSION_CONFLICT`; `cancelOrder` chỉ huỷ khi mọi món còn `PENDING` và hoàn lại tồn kho; `kitchenSnapshot` đọc `latestSeq` trước danh sách đơn.
* **`EventStore`**: `append` sinh `eventId` (UUID), tuần tự hoá payload thành JSON, chèn vào `order_event` và trả về envelope có `seq` vừa cấp; `after(afterSeq, limit)` đọc các sự kiện kế tiếp theo thứ tự `seq`.
* **`EventPublisher`**: `afterCommit` đăng ký `TransactionSynchronization`; nếu không có giao dịch thì chạy ngay. `sendNow` bắt `MessagingException` và chỉ ghi log.
* **`WebSocketConfig`**: endpoint `/ws`; simple broker cho `/topic`, `/queue` với heart-beat 10 s; tiền tố `/app`, `/user`; giới hạn transport; pool cho inbound/outbound channel.
* **`StompAuthInterceptor`**: một `ChannelInterceptor` trên inbound channel, xử lý `CONNECT`/`SUBSCRIBE`/`SEND` như mục 6.2.
* **`KitchenWsController`**: `@MessageMapping("/ack")`, `@MessageMapping("/resume")` + `@SendToUser("/queue/replay", broadcast = false)` để chỉ gửi về đúng phiên yêu cầu.
* **`SessionRegistry`**: danh sách phiên WebSocket và số kết nối mỗi bàn, phục vụ giới hạn kết nối và trang giám sát.
* **`TokenBucket` / `RateLimiter` / `RateLimitInterceptor`**: thuật toán token bucket nạp liên tục theo thời gian thực (`tokens = min(capacity, tokens + Δt × rate)`), trả về số mili-giây cần chờ để điền `Retry-After`; interceptor chạy trước controller nên request bị từ chối không chạm tới DB.
* **`AuthService`**: token = `base64url(id:username:role:expiry) + "." + base64url(HMAC-SHA256)`, so sánh chữ ký bằng `MessageDigest.isEqual` (thời gian hằng định); mật khẩu lưu bằng BCrypt.
* **`MenuService`**: cache thực đơn trong RAM theo số phiên bản `AtomicLong`; số phiên bản cũng là ETag; khi thực đơn thay đổi, phát `MENU_UPDATED`.
* **`TableService`**: `join` mở phiên bằng `UPDATE … WHERE current_session_id IS NULL AND status = 'OPEN'` trong `TransactionTemplate` (bên thua rollback rồi đọc lại); `requireSession` kiểm tra `X-Session-Id`; `endSession` kết thúc phiên có điều kiện `current_session_id = ?` và phát `TABLE_SESSION_ENDED`.
* **`PaymentService`**: tính hóa đơn từ cơ sở dữ liệu; `create` xử lý `Idempotency-Key`, trả lại lần đang chờ nếu có, bắt `DuplicateKeyException` của `UNIQUE (pending_session_id)` khi hai máy cùng tạo; `confirmCash` dùng khoá lạc quan; `handleVnpayCallback` dùng chung cho IPN và Return URL (chữ ký → tìm giao dịch → số tiền → `UPDATE` có điều kiện); `expireOverdue` gọi `querydr` trước khi cho hết hạn.
* **`VnpayGateway`**: tạo link thanh toán (tham số sắp xếp bằng `TreeMap`, URL-encode, HMAC-SHA512), kiểm chữ ký bằng `MessageDigest.isEqual`, gọi API `querydr` bằng `java.net.http.HttpClient` (timeout kết nối 5 s, request 10 s).
* **`CashierService`**: sơ đồ bàn và chi tiết hóa đơn cho thu ngân; "Trả bàn" (bắt buộc lý do khi còn nợ/còn món); `@Scheduled` mỗi phút chạy `expireOverdue` và tự kết thúc phiên (`AUTO_IDLE`, `AUTO_AFTER_PAID`).

### 7.3. Thư viện mạng phía client

* **`stomp.js`** – client STOMP 1.2 tự viết, khoảng 200 dòng: `encodeFrame`/`decodeFrame`, escape header, cắt luồng theo NUL, thương lượng heart-beat, phát hiện kết nối chết sau 2 chu kỳ im lặng, `forceClose()` để giả lập mất mạng (với thư viện `ws` của Node, `terminate()` cắt TCP ngay). Có thống kê frame/byte vào ra, dùng cho thực nghiệm E1.
* **`connection.js`** – `backoffDelay(attempt)` và lớp `RealtimeConnection` giữ kết nối luôn sống; `simulateOutage(ms)` vừa cắt kết nối vừa chặn kết nối lại trong `ms` mili-giây.
* **`kitchenFeed.js`** – lớp `KitchenFeed` với ba chế độ `POLLING`, `NAIVE_PUSH`, `RELIABLE_PUSH`, hiện thực thuật toán ở mục 4.2 và thu thập thống kê (`received`, `duplicates`, `gaps`, `resumes`, `replayed`, `resyncMs`).
* **`api.js`** – `request()` có timeout bằng `AbortController`, chuẩn hoá lỗi thành `ApiError` (mã 0 cho lỗi mạng/timeout); `withRetry()` chỉ thử lại lỗi tạm thời (0, 429, 502, 503, 504) và tôn trọng `Retry-After`; `newIdempotencyKey()` sinh 128 bit ngẫu nhiên bằng `crypto.getRandomValues` vì `crypto.randomUUID` chỉ có trong secure context, trong khi điện thoại truy cập qua `http://IP-LAN`.

### 7.4. Cấu trúc dữ liệu chính

| Cấu trúc | Vị trí | Vai trò |
|---|---|---|
| Bảng `order_event` (`seq` AUTO_INCREMENT) | CSDL | Nhật ký sự kiện, nguồn phát bù |
| Bảng `idempotency_key` (khoá chính `key_value`, `request_hash` CHAR(64)) | CSDL | Chống đặt trùng |
| Cột `order_item.version` | CSDL | Khoá lạc quan |
| Cột `restaurant_table.current_session_id` | CSDL | Phiên bàn hiện tại; `UPDATE` có điều kiện bảo đảm một phiên mỗi bàn |
| Bảng `payment` (`pending_session_id` UNIQUE, `idempotency_key` UNIQUE, `txn_ref` UNIQUE, `version`) | CSDL | Một lần thanh toán đang chờ mỗi phiên; chống tạo trùng; khoá lạc quan khi xác nhận tiền mặt |
| `ConcurrentHashMap<String, ClientSession>` | `SessionRegistry` | Phiên WebSocket |
| `ConcurrentHashMap<String, TokenBucket>` | `RateLimiter` | Bucket theo IP và theo bàn |
| `Set<seq>` + mảng thứ tự (tối đa 20 000) | `KitchenFeed` | Loại trùng |
| `watermark`, `maxSeen` | `KitchenFeed` | Phát hiện khoảng trống |

### 7.5. Kiểm thử

`mvn test` chạy 22 test JUnit, tất cả đều qua (báo cáo surefire ngày 25/10/2026: `OrderFlowIntegrationTest` 16, `OrderItemStatusTest` 3, `TokenBucketTest` 3):

| Lớp test | Test | Kiểm tra |
|---|---|---|
| `TokenBucketTest` | `allowsBurstUpToCapacityThenRejects`, `refillsOverTime`, `neverExceedsCapacity` | Thuật toán token bucket |
| `OrderItemStatusTest` | `happyPath`, `rejectsInvalidTransitions`, `derivesOrderStatus` | Máy trạng thái |
| `OrderFlowIntegrationTest` (HTTP thật, H2) | `sameIdempotencyKeyCreatesOnlyOneOrder` | Gửi lặp cùng khoá → 1 đơn |
| | `concurrentRequestsWithSameKeyCreateOneOrder` | 8 request song song cùng khoá → 1 đơn |
| | `sameKeyDifferentBodyIsRejected` | Cùng khoá, khác nội dung → 409 |
| | `invalidRequestReturns400` | Request sai → 400 |
| | `invalidTableTokenReturns401` | Mã QR sai → 401 |
| | `stateMachineAndOptimisticLock` | Sai version → 409; chuyển trạng thái sai → 409 |
| | `kitchenRequiresLogin` | Bếp chưa đăng nhập → 401 |
| | `menuSupportsEtag` | ETag → 304 |
| | `concurrentJoinOpensOnlyOneSession` | Nhiều máy vào bàn trống song song → chỉ 1 phiên |
| | `devicesInSameSessionShareOrdersButOnlyOwnerCancels` | Đơn chung trong phiên; chỉ máy đã đặt mới huỷ được |
| | `endedSessionIsRejectedAndAdminCannotCloseOccupiedTable` | Máy của lượt cũ bị chặn sau khi trả bàn; không đóng được bàn có khách |
| | `idleSessionWithoutOrdersEndsAutomatically` | Phiên không gọi món tự kết thúc |
| | `cashPaymentFlowAndCheckout` | Thanh toán tiền mặt, thu ngân xác nhận, trả bàn |
| | `vnpayIpnVerifiesSignatureAmountAndIsIdempotent` | IPN (khoá giả của môi trường test): sai chữ ký → `97`, sai số tiền → `04`, hợp lệ → `00` và `PAID`, gọi lặp → `02` |
| | `vnpayHmacMatchesWhenRecomputed` | Chữ ký HMAC-SHA512 tính lại khớp; đổi một tham số thì không khớp |
| | `serviceCallIsDedupedPerSessionAndHandledByCashier` | Gọi phục vụ: nhiều máy cùng bàn gọi → 1 lượt; bếp không xử lý được (403); thu ngân xử lý, gọi lặp không lỗi; trả bàn → lượt gọi biến mất; máy của lượt cũ bị chặn |

Ngoài JUnit, bộ kiểm thử end-to-end `source/loadtest/e2e-test.js` chạy trên máy chủ thật, gồm 17 nhóm; nhóm 15 kiểm tra phiên bàn nhiều điện thoại (đơn chung, tên khách, trả bàn), nhóm 16 kiểm tra thanh toán và quầy thu ngân (gồm phân quyền `/api/cashier` và `/topic/cashier`, IPN VNPay giả lập), nhóm 17 kiểm tra gọi phục vụ (gộp lượt gọi trùng, thông báo real-time tới quầy và tới điện thoại khách). Lần chạy ngày 25/10/2026 trên cơ sở dữ liệu H2: `KẾT QUẢ: 193 đạt, 0 lỗi`.

Kiểm thử thủ công khả năng chịu lỗi: trên màn hình bếp bấm "Giả lập mất mạng 5s" trong khi đặt món từ điện thoại; sau khi kết nối lại, bếp tự RESUME và thanh thống kê hiển thị số sự kiện "Gửi bù". Các ca test tay về đơn chung, thanh toán, trả bàn và VNPay (thẻ test NCB qua tunnel) nằm trong `TEST_CASES.md`. [CẦN ĐIỀN: ảnh chụp màn hình demo]

---

## 8. Thiết lập thực nghiệm (Experimental Setup)

### 8.1. Môi trường

| Hạng mục | Giá trị |
|---|---|
| Phần cứng | [CẦN ĐIỀN: CPU, số nhân, RAM của máy chạy thực nghiệm] |
| Hệ điều hành | [CẦN ĐIỀN – ví dụ Windows 11 Pro, xác nhận lại trên máy thực nghiệm] |
| Máy chủ | Java 17+ [CẦN ĐIỀN phiên bản JDK], Spring Boot 3.3.5, chạy bằng file jar |
| Cơ sở dữ liệu | **Lần đo hiện có: H2 trong RAM (`MODE=MySQL`, profile `h2`).** Lần đo MySQL 8: [CẦN ĐIỀN SỐ LIỆU MYSQL] |
| Bộ sinh tải | Node.js [CẦN ĐIỀN phiên bản], thư viện `ws` 8.18.0; dùng chính `stomp.js`, `connection.js`, `kitchenFeed.js` của client |
| Mạng | Bộ sinh tải và máy chủ chạy trên cùng một máy, giao tiếp qua `localhost` (loopback) |
| Đo CPU | Lấy mẫu `process.cpu.usage` của Spring Boot Actuator [23] mỗi giây (tỷ lệ so với toàn bộ CPU của máy) |

### 8.2. Dữ liệu

Thực đơn mẫu do `DataSeeder` tạo khi khởi động. Bộ sinh tải tạo các bàn riêng có mã `LT001…` qua `POST /api/admin/tables/bulk`, chỉ đặt những món còn bán và không giới hạn tồn kho; mỗi đơn gồm 1–3 món ngẫu nhiên, số lượng 1–2. Trước mỗi kịch bản, đơn của các bàn `LT…` được dọn và cấu hình được đặt lại; sau khi chạy xong, cấu hình trở về mặc định.

### 8.3. Phương pháp đo

Bộ sinh tải đóng **cả vai khách lẫn vai bếp** trong cùng một tiến trình, nên độ trễ từ lúc gửi `POST /api/orders` đến lúc bếp nhận `ORDER_CREATED` được đo bằng cùng một đồng hồ (`performance.now()`), không bị lệch giờ giữa các máy. Phân vị được tính theo phương pháp nearest-rank trên toàn bộ mẫu. Kết quả thô được ghi ra JSON (và CSV cho E1, E5) trong `statics/results/`; `report.js` tổng hợp thành `REPORT.md`.

### 8.4. Kịch bản thực nghiệm

Bảng sau ghi **tham số thực tế của lần chạy đã có số liệu** (`node run-all.js --quick`) và tham số của bản đầy đủ chưa chạy.

| ID | Mục đích | Tham số lần chạy rút gọn (đã có số liệu) | Bản đầy đủ (`run-all.js`) | Metric |
|---|---|---|---|---|
| E1 | Push vs Polling | 20 bàn, 20 s, mỗi bàn đặt 1 đơn/5 s; POLLING (chu kỳ 3 s) và RELIABLE_PUSH; 1 màn hình bếp | 50 bàn × {POLLING, NAIVE_PUSH, RELIABLE_PUSH}; 200 bàn × {POLLING, RELIABLE_PUSH}; 60 s | Độ trễ đặt món → bếp (p50/p95/p99), số request poll/s, byte bếp nhận, CPU |
| E2 | Mất kết nối | 200 đơn, 10 đơn/s, 20 bàn; cứ 10 s cắt kết nối bếp và chặn kết nối lại 3 s (trong thời gian chạy xảy ra 1 lần); NAIVE_PUSH vs RELIABLE_PUSH | 600 đơn, cùng tốc độ và chu kỳ cắt | Số đơn mất, trùng tới ứng dụng, số RESUME, số sự kiện gửi bù, thời gian đồng bộ lại |
| E3 | Gửi lặp | 100 đơn logic, 20 luồng song song; 10% "bấm 2 lần" (2 request song song cùng khoá); 30% "mất phản hồi" (client bỏ qua phản hồi, chờ 100 ms rồi gửi lại cùng khoá); idempotency tắt/bật | 300 đơn logic | Số đơn trong DB, số đơn trùng |
| E4 | Cập nhật đồng thời | 20 vòng; mỗi vòng tạo 1 món mới rồi 10 client cùng gửi PATCH với `version = 0` (5 client `ACCEPTED`, 5 client `CANCELLED`); khoá lạc quan tắt/bật | 50 vòng | Số cập nhật thành công, lost update (= thành công − số vòng), số 409 |
| E5 | Tải tăng dần | 10, 50, 100 client vòng kín (gửi request kế tiếp ngay khi nhận phản hồi), mỗi mức 10 s, 0 kết nối WebSocket mở sẵn | 10, 25, 50, 100, 200 client, mỗi mức 20 s; thêm một lượt với 500 kết nối WebSocket mở sẵn | Throughput, tỷ lệ lỗi, p50/p95/p99, CPU |
| E6 | Client spam | 15 s; 30 khách thường (mỗi khách một IP giả lập qua `X-Forwarded-For`, mỗi giây 1 `GET /api/orders`, thỉnh thoảng đặt 1 đơn); 1 bàn spam với 50 luồng `POST /api/orders` liên tục; rate limit tắt/bật | 30 s | Độ trễ của khách thường, số request spam được nhận/bị 429, CPU |

Trong E1–E3, E5 rate limit được tắt để không ảnh hưởng tới phép đo. Ở E6, máy chủ tạm thời tin header `X-Forwarded-For` để giả lập nhiều IP từ một máy, và tắt lại sau khi đo.

---

## 9. Kết quả (Results)

> **Toàn bộ số liệu dưới đây được đo với H2 trong RAM**, lần chạy `run-all.js --quick` ngày 17/10/2026 (file trong `statics/results/`, `REPORT.md` sinh lúc 20:00:18). Mỗi cấu hình chạy **một lần**. Các ô `[CẦN ĐIỀN SỐ LIỆU MYSQL]` để nhóm điền sau khi chạy lại trên MySQL 8.

### 9.1. E1 – Độ trễ đặt món → bếp nhận

**Bảng 1.** E1, 20 bàn, 20 s, 1 màn hình bếp (H2).

| Chế độ | Đơn tạo | Bếp nhận | p50 (ms) | p95 (ms) | p99 (ms) | Request poll/s | Byte bếp nhận | Frame WS vào | CPU TB (%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| POLLING (3 s) | 80 | 80 | 1341,68 | 2809,83 | 2953,84 | 0,55 | 50 745 | 0 | 1,04 |
| RELIABLE_PUSH | 80 | 80 | 7,71 | 11,52 | 16,01 | 0 | 61 449 | 82 | 0,69 |

Độ trễ của chính request `POST /api/orders` (phía khách) trong hai lượt chạy: p50 8,40 ms (POLLING) và 7,37 ms (RELIABLE_PUSH). Dữ liệu từng đơn: `e1_POLLING_20t_….csv`, `e1_RELIABLE_PUSH_20t_….csv`.

**Bảng 1b.** E1 bản đầy đủ.

| Chế độ | Bàn | p50 (ms) | p95 (ms) | p99 (ms) | Request poll/s | Byte bếp nhận | CPU TB (%) |
|---|---:|---:|---:|---:|---:|---:|---:|
| POLLING | 50 | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | | |
| NAIVE_PUSH | 50 | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | | |
| RELIABLE_PUSH | 50 | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | | |
| POLLING | 200 | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | | |
| RELIABLE_PUSH | 200 | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | | |

### 9.2. E2 – Mất đơn khi màn hình bếp mất kết nối

**Bảng 2.** E2, 200 đơn, 10 đơn/s, 1 lần mất kết nối 3 s (H2).

| Chế độ | Đơn tạo | Bếp nhận | Đơn mất | Tỷ lệ mất (%) | Trùng tới ứng dụng | Trùng bị lọc | Khoảng trống phát hiện | RESUME | Sự kiện gửi bù | Thời gian đồng bộ lại p50 / max (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NAIVE_PUSH | 200 | 169 | 31 | 15,5 | 0 | 0 | 0 | 0 | 0 | – |
| RELIABLE_PUSH | 200 | 200 | **0** | **0** | 0 | 0 | 0 | 2 | 31 | 2 / 4 |

"Thời gian đồng bộ lại" tính từ lúc nhận `CONNECTED` đến lúc xử lý xong `REPLAY_BATCH`; không bao gồm thời gian mất mạng và thời gian chờ backoff. Hai lần RESUME gồm một lần lúc kết nối ban đầu và một lần sau khi kết nối lại.

| Chế độ | Đơn tạo | Đơn mất | Tỷ lệ mất (%) | RESUME | Gửi bù |
|---|---:|---:|---:|---:|---:|
| NAIVE_PUSH (MySQL, 600 đơn) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | |
| RELIABLE_PUSH (MySQL, 600 đơn) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | |

### 9.3. E3 – Đơn trùng khi mất phản hồi / bấm hai lần

**Bảng 3.** E3, 100 đơn logic (H2).

| Idempotency | Request gửi | Mất phản hồi (giả lập) | Bấm 2 lần | Phản hồi "replayed" | Đơn trong DB | Đơn trùng | Tỷ lệ trùng (%) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 134 | 24 | 10 | 0 | 134 | 34 | 34 |
| Bật | 141 | 32 | 9 | 41 | 100 | **0** | **0** |

Số request khác nhau giữa hai lượt vì việc chọn "mất phản hồi" và "bấm 2 lần" là ngẫu nhiên. Với idempotency bật, số phản hồi replayed (41) đúng bằng số request vượt quá số đơn logic (141 − 100).

| Idempotency | Request gửi | Đơn trong DB | Đơn trùng | Tỷ lệ trùng (%) |
|---|---:|---:|---:|---:|
| Tắt (MySQL, 300 đơn) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | |
| Bật (MySQL, 300 đơn) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | |

### 9.4. E4 – Nhiều màn hình bếp cùng cập nhật một món

**Bảng 4.** E4, 20 vòng × 10 client đồng thời (H2).

| Khoá lạc quan | Cập nhật thành công | Kỳ vọng | Lost update | Số 409 | Lỗi khác | Vòng có lost update |
|---|---:|---:|---:|---:|---:|---:|
| Tắt | 154 | 20 | 134 | 46 | 0 | 20/20 |
| Bật | 20 | 20 | **0** | 180 | 0 | **0/20** |

| Khoá lạc quan | Thành công | Lost update | Số 409 |
|---|---:|---:|---:|
| Tắt (MySQL, 50 vòng) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | |
| Bật (MySQL, 50 vòng) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | |

### 9.5. E5 – Tải tăng dần

**Bảng 5.** E5, đặt món vòng kín, mỗi mức 10 s, không có kết nối WebSocket mở sẵn (H2).

| Client đồng thời | Request | Throughput (đơn/s) | Lỗi (%) | Trung bình (ms) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | CPU TB (%) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 25 361 | 2536,1 | 0 | 3,92 | 3,44 | 7,22 | 9,65 | 23,15 | 28,77 |
| 50 | 32 086 | 3208,6 | 0 | 15,56 | 14,93 | 20,87 | 33,55 | 64,68 | 13,89 |
| 100 | 31 970 | 3197,0 | 0 | 31,25 | 29,96 | 39,82 | 54,72 | 110,58 | 14,49 |

| Client đồng thời | WS mở sẵn | Throughput (đơn/s) | Lỗi (%) | p50 (ms) | p95 (ms) | p99 (ms) | CPU TB (%) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 / 25 / 50 / 100 / 200 | 0 | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | | |
| 10 / 25 / 50 / 100 / 200 | 500 | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | | | |

> [CHÈN BIỂU ĐỒ: throughput và p95 theo số client, vẽ từ `e5_ws-0_….csv` và file MySQL tương ứng]

### 9.6. E6 – Client spam

**Bảng 6.** E6, 15 s, 30 khách thường, 50 luồng spam từ 1 IP/1 bàn (H2).

| Rate limit | Khách thường p50 (ms) | p95 (ms) | p99 (ms) | Lỗi khách thường | Đơn khách thường OK / lỗi | Spam gửi | Spam được nhận | Spam bị 429 | CPU TB (%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Tắt | 17,74 | 47,51 | 48,07 | 0 | 30 / 0 | 45 708 | 45 708 | 0 | 14,00 |
| Bật | 14,52 | 43,85 | 55,35 | 0 | 29 / 0 | 52 964 | 6 | 52 958 | 4,38 |

Số đơn của khách thường (30 và 29) khác nhau do thời điểm đặt đơn được chọn ngẫu nhiên trong 15 s; cả hai lượt đều không có đơn nào của khách thường bị lỗi.

| Rate limit | Khách thường p50 / p95 / p99 (ms) | Spam được nhận | Spam bị 429 | CPU TB (%) |
|---|---|---:|---:|---:|
| Tắt (MySQL, 30 s) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | |
| Bật (MySQL, 30 s) | [CẦN ĐIỀN SỐ LIỆU MYSQL] | | | |

### 9.7. Tổng hợp baseline và đề xuất

**Bảng 7.** Tổng hợp (H2, lần chạy rút gọn).

| Metric | Baseline | Đề xuất | Nguồn |
|---|---:|---:|---|
| Độ trễ đặt món → bếp, p50 (ms) | 1341,68 (POLLING) | 7,71 | E1 |
| Độ trễ đặt món → bếp, p95 (ms) | 2809,83 (POLLING) | 11,52 | E1 |
| Đơn mất / 200 khi bếp mất kết nối 3 s | 31 (NAIVE_PUSH) | 0 | E2 |
| Tỷ lệ đơn trùng khi gửi lặp | 34% | 0% | E3 |
| Lost update / 20 vòng × 10 client | 134 | 0 | E4 |
| Request spam đi tới nghiệp vụ | 45 708 | 6 | E6 |
| CPU máy chủ trung bình khi bị spam | 14,00% | 4,38% | E6 |

---

## 10. Thảo luận (Discussion)

### 10.1. Độ trễ: Push và Polling (E1)

Với polling chu kỳ 3 s, một đơn tạo ra tại thời điểm ngẫu nhiên phải chờ tới lần hỏi kế tiếp, nên về lý thuyết thời gian chờ phân bố gần đều trong khoảng 0–3 s, trung bình khoảng 1,5 s. Số đo phù hợp với nhận định này: p50 là 1341,68 ms và p99 là 2953,84 ms, sát với chu kỳ hỏi. Khi đẩy qua WebSocket, độ trễ chỉ còn là thời gian xử lý giao dịch cộng thời gian chuyển frame: p50 7,71 ms, tức thấp hơn khoảng 174 lần. Muốn polling đạt cỡ độ trễ này thì chu kỳ hỏi phải giảm xuống cỡ vài chục mili-giây, khiến số request tăng hàng trăm lần.

Kết quả cũng cho thấy một điểm cần nói rõ: trong kịch bản này, **đẩy không tiết kiệm băng thông**. Bếp nhận 61 449 byte qua WebSocket so với 50 745 byte qua polling. Lý do là ở mức 4 đơn/s, mỗi lần hỏi đã gom được nhiều sự kiện vào một phản hồi, còn khi đẩy, mỗi sự kiện là một frame STOMP riêng với các header lặp lại. Polling tốn ít byte hơn ở đây nhưng phải trả giá bằng độ trễ; ưu thế băng thông của đẩy chỉ xuất hiện khi hệ thống rảnh hoặc khi có nhiều màn hình bếp cùng hỏi, và cần bản đo đầy đủ (Bảng 1b) để xác nhận. Mức CPU trung bình của cả hai chế độ đều rất thấp (1,04% và 0,69%), chưa đủ để kết luận chế độ nào nhẹ hơn.

### 10.2. Độ tin cậy khi mất kết nối (E2)

Ở 10 đơn/s, khoảng mất mạng 3 s tương ứng khoảng 30 đơn. Chế độ NAIVE_PUSH mất đúng 31 đơn: những đơn được phát trong khoảng thời gian bếp không có kết nối (cộng thêm khoảng chờ kết nối lại) không còn cách nào tới được bếp, và client không hề biết mình đã bỏ lỡ. Với RELIABLE_PUSH, ngay sau khi kết nối lại client gửi RESUME với watermark của mình và nhận đúng 31 sự kiện gửi bù, nên số đơn mất bằng 0. Thời gian từ `CONNECTED` tới khi đồng bộ xong chỉ 2–4 ms vì nhật ký nằm trong cơ sở dữ liệu cục bộ và lô gửi bù nhỏ.

Hai chỉ số "trùng bị lọc" và "khoảng trống phát hiện" đều bằng 0 trong lần chạy này. Điều đó có nghĩa là trong E2 cơ chế phục hồi chính là RESUME sau khi kết nối lại, chứ không phải phát hiện khoảng trống trong lúc đang kết nối; nhánh loại trùng và nhánh phát hiện khoảng trống chưa được kịch bản này kích hoạt. Thực nghiệm chỉ xảy ra **một** lần mất kết nối vì tổng thời gian chạy là 20 s; bản đầy đủ 600 đơn (60 s) sẽ cho nhiều lần mất kết nối hơn.

### 10.3. Đơn trùng (E3)

Khi tắt idempotency, mỗi request tới máy chủ đều tạo một đơn: 134 request thành 134 đơn, dư 34 đơn so với 100 lần đặt thật. Khi bật, 141 request chỉ tạo đúng 100 đơn; 41 request còn lại được trả lại đơn cũ với `200` + `Idempotent-Replayed: true`. Kịch bản "bấm 2 lần" gửi hai request cùng khoá **song song**, nên kết quả bằng 0 cũng cho thấy nhánh xử lý tranh chấp đồng thời (dựa trên khoá chính và `DuplicateKeyException`) hoạt động, không chỉ nhánh kiểm tra tuần tự. Test tích hợp `concurrentRequestsWithSameKeyCreateOneOrder` (8 request song song cùng khoá) củng cố thêm kết luận này.

Cần lưu ý: "mất phản hồi" được giả lập ở phía client (client bỏ qua phản hồi đã nhận rồi gửi lại), chưa phải mất gói tin thật trên mạng. Về phía máy chủ, hai trường hợp này giống nhau vì máy chủ chỉ thấy một request mới với cùng khoá.

### 10.4. Cập nhật đồng thời (E4)

Khi tắt khoá lạc quan, mỗi vòng có trung bình 7,7 trên 10 request được báo thành công (154/20), dù trên thực tế chỉ một quyết định có thể đúng: món vừa được "nhận" vừa bị "từ chối", và trạng thái cuối cùng phụ thuộc vào request nào ghi sau. Các request đọc trạng thái `PENDING` trước khi có ai ghi đều vượt qua kiểm tra máy trạng thái rồi ghi đè lên nhau; chỉ những request đọc muộn (thấy trạng thái đã đổi) mới nhận 409 (46 lần). Như vậy **chỉ riêng máy trạng thái không đủ** khi có cạnh tranh, vì kiểm tra và ghi không nguyên tử. Khi bật khoá lạc quan, điều kiện `WHERE version = ?` biến kiểm tra và ghi thành một thao tác nguyên tử: mỗi vòng đúng 1 request thành công, 9 request còn lại nhận 409 (tổng 180), không có lỗi nào khác.

### 10.5. Tải tăng dần (E5)

Throughput tăng từ 2536 lên khoảng 3200 đơn/s khi tăng từ 10 lên 50 client, rồi đứng yên ở 100 client, trong khi độ trễ tăng gần tuyến tính với số client. Đây là hành vi đặc trưng của thử tải vòng kín đã chạm điểm bão hoà: độ trễ trung bình đo được (3,92; 15,56; 31,25 ms) khớp với tỷ số số client / throughput (10/2536,1 ≈ 3,9 ms; 50/3208,6 ≈ 15,6 ms; 100/3197 ≈ 31,3 ms) theo định luật Little. Không có request nào lỗi.

Có ba điểm cần thận trọng khi diễn giải:

1. Bộ sinh tải và máy chủ chạy trên cùng máy, nên điểm bão hoà có thể đến từ chính bộ sinh tải hoặc từ cạnh tranh CPU giữa hai tiến trình, chưa chắc là giới hạn của máy chủ.
2. CPU trung bình ở mức 10 client (28,77%) lại cao hơn ở mức 50 và 100 client (khoảng 14%). Nhiều khả năng mức đầu tiên trùng với giai đoạn JIT của JVM đang biên dịch mã nóng; muốn khẳng định thì cần một bước khởi động (warm-up) trước khi đo.
3. H2 chạy trong RAM nên chi phí ghi đĩa và chi phí mạng tới cơ sở dữ liệu gần như bằng 0. Con số khoảng 3200 đơn/s **không đại diện** cho triển khai với MySQL, và đây là thực nghiệm cần đo lại nhất. [CẦN ĐIỀN SỐ LIỆU MYSQL]

Dù vậy, ngay cả khi throughput thực tế với MySQL thấp hơn nhiều lần, nó vẫn vượt xa nhu cầu của một nhà hàng vài chục bàn. Rủi ro tải của bài toán vì vậy nằm ở đột biến và client bất thường (E6) hơn là ở tải trung bình.

### 10.6. Client spam (E6)

Khi tắt rate limit, một bàn với 50 luồng đã đưa được **45 708 đơn rác** vào cơ sở dữ liệu trong 15 s. Khi bật, chỉ 6 request spam lọt qua (5 token ban đầu của bucket theo bàn cộng phần nạp lại 5 đơn/phút trong 15 s, theo cấu hình lúc đo; mặc định hiện nay là 10), 52 958 request còn lại bị từ chối bằng 429 ở interceptor, trước khi chạm tới cơ sở dữ liệu; CPU trung bình giảm từ 14,00% xuống 4,38%. Số request spam gửi được còn tăng lên (52 964 so với 45 708) vì phản hồi 429 rẻ và nhanh hơn phản hồi tạo đơn.

Ảnh hưởng tới độ trễ của khách thường trong lần đo này **nhỏ và không nhất quán**: p50 giảm từ 17,74 xuống 14,52 ms và p95 từ 47,51 xuống 43,85 ms, nhưng p99 lại tăng từ 48,07 lên 55,35 ms. Với 450 mẫu, p99 chỉ phụ thuộc vào vài request chậm nhất nên dao động lớn. Giải thích hợp lý là với H2 trong RAM, máy chủ còn dư năng lực nên spam chưa làm nghẽn khách thường; lợi ích đo được rõ ràng của rate limit ở đây là **bảo vệ dữ liệu và tài nguyên** (không có 45 nghìn đơn rác, CPU giảm khoảng 69%) hơn là cải thiện độ trễ. Với MySQL, nơi mỗi đơn tốn thêm ghi đĩa, nhóm kỳ vọng tác động lên độ trễ sẽ rõ hơn, nhưng điều này cần được kiểm chứng bằng số đo. [CẦN ĐIỀN SỐ LIỆU MYSQL]

### 10.7. Khi nào giải pháp hoạt động tốt, khi nào còn hạn chế

**Hoạt động tốt** khi: mất kết nối ngắn hoặc dài nhưng nhật ký còn đủ (phát bù theo trang 500 sự kiện); nhiều màn hình bếp cùng thao tác; client gửi lặp do mạng chập chờn; một client gửi quá nhiều request.

**Còn hạn chế** khi: cần đánh giá phần thanh toán (chưa có thực nghiệm định lượng, chỉ có kiểm thử chức năng); cần mở rộng ra nhiều máy chủ (broker trong RAM và rate limiter trong RAM chỉ có ý nghĩa trên một máy); nhật ký sự kiện tăng mãi; hai giao dịch commit theo thứ tự ngược với thứ tự cấp `seq` (xem mục 12); khách hàng không dùng cơ chế RESUME mà tải lại toàn bộ danh sách đơn khi kết nối lại.

### 10.8. Ý nghĩa của kết quả

Các thực nghiệm E2–E4 cho thấy ba lỗi thường gặp ở ứng dụng mạng (mất sự kiện, request lặp, ghi đè đồng thời) không chỉ là rủi ro lý thuyết: với cấu hình baseline, chúng xảy ra với tỷ lệ đáng kể ngay trên một máy và một mạng loopback không có nhiễu. Các cơ chế đề xuất đưa cả ba chỉ số về 0 trong các kịch bản đã đo, với chi phí độ trễ gần như không đáng kể (độ trễ `POST /api/orders` ở chế độ đề xuất vẫn ở mức vài mili-giây).

---

## 11. Điểm mới và đóng góp (Novelty and Contributions)

**Khác gì so với baseline / cách làm thông thường?** Ứng dụng gọi món thông thường hoặc dùng polling, hoặc broadcast WebSocket không bảo đảm, tạo đơn bằng POST không idempotent và cập nhật trạng thái theo kiểu "ghi sau thắng". Hệ thống của nhóm không phát minh thuật toán mới mà **thiết kế, tích hợp và đo đạc** một bộ cơ chế độ tin cậy ở tầng giao thức ứng dụng, mỗi cơ chế có thể bật/tắt để so sánh trực tiếp với baseline trên cùng mã nguồn.

| # | Đóng góp | Mô tả | Bằng chứng |
|---|---|---|---|
| 1 | Giao thức sự kiện tin cậy trên STOMP | Envelope `{type, seq, eventId, serverTime, payload}`; ACK; RESUME/REPLAY_BATCH theo trang; watermark xử lý trùng, khoảng trống và lỗ seq do rollback | Hiện thực: `KitchenWsController`, `kitchenFeed.js`. E2: mất 31/200 (NAIVE_PUSH) → 0/200 (RELIABLE_PUSH), gửi bù 31 sự kiện |
| 2 | Nhật ký sự kiện cùng giao dịch + phát sau commit | `order_event` ghi trong cùng giao dịch; gửi qua `TransactionSynchronization.afterCommit`; lỗi gửi không làm mất sự kiện | Hiện thực: `EventStore`, `EventPublisher`, `OrderService.createOrder`. Chưa có test riêng cho trường hợp rollback (xem mục 12) |
| 3 | Đặt món idempotent chịu được request đồng thời | `Idempotency-Key` + SHA-256 nội dung; khoá chính làm điểm tuần tự hoá; 409 khi dùng lại khoá cho nội dung khác; client giữ khoá trong `localStorage` | E3: trùng 34% → 0%; 2 test tích hợp (gửi lặp, 8 request song song) và 1 test 409 |
| 4 | Đồng bộ nhiều màn hình bếp | Máy trạng thái + `UPDATE … WHERE version = ?` | E4: lost update 134 → 0; test `stateMachineAndOptimisticLock` |
| 5 | So sánh định lượng Push và Polling | Cùng một client đo theo cùng đồng hồ | E1: p50 1341,68 ms → 7,71 ms; đồng thời chỉ ra polling tốn ít byte hơn ở mức 4 đơn/s |
| 6 | Chống quá tải nhiều lớp | Token bucket tự cài đặt theo IP và theo bàn, giới hạn kết nối WS theo bàn, giới hạn bộ đệm/kích thước frame, pool DB giới hạn + 503, ETag, backoff + jitter | E6: spam lọt qua 45 708 → 6, CPU 14,00% → 4,38%; 3 test `TokenBucketTest`; test ETag → 304 |
| 7 | Client STOMP 1.2 tự viết và khung thực nghiệm | Mã hoá/giải mã frame, heart-beat, phát hiện kết nối chết; dùng chung cho trình duyệt và bộ sinh tải; baseline/đề xuất đổi lúc chạy | `stomp.js`, `connection.js`; `source/loadtest`; file kết quả trong `statics/results/` |
| 8 | Xác nhận thanh toán server-to-server có chữ ký, idempotent | IPN của VNPay được kiểm chữ ký HMAC-SHA512 và số tiền do máy chủ tính; IPN, Return URL và tra cứu `querydr` dùng chung một `UPDATE … WHERE status IN (…)` nên gọi lặp chỉ ghi nhận một lần (`02`); tiền về muộn vẫn được ghi nhận và đánh dấu cần hoàn | Hiện thực: `PaymentService`, `VnpayGateway`. Test `vnpayIpnVerifiesSignatureAmountAndIsIdempotent` (`97`/`04`/`00`/`02`), `vnpayHmacMatchesWhenRecomputed`. Chưa có số liệu thực nghiệm |
| 9 | Phiên bàn và thanh toán dùng chung cho nhiều điện thoại, an toàn khi đồng thời | Phiên bàn mở bằng `UPDATE … WHERE current_session_id IS NULL`; một lần thanh toán đang chờ mỗi phiên bằng `UNIQUE (pending_session_id)`; xác nhận tiền mặt bằng khoá lạc quan | Test `concurrentJoinOpensOnlyOneSession`, `cashPaymentFlowAndCheckout`; e2e nhóm 15, 16 |

**So sánh baseline và đề xuất**

| Khía cạnh | Baseline | Đề xuất |
|---|---|---|
| Kiến trúc | Ghi DB rồi phát ngay, không nhật ký | Nhật ký sự kiện cùng giao dịch, phát sau commit |
| Thuật toán | Không có thứ tự, không phát hiện mất | `seq` toàn cục, watermark, RESUME; token bucket |
| Giao tiếp | Polling 3 s, hoặc đẩy không ACK | Đẩy có ACK, phát bù theo yêu cầu, heart-beat, backoff + jitter |
| Hiệu năng (H2) | p50 1341,68 ms (polling) | p50 7,71 ms |
| Chức năng/độ tin cậy | Mất đơn, đơn trùng, lost update | 0 trong các kịch bản đã đo |

---

## 12. Hạn chế (Limitations)

1. **Số liệu mới đo với H2 trong RAM, bản rút gọn, mỗi cấu hình một lần.** Chưa có số liệu MySQL, chưa có khoảng tin cậy hay nhiều lần lặp. E5 và E6 nhạy cảm nhất với lựa chọn cơ sở dữ liệu.
2. **Môi trường thực nghiệm là loopback trên một máy.** Không có độ trễ, mất gói hay giới hạn băng thông của Wi-Fi thật; bộ sinh tải tranh CPU với máy chủ. Mất kết nối được giả lập bằng cách cắt TCP từ phía client (`terminate()`) và chặn kết nối lại; chưa dùng công cụ chèn lỗi mạng như Toxiproxy.
3. **E2 mới có một lần mất kết nối**, và chưa kích hoạt nhánh phát hiện khoảng trống/loại trùng; chưa đo trường hợp nhiều màn hình bếp mất kết nối cùng lúc hay "reconnect storm" của hàng trăm client.
4. **Chưa có test tự động cho phát-sau-commit** (ép giao dịch rollback và kiểm tra bếp không nhận sự kiện).
5. **Thứ tự commit có thể khác thứ tự `seq`.** `seq` được cấp lúc INSERT, còn sự kiện chỉ hiển thị sau COMMIT. Nếu giao dịch giữ `seq = n` commit muộn hơn giao dịch giữ `seq = n + 1`, một lần phát bù xảy ra đúng lúc đó sẽ trả `latestSeq = n + 1`, và client coi `n` là "lỗ". Khi đang kết nối, client vẫn nhận `n` qua kênh đẩy (vì loại trùng dựa trên tập `seen`, không dựa trên watermark); nhưng nếu `n` được commit trong lúc client lại mất kết nối, lần RESUME sau sẽ bắt đầu từ watermark lớn hơn `n` và bỏ qua nó. Đây là trường hợp hiếm nhưng có thật.
6. **Một máy chủ duy nhất.** Simple broker, `SessionRegistry` và rate limiter đều nằm trong RAM của một tiến trình; khi khởi động lại máy chủ, bộ đếm và bucket bị xoá (nhật ký sự kiện vẫn còn nếu dùng MySQL).
7. **Nhật ký sự kiện và bảng `idempotency_key` chưa có cơ chế dọn dẹp** theo thời gian, nên tăng mãi.
8. **Khách hàng không dùng RESUME**: khi kết nối lại, ứng dụng khách tải lại toàn bộ danh sách đơn qua REST; đơn giản nhưng tốn hơn khi bàn có nhiều đơn.
9. **Bảo mật cơ bản**: chưa có HTTPS/WSS; token nhân viên tự ký không thu hồi được trước hạn; mã QR tĩnh theo bàn, chỉ đổi khi quản trị bấm "đổi mã"; rate limit theo IP chưa phân biệt được nhiều điện thoại sau cùng một NAT.
10. **Thanh toán mới ở mức sandbox và chưa được đo.** Chỉ chạy với môi trường thử của VNPay; chưa có thực nghiệm định lượng (độ trễ xác nhận, tỷ lệ IPN bị lạc). Hoàn tiền chỉ được đánh dấu (`needs_refund`) để thu ngân xử lý tay, chưa gọi API hoàn tiền. Các thông báo thanh toán không đi qua nhật ký `seq`, client phải tải lại qua REST khi kết nối lại. Người biết mã QR của bàn có thể vào phiên và thấy đơn chung của bàn đó.
11. **Số liệu E1–E6 được đo trước khi thêm phiên bàn và thanh toán** (mục 4.9); E6 dùng giới hạn cũ 5 đơn/phút/bàn. Cần chạy lại để xác nhận các số liệu với mã nguồn hiện tại.

---

## 13. Hướng phát triển (Future Work)

1. Chạy bản đầy đủ `run-all.js` trên MySQL 8, lặp mỗi cấu hình nhiều lần để báo cáo trung bình và độ lệch chuẩn; thêm bước khởi động JVM trước khi đo.
2. Tách bộ sinh tải sang máy khác trong LAN; dùng Toxiproxy hoặc `tc netem` để chèn độ trễ, mất gói, cắt TCP ở tầng mạng; đo "reconnect storm" với và không có jitter.
3. Xử lý triệt để vấn đề thứ tự commit: cấp `seq` bằng một bộ đếm được tuần tự hoá lúc commit, hoặc chỉ coi `seq` là "lỗ" sau một khoảng thời gian an toàn kể từ khi nó xuất hiện.
4. Thêm test tích hợp cho WebSocket (RESUME, phát bù, phân quyền SUBSCRIBE) và cho trường hợp rollback không phát sự kiện.
5. Mở rộng ra nhiều máy chủ: dùng STOMP broker relay (RabbitMQ/ActiveMQ), rate limiter dùng chung (ví dụ Redis), sticky session hoặc chia sẻ trạng thái phiên.
6. Dọn nhật ký và khoá idempotency theo TTL; nén payload hoặc chỉ gửi phần thay đổi; topic theo trạm bếp để giảm fan-out.
7. HTTPS/WSS, mã QR có hạn dùng theo phiên bàn, thu hồi token nhân viên.
8. Áp dụng RESUME cho ứng dụng khách để chỉ tải phần thay đổi.

---

## 14. Kết luận (Conclusion)

Báo cáo đã trình bày QR Order, một hệ thống gọi món qua QR có màn hình bếp thời gian thực, trong đó trọng tâm là tính tin cậy của giao tiếp mạng chứ không phải số lượng màn hình. Bài toán đặt ra là giao đơn tới bếp không mất, không trùng, độ trễ thấp, trong điều kiện kết nối chập chờn, client gửi lặp và nhiều người thao tác đồng thời. Giải pháp tách lệnh (REST) khỏi sự kiện (WebSocket/STOMP), lấy nhật ký sự kiện trong cơ sở dữ liệu làm nguồn sự thật, đánh số thứ tự toàn cục cho sự kiện, để client ACK, loại trùng và yêu cầu phát bù; đồng thời bổ sung idempotency key, máy trạng thái với khoá lạc quan và nhiều lớp chống quá tải. Trên lần thực nghiệm rút gọn với H2, so với baseline, giải pháp giảm số đơn mất khi bếp mất kết nối từ 31/200 xuống 0, tỷ lệ đơn trùng từ 34% xuống 0%, lost update từ 134 xuống 0, độ trễ trung vị từ 1341,68 ms xuống 7,71 ms, và chặn 52 958/52 964 request spam trước khi chạm tới cơ sở dữ liệu. Đóng góp của nhóm nằm ở việc thiết kế giao thức, tích hợp các cơ chế độ tin cậy vào một hệ thống chạy được và cung cấp bằng chứng định lượng có thể chạy lại; việc đo lại trên MySQL và trong mạng thật là bước tiếp theo cần hoàn thành.

---

## Tài liệu tham khảo (References)

[1] I. Fette and A. Melnikov, "The WebSocket Protocol," RFC 6455, IETF, Dec. 2011. [Online]. Available: https://www.rfc-editor.org/rfc/rfc6455

[2] STOMP Protocol Specification, Version 1.2. [Online]. Available: https://stomp.github.io/stomp-specification-1.2.html

[3] R. Fielding, M. Nottingham, and J. Reschke, Eds., "HTTP Semantics," RFC 9110, IETF, Jun. 2022. [Online]. Available: https://www.rfc-editor.org/rfc/rfc9110

[4] M. Nottingham and R. Fielding, "Additional HTTP Status Codes," RFC 6585, IETF, Apr. 2012. [Online]. Available: https://www.rfc-editor.org/rfc/rfc6585

[5] S. Loreto, P. Saint-Andre, S. Salsano, and G. Wilkins, "Known Issues and Best Practices for the Use of Long Polling and Streaming in Bidirectional HTTP," RFC 6202, IETF, Apr. 2011. [Online]. Available: https://www.rfc-editor.org/rfc/rfc6202

[6] WHATWG, "HTML Living Standard – Server-sent events." [Online]. Available: https://html.spec.whatwg.org/multipage/server-sent-events.html

[7] Spring Framework Reference Documentation, "WebSockets – STOMP." [Online]. Available: https://docs.spring.io/spring-framework/reference/web/websocket/stomp.html

[8] OASIS, "MQTT Version 5.0," OASIS Standard, Mar. 2019. [Online]. Available: https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html

[9] Stripe, "API Reference – Idempotent requests." [Online]. Available: https://docs.stripe.com/api/idempotent_requests

[10] B. Leach, "Implementing Stripe-like Idempotency Keys in Postgres," 2017. [Online]. Available: https://brandur.org/idempotency-keys

[11] J. Jena and S. Dalal, "The Idempotency-Key HTTP Header Field," IETF Internet-Draft draft-ietf-httpapi-idempotency-key-header, work in progress. [Online]. Available: https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/

[12] C. Richardson, "Pattern: Transactional outbox," microservices.io. [Online]. Available: https://microservices.io/patterns/data/transactional-outbox.html

[13] Spring Framework Reference Documentation, "Transaction-bound Events." [Online]. Available: https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html

[14] M. Kleppmann, *Designing Data-Intensive Applications*. Sebastopol, CA, USA: O'Reilly Media, 2017.

[15] H. T. Kung and J. T. Robinson, "On optimistic methods for concurrency control," *ACM Transactions on Database Systems*, vol. 6, no. 2, pp. 213–226, 1981.

[16] J. H. Saltzer, D. P. Reed, and D. D. Clark, "End-to-end arguments in system design," *ACM Transactions on Computer Systems*, vol. 2, no. 4, pp. 277–288, 1984.

[17] M. Fowler, *Patterns of Enterprise Application Architecture*. Boston, MA, USA: Addison-Wesley, 2002 (Optimistic Offline Lock).

[18] A. S. Tanenbaum and D. J. Wetherall, *Computer Networks*, 5th ed. Boston, MA, USA: Pearson, 2011 (mục Traffic shaping – token bucket).

[19] J. Heinanen and R. Guerin, "A Single Rate Three Color Marker," RFC 2697, IETF, Sep. 1999. [Online]. Available: https://www.rfc-editor.org/rfc/rfc2697

[20] M. Brooker, "Exponential Backoff And Jitter," AWS Architecture Blog, Mar. 2015. [Online]. Available: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

[21] W. Eddy, Ed., "Transmission Control Protocol (TCP)," RFC 9293, IETF, Aug. 2022. [Online]. Available: https://www.rfc-editor.org/rfc/rfc9293

[22] Oracle, "MySQL 8.0 Reference Manual – AUTO_INCREMENT Handling in InnoDB." [Online]. Available: https://dev.mysql.com/doc/refman/8.0/en/innodb-auto-increment-handling.html

[23] Spring Boot Reference Documentation. [Online]. Available: https://docs.spring.io/spring-boot/index.html

> Ghi chú cho nhóm: trước khi nộp, mở lại từng đường dẫn để kiểm tra và ghi ngày truy cập theo quy định của khoa (ví dụ "Truy cập ngày …/10/2026").

---

## Phụ lục (Appendix)

### A. REST API

| Method | Endpoint | Xác thực | Ghi chú |
|---|---|---|---|
| GET | `/api/public/config` | – | Chế độ giao đơn, chu kỳ polling, heart-beat, giờ máy chủ |
| GET | `/api/public/tables/{qrToken}` | – | Mã QR → thông tin bàn |
| POST | `/api/public/tables/{qrToken}/join` | – | Vào bàn: vào phiên đang có hoặc mở phiên mới → `sessionId`; bàn ngừng phục vụ → `409 TABLE_CLOSED` |
| GET | `/api/public/menu` | – | Có `ETag`; gửi `If-None-Match` → `304` |
| POST | `/api/orders` | `X-Table-Token` | `X-Device-Id`, `X-Session-Id`, `Idempotency-Key`; body có `guestName`; `201` mới / `200` + `Idempotent-Replayed: true`; `409 PAYMENT_IN_PROGRESS`, `409 SESSION_ENDED` |
| GET | `/api/orders` | `X-Table-Token` | Mọi đơn của phiên bàn hiện tại + `mineOrderIds` |
| POST | `/api/orders/{id}/cancel` | `X-Table-Token` | Chỉ máy đã đặt, khi mọi món còn `PENDING` |
| GET | `/api/payments/bill` | `X-Table-Token` | Tổng, đã trả, còn phải trả, lần đang chờ, cách thanh toán đang bật |
| POST | `/api/payments` | `X-Table-Token` | `{method: CASH \| VNPAY}` + `Idempotency-Key`; VNPay trả kèm `payUrl` |
| GET | `/api/payments/{id}` | `X-Table-Token` | Một lần thanh toán của bàn |
| POST | `/api/payments/{id}/cancel` | `X-Table-Token` | Huỷ lần đang chờ |
| GET | `/api/payments/vnpay/ipn` | Chữ ký VNPay | Máy chủ VNPay gọi; trả `{RspCode, Message}` |
| GET | `/api/payments/vnpay/return` | Chữ ký VNPay | Trình duyệt quay về; `302` về trang gọi món |
| POST | `/api/auth/login` | – | `{username, password}` → token nhân viên |
| GET | `/api/kitchen/orders` | Bearer | Ảnh chụp đơn đang mở + `latestSeq` |
| GET | `/api/kitchen/events?afterSeq=` | Bearer | Dùng cho chế độ POLLING |
| PATCH | `/api/kitchen/order-items/{id}/status` | Bearer | `{status, version}` |
| GET | `/api/cashier/tables`, `/api/cashier/tables/{id}` | Bearer (CASHIER, ADMIN) | Sơ đồ bàn / chi tiết hóa đơn |
| POST | `/api/cashier/tables/{id}/payments` | Bearer (CASHIER, ADMIN) | Thu tiền mặt tại quầy |
| PATCH | `/api/cashier/payments/{id}/confirm` | Bearer (CASHIER, ADMIN) | `{version}`: "Đã nhận tiền" |
| POST | `/api/cashier/payments/{id}/cancel` | Bearer (CASHIER, ADMIN) | Huỷ lần đang chờ |
| POST | `/api/cashier/tables/{id}/checkout` | Bearer (CASHIER, ADMIN) | Trả bàn `{reason, note}`; `409 CONFIRM_REQUIRED` khi còn nợ/còn món mà chưa có lý do |
| GET/POST | `/api/admin/tables`, `/tables/bulk`, `/tables/{id}/open`, `/close`, `/rotate-token` | Bearer (ADMIN) | Quản lý bàn và mã QR; `open`/`close` = phục vụ / ngừng phục vụ, `409 TABLE_HAS_GUESTS` khi đóng bàn có khách |
| GET | `/api/admin/payments` | Bearer (ADMIN) | Lịch sử thanh toán |
| GET/POST/PUT | `/api/admin/categories`, `/api/admin/menu-items[/{id}]` | Bearer (ADMIN) | Quản lý thực đơn |
| GET | `/api/admin/monitor`, `/api/admin/stats?since=` | Bearer (ADMIN) | Giám sát kết nối, thống kê |
| GET/PUT | `/api/admin/settings` | Bearer (ADMIN) | Bật/tắt baseline: `deliveryMode`, `idempotencyEnabled`, `optimisticLockEnabled`, `rateLimitEnabled`, `trustForwardedFor` |
| POST | `/api/admin/maintenance/clear-test-orders` | Bearer (ADMIN) | Dọn dữ liệu các bàn `LT…` |
| GET | `/actuator/health`, `/actuator/metrics/...` | – | Giám sát, lấy mẫu CPU |

### B. Đích STOMP

| Hướng | Đích | Ai được dùng |
|---|---|---|
| SUBSCRIBE | `/topic/kitchen` | Nhân viên |
| SUBSCRIBE | `/topic/table.{id}` | Khách của bàn `id`; nhân viên |
| SUBSCRIBE | `/topic/cashier` | CASHIER, ADMIN |
| SUBSCRIBE | `/topic/menu` | Tất cả |
| SUBSCRIBE | `/user/queue/replay`, `/user/queue/errors` | Nhân viên (khách chỉ `/user/queue/errors`) |
| SEND | `/app/ack`, `/app/resume` | Nhân viên |

### C. Lược đồ cơ sở dữ liệu

```text
staff            (id PK, username UNIQUE, password_hash, role)          -- role: ADMIN, KITCHEN, CASHIER
restaurant_table (id PK, code UNIQUE, qr_token UNIQUE, status, current_session_id)  -- status: OPEN = phục vụ, CLOSED = ngừng
table_session    (id PK, table_id FK, opened_at, closed_at, end_reason, end_note, ended_by)
category         (id PK, name, sort_order)
menu_item        (id PK, category_id FK, name, description, price, image_url, available, stock NULL, station)
orders           (id PK, session_id FK, table_id FK, device_id, guest_name, status, total, created_at, updated_at)
order_item       (id PK, order_id FK, menu_item_id FK, name, unit_price, quantity, note, status, version, station, updated_at)
order_event      (seq PK AUTO_INCREMENT, event_id, order_id FK, table_id, type, payload TEXT, created_at)
idempotency_key  (key_value PK, request_hash CHAR(64), order_id NULL, created_at)
payment          (id PK, session_id, table_id, amount, method, status, version, txn_ref UNIQUE,
                  idempotency_key UNIQUE NULL, pending_session_id UNIQUE NULL, provider_txn_no,
                  provider_create_date, needs_refund, created_by_device, created_at, expires_at,
                  paid_at, updated_at, confirmed_by)
```

Thời gian lưu dưới dạng epoch mili-giây (BIGINT). Tên món và giá được chụp lại vào `order_item` tại thời điểm đặt. Script đầy đủ: `source/server/src/main/resources/schema.sql`.

### D. Cấu hình chính (`application.yml`)

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `app.delivery-mode` | `RELIABLE_PUSH` | `POLLING` / `NAIVE_PUSH` / `RELIABLE_PUSH` |
| `app.polling-interval-ms` | `3000` | Chu kỳ polling của baseline |
| `app.idempotency-enabled` | `true` | |
| `app.optimistic-lock-enabled` | `true` | |
| `app.rate-limit.order-capacity` / `order-refill-per-minute` | `10` / `10` | Token bucket theo bàn (lúc chạy E1–E6: `5` / `5`) |
| `app.rate-limit.api-capacity` / `api-refill-per-second` | `60` / `20` | Token bucket theo IP |
| `app.ws.heartbeat-ms` | `10000` | |
| `app.ws.max-connections-per-table` | `8` | |
| `app.ws.send-time-limit-ms` / `send-buffer-size-limit` / `message-size-limit` | `10000` / `524288` / `65536` | Backpressure |
| `app.ws.replay-batch-limit` | `500` | |
| `app.session.idle-timeout-minutes` | `30` | Phiên không có đơn nào quá 30 phút → tự kết thúc |
| `app.session.auto-checkout-after-paid-minutes` | `30` | Đã trả đủ, 30 phút chưa ai bấm "Trả bàn" → tự trả bàn |
| `app.payment.expire-minutes` | `15` | Hạn của một lần thanh toán |
| `app.vnpay.tmn-code` / `hash-secret` | biến môi trường `VNPAY_TMN_CODE` / `VNPAY_HASH_SECRET`, mặc định trống | Thiếu thì ẩn VNPay; không ghi vào file |
| `app.vnpay.pay-url` / `api-url` | sandbox của VNPay | Trang thanh toán / API `querydr` |
| `app.vnpay.public-url` | biến môi trường `APP_PUBLIC_URL`, mặc định trống | Địa chỉ công khai để tạo Return URL; trống thì lấy theo request |
| `server.tomcat.threads.max` / `max-connections` / `accept-count` | `200` / `2000` / `100` | |
| `spring.datasource.hikari.maximum-pool-size` / `connection-timeout` | `20` / `3000` | |
| `spring.jdbc.template.query-timeout` | `3s` | |

### E. Kết quả bổ sung

Thư mục `statics/results/smoke-test-h2-old/` chứa một lần chạy thử trước đó (cùng ngày, cùng tham số rút gọn, H2). Các xu hướng giống lần chạy chính: E1 POLLING p50 1384,23 ms so với RELIABLE_PUSH 5,84 ms; E2 NAIVE_PUSH mất 31/200 so với RELIABLE_PUSH 0/200; E3 tỷ lệ trùng 43% khi tắt và 0% khi bật; E4 lost update 154 khi tắt và 0 khi bật; E5 throughput khoảng 2613–3159 đơn/s; E6 spam được nhận 41 257 khi tắt và 6 khi bật. Thư mục này cũng có một lượt E2 RELIABLE_PUSH riêng với 2 lần mất kết nối, 0 đơn mất. Lần chạy này có thể được thực hiện trên phiên bản mã nguồn cũ hơn nên chỉ dùng để tham khảo tính lặp lại, không đưa vào bảng chính.

### F. Cách chạy lại thực nghiệm

```bash
cd source/server
mvn package -DskipTests
java -jar target/qrorder-server-1.0.0.jar            # MySQL (mặc định)
```

```bash
cd source/loadtest
npm install
node run-all.js           # bản đầy đủ, khoảng 15 phút
node report.js            # tổng hợp statics/results/*.json -> REPORT.md
```

### G. Đoạn mã quan trọng

Phát sự kiện sau commit (`EventPublisher.java`):

```java
public void afterCommit(Runnable action) {
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    } else {
        action.run();
    }
}
```

Token bucket (`TokenBucket.java`):

```java
public synchronized long tryConsume(long nowMs) {
    refill(nowMs);
    lastUsedMs = nowMs;
    if (tokens >= 1) {
        tokens -= 1;
        return 0;
    }
    return (long) Math.ceil((1 - tokens) / refillPerMs);
}
```

Nhận bù phía client (`kitchenFeed.js`):

```js
_onReplay(batch) {
  for (const env of batch.events || []) {
    if (this._accept(env)) this.stats.replayed++;
  }
  if (batch.hasMore && batch.events.length) {
    this._resume(batch.events[batch.events.length - 1].seq);
    return;
  }
  if (batch.latestSeq > this.watermark) this.watermark = batch.latestSeq;
  this._advanceWatermark();
  // ...
}
```
