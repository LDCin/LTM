# Hướng dẫn thiết lập nhanh

Yêu cầu: JDK 17+, Maven 3.9+, Node.js 18+. MySQL 8 là tuỳ chọn (có thể chạy H2 trong RAM).

Mọi lệnh dưới đây chạy từ thư mục `Source/`.

## 1. Build giao diện

```powershell
cd frontend
npm.cmd install
npm.cmd run build      # xuất vào backend/src/main/resources/static
cd ..
```

## 2. Chạy máy chủ

Cách nhanh, không cần MySQL (dữ liệu mất khi tắt):

```powershell
cd backend
mvn spring-boot:run "-Dspring-boot.run.profiles=h2"
```

Dùng MySQL qua Docker:

```powershell
docker compose -f config/docker-compose.yml up -d
cd backend
mvn spring-boot:run
```

Thông số kết nối và khoá dịch vụ xem `config/.env.example`; đặt thành biến môi trường trước khi chạy để ghi đè mặc định.

## 3. Truy cập

| Trang | Đường dẫn | Tài khoản mẫu |
|---|---|---|
| Trang chủ nhà hàng | `http://localhost:8080/` | — |
| Cổng nhân viên | `http://localhost:8080/staff` | — |
| Bếp | `/kitchen` | `bep / bep123` |
| Thu ngân | `/cashier` | `thungan / thungan123` |
| Quản lý | `/admin` | `admin / admin123` |
| Khách gọi món | `/t/<mã-QR-bàn>` (xem ở Quản lý → Bàn & mã QR, hoặc log khi khởi động) | — |

Khi phát triển giao diện có hot reload: `cd frontend && npm.cmd run dev`, mở `http://localhost:5173` (tự proxy API sang cổng 8080).

## 4. Database

- `database/schema.sql`: lược đồ bảng, được đóng gói vào backend và tự chạy khi khởi động (`CREATE TABLE IF NOT EXISTS`).
- `database/sample-data.sql`: dữ liệu mẫu (thực đơn, 12 bàn) để tham khảo / nạp tay. Khi database trống, server cũng tự tạo dữ liệu mẫu và các tài khoản nhân viên.

## 5. Kiểm thử

```powershell
cd backend
mvn test                      # unit + integration test (H2)

cd ../tests
npm.cmd install
node e2e-test.js              # kiểm thử đầu-cuối, cần server đang chạy ở 8080
node run-all.js               # chạy các thực nghiệm, kết quả lưu ở tests/results
```
