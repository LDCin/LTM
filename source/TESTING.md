# Hướng dẫn test hệ thống QR Order

Có 3 mức test, nên làm theo thứ tự:

1. **Test tay trên trình duyệt** (khoảng 15 phút): hiểu hệ thống chạy thế nào, dùng để tập demo.
2. **Test tự động** (khoảng 1 phút): `mvn test` (24 ca) và `npm run e2e` (18 nhóm).
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

Mở 4 tab. Ba trang nhân viên dùng chung phiên đăng nhập trong một trình duyệt, nên mỗi trang nhân viên nên mở ở một
cửa sổ ẩn danh / trình duyệt khác.

| Tab | Địa chỉ | Đăng nhập |
|---|---|---|
| Quản trị | http://localhost:8080/admin | `admin` / `admin123` |
| Bếp | http://localhost:8080/kitchen | `bep` / `bep123` |
| Thu ngân | http://localhost:8080/cashier | `thungan` / `thungan123` |
| Khách | Bấm "Mở link gọi món" của một bàn ở trang Quản trị | – |

Lưu ý: nếu đăng nhập admin ở tab Quản trị, tab Bếp / Thu ngân trong cùng trình duyệt cũng chạy bằng tài khoản admin
(vẫn dùng được, vì admin có mọi quyền). Muốn thấy đúng tên `bep` / `thungan`, dùng cửa sổ ẩn danh riêng.

Nên bật chế độ điện thoại cho tab Khách: F12 → biểu tượng điện thoại (Toggle device toolbar).

Không cần "mở bàn" trước: **phiên bàn tự mở** khi khách đầu tiên vào link gọi món (bàn đang phục vụ).
Mọi điện thoại trong cùng phiên thấy **đơn chung** của bàn; chỉ máy đã đặt đơn mới huỷ được đơn đó.

### Checklist

| # | Thao tác | Kết quả đúng |
|---|---|---|
| 1 | Khách mở link gọi món của một bàn **trống** | Hiện hộp "Bạn tên gì?"; nhập "Minh" → hiện thực đơn, góc trên ghi "Bạn là: Minh". Tab Thu ngân thấy bàn chuyển "Đang ăn" (không cần tải lại) |
| 2 | Khách thêm 2 món, mở giỏ, ghi chú "ít cay", bấm **Đặt món** | Hiện "Đã gửi đơn tới bếp!"; đơn xuất hiện ở "Đơn của bàn" với nhãn **BẠN ĐẶT**, trạng thái "Chờ bếp nhận" |
| 3 | Nhìn tab Bếp | Đơn hiện ngay ở cột **Mới** (không cần tải lại), có ghi chú 📝, tên "Minh" và nhãn **Bàn mới mở** (đơn đầu tiên của phiên) |
| 4 | Bếp bấm **Nhận** → **Bắt đầu nấu** → **Xong** | Đơn chuyển cột Mới → Đang làm → Sẵn sàng. Tab Khách đổi trạng thái theo, có thông báo "🔔 ... đã sẵn sàng!" |
| 5 | Bếp bấm **Đã phục vụ** | Đơn biến mất khỏi bảng bếp; khách thấy "Đã phục vụ" |
| 6 | Khách đặt đơn mới rồi bấm **Huỷ đơn** khi bếp chưa nhận | Đơn chuyển "Đã huỷ", biến mất khỏi bếp |
| 7 | Bếp nhận một món, rồi khách thử huỷ đơn đó | Nút Huỷ đã biến mất (bếp nhận rồi thì không huỷ được) |
| 8 | **Đơn chung:** mở **cùng link** bằng `http://127.0.0.1:8080/t/...` (hoặc điện thoại khác / cửa sổ ẩn danh, coi như máy thứ hai), nhập tên "Lan"; rồi máy "Lan" đặt một món | Máy "Lan" vào **cùng phiên**: thấy ngay các đơn của "Minh" (ghi tên "Minh", **không** có nút Huỷ). Đơn của "Lan" hiện ngay trên máy "Minh"; mục **Tổng cả bàn** cộng dồn đúng |
| 9 | **Tính năng chính:** ở tab Bếp bấm **Giả lập mất mạng 5s**, trong 5 giây đó khách đặt một đơn | Badge bếp chuyển "Mất mạng" rồi "Đang kết nối lại"; khi xanh lại, đơn vẫn hiện; F12 → Network → WS thấy frame `/app/resume` và `REPLAY_BATCH` chứa đơn đó |
| 10 | Admin → **Cấu hình thực nghiệm** → chọn `NAIVE_PUSH`; tải lại tab Bếp; lặp lại bước 9 | Lần này đơn **không** hiện ở bếp (baseline bị mất đơn). Xong nhớ chọn lại `RELIABLE_PUSH` và tải lại bếp |
| 11 | Admin → chọn `POLLING`; tải lại Bếp; khách đặt món | Badge bếp hiện "Polling"; đơn hiện chậm 0–3 giây. Chọn lại `RELIABLE_PUSH` |
| 12 | Mở 2 tab Bếp, cùng bấm **Nhận** một món gần như cùng lúc | Một tab thành công, tab kia báo "Món vừa được người khác cập nhật" |
| 13 | Khách đặt một đơn 3 món. Bếp bấm **Nhận** một món, rồi **Bắt đầu nấu** món đó; sau đó bấm **Nhận cả đơn** cho phần còn lại | Món vừa thao tác tách sang cột **Đang làm** ngay, hai món còn lại vẫn ở cột **Mới** với dòng "+1 món của đơn này ở cột khác"; **Nhận cả đơn** chuyển nốt các món còn lại |
| 14 | Khách đặt **Bò lúc lắc** cho tới khi hết 10 suất; Admin → **Thực đơn** bỏ tick "Còn bán" một món → **Lưu** | Món tự chuyển "Hết món" trên mọi tab khách, không cần tải lại |
| 15 | **Thanh toán:** máy "Minh" bấm **Thanh toán** → **Tiền mặt tại quầy**; sau đó máy "Lan" cũng bấm **Thanh toán** | Cả hai máy hiện "Bàn đang thanh toán", nút + mờ (không gọi thêm được). Máy "Lan" **không** tạo lần thứ hai mà báo "Bạn cùng bàn đang thanh toán". Thu ngân thấy bàn màu cam "Chờ thanh toán" kèm số tiền |
| 16 | Thu ngân bấm vào bàn → **Đã nhận tiền** → **Trả bàn** | Sau "Đã nhận tiền": khách hiện "Bàn đã thanh toán đủ", bàn chuyển "Đã thanh toán". Sau "Trả bàn": bàn về "Trống", mọi máy của bàn hiện "Cảm ơn quý khách"; bấm **Bắt đầu lượt mới** thì hỏi tên lại và danh sách đơn **trống** |
| 17 | Admin → **Bàn & QR**: **Đóng bàn** khi bàn đang có khách; rồi đóng một bàn trống và mở link của bàn đó; **Mở bàn** lại; **Đổi mã QR** | Bàn có khách: không cho đóng ("Bàn đang có khách, cần thanh toán và trả bàn trước"). Bàn trống đã đóng: khách thấy "Bàn đang tạm ngừng phục vụ", thu ngân thấy bàn xám. Mở lại thì vào bình thường. Sau khi đổi mã: link cũ báo "Mã QR không hợp lệ", link mới dùng được |
| 18 | Mở http://localhost:8080/t/abc; đăng nhập Bếp sai mật khẩu; đăng nhập trang Admin hoặc Thu ngân bằng tài khoản `bep` | Báo "Mã QR không hợp lệ"; báo "Sai tên đăng nhập..."; báo "không có quyền truy cập" |
| 19 | Admin → **Giám sát** trong lúc làm các bước trên | Thấy số kết nối WebSocket, ACK seq của bếp, số request trùng bị chặn, số 409, số 429... |
| 20 | Khách bấm **Đặt món** khi tắt server (Ctrl+C), đợi ~5 giây, bật lại server, bấm **Gửi lại** | Hiện banner "Có đơn chưa gửi được"; sau khi Gửi lại chỉ tạo **1** đơn (với H2, tắt server sẽ mất dữ liệu; nên thử bước này với MySQL) |
| 21 | Khách bấm **🙋 Gọi phục vụ** (thử bấm trên cả 2 máy cùng bàn); thu ngân bấm **Đã xử lý** | Thu ngân kêu "ting", khung đỏ "Khách gọi phục vụ" chỉ có **1** dòng cho bàn, ô bàn nhấp nháy. Sau "Đã xử lý": khung biến mất, cả 2 máy hiện "Nhân viên đã nhận yêu cầu..." và nút trở lại bình thường |
| 22 | Khách đặt 3× một món; bếp **Nhận** rồi bấm **Huỷ**, chọn 1 suất, lý do **Hết nguyên liệu**. Phục vụ món còn lại, khách trả tiền; bếp bấm **🍽 Món đã phục vụ** → **Khách trả lại** 1 suất; thu ngân bấm **Trả bàn** | Khách thấy dòng huỷ kèm lý do và tạm tính giảm ngay. Sau khi trả lại: thu ngân thấy bàn "Cần trả lại tiền" kèm số tiền, và phải xác nhận đã trả lại khách mới trả bàn được |

Thanh toán **VNPay** sandbox cần mã merchant (biến môi trường `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`) và chạy qua
tunnel; thiếu cấu hình thì trang khách chỉ hiện "Tiền mặt". Cách cấu hình ở `SETUP.md` mục 12.7, các ca thử ở
`TEST_CASES.md` (ca 32, 33). Danh sách ca test tay đầy đủ hơn (58 ca, gồm các tình huống mất mạng, gọi phục vụ và huỷ / trả lại món) nằm trong `TEST_CASES.md`.

### Xem gói tin thật (rất nên làm trước khi bảo vệ)

F12 → tab **Network** → lọc **WS** → bấm vào kết nối `ws` → tab **Messages**. Sẽ thấy từng frame STOMP:
`CONNECT`, `CONNECTED` (có `heart-beat:10000,10000`), `SUBSCRIBE`, `MESSAGE` (body JSON có `seq`), `SEND /app/ack`,
`SEND /app/resume`, và ký tự xuống dòng là heart-beat. Với REST, lọc **Fetch/XHR** để xem header
`Idempotency-Key`, `X-Session-Id`, `ETag` / `304 Not Modified`, `Retry-After`. Trang Thu ngân có thêm frame
`SUBSCRIBE /topic/cashier` và `MESSAGE` loại `TABLE_STATE_CHANGED` / `PAYMENT_UPDATED`.

---

## 2. Test tự động

### JUnit (không cần server chạy)

```bash
cd source/server
mvn test
```

Kết quả đúng: `Tests run: 24, Failures: 0, Errors: 0`.

### End-to-end (server phải đang chạy)

```bash
cd source/loadtest
npm run e2e
```

Kết quả đúng: `KẾT QUẢ: … đạt, 0 lỗi` (17 nhóm, nhóm 15 là phiên bàn nhiều điện thoại, nhóm 16 là thanh toán và thu ngân, nhóm 17 là gọi phục vụ, nhóm 18 là bếp huỷ / khách trả lại món). Mỗi dòng ✔ là một tính năng đã được kiểm chứng qua mạng thật;
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
4. Dùng điện thoại quét QR của một bàn để gọi món (phiên bàn tự mở, không cần nhân viên bấm gì).

Điện thoại không vào được: cho phép Java trong Windows Defender Firewall (Private network), hoặc mở cổng 8080.

---

## 5. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Port 8080 was already in use` | Đã có một server khác đang chạy: tắt nó, hoặc thêm `--server.port=8081` |
| Server không khởi động, báo lỗi kết nối MySQL | MySQL chưa chạy hoặc sai mật khẩu: đặt biến `DB_PASSWORD`, hoặc dùng cách A (`h2`) |
| `npm run e2e` báo "Không đăng nhập được admin" | Server chưa chạy hoặc chạy ở cổng khác: `node e2e-test.js --base=http://localhost:8081` |
| Trang bếp báo "Lỗi kết nối" | Phiên đăng nhập hết hạn: bấm Đăng xuất rồi đăng nhập lại |
| Đặt món bị 429 khi test tay quá nhanh | Rate limit đang bật (10 đơn/phút/bàn): đợi vài giây, hoặc tắt ở Admin → Cấu hình thực nghiệm |
