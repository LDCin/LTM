# QR Order – Hệ thống gọi món qua mã QR

Bài tập lớn môn **Lập trình mạng**, xây dựng ứng dụng web hỗ trợ khách hàng quét mã QR tại bàn để xem thực đơn, đặt món và theo dõi trạng thái đơn. Hệ thống cung cấp màn hình bếp thời gian thực, trang thu ngân và trang quản trị nhà hàng.

Khách hàng và nhân viên sử dụng hệ thống ngay trên trình duyệt. Các thay đổi về đơn hàng và trạng thái món được cập nhật qua WebSocket/STOMP.

## Thông tin nhóm

| Thông tin | Nội dung |
| --- | --- |
| Trường | Học viện Công nghệ Bưu chính Viễn thông |
| Khoa | Công nghệ thông tin 1 |
| Chuyên ngành | Công nghệ phần mềm |
| Môn học | Lập trình mạng |
| Năm học | 2026–2027 |
| Lớp | Chưa bổ sung |
| Nhóm | Chưa bổ sung |
| Giảng viên hướng dẫn | ThS. Ngô Văn Quyền |

| STT | MSSV | Họ và tên |
| --- | --- | --- |
| 1 | B23DCCN100 | Lê Đình Chuyên |
| 2 | B23DCCN156 | Vũ Ngọc Diệp |
| 3 | B23DCCN230 | Trần Thị Ánh Dương |
| 4 | B23DCCN324 | Bùi Huy Hoàng |

## Chức năng chính

| Vai trò | Chức năng |
| --- | --- |
| Khách hàng | Quét QR, xem thực đơn, đặt món, theo dõi trạng thái, gọi phục vụ và thanh toán |
| Nhân viên bếp | Nhận đơn thời gian thực, cập nhật trạng thái món, xử lý hủy hoặc trả món |
| Thu ngân | Theo dõi bàn, quản lý hóa đơn, xác nhận thanh toán và trả bàn |
| Quản trị viên | Quản lý bàn, mã QR, thực đơn, lịch sử thanh toán và cấu hình hệ thống |

Hệ thống hỗ trợ thanh toán tiền mặt, tích hợp VNPay sandbox và trợ lý gợi ý món.

## Công nghệ sử dụng

| Thành phần | Công nghệ |
| --- | --- |
| Giao diện | React, Vite |
| Máy chủ | Java 17, Spring Boot, JDBC |
| Cơ sở dữ liệu | MySQL 8; H2 cho chế độ chạy thử |
| Giao tiếp | REST API, WebSocket/STOMP |
| Công cụ | Maven, npm, Docker Compose (tùy chọn) |

## Yêu cầu hệ thống

Hướng dẫn dưới đây sử dụng Windows và PowerShell. Mã nguồn cũng có thể chạy trên Linux/macOS với các công cụ tương ứng; cú pháp đặt biến môi trường sẽ khác.

| Thành phần | Yêu cầu |
| --- | --- |
| Máy tính | Gợi ý cho demo cục bộ: CPU 2 nhân, RAM 8 GB, dung lượng trống 5 GB; đây không phải cấu hình tối thiểu đã đo kiểm |
| Java | JDK 17, bao gồm cả `java` và `javac` |
| Maven | Dòng 3.9.x, đã thêm thư mục `bin` vào `PATH` |
| Node.js và npm | Dùng Node.js 22.x kèm npm để cài dependency và build giao diện |
| Git | Cần khi tải mã nguồn bằng `git clone`; có thể thay bằng tải ZIP |
| Cơ sở dữ liệu | H2 có sẵn trong ứng dụng; MySQL 8.0 nếu muốn lưu dữ liệu lâu dài |
| Docker Desktop | Tùy chọn, chỉ cần nếu chạy MySQL bằng Docker Compose |
| Trình duyệt | Trình duyệt hỗ trợ JavaScript và WebSocket, ví dụ Edge, Chrome hoặc Firefox |
| Kết nối mạng | Internet khi tải công cụ/dependency và sử dụng VNPay hoặc Gemini; cùng mạng LAN nếu demo bằng điện thoại |
| Cổng | `8080` cho ứng dụng; `3306` khi dùng MySQL; `5173` khi chạy frontend ở chế độ phát triển |

Sau khi build, giao diện được phục vụ trực tiếp từ Spring Boot. Chế độ này chỉ cần chạy file JAR và cơ sở dữ liệu đã chọn, không cần chạy thêm Vite.

## Cài đặt và chạy từ đầu

Thực hiện bước 1–4, sau đó chọn **bước 5A hoặc 5B** và tiếp tục bước 6–8.

### 1. Cài công cụ

1. Tải bộ cài Windows của [Microsoft OpenJDK 17](https://learn.microsoft.com/en-us/java/openjdk/download), chọn bản phù hợp với kiến trúc máy. Khi cài, bật tùy chọn thêm Java vào `PATH` và đặt `JAVA_HOME`. Nếu đặt thủ công, `JAVA_HOME` trỏ đến thư mục JDK, còn `PATH` thêm `%JAVA_HOME%\bin`.
2. Cài Node.js 22.x bằng bộ cài Windows từ [trang tải Node.js](https://nodejs.org/en/download). Giữ thành phần npm và tùy chọn thêm vào `PATH`.
3. Tải gói **Binary zip archive** của Maven 3.9.x từ [Apache Maven](https://maven.apache.org/download.cgi), giải nén vào thư mục cố định. Mở **Edit environment variables for your account**, sửa `Path` và thêm đường dẫn thư mục `bin` của Maven. Xem [hướng dẫn cài Maven](https://maven.apache.org/install).
4. Nếu dùng `git clone`, cài Git từ [Git for Windows](https://gitforwindows.org/). Nếu tải ZIP thì bỏ qua.
5. Đóng rồi mở lại PowerShell để nhận các biến môi trường vừa cập nhật.

Kiểm tra công cụ:

```powershell
java -version
javac -version
mvn -v
node -v
npm.cmd -v
```

Java và Java mà `mvn -v` hiển thị phải là JDK 17; Maven là 3.9.x, Node.js là 22.x. Các lệnh dưới đây dùng `npm.cmd` để tránh lỗi PowerShell chặn thực thi `npm.ps1`.

### 2. Tải mã nguồn

Mở PowerShell tại thư mục muốn lưu project:

```powershell
git clone https://github.com/LDCin/LTM.git
cd LTM
```

Hoặc chọn **Code → Download ZIP** trên repository, giải nén và mở PowerShell trong thư mục chứa `README.md`, `source/`, `report/` và `statics/`.

Các bước tiếp theo bắt đầu từ thư mục gốc này.

### 3. Cài dependency và build giao diện

```powershell
cd source/client
npm.cmd install
npm.cmd run build
```

Chờ lệnh build hoàn tất. Giao diện được xuất vào `source/server/src/main/resources/static/` để đóng gói cùng backend.

### 4. Build máy chủ

Từ thư mục `source/client/` ở bước 3:

```powershell
cd ../server
mvn package
```

Lệnh này tải dependency, chạy test và tạo `target/qrorder-server-1.0.0.jar`. Chỉ tiếp tục khi Maven báo `BUILD SUCCESS`. Cần build giao diện trước khi đóng gói JAR.

### 5A. Chạy thử bằng H2, không cần MySQL

Từ `source/server/`:

```powershell
java -jar target/qrorder-server-1.0.0.jar --spring.profiles.active=h2
```

Giữ cửa sổ này mở trong khi sử dụng ứng dụng. Hệ thống tự tạo bảng và dữ liệu mẫu. **Dữ liệu H2 nằm trong RAM và mất khi dừng máy chủ.** Sau đó chuyển sang bước 6.

### 5B. Chạy bằng MySQL để lưu dữ liệu

Chọn một trong hai cách chuẩn bị MySQL:

**Cách 1 — Docker Compose:** cài [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/), hoàn tất yêu cầu cài đặt của Docker và mở ứng dụng. Từ thư mục gốc project, mở một cửa sổ PowerShell khác:

```powershell
cd source
docker compose up -d
docker compose ps
docker compose exec mysql mysqladmin ping -h localhost -uroot -proot
```

Nếu MySQL vẫn đang khởi tạo, chờ rồi chạy lại lệnh cuối. Khi thấy `mysqld is alive`, database đã sẵn sàng. Compose tạo database `qrorder`, tài khoản `root` với mật khẩu `root` và ánh xạ cổng `3306`. Dữ liệu được giữ trong Docker volume `qrorder-data`.

**Cách 2 — MySQL cài trực tiếp:** cài MySQL Server 8.0 từ [MySQL Community Downloads](https://dev.mysql.com/downloads/mysql/), cấu hình cổng và mật khẩu, rồi khởi động dịch vụ MySQL. Không chạy đồng thời với container MySQL trên cùng cổng `3306`.

Sau khi MySQL sẵn sàng, tại cửa sổ PowerShell đang ở `source/server/`, đặt thông tin kết nối và chạy:

```powershell
$env:DB_HOST = "localhost"
$env:DB_PORT = "3306"
$env:DB_NAME = "qrorder"
$env:DB_USER = "root"
$env:DB_PASSWORD = "root"
java -jar target/qrorder-server-1.0.0.jar
```

Nếu dùng MySQL cài trực tiếp, thay giá trị tài khoản và mật khẩu theo cấu hình của bạn. Các biến trên chỉ áp dụng cho cửa sổ PowerShell hiện tại; đặt lại khi mở cửa sổ mới nếu thông tin khác mặc định.

Ứng dụng tự tạo database nếu chưa tồn tại và tài khoản có quyền tạo database, sau đó khởi tạo các bảng. Nếu tài khoản không có quyền này, tạo trước database `qrorder` và cấp quyền trên database đó. Dữ liệu demo được tạo khi bảng nhân viên trống.

Không thêm `--spring.profiles.active=h2` khi muốn sử dụng MySQL.

### 6. Kiểm tra ứng dụng và đăng nhập

Chờ log thông báo Spring Boot khởi động thành công. Mở [trạng thái máy chủ](http://localhost:8080/actuator/health), kết quả mong đợi có `"status":"UP"`.

| Trang | Địa chỉ | Tên đăng nhập | Mật khẩu mẫu |
| --- | --- | --- | --- |
| Quản trị | [Mở quản trị](http://localhost:8080/admin) | `admin` | `admin123` |
| Bếp | [Mở màn hình bếp](http://localhost:8080/kitchen) | `bep` | `bep123` |
| Thu ngân | [Mở thu ngân](http://localhost:8080/cashier) | `thungan` | `thungan123` |
| Khách | Lấy mã QR hoặc đường dẫn `/t/<qrToken>` trong trang quản trị | Không cần | Không cần |

Các tài khoản trên dành cho database mới có dữ liệu mẫu. Nếu dùng database cũ, sử dụng tài khoản hiện có. Khi chạy bằng JAR, dùng cổng `8080`; các link `5173` xuất hiện trong log tạo dữ liệu mẫu dành cho chế độ phát triển.

Mở trang bếp ở một cửa sổ, trang khách ở cửa sổ khác và đặt thử một món. Kiểm tra đơn xuất hiện ở bếp và trạng thái trên trang khách thay đổi khi bếp xử lý.

### 7. Truy cập bằng điện thoại trong cùng mạng LAN

1. Kết nối điện thoại và máy chạy server vào cùng mạng Wi-Fi.
2. Chạy `ipconfig` trên máy chủ và lấy địa chỉ IPv4 của card mạng đang sử dụng, ví dụ `192.168.1.10`.
3. Trên máy chủ, truy cập `http://192.168.1.10:8080/admin` rồi lấy mã QR của bàn để QR sử dụng địa chỉ LAN.
4. Dùng điện thoại quét mã QR. Không dùng `localhost` trên điện thoại vì địa chỉ đó trỏ về chính điện thoại.
5. Nếu không kết nối được, kiểm tra Windows Firewall cho phép Java/cổng `8080` trên mạng Private và Wi-Fi không bật tính năng cô lập thiết bị.

### 8. Dừng và chạy lại

- Dừng ứng dụng bằng `Ctrl+C` tại cửa sổ chạy Java.
- Chạy lại bằng lệnh Java tương ứng ở bước 5A hoặc 5B; không cần build lại nếu mã nguồn không đổi.
- Nếu dùng Docker, từ thư mục `source/` chạy `docker compose stop` để dừng database, và `docker compose start` để mở lại. Chờ MySQL sẵn sàng trước khi chạy Java.

## Các chế độ và cấu hình bổ sung

### Chạy khi phát triển giao diện

Mở hai cửa sổ PowerShell, mỗi cửa sổ bắt đầu từ thư mục gốc project.

**Cửa sổ 1 — backend H2:**

```powershell
cd source/server
mvn spring-boot:run "-Dspring-boot.run.profiles=h2"
```

**Cửa sổ 2 — frontend:**

```powershell
cd source/client
npm.cmd install
npm.cmd run dev
```

Truy cập `http://localhost:5173/admin`, `/kitchen` hoặc `/cashier`. Vite chuyển tiếp `/api` và `/ws` đến backend cổng `8080`. Khi demo qua LAN ở chế độ này, dùng địa chỉ IP máy chủ và cổng `5173`.

### Tích hợp tùy chọn

Các cấu hình sau không bắt buộc để chạy luồng gọi món và thanh toán tiền mặt. Đặt biến môi trường trong cùng cửa sổ PowerShell **trước khi chạy Java**, hoặc dừng rồi chạy lại nếu ứng dụng đang mở.

| Biến môi trường | Ý nghĩa |
| --- | --- |
| `GEMINI_API_KEY` | Khóa Gemini của bạn cho trợ lý AI; khi chưa có khóa, trợ lý dùng gợi ý dự phòng |
| `GEMINI_MODEL` | Model Gemini sử dụng, nếu cần thay giá trị mặc định |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | Thông tin merchant VNPay sandbox của bạn, ghi đè cấu hình demo có sẵn |
| `APP_PUBLIC_URL` | Địa chỉ HTTPS công khai của backend khi thử luồng VNPay qua tunnel; không dùng URL frontend Vite |
| `AUTH_SECRET` | Khóa ký token nhân viên, ghi đè giá trị demo khi cần |

Ví dụ đặt khóa trợ lý:

```powershell
$env:GEMINI_API_KEY = "<khoa-api-cua-ban>"
```

Để thử VNPay đầy đủ, cần tài khoản sandbox hợp lệ và địa chỉ callback mà VNPay có thể truy cập. Khi dùng tunnel, chuyển tiếp đến backend cổng `8080`, đặt `APP_PUBLIC_URL` theo địa chỉ tunnel và cấu hình callback/IPN tương ứng tại VNPay. Các endpoint của ứng dụng là `/api/payments/vnpay/return` và `/api/payments/vnpay/ipn`.

### Kiểm thử sau cài đặt

Kiểm thử backend, từ thư mục gốc project:

```powershell
cd source/server
mvn test
```

Kiểm thử E2E: chạy ứng dụng trước, rồi mở PowerShell khác tại thư mục gốc. Nên dùng database demo riêng vì bộ test tạo dữ liệu thử và thay đổi cấu hình phục vụ kiểm thử.

```powershell
cd source/loadtest
npm.cmd install
npm.cmd run e2e
```

## Lỗi cài đặt thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| Không nhận `java`, `javac`, `mvn` hoặc `node` | Kiểm tra công cụ đã cài và `PATH`, sau đó mở lại PowerShell |
| Maven dùng sai Java hoặc báo lỗi phiên bản biên dịch | Kiểm tra `mvn -v`, đặt `JAVA_HOME` về JDK 17 và sửa thứ tự Java trong `PATH` |
| PowerShell chặn `npm.ps1` | Dùng `npm.cmd` như các lệnh trong hướng dẫn |
| Tải dependency thất bại | Kiểm tra Internet, proxy và quyền truy cập Maven Central/npm; chạy lại bước bị lỗi |
| Cổng `8080` đang được sử dụng | Dừng ứng dụng đang chiếm cổng, hoặc chạy JAR với `--server.port=8081` rồi truy cập cổng `8081` |
| Đổi backend sang `8081` khi chạy Vite | Đặt `$env:BACKEND_URL = "http://localhost:8081"` ở cửa sổ frontend trước `npm.cmd run dev` |
| MySQL báo `Access denied` | Kiểm tra `DB_USER`, `DB_PASSWORD` và quyền của tài khoản |
| MySQL báo `Communications link failure` | Kiểm tra MySQL đã sẵn sàng và `DB_HOST`, `DB_PORT` khớp cấu hình |
| Docker không khởi động MySQL do cổng `3306` đã dùng | Dùng MySQL cài sẵn hoặc dừng dịch vụ đang chiếm cổng trước khi chạy container |
| Backend chạy nhưng không có giao diện | Thực hiện lại bước build frontend rồi đóng gói JAR, sau đó khởi động lại |
| Không thấy dữ liệu sau khi chạy lại H2 | H2 lưu trong RAM; dùng MySQL nếu cần giữ dữ liệu |

## Trải nghiệm hệ thống

Quy trình demo chính:

1. Quản trị viên lấy mã QR của bàn; khách quét mã để truy cập trang gọi món.
2. Khách xem thực đơn, chọn món và gửi đơn.
3. Bếp nhận đơn, xử lý và cập nhật trạng thái món.
4. Khách theo dõi trạng thái và yêu cầu thanh toán.
5. Thu ngân xác nhận thanh toán và trả bàn.

Các trang dành cho nhân viên gồm `/admin`, `/kitchen` và `/cashier`. Khách truy cập qua đường dẫn `/t/<qrToken>` từ mã QR của bàn.

## Cấu trúc repository

```text
.
├── README.md           Giới thiệu tổng quan đồ án
├── source/             Mã nguồn hệ thống
│   ├── client/         Giao diện web
│   ├── server/         Máy chủ Spring Boot
│   ├── loadtest/       Công cụ kiểm thử và thực nghiệm
│   └── docker-compose.yml  Cấu hình MySQL qua Docker
├── report/             Báo cáo đồ án
└── statics/            Tài nguyên và kết quả thực nghiệm
```

## Tài liệu

- [Báo cáo đồ án](report/BTL_LTM_N10.docx)
- [Kết quả thực nghiệm](statics/results/REPORT.md)

Thiết kế kiến trúc, giao thức mạng, cơ chế xử lý lỗi và đánh giá hệ thống được trình bày trong báo cáo đồ án.
