# Tiến độ (cập nhật 17/10/2026)

## Đã xong
- Backend Spring Boot (`source/server`): REST, WebSocket/STOMP, idempotency, state machine, optimistic lock,
  event log + replay, rate limit (token bucket), giới hạn kết nối WS, phân quyền SUBSCRIBE, giám sát, cấu hình thực nghiệm.
  14 test JUnit đều qua (`mvn test`).
- Frontend React (`source/client`): trang khách `/t/:token`, bếp `/kitchen`, quản trị `/admin`.
  STOMP client tự viết (`src/lib/stomp.js`), reconnect backoff + jitter, feed tin cậy (`kitchenFeed.js`).
- Load test E1–E6 (`source/loadtest`), `run-all.js`, `report.js`.
- Bộ test end-to-end `npm run e2e` (143 ca): đạt 143/143 trên cả H2 và **MySQL 8.0.39** (17/10/2026).
  Đã thử thêm trên trình duyệt: giao diện khách (mất response, mất mạng + gửi lại, huỷ, hết món, đóng bàn,
  QR sai), bếp (đăng nhập, lọc trạm, nhận cả đơn, xung đột, POLLING), admin (bàn/QR, thực đơn, cấu hình, giám sát).
  Với MySQL: schema tự tạo, dữ liệu giữ nguyên qua lần khởi động lại, tiếng Việt đúng UTF-8.
- `source/README.md`: hướng dẫn build/run/test/thực nghiệm.

## Quyết định thiết kế (khác hoặc chi tiết hơn PLAN.md)
- JdbcTemplate (SQL tường minh) thay vì JPA; optimistic lock bằng `UPDATE ... WHERE version = ?`.
- Token nhân viên tự ký HMAC-SHA256, không dùng Spring Security.
- Publish WebSocket sau commit qua `TransactionSynchronization.afterCommit`.
- Client bếp chống trùng bằng tập seq đã thấy; watermark nhảy lên `latestSeq` sau replay để bỏ qua seq "lỗ" do rollback.
- QR tĩnh theo bàn; chỉ đặt món được khi bàn OPEN; admin có nút đổi mã QR. QR sinh ở frontend.

## Việc nhóm còn phải làm
1. Chạy `node run-all.js` (bản đầy đủ) trên máy demo để lấy số liệu cho báo cáo.
2. Điền README.md gốc theo template của môn (thông tin nhóm, kết quả, novelty...).
3. Vẽ `statics/architecture.png`, `statics/protocol.png`.
4. Viết báo cáo theo cấu trúc paper và kiểm tra Compilatio.
5. Thử demo bằng điện thoại thật trong mạng LAN.
