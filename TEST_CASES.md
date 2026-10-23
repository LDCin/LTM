# Test case – QR Order

Chế độ giao đơn: **RELIABLE_PUSH** (mặc định, không cần đổi).

**Chuẩn bị:** server đang chạy với MySQL. Mở 3 cửa sổ:

| Vai | Địa chỉ | Tài khoản |
|---|---|---|
| Quản trị | `/admin` | `admin` / `admin123` |
| Bếp (nên dùng cửa sổ ẩn danh) | `/kitchen` | `bep` / `bep123` |
| Khách | Quét QR ở trang Quản trị → **Bàn & QR**, hoặc bấm "Mở link gọi món" | – |

Đánh dấu ✅ / ❌ vào cột **Kết quả** khi test.

---

## 1. Nghiệp vụ

| # | Thao tác | Kết quả đúng | Kết quả |
|---|---|---|---|
| 1 | Khách quét QR của bàn đang mở | Hiện thực đơn của bàn đó | |
| 2 | Khách thêm vài món, ghi chú "ít cay", bấm **Đặt món** | Báo "Đã gửi đơn tới bếp!", đơn hiện ở "Đơn của bàn" với trạng thái "Chờ bếp nhận" | |
| 3 | Nhìn màn hình bếp | Đơn hiện ngay ở cột **Mới** (không cần tải lại), có ghi chú | |
| 4 | Bếp bấm **Nhận** | Món chuyển "Đã nhận"; điện thoại khách cập nhật ngay | |
| 5 | Bếp bấm **Bắt đầu nấu** → **Xong** | Món chuyển "Đang làm" → "Sẵn sàng"; khách thấy thông báo món đã sẵn sàng | |
| 6 | Bếp bấm **Đã phục vụ** | Đơn biến mất khỏi bếp; khách thấy "Đã phục vụ" | |
| 7 | Đơn có nhiều món: bếp bấm **Nhận cả đơn** | Mọi món chuyển "Đã nhận" | |
| 8 | Khách đặt đơn mới rồi bấm **Huỷ đơn** khi bếp chưa nhận | Đơn "Đã huỷ", biến mất khỏi bếp | |
| 9 | Bếp đã nhận đơn, khách thử huỷ | Không huỷ được (nút Huỷ không còn) | |
| 10 | Bếp bấm **Từ chối** một món còn "Chờ nhận" | Món "Đã huỷ" ở cả bếp và khách | |
| 11 | Khách đặt một món có giới hạn suất (ví dụ Bò lúc lắc) tới khi hết | Món tự chuyển "Hết món" trên điện thoại, không đặt được nữa | |
| 12 | Quản trị bỏ tick "Còn bán" một món → Lưu | Điện thoại khách hiện "Hết món" ngay | |
| 13 | Quản trị sửa giá một món, khách đặt món đó | Đơn mới tính theo giá mới | |
| 14 | Hai màn hình bếp cùng bấm **Nhận** một món gần như cùng lúc | Một bên thành công, bên kia báo "Món vừa được người khác cập nhật" và tự tải lại | |
| 15 | Hai điện thoại cùng quét QR một bàn, một máy đặt món | Cả hai máy đều thấy đơn và trạng thái | |
| 16 | Điện thoại ở bàn khác | Không thấy đơn của bàn kia | |
| 17 | Quản trị **Đóng bàn** khi khách đang mở trang | Khách báo "Bàn đã được đóng", không đặt món được | |
| 18 | Quản trị **Mở bàn** lại | Khách mới không thấy đơn của khách trước | |
| 19 | Quản trị **Đổi mã QR**, khách dùng link/QR cũ | Báo "Mã QR không hợp lệ"; QR mới dùng được | |
| 20 | Mở link QR sai (ví dụ `/t/abc`) | Báo "Mã QR không hợp lệ" | |
| 21 | Đăng nhập bếp sai mật khẩu; đăng nhập trang Quản trị bằng tài khoản `bep` | Báo sai mật khẩu; báo không có quyền | |
| 22 | Khách bấm **Đặt món** 2 lần thật nhanh | Chỉ tạo **1** đơn | |

---

## 2. Mạng

Có hai cách làm "mất mạng":
* **Thật:** điện thoại bật chế độ máy bay / tắt Wi-Fi; máy làm bếp tắt Wi-Fi.
* **Nút có sẵn:** màn hình bếp có nút **Giả lập mất mạng 5s**.

| # | Tình huống | Thao tác | Kết quả đúng | Kết quả |
|---|---|---|---|---|
| 23 | **Khách mất mạng ngay lúc đặt đơn** | Điện thoại bật chế độ máy bay, bấm **Đặt món**; tắt chế độ máy bay, bấm **Gửi lại** | Hiện banner "Có đơn chưa gửi được"; sau khi gửi lại, bếp nhận đúng **1** đơn | |
| 24 | **Khách mất mạng ngay sau khi bấm đặt** (đơn đã tới server nhưng chưa nhận được phản hồi) | Bấm **Đặt món** rồi lập tức bật chế độ máy bay; tắt chế độ máy bay, nếu app báo chưa gửi được thì bấm **Gửi lại** | Bếp chỉ có **1** đơn, không bị trùng | |
| 25 | **Khách mất mạng khi đang chờ món** | Điện thoại bật chế độ máy bay 10–20 s; trong lúc đó bếp đổi trạng thái món; tắt chế độ máy bay | Trang tự kết nối lại và hiện đúng trạng thái mới, không cần tải lại | |
| 26 | **Khách tải lại trang / tắt trình duyệt rồi mở lại** | Đóng tab, mở lại link QR | Vẫn thấy các đơn của bàn | |
| 27 | **Bếp mất mạng trong lúc khách đặt đơn** | Bếp bấm **Giả lập mất mạng 5s** (hoặc tắt Wi-Fi máy bếp 10 s); trong lúc đó khách đặt 1–2 đơn | Badge bếp "Mất mạng" → "Đang kết nối lại" → xanh; **các đơn đặt trong lúc mất mạng vẫn hiện ở bếp**; thanh thống kê có "Gửi bù" | |
| 28 | **Bếp mất mạng lâu** | Tắt Wi-Fi máy bếp 1–2 phút, khách đặt nhiều đơn; bật lại Wi-Fi | Bếp nhận đủ mọi đơn, không thiếu, không trùng | |
| 29 | **Bếp mất mạng ngay lúc bấm đổi trạng thái** | Tắt Wi-Fi máy bếp rồi bấm **Nhận** | Bếp báo lỗi kết nối, không bị treo; có mạng lại bấm lại được | |
| 30 | **Server tắt rồi bật lại** | Tắt server (■ trong IntelliJ) 10–20 s rồi chạy lại | Khách và bếp tự kết nối lại; dữ liệu đơn vẫn còn (MySQL) | |
| 31 | **Khách đặt đơn khi server đang tắt** | Tắt server, khách bấm **Đặt món**; bật server, bấm **Gửi lại** | Banner "Có đơn chưa gửi được"; sau khi gửi lại chỉ có **1** đơn | |
| 32 | **Điện thoại đổi mạng** (nếu dùng tunnel) | Đang dùng Wi-Fi chuyển sang 4G | Tự kết nối lại, vẫn đặt món và nhận cập nhật được | |

---

## 3. Test tự động (đã có sẵn, chỉ cần chạy)

| Lệnh | Kỳ vọng |
|---|---|
| `cd source/server` → `mvn test` | `Tests run: 14, Failures: 0, Errors: 0` |
| Server đang chạy → `cd source/loadtest` → `npm run e2e` | `KẾT QUẢ: 143 đạt, 0 lỗi` |
