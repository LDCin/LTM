# Hướng dẫn test hệ thống QR Order

Có 3 mức test, nên làm theo thứ tự:

1. **Test tay trên trình duyệt** (khoảng 15 phút): hiểu hệ thống chạy thế nào, dùng để tập demo.
2. **Test tự động** (khoảng 1 phút): `mvn test` (14 ca) và `npm run e2e` (143 ca).
3. **Thực nghiệm đo hiệu năng** (khoảng 15 phút): lấy số liệu cho báo cáo.

---

## 0. Chuẩn bị

### Phần mềm cần có

| Phần mềm | Kiểm tra bằng lệnh |
|---|---|
| JDK 17 trở lên | `java -version` |
| Maven 3.9 | `mvn -v` |
| Node.js 18 trở lên | `node -v` |
| MySQL 8 (không bắt buộc) | – |

### Build một lần

```bash
cd source/client
npm install
npm run build
cd ../server
mvn package -DskipTests
cd ../loadtest
npm install
```

### Chạy server (chọn một trong hai cách)

**Cách A: nhanh, không cần MySQL** (dữ liệu nằm trong RAM, mất khi tắt server):

```bash
cd source/server
java -jar target/qrorder-server-1.0.0.jar --spring.profiles.active=h2
```

**Cách B: dùng MySQL** (MySQL chạy ở `localhost:3306`, tài khoản `root`/`root`; database tự tạo):

```bash
cd source/server
java -jar target/qrorder-server-1.0.0.jar
```

Server sẵn sàng khi log in ra `Started QrOrderApplication`, kèm danh sách link gọi món của từng bàn.
Khi chạy bằng file jar, mọi trang đều ở cổng **8080**. Log in link dạng `localhost:5173/...` là dành cho chế độ `npm run dev`.

---

## 1. Test tay trên trình duyệt

Mở 3 tab, nên dùng 3 cửa sổ trình duyệt khác nhau hoặc một cửa sổ ẩn danh.

| Tab | Địa chỉ | Đăng nhập |
|---|---|---|
| Quản trị | http://localhost:8080/admin | `admin` / `admin123` |
| Bếp | http://localhost:8080/kitchen | `bep` / `bep123` |
| Khách | Bấm "Mở link gọi món" của một bàn ở trang Quản trị | – |

Lưu ý: trang Bếp và trang Quản trị dùng chung phiên đăng nhập trong cùng một trình duyệt. Nếu đăng nhập admin
ở tab Quản trị, tab Bếp cũng chạy bằng tài khoản admin (vẫn dùng được). Muốn thấy đúng tên `bep` ở bếp, dùng một
cửa sổ ẩn danh cho tab Bếp.

Nên bật chế độ điện thoại cho tab Khách: F12 → biểu tượng điện thoại (Toggle device toolbar).

### Checklist

| # | Thao tác | Kết quả đúng |
|---|---|---|
| 1 | Khách thêm 2 món, mở giỏ, ghi chú "ít cay", bấm **Đặt món** | Hiện "Đã gửi đơn tới bếp!"; đơn xuất hiện ở "Đơn của bàn" với trạng thái "Chờ bếp nhận" |
| 2 | Nhìn tab Bếp | Đơn hiện ngay ở cột **Mới** (không cần tải lại), có ghi chú 📝 |
| 3 | Bếp bấm **Nhận** → **Bắt đầu nấu** → **Xong** | Đơn chuyển cột Mới → Đang làm → Sẵn sàng. Tab Khách đổi trạng thái theo, có thông báo "🔔 ... đã sẵn sàng!" |
| 4 | Bếp bấm **Đã phục vụ** | Đơn biến mất khỏi bảng bếp; khách thấy "Đã phục vụ" |
| 5 | Khách đặt đơn mới rồi bấm **Huỷ đơn** khi bếp chưa nhận | Đơn chuyển "Đã huỷ", biến mất khỏi bếp |
| 6 | Bếp nhận một món, rồi khách thử huỷ đơn đó | Nút Huỷ đã biến mất (bếp nhận rồi thì không huỷ được) |
| 7 | **Tính năng chính:** ở tab Bếp bấm **Giả lập mất mạng 5s**, trong 5 giây đó khách đặt một đơn | Badge bếp chuyển "Mất mạng" rồi "Đang kết nối lại"; khi xanh lại, đơn vẫn hiện; thanh thống kê có **Gửi bù: 1** |
| 8 | Admin → **Cấu hình thực nghiệm** → chọn `NAIVE_PUSH`; tải lại tab Bếp; lặp lại bước 7 | Lần này đơn **không** hiện ở bếp (baseline bị mất đơn). Xong nhớ chọn lại `RELIABLE_PUSH` và tải lại bếp |
| 9 | Admin → chọn `POLLING`; tải lại Bếp; khách đặt món | Badge bếp hiện "Polling"; đơn hiện chậm 0–3 giây. Chọn lại `RELIABLE_PUSH` |
| 10 | Mở 2 tab Bếp, cùng bấm **Nhận** một món gần như cùng lúc | Một tab thành công, tab kia báo "Món vừa được người khác cập nhật" |
| 11 | Bếp chọn tab **Quầy nước** | Chỉ còn đồ uống; chọn **Bếp** chỉ còn món ăn |
| 12 | Đơn có nhiều món: bấm **Nhận cả đơn** | Tất cả món chuyển sang "Đã nhận" |
| 13 | Khách đặt **Bò lúc lắc** cho tới khi hết 10 suất | Món tự chuyển "Hết món" trên mọi tab khách, không cần tải lại |
| 14 | Admin → **Thực đơn**: bỏ tick "Còn bán" một món → **Lưu** | Tab Khách hiện "Hết món" ngay lập tức |
| 15 | Admin → **Bàn & QR**: **Đóng bàn** đang mở ở tab Khách | Tab Khách báo "Bàn đã được đóng", nút + bị khoá |
| 16 | **Mở bàn** lại, rồi **Đổi mã QR** | Link cũ báo "Mã QR không hợp lệ"; link mới (QR mới) dùng được |
| 17 | Mở http://localhost:8080/t/abc | Trang báo "Mã QR không hợp lệ" |
| 18 | Đăng nhập Bếp sai mật khẩu; đăng nhập trang Admin bằng tài khoản `bep` | Báo "Sai tên đăng nhập..."; báo "không có quyền truy cập" |
| 19 | Admin → **Giám sát** trong lúc làm các bước trên | Thấy số kết nối WebSocket, ACK seq của bếp, số request trùng bị chặn, số 409, số 429... |
| 20 | Khách bấm **Đặt món** khi tắt server (Ctrl+C), đợi ~5 giây, bật lại server, bấm **Gửi lại** | Hiện banner "Có đơn chưa gửi được"; sau khi Gửi lại chỉ tạo **1** đơn (với H2, tắt server sẽ mất dữ liệu; nên thử bước này với MySQL) |

### Xem gói tin thật (rất nên làm trước khi bảo vệ)

F12 → tab **Network** → lọc **WS** → bấm vào kết nối `ws` → tab **Messages**. Sẽ thấy từng frame STOMP:
`CONNECT`, `CONNECTED` (có `heart-beat:10000,10000`), `SUBSCRIBE`, `MESSAGE` (body JSON có `seq`), `SEND /app/ack`,
`SEND /app/resume`, và ký tự xuống dòng là heart-beat. Với REST, lọc **Fetch/XHR** để xem header
`Idempotency-Key`, `ETag` / `304 Not Modified`, `Retry-After`.

---

## 2. Test tự động

### JUnit (không cần server chạy)

```bash
cd source/server
mvn test
```

Kết quả đúng: `Tests run: 14, Failures: 0, Errors: 0`.

### End-to-end (server phải đang chạy)

```bash
cd source/loadtest
npm run e2e
```

Kết quả đúng: `KẾT QUẢ: 143 đạt, 0 lỗi`. Mỗi dòng ✔ là một tính năng đã được kiểm chứng qua mạng thật;
dòng ✘ cho biết tính năng nào hỏng kèm dữ liệu thực tế. Bộ test dùng các bàn riêng mã `LTE...` và tự khôi phục
cấu hình khi chạy xong, nên chạy lại bao nhiêu lần cũng được.

---

## 3. Thực nghiệm đo hiệu năng (lấy số liệu cho báo cáo)

Nên chạy với **MySQL** (cách B), không mở trang nào khác trong lúc đo:

```bash
cd source/loadtest
node run-all.js
```

Chạy xong, xem `statics/results/REPORT.md` (bảng tổng hợp) và các file `.json` / `.csv` (số liệu thô).
Bản rút gọn để thử nhanh: `node run-all.js --quick`.

---

## 4. Demo bằng điện thoại thật

1. Điện thoại và máy chạy server dùng chung một Wi-Fi.
2. Trên máy chủ, chạy `ipconfig` để xem địa chỉ IPv4, ví dụ `192.168.1.147`.
3. Trên máy chủ, mở `http://192.168.1.147:8080/admin`. Mã QR trên trang sẽ chứa địa chỉ này.
4. Dùng điện thoại quét QR của một bàn để gọi món.

Điện thoại không vào được: cho phép Java trong Windows Defender Firewall (Private network), hoặc mở cổng 8080.

---

## 5. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Port 8080 was already in use` | Đã có một server khác đang chạy: tắt nó, hoặc thêm `--server.port=8081` |
| Server không khởi động, báo lỗi kết nối MySQL | MySQL chưa chạy hoặc sai mật khẩu: đặt biến `DB_PASSWORD`, hoặc dùng cách A (`h2`) |
| `npm run e2e` báo "Không đăng nhập được admin" | Server chưa chạy hoặc chạy ở cổng khác: `node e2e-test.js --base=http://localhost:8081` |
| Trang bếp báo "Lỗi kết nối" | Phiên đăng nhập hết hạn: bấm Đăng xuất rồi đăng nhập lại |
| Đặt món bị 429 khi test tay quá nhanh | Rate limit đang bật (5 đơn/phút/bàn): đợi vài giây, hoặc tắt ở Admin → Cấu hình thực nghiệm |
