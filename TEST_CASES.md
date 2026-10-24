# Test case – QR Order

Chế độ giao đơn: **RELIABLE_PUSH** (mặc định, không cần đổi).

**Chuẩn bị:** server đang chạy với MySQL. Mở 4 cửa sổ (các trang nhân viên dùng chung phiên đăng nhập trong một trình
duyệt, nên mỗi trang nhân viên mở ở một cửa sổ ẩn danh / trình duyệt khác):

| Vai | Địa chỉ | Tài khoản |
|---|---|---|
| Quản trị | `/admin` | `admin` / `admin123` |
| Bếp | `/kitchen` | `bep` / `bep123` |
| Thu ngân | `/cashier` | `thungan` / `thungan123` |
| Khách | Quét QR ở trang Quản trị → **Bàn & QR**, hoặc bấm "Mở link gọi món" | – |

Đánh dấu ✅ / ❌ vào cột **Kết quả** khi test.

---

## 1. Nghiệp vụ gọi món

| # | Thao tác | Kết quả đúng | Kết quả |
|---|---|---|---|
| 1 | Khách quét QR của một bàn đang trống | Hiện hộp hỏi tên; nhập "Minh" → hiện thực đơn, góc trên ghi "Bạn là: Minh". Thu ngân thấy bàn chuyển "Đang ăn" | |
| 2 | Tải lại trang (vẫn cùng lượt khách) | Không hỏi tên lại | |
| 3 | Khách thêm vài món, ghi chú "ít cay", bấm **Đặt món** | Báo "Đã gửi đơn tới bếp!", đơn hiện ở "Đơn của bàn" với nhãn **BẠN ĐẶT** | |
| 4 | Nhìn màn hình bếp | Đơn hiện ngay ở cột **Mới**, có ghi chú, tên "Minh" và nhãn **Bàn mới mở** (đơn đầu tiên của lượt khách) | |
| 5 | Bếp bấm **Nhận** → **Bắt đầu nấu** → **Xong** → **Đã phục vụ** | Điện thoại khách cập nhật theo từng bước; có thông báo món đã sẵn sàng | |
| 6 | Đơn có nhiều món: bếp bấm **Nhận cả đơn** | Mọi món chuyển "Đã nhận" | |
| 7 | Khách đặt đơn mới rồi bấm **Huỷ đơn** khi bếp chưa nhận | Đơn "Đã huỷ", biến mất khỏi bếp | |
| 8 | Bếp đã nhận đơn, khách thử huỷ | Không huỷ được (nút Huỷ không còn) | |
| 9 | Bếp bấm **Từ chối** một món còn "Chờ nhận" | Món "Đã huỷ" ở cả bếp và khách | |
| 10 | Khách đặt một món có giới hạn suất (ví dụ Bò lúc lắc) tới khi hết | Món tự chuyển "Hết món", không đặt được nữa | |
| 11 | Quản trị bỏ tick "Còn bán" một món → Lưu | Điện thoại khách hiện "Hết món" ngay | |
| 12 | Hai màn hình bếp cùng bấm **Nhận** một món gần như cùng lúc | Một bên thành công, bên kia báo "Món vừa được người khác cập nhật" | |
| 13 | Khách bấm **Đặt món** 2 lần thật nhanh | Chỉ tạo **1** đơn | |
| 14 | Mở link QR sai (ví dụ `/t/abc`) | Báo "Mã QR không hợp lệ" | |
| 15 | Đăng nhập bếp sai mật khẩu; đăng nhập trang Thu ngân bằng tài khoản `bep` | Báo sai mật khẩu; báo không có quyền | |

## 2. Nhiều điện thoại cùng bàn

| # | Thao tác | Kết quả đúng | Kết quả |
|---|---|---|---|
| 16 | Điện thoại thứ hai quét QR cùng bàn, nhập tên "Lan" | Vào **cùng lượt khách**: thấy ngay các đơn máy 1 đã đặt, đơn đó ghi "Minh", **không** có nút Huỷ | |
| 17 | Máy "Lan" đặt món | Máy "Minh" thấy ngay đơn mới ghi "Lan"; mục **Tổng cả bàn** cộng dồn đúng | |
| 18 | Hai điện thoại quét QR một bàn **trống** cùng lúc | Cả hai vào chung một lượt khách (thu ngân chỉ thấy một bàn "Đang ăn") | |
| 19 | Điện thoại ở bàn khác | Không thấy đơn của bàn kia | |
| 20 | Máy "Lan" bấm ✏️ đổi tên thành "Lan Anh" rồi đặt món | Đơn mới ghi "Lan Anh"; đơn cũ giữ tên cũ | |

## 3. Thanh toán và trả bàn

| # | Thao tác | Kết quả đúng | Kết quả |
|---|---|---|---|
| 21 | Khách bấm **Thanh toán** → **Tiền mặt tại quầy** | Trang khách hiện "Bàn đang thanh toán… vui lòng ra quầy"; **cả hai máy** cùng thấy; thu ngân thấy bàn màu cam "Chờ thanh toán" kèm số tiền | |
| 22 | Trong lúc đang chờ thanh toán, khách thử gọi thêm món | Không thêm được (nút + mờ), có hướng dẫn huỷ thanh toán | |
| 23 | Máy thứ hai cũng bấm **Thanh toán** | Không tạo lần thứ hai; báo bạn cùng bàn đang thanh toán | |
| 24 | Thu ngân bấm vào bàn → **Đã nhận tiền** | Trang khách hiện "Bàn đã thanh toán đủ"; bàn chuyển xanh dương "Đã thanh toán" | |
| 25 | Khách gọi thêm tráng miệng sau khi đã trả | Gọi được; "Còn phải trả" bằng tiền món mới; thu ngân thấy bàn quay về "Đang ăn" | |
| 26 | Khách bấm **Thanh toán** → **Huỷ thanh toán** | Lần chờ bị huỷ, khách gọi thêm món được | |
| 27 | Thu ngân bấm **Trả bàn** khi đã trả đủ, món đã phục vụ hết | Bàn về "Trống"; mọi điện thoại của bàn hiện "Cảm ơn quý khách" | |
| 28 | Điện thoại cũ bấm **Bắt đầu lượt mới** / khách mới quét QR | Hỏi tên lại; danh sách đơn **trống** (không thấy đơn lượt trước) | |
| 29 | Thu ngân bấm **Trả bàn** khi khách chưa trả tiền | Hệ thống hỏi lý do (khách bỏ về / mời khách / khác); chọn xong thì trả bàn được | |
| 30 | Thu ngân bấm **Trả bàn** khi đang có lần thanh toán chờ | Không cho; báo xác nhận hoặc huỷ lần chờ trước | |
| 31 | Hai thu ngân cùng bấm **Đã nhận tiền** cho một bàn | Một bên thành công, bên kia báo lỗi đã xử lý | |
| 32 | **VNPay** (cần cấu hình mã sandbox, chạy qua tunnel): khách bấm **Thanh toán → VNPay**, trả bằng thẻ test NCB | Chuyển sang trang VNPay → trả xong quay về trang gọi món, hiện "Bàn đã thanh toán đủ"; thu ngân thấy "Đã thanh toán"; trang **Quản trị → Thanh toán** có dòng VNPay "Đã trả" | |
| 33 | VNPay: vào trang VNPay rồi bấm **Huỷ giao dịch** | Quay về trang gọi món, báo thanh toán chưa thành công; bàn không chuyển "Đã thanh toán" | |
| 34 | Khách mở trang mà không gọi món gì, bỏ đi | Sau 30 phút bàn tự về "Trống" | |

## 4. Quản trị bàn

| # | Thao tác | Kết quả đúng | Kết quả |
|---|---|---|---|
| 35 | Quản trị bấm **Đóng bàn** khi bàn đang có khách | Không cho: "Bàn đang có khách, cần thanh toán và trả bàn trước" | |
| 36 | Bàn trống → Quản trị **Đóng bàn**, khách quét QR | Báo "Bàn đang tạm ngừng phục vụ"; thu ngân thấy bàn xám | |
| 37 | Quản trị **Mở bàn** lại, khách quét QR | Vào bình thường | |
| 38 | Quản trị **Đổi mã QR**, khách dùng link/QR cũ | Báo "Mã QR không hợp lệ"; QR mới dùng được | |

---

## 5. Mạng

Có hai cách làm "mất mạng":
* **Thật:** điện thoại bật chế độ máy bay / tắt Wi-Fi; máy làm bếp tắt Wi-Fi.
* **Nút có sẵn:** màn hình bếp có nút **Giả lập mất mạng 5s**.

| # | Tình huống | Thao tác | Kết quả đúng | Kết quả |
|---|---|---|---|---|
| 39 | **Khách mất mạng ngay lúc đặt đơn** | Điện thoại bật chế độ máy bay, bấm **Đặt món**; tắt chế độ máy bay, bấm **Gửi lại** | Hiện banner "Có đơn chưa gửi được"; sau khi gửi lại, bếp nhận đúng **1** đơn | |
| 40 | **Khách mất mạng ngay sau khi bấm đặt** | Bấm **Đặt món** rồi lập tức bật chế độ máy bay; tắt chế độ máy bay, nếu app báo chưa gửi được thì bấm **Gửi lại** | Bếp chỉ có **1** đơn, không bị trùng | |
| 41 | **Khách mất mạng khi đang chờ món** | Điện thoại bật chế độ máy bay 10–20 s; trong lúc đó bếp đổi trạng thái món; tắt chế độ máy bay | Trang tự kết nối lại và hiện đúng trạng thái mới | |
| 42 | **Khách mất mạng lúc bấm Thanh toán** | Bật chế độ máy bay, bấm **Thanh toán → Tiền mặt**; tắt chế độ máy bay, bấm lại | Chỉ có **1** lần thanh toán chờ | |
| 43 | **Khách mất mạng trong lúc thu ngân xác nhận / trả bàn** | Bật chế độ máy bay; thu ngân bấm **Đã nhận tiền** (hoặc **Trả bàn**); tắt chế độ máy bay | Trang tự kết nối lại và hiện đúng "Đã thanh toán" (hoặc "Cảm ơn quý khách") | |
| 44 | **Bếp mất mạng trong lúc khách đặt đơn** | Bếp bấm **Giả lập mất mạng 5s** (hoặc tắt Wi-Fi máy bếp 10 s); trong lúc đó khách đặt 1–2 đơn | **Các đơn đặt trong lúc mất mạng vẫn hiện ở bếp** (F12 → Network → WS thấy `REPLAY_BATCH` chứa các đơn đó) | |
| 45 | **Bếp mất mạng lâu** | Tắt Wi-Fi máy bếp 1–2 phút, khách đặt nhiều đơn; bật lại Wi-Fi | Bếp nhận đủ mọi đơn, không thiếu, không trùng | |
| 46 | **Thu ngân mất mạng** | Tắt Wi-Fi máy thu ngân 20 s, trong lúc đó khách bấm Thanh toán; bật lại | Sơ đồ bàn tự cập nhật đúng sau khi kết nối lại | |
| 47 | **Server tắt rồi bật lại** | Tắt server 10–20 s rồi chạy lại | Khách, bếp, thu ngân tự kết nối lại; dữ liệu vẫn còn (MySQL) | |
| 48 | **Khách đặt đơn khi server đang tắt** | Tắt server, khách bấm **Đặt món**; bật server, bấm **Gửi lại** | Sau khi gửi lại chỉ có **1** đơn | |
| 49 | **Điện thoại đổi mạng** (nếu dùng tunnel) | Đang dùng Wi-Fi chuyển sang 4G | Tự kết nối lại, vẫn đặt món và nhận cập nhật được | |

---

## 6. Gọi phục vụ

| # | Tình huống | Kết quả đúng | Kết quả |
|---|---|---|---|
| 50 | Khách bấm **🙋 Gọi phục vụ** | Khách: nút chuyển "⏳ Đang gọi…". Thu ngân: có tiếng "ting", khung đỏ "Khách gọi phục vụ" hiện bàn, tên khách và số phút; ô bàn nhấp nháy viền đỏ | |
| 51 | Hai điện thoại cùng bàn lần lượt bấm **Gọi phục vụ** | Thu ngân chỉ thấy **1** dòng cho bàn đó; điện thoại thứ hai cũng hiện "Đang gọi…" | |
| 52 | Thu ngân bấm **Đã xử lý** | Dòng biến mất, ô bàn hết nhấp nháy; mọi điện thoại của bàn hiện "Nhân viên đã nhận yêu cầu và đang tới bàn bạn", nút trở lại bình thường và gọi lại được | |
| 53 | Khách gọi phục vụ rồi thu ngân **Trả bàn** | Lượt gọi của bàn biến mất khỏi khung "Khách gọi phục vụ" | |

---

## 7. Bếp huỷ / khách trả lại món đã nhận

Chỉ màn hình bếp có nút này. Món chưa nhận vẫn dùng **Từ chối** như cũ.

| # | Tình huống | Kết quả đúng | Kết quả |
|---|---|---|---|
| 54 | Khách đặt 3× Phở. Bếp **Nhận** → bấm **Huỷ** ở món → chọn 1 suất, lý do **Hết nguyên liệu** | Bếp còn 2× Phở; khách thấy thêm dòng "1× Phở · Hết nguyên liệu · Đã huỷ", tạm tính giảm 1 suất; tồn kho món được cộng lại 1 (món chưa nấu) | |
| 55 | Chọn **Lý do khác** mà không ghi chú | Nút Huỷ bị khoá cho tới khi nhập ghi chú | |
| 56 | Món đã **Đã phục vụ**: bếp bấm **🍽 Món đã phục vụ** → **Khách trả lại** | Món đó có trong danh sách; sau khi ghi nhận, khách thấy "Đã trả lại", không tính tiền | |
| 57 | Bàn đã thanh toán đủ, rồi bếp ghi nhận khách trả lại 1 món | Thu ngân thấy bàn "Cần trả lại tiền" kèm số tiền; bấm **Trả bàn** thì phải xác nhận đã trả lại khách mới trả bàn được | |
| 58 | Bàn đang chờ thanh toán (đã bấm Thanh toán), bếp bấm **Huỷ** một món | Báo bàn đang thanh toán, phải huỷ lần thanh toán chờ trước | |

---

## 8. Test tự động

| Lệnh | Kỳ vọng |
|---|---|
| `cd source/server` → `mvn test` | `Tests run: 24, Failures: 0, Errors: 0` |
| Server đang chạy → `cd source/loadtest` → `npm run e2e` | `KẾT QUẢ: 205 đạt, 0 lỗi` (18 nhóm) |
