# Hướng dẫn cài đặt và chạy QR Order từ đầu (A → Z)

Tài liệu này dành cho người có một máy **Windows 10/11 mới tinh**, dùng **chính máy đó làm server** và mở ra Internet
bằng **tunnel** để điện thoại ở bất kỳ mạng nào (4G, Wi-Fi khác) cũng gọi món được. Hướng dẫn bao gồm: cài phần mềm,
MySQL, IntelliJ IDEA, build, chạy, tunnel, test và thực nghiệm.

Thời gian ước tính: 45–60 phút cho lần đầu (phần lớn là thời gian tải và cài phần mềm).

---

## Mục lục

0. [Tổng quan phần mềm cần cài](#0-tổng-quan-phần-mềm-cần-cài)
1. [Git](#1-cài-git)
2. [JDK 17](#2-cài-jdk-17)
3. [Maven](#3-cài-maven)
4. [Node.js](#4-cài-nodejs)
5. [MySQL 8](#5-cài-mysql-8)
6. [IntelliJ IDEA](#6-cài-intellij-idea)
7. [Lấy source code, mở bằng IntelliJ, khai báo mật khẩu MySQL](#7-lấy-source-code-mở-bằng-intellij-khai-báo-mật-khẩu-mysql)
8. [Build](#8-build)
9. [Chạy server](#9-chạy-server)
10. [Dùng thử trên máy](#10-dùng-thử-trên-máy)
11. [Chế độ phát triển (tự reload)](#11-chế-độ-phát-triển-tự-reload)
12. [Mở server ra Internet bằng tunnel](#12-mở-server-ra-internet-bằng-tunnel)
13. [Chạy test](#13-chạy-test)
14. [Chạy thực nghiệm E1–E6](#14-chạy-thực-nghiệm-e1e6)
15. [Xoá dữ liệu, làm lại từ đầu](#15-xoá-dữ-liệu-làm-lại-từ-đầu)
16. [Lỗi thường gặp](#16-lỗi-thường-gặp)

---

## 0. Tổng quan phần mềm cần cài

| Phần mềm | Phiên bản | Bắt buộc? | Dùng để |
|---|---|---|---|
| Git | bản mới nhất | Nên có | Tải source code |
| JDK (Java Development Kit) | **17** hoặc **21** (LTS). Không dùng bản mới hơn 23 (ví dụ 25, 27): Spring Boot 3.3 chỉ hỗ trợ Java 17–23 | Có | Biên dịch và chạy server Spring Boot |
| Maven | 3.9 trở lên | Có (hoặc dùng Maven có sẵn trong IntelliJ) | Build server, chạy JUnit |
| Node.js (kèm npm) | **18** trở lên (khuyến nghị bản LTS; dự án đã chạy với 20.18) | Chỉ khi sửa giao diện hoặc chạy test | Build giao diện React, chạy test e2e và thực nghiệm |
| MySQL Server | **8.0** (dự án đã test với 8.0.39) | Có | Cơ sở dữ liệu |
| MySQL Workbench | bản đi kèm MySQL | Không | Xem dữ liệu bằng giao diện |
| IntelliJ IDEA Community | bản mới nhất | Có | IDE: chạy server, đọc/sửa code Java và React, có terminal tích hợp |
| Công cụ tunnel: **ngrok** hoặc **cloudflared** | bản mới nhất | Có (để điện thoại truy cập qua Internet) | Đưa cổng 8080 của máy ra một địa chỉ `https://…` công khai |
| Google Chrome / Edge | bản mới nhất | Có | Mở giao diện, xem frame WebSocket bằng F12 |

**Mẹo:** Windows 10/11 có sẵn `winget`. Mở **PowerShell** và chạy các lệnh `winget` ở từng bước để cài nhanh thay vì
tải file cài đặt bằng tay. Nếu `winget` không có hoặc báo lỗi, làm theo cách tải thủ công ghi bên dưới.

**Cách mở terminal:** bấm phím Windows, gõ `PowerShell` hoặc `cmd`, Enter (hoặc dùng tab **Terminal** ở thanh dưới
của IntelliJ, phím tắt `Alt + F12`). **Sau mỗi lần cài phần mềm có thay đổi PATH, đóng hết cửa sổ terminal và IntelliJ
rồi mở lại** thì lệnh mới có tác dụng.

---

## 1. Cài Git

**Cách nhanh:**

```bash
winget install --id Git.Git -e
```

**Cách thủ công:** tải tại https://git-scm.com/download/win, chạy file cài đặt, giữ nguyên các lựa chọn mặc định.

**Kiểm tra** (mở terminal mới):

```bash
git --version
```

Kết quả đúng: `git version 2.x.x...`

---

## 2. Cài JDK 17

Dùng bản **Eclipse Temurin** (miễn phí, của Adoptium).

**Cách nhanh:**

```bash
winget install --id EclipseAdoptium.Temurin.17.JDK -e
```

**Cách thủ công:**

1. Vào https://adoptium.net/temurin/releases/, chọn **Operating System: Windows**, **Architecture: x64**,
   **Package Type: JDK**, **Version: 17 - LTS**, tải file **.msi**.
2. Chạy file cài đặt. Ở màn hình **Custom Setup**, bấm vào từng mục và chọn
   **"Will be installed on local hard drive"** cho cả hai mục:
   * `Add to PATH`
   * `Set JAVA_HOME variable`
3. Next → Install.

**Kiểm tra** (terminal mới):

```bash
java -version
```

```bash
javac -version
```

Kết quả đúng: cả hai đều in `17.x.x` (hoặc số lớn hơn nếu bạn cài JDK mới hơn).

Kiểm tra `JAVA_HOME` (trong **cmd**):

```bash
echo %JAVA_HOME%
```

Kết quả đúng: một đường dẫn như `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot\`.

> Muốn dùng bản mới hơn thì thay `17` bằng `21` trong lệnh/đường dẫn ở trên (`EclipseAdoptium.Temurin.21.JDK`).
> Không dùng JDK mới hơn 23: Spring Boot 3.3.5 của dự án chỉ hỗ trợ Java 17–23. Lưu ý IntelliJ có thể tự tải một JDK
> rất mới (ví dụ OpenJDK 27 vào `C:\Users\<tên>\.jdks`); khi đó chọn lại JDK 17/21 ở Bước 7.2.
>
> Nếu máy có nhiều JDK, `java -version` phải in bản 17 hoặc 21. Nếu in bản 8 hoặc 11, xem mục
> [Lỗi thường gặp](#16-lỗi-thường-gặp).

---

## 3. Cài Maven

> Nếu bạn chỉ chạy server bằng IntelliJ IDEA thì có thể bỏ qua bước này: IntelliJ có sẵn Maven bên trong. Tuy nhiên
> các lệnh `mvn` gõ trong terminal ở tài liệu này cần Maven cài riêng.

1. Vào https://maven.apache.org/download.cgi, tải file **Binary zip archive** (`apache-maven-3.9.x-bin.zip`).
2. Giải nén vào một thư mục **không có dấu cách và dấu tiếng Việt**, ví dụ `C:\tools\apache-maven-3.9.x`
   (bên trong phải có thư mục `bin`).
3. Thêm Maven vào PATH:
   1. Bấm phím Windows, gõ **"environment"**, chọn **Edit the system environment variables**
      (hoặc "Chỉnh sửa biến môi trường hệ thống").
   2. Bấm **Environment Variables...**
   3. Ở khung **User variables** (hoặc **System variables**), chọn dòng **Path** → **Edit** → **New**, dán
      `C:\tools\apache-maven-3.9.x\bin` (đúng thư mục bạn đã giải nén) → **OK** ở tất cả các cửa sổ.
4. Đóng mọi terminal, mở terminal mới.

**Kiểm tra:**

```bash
mvn -v
```

Kết quả đúng: in `Apache Maven 3.9.x` và dòng `Java version: 17...`. Nếu dòng Java version là bản cũ hơn 17,
sửa lại biến `JAVA_HOME` cho trỏ tới JDK 17.

---

## 4. Cài Node.js

> Chỉ cần nếu sửa giao diện React hoặc chạy test e2e / thực nghiệm. Chỉ chạy hệ thống để demo thì **bỏ qua bước này**:
> bản build giao diện đã có sẵn trong Git.

**Cách nhanh:**

```bash
winget install --id OpenJS.NodeJS.LTS -e
```

**Cách thủ công:** vào https://nodejs.org, tải bản **LTS** cho Windows (file `.msi`), cài với các lựa chọn mặc định.
Không cần tick "Automatically install the necessary tools" (Chocolatey, Python…), dự án không dùng.

**Kiểm tra** (terminal mới):

```bash
node -v
```

```bash
npm -v
```

Kết quả đúng: `node -v` in `v18.x` trở lên (ví dụ `v20.18.0`, `v22.x`).

---

## 5. Cài MySQL 8

Dự án dùng tài khoản **`root`** của MySQL, cổng `3306`. **Database `qrorder` và các bảng được tạo tự động** khi server
khởi động lần đầu, không cần chạy script SQL hay tạo database bằng tay.

### 5.1. Cài đặt

1. Vào https://dev.mysql.com/downloads/installer/ và tải **MySQL Installer for Windows** bản **8.0.x**
   (chọn file lớn `mysql-installer-community-8.0.x.msi`, khoảng 300 MB). Khi trang hỏi đăng nhập, bấm
   **"No thanks, just start my download"**.
   * Nếu trang chỉ còn bản 8.4: vào mục **Archives** trên trang tải để lấy bản 8.0, hoặc dùng bản 8.4 LTS. Dự án đã
     được test với **8.0.39**; bản 8.4 chưa được nhóm thử (nếu dùng, chạy `npm run e2e` ở Bước 13.2 để kiểm tra).
2. Chạy installer, chọn **Custom** (hoặc **Server only**), chọn:
   * **MySQL Server 8.0.x**
   * **MySQL Workbench** (tuỳ chọn, để xem dữ liệu)
3. **Execute** để cài, rồi **Next** tới phần cấu hình:
   * **Type and Networking**: *Config Type* = `Development Computer`, *Port* = `3306`.
     **Bỏ tick** *Open Windows Firewall port for network access*: server Spring Boot chạy cùng máy nên MySQL không cần
     mở ra ngoài, và tunnel chỉ mở cổng 8080.
   * **Authentication Method**: chọn **Use Strong Password Encryption (Recommended)**.
   * **Accounts and Roles**: đặt **MySQL Root Password** và **ghi lại** mật khẩu này, sẽ dùng ở Bước 7.3.
   * **Windows Service**: giữ tick *Configure MySQL Server as a Windows Service*, tên `MySQL80`, tick
     *Start the MySQL Server at System Startup*.
   * **Apply Configuration** → **Execute** → **Finish**.

### 5.2. Kiểm tra

* Bấm Windows, gõ `services.msc`, tìm **MySQL80**: cột Status phải là **Running**.
* Hoặc mở **MySQL Workbench** → bấm vào kết nối *Local instance MySQL80* → nhập mật khẩu root → vào được là đúng.

---

## 6. Cài IntelliJ IDEA

```bash
winget install --id JetBrains.IntelliJIDEA.Community -e
```

hoặc tải tại https://www.jetbrains.com/idea/download/ → bản **Community Edition** (miễn phí; bản Ultimate cũng được).
Một IntelliJ dùng được cho cả phần Java (`source/server`) lẫn phần React/Node.js (`source/client`, `source/loadtest`).

---

## 7. Lấy source code, mở bằng IntelliJ, khai báo mật khẩu MySQL

### 7.1. Tải source code

Chọn thư mục làm việc **không có dấu cách và dấu tiếng Việt** (ví dụ `C:\Projects`), rồi trong terminal:

```bash
cd C:\Projects
```

```bash
git clone -b feat/separate_visual https://github.com/LDCin/LTM.git
```

> **Lưu ý nhánh:** bản mới nhất (phiên bàn, thu ngân, thanh toán VNPay) đang nằm ở nhánh `feat/separate_visual`, chưa gộp
> vào `main`. Clone thường (không có `-b`) sẽ lấy `main` là bản cũ. Đã clone rồi thì chuyển nhánh bằng
> `git checkout feat/separate_visual`, sau đó mỗi lần cập nhật chỉ cần `git pull`.

(Hoặc tải thư mục nộp bài từ Google Drive và giải nén.) Cấu trúc chính:

```text
LTM/
├── README.md, SETUP.md (file này), PLAN.md, PROGRESS.md
├── report/                báo cáo
├── statics/results/       kết quả thực nghiệm
└── source/
    ├── server/            Spring Boot (Java 17, Maven)
    ├── client/            React + Vite
    ├── loadtest/          Node.js: test e2e + thực nghiệm
    ├── README.md          tài liệu kỹ thuật
    └── TESTING.md         checklist test tay
```

### 7.2. Mở dự án trong IntelliJ

1. **File → Open...** → chọn thư mục `LTM/source/server` (thư mục có `pom.xml`) → **Trust Project**. Chờ thanh tiến
   trình ở góc dưới chạy xong (IntelliJ đang tải thư viện Maven, lần đầu mất vài phút).
2. **File → Project Structure... → Project → SDK**: chọn JDK 17 (nếu chưa có: **Add SDK → JDK...** → trỏ tới
   `C:\Program Files\Eclipse Adoptium\jdk-17...`) → **OK**.
3. Kiểm tra IntelliJ đã nhận dự án Maven: thư mục `src/main/java` phải có **màu xanh dương**, file `.java` có icon chữ
   **C**, và cạnh hàm `main` trong `QrOrderApplication.java` có nút ▶. Nếu thư mục `java` màu xám và file `.java` có
   icon cốc cà phê màu cam, nghĩa là bạn đã mở thư mục cha (`LTM` hoặc `source`) thay vì `source/server`: chuột phải
   `server/pom.xml` → **Add as Maven Project** (hoặc mở `pom.xml` rồi bấm **Load** ở thông báo góc dưới), chờ tải xong.

### 7.3. Khai báo mật khẩu MySQL

Server đọc mật khẩu MySQL từ biến môi trường `DB_PASSWORD`. Chỉ cần khai báo một lần:

1. Mở file `src/main/java/com/ltm/qrorder/QrOrderApplication.java`, bấm nút ▶ màu xanh cạnh hàm `main` → **Run**.
   Lần này server sẽ báo lỗi `Access denied for user 'root'` vì chưa có mật khẩu: bình thường, bấm nút ■ để dừng.
2. Menu **Run → Edit Configurations...** → chọn `QrOrderApplication`.
3. Ô **Environment variables** (không thấy thì bấm **Modify options → Environment variables**), gõ:

   ```text
   DB_PASSWORD=mat_khau_root_cua_ban
   ```

4. **OK**, rồi bấm ▶ chạy lại. Thấy dòng `Started QrOrderApplication` là xong.

> Nếu mật khẩu root của bạn đúng là `root` thì không cần khai báo gì.
>
> Mật khẩu này chỉ lưu trong cấu hình IntelliJ trên máy bạn (thư mục `.idea/`, không bị đưa lên Git). Đừng tick
> **Store as project file** trong cửa sổ cấu hình.

---

## 8. Build

Trong tab **Terminal** của IntelliJ (`Alt + F12`), chạy lần lượt.

### 8.1. Build giao diện (chỉ cần khi sửa code React)

Giao diện React được build thẳng vào thư mục `server/src/main/resources/static/` để server phục vụ luôn. Bản build
**đã có sẵn trong Git**, nên vừa pull về là chạy server được ngay, không cần cài Node.js. Chỉ làm bước này khi sửa code
React, và nhớ commit cả thư mục `static/` sau khi build.

```bash
cd C:\Projects\LTM\source\client
```

```bash
npm install
```

```bash
npm run build
```

Kết quả đúng: dòng cuối có `✓ built in ...`, và thư mục `source/server/src/main/resources/static/` có `index.html`
cùng thư mục `assets/`.

### 8.2. Build server thành file jar

Chỉ cần nếu muốn chạy server bằng terminal (Bước 9.2). Chạy bằng IntelliJ (Bước 9.1) thì không cần.

```bash
cd ..\server
```

```bash
mvn package -DskipTests
```

Kết quả đúng: `BUILD SUCCESS` và có file `source/server/target/qrorder-server-1.0.0.jar`.

### 8.3. Cài thư viện cho test e2e và thực nghiệm

```bash
cd ..\loadtest
```

```bash
npm install
```

> **Khi nào phải build lại?** Sửa code React → chạy lại `npm run build` (8.1) rồi chạy lại server. Sửa code Java →
> chạy lại server trong IntelliJ là đủ (nếu chạy bằng jar thì `mvn package -DskipTests` lại).

---

## 9. Chạy server

MySQL phải đang chạy (Bước 5.2).

### 9.1. Chạy bằng IntelliJ (cách chính)

Chọn cấu hình `QrOrderApplication` ở thanh trên cùng → bấm ▶ (hoặc `Shift + F10`). Dừng bằng nút ■.

### 9.2. Chạy bằng terminal

Biến `DB_PASSWORD` khai báo trong IntelliJ không áp dụng cho terminal, nên phải khai báo lại.

**PowerShell:**

```powershell
cd C:\Projects\LTM\source\server
$env:DB_PASSWORD = "mat_khau_root_cua_ban"
java -jar target/qrorder-server-1.0.0.jar
```

**cmd:**

```bat
cd C:\Projects\LTM\source\server
set DB_PASSWORD=mat_khau_root_cua_ban
java -jar target/qrorder-server-1.0.0.jar
```

Dừng server: `Ctrl + C`. Đổi cổng (nếu 8080 bị chiếm): thêm `--server.port=8081` vào cuối lệnh (khi đó tunnel cũng
phải trỏ tới 8081).

### 9.3. Nhận biết server đã chạy

Trong log sẽ thấy:

* `Started QrOrderApplication in ... seconds` → server sẵn sàng.
* Lần đầu với database trống: `CSDL trống -> tạo dữ liệu mẫu` (tạo tài khoản, thực đơn, các bàn mẫu).
* Danh sách "Link gọi món" của từng bàn. **Lưu ý:** các link này in theo cổng `5173` (dành cho chế độ phát triển).
  Khi chạy server bình thường, hãy dùng cổng **8080**.

Kiểm tra nhanh bằng trình duyệt: mở http://localhost:8080/actuator/health → thấy `{"status":"UP"}`.

Với MySQL Workbench: bấm Refresh ở khung **Schemas** sẽ thấy database `qrorder` với các bảng `orders`, `order_item`,
`order_event`, `idempotency_key`, `table_session`, `payment`...

> **Máy đã chạy bản cũ trước đây:** không cần xoá database. Khi khởi động, server tự thêm các cột và bảng mới (tên khách,
> lý do kết thúc phiên, bảng `payment`) và đưa mọi bàn về trạng thái "đang phục vụ, chưa có khách".

---

## 10. Dùng thử trên máy

| Trang | Địa chỉ | Tài khoản |
|---|---|---|
| Trang chủ | http://localhost:8080 | – |
| Quản trị (bàn, QR, thực đơn, lịch sử thanh toán, cấu hình thực nghiệm) | http://localhost:8080/admin | `admin` / `admin123` |
| Màn hình bếp | http://localhost:8080/kitchen | `bep` / `bep123` |
| Thu ngân (sơ đồ bàn, thanh toán, trả bàn) | http://localhost:8080/cashier | `thungan` / `thungan123` |
| Khách gọi món | Ở trang Quản trị → **Bàn & QR** → bấm "Mở link gọi món" của một bàn (hoặc quét QR) | – |

Luồng thử 2 phút:

1. Mở trang Quản trị và trang Bếp (nên mở trang Bếp trong **cửa sổ ẩn danh**, vì hai trang dùng chung phiên đăng nhập
   trong cùng trình duyệt).
2. Mở link gọi món của một bàn, bấm F12 → biểu tượng điện thoại để xem như trên điện thoại.
   Lần đầu vào, trang hỏi **tên** (có thể Bỏ qua).
   Bàn tự "mở phiên" khi người đầu tiên vào, không cần nhân viên bấm gì.
3. Thêm món → **Đặt món** → đơn hiện ngay ở cột **Mới** trên màn hình bếp.
4. Bếp bấm **Nhận** → **Bắt đầu nấu** → **Xong**: trang khách đổi trạng thái theo. Món đã nhận mà
   cần huỷ (hết nguyên liệu, làm hỏng) hoặc khách trả lại: bếp bấm **Huỷ** ở món (món đã phục vụ thì mở **🍽 Món đã phục vụ**),
   chọn số suất và lý do; món huỷ không tính tiền.
5. Trên màn hình bếp bấm **Giả lập mất mạng 5s**, trong lúc đó đặt thêm một đơn: khi bếp kết nối lại, đơn vẫn hiện
   (F12 → **Network** → **WS** → chọn kết nối `/ws` → **Messages**: thấy frame gửi `/app/resume` và frame nhận `REPLAY_BATCH`
   chứa đơn bị lỡ).
6. Mở trang Thu ngân (cửa sổ ẩn danh khác). Trên trang khách bấm **🙋 Gọi phục vụ**: trang Thu ngân kêu "ting", hiện
   khung đỏ "Khách gọi phục vụ" và ô bàn nhấp nháy. Lễ tân điều phối nhân viên qua bộ đàm rồi bấm **Đã xử lý**: điện
   thoại khách hiện "Nhân viên đã nhận yêu cầu và đang tới bàn bạn".
7. Trên trang khách bấm **Thanh toán** → chọn **Tiền mặt tại quầy**. Trên trang Thu ngân, bàn chuyển màu cam "Chờ thanh
   toán" → bấm vào bàn → **Đã nhận tiền** → **Trả bàn**. Trang khách hiện "Cảm ơn quý khách".

Giải thích các khái niệm mới:

* **Phiên bàn** = một lượt khách. Tự mở khi khách đầu tiên quét QR; kết thúc khi thu ngân bấm **Trả bàn** (hoặc tự kết
  thúc: 30 phút không gọi món, hoặc 30 phút sau khi đã trả đủ tiền). Mọi điện thoại trong cùng phiên thấy **đơn chung**.
* **Đóng bàn / Mở bàn** ở trang Quản trị = **ngừng phục vụ / phục vụ lại** (bảo trì), không liên quan tới lượt khách.
  Không đóng được bàn đang có khách.

Checklist đầy đủ 23 bước nằm trong [`source/TESTING.md`](source/TESTING.md).

---

## 11. Chế độ phát triển (tự reload)

Dùng khi sửa giao diện React và muốn thấy ngay, không phải `npm run build` mỗi lần.

1. Chạy server trong IntelliJ như Bước 9.1.
2. Trong tab **Terminal** của IntelliJ:

```bash
cd C:\Projects\LTM\source\client
npm run dev
```

3. Mở **http://localhost:5173**. Vite tự chuyển các request `/api` và `/ws` sang server ở cổng 8080. Sửa file trong
   `source/client/src` là trình duyệt cập nhật ngay. Lúc này các link `localhost:5173/...` in trong log server dùng được.

> Khi demo qua tunnel, **không** dùng chế độ này: chạy lại `npm run build` (Bước 8.1), chạy server (Bước 9) và trỏ
> tunnel tới cổng 8080.

---

## 12. Mở server ra Internet bằng tunnel

### 12.1. Cách hoạt động

```text
Điện thoại (4G / Wi-Fi bất kỳ)
        │  https://ten-ngau-nhien.ngrok-free.app   (HTTPS + WSS)
        ▼
Máy chủ của dịch vụ tunnel (ngrok / Cloudflare)
        │  kết nối do chương trình tunnel trên máy bạn mở sẵn
        ▼
Chương trình tunnel trên máy bạn ──▶ http://localhost:8080 (Spring Boot)
```

Chương trình tunnel chạy trên máy bạn, chủ động mở kết nối ra máy chủ của dịch vụ tunnel, nên **không cần** IP tĩnh,
mở port trên router hay cấu hình firewall. Dịch vụ cấp một địa chỉ `https://…` công khai và chuyển mọi request về
cổng 8080 trên máy bạn.

Hệ thống chạy được qua tunnel mà không phải sửa code:

* Giao diện, REST và WebSocket đều đi qua **cùng một cổng 8080**, nên chỉ cần **một** tunnel.
* Trang web tự dùng `wss://` khi được mở bằng `https://`, nên WebSocket chạy qua tunnel HTTPS.
* Trang Quản trị lấy địa chỉ đang mở trên thanh địa chỉ để in vào mã QR, nên chỉ cần mở trang Quản trị **bằng địa chỉ
  tunnel**.

Chọn **một** trong hai dịch vụ dưới đây (cả hai đều miễn phí và hỗ trợ WebSocket). Nếu bạn dùng dịch vụ khác, yêu cầu
duy nhất là: chuyển được HTTP **và WebSocket** tới `http://localhost:8080`.

### 12.2. Cách 1 – ngrok

1. Cài:

```bash
winget install --id Ngrok.Ngrok -e
```

   (hoặc tải tại https://ngrok.com/download, giải nén `ngrok.exe` vào một thư mục có trong PATH.)

   **Lưu ý:** `winget` có thể cài bản cũ (ví dụ 3.3.1). Bản cũ không có tuỳ chọn `--url` và bị tài khoản miễn phí từ
   chối với lỗi `ERR_NGROK_121` ("agent version is too old"). Cài xong, mở terminal mới rồi chạy `ngrok update` và
   kiểm tra `ngrok version` phải từ **3.20.0** trở lên.
2. Đăng ký tài khoản miễn phí tại https://dashboard.ngrok.com/signup, vào mục **Your Authtoken**, sao chép lệnh
   `ngrok config add-authtoken ...` và chạy **một lần**:

```bash
ngrok config add-authtoken <AUTHTOKEN_CUA_BAN>
```

3. Chạy server (Bước 9), rồi ở một terminal khác:

```bash
ngrok http 8080
```

4. Dòng `Forwarding` cho biết địa chỉ công khai, ví dụ `https://abcd-1234.ngrok-free.app -> http://localhost:8080`.
   Giữ cửa sổ này mở trong suốt buổi demo. Trang http://127.0.0.1:4040 cho xem từng request đi qua tunnel.

Lưu ý với gói miễn phí:

* Lần đầu mở địa chỉ bằng trình duyệt, ngrok hiện một trang cảnh báo; bấm **Visit Site** (mỗi điện thoại một lần).
* Tài khoản miễn phí có **một tên miền cố định** (xem mục **Domains** trong dashboard và lệnh chạy kèm theo). Dùng tên
  miền này thì mã QR in ra **không đổi** giữa các lần chạy.

### 12.3. Cách 2 – Cloudflare Tunnel (không cần tài khoản)

1. Cài:

```bash
winget install --id Cloudflare.cloudflared -e
```

   (hoặc tải tại https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/.)
2. Chạy server (Bước 9), rồi ở một terminal khác:

```bash
cloudflared tunnel --url http://localhost:8080
```

3. Trong log có một khung chứa địa chỉ dạng `https://ten-ngau-nhien.trycloudflare.com`. Giữ cửa sổ này mở.

Lưu ý: kiểu "quick tunnel" này **đổi địa chỉ mỗi lần chạy**, nên mỗi lần chạy lại phải in lại mã QR. Muốn địa chỉ cố
định thì cần tài khoản Cloudflare và một tên miền riêng (named tunnel), không trình bày ở đây.

### 12.4. Dùng hệ thống qua tunnel

1. Trên máy chủ, mở trang Quản trị **bằng địa chỉ tunnel**: `https://<dia-chi-tunnel>/admin` (không dùng
   `localhost`). Kiểm tra ô **"Địa chỉ in trong QR"** đã là địa chỉ tunnel; nếu chưa, sửa ô đó.
2. Vào **Bàn & QR** để hiển thị / in mã QR (không cần mở bàn: phiên tự mở khi khách quét).
3. Dùng điện thoại **tắt Wi-Fi, bật 4G** quét QR: vào được trang gọi món là tunnel hoạt động.
4. Màn hình bếp và thu ngân có thể mở bằng `http://localhost:8080/kitchen`, `http://localhost:8080/cashier` ngay trên
   máy chủ, hoặc `https://<dia-chi-tunnel>/kitchen`, `https://<dia-chi-tunnel>/cashier` trên máy khác.
5. Kiểm tra WebSocket: đặt một món từ điện thoại, đơn phải hiện ngay ở bếp. Nếu badge trạng thái kết nối ở trang khách
   hoặc bếp không chuyển xanh, xem [Lỗi thường gặp](#16-lỗi-thường-gặp).

Trong lúc demo, để máy không ngủ: **Settings → System → Power & battery → Screen and sleep → When plugged in, put my
device to sleep after: Never**, và cắm sạc.

### 12.5. Bảo mật khi mở ra Internet

Khi tunnel đang mở, **bất kỳ ai biết địa chỉ** đều truy cập được hệ thống. Trước khi mở tunnel:

1. **Đổi khoá ký token đăng nhập.** Giá trị mặc định nằm công khai trong source code, ai có nó đều tự tạo được token
   đăng nhập admin. Trong IntelliJ, sửa ô **Environment variables** ở Bước 7.3 thành:

   ```text
   DB_PASSWORD=mat_khau_root_cua_ban;AUTH_SECRET=mot-chuoi-ngau-nhien-that-dai
   ```

   (chạy bằng terminal thì thêm dòng `$env:AUTH_SECRET = "mot-chuoi-ngau-nhien-that-dai"` trước `java -jar`).
2. Tài khoản mẫu `admin`/`admin123`, `bep`/`bep123`, `thungan`/`thungan123` được ghi công khai trong README. Hệ thống chưa có chức năng đổi
   mật khẩu, nên **chỉ mở tunnel trong lúc demo** và tắt ngay sau đó (`Ctrl + C` ở cửa sổ tunnel).
3. **Không chạy server bằng profile `h2`** khi mở tunnel. Profile này bật trang quản lý cơ sở dữ liệu `/h2-console`;
   request đi qua tunnel xuất phát từ chính máy chủ nên người ngoài cũng vào được trang này.
4. Không chia sẻ địa chỉ tunnel lên nơi công khai.

### 12.6. Rate limit khi đi qua tunnel

Server giới hạn request theo địa chỉ IP (60 request dồn, hồi 20 request/giây mỗi IP; riêng đặt món thì giới hạn 10
đơn/phút **mỗi bàn**). Qua tunnel, mọi request đều đến từ chương trình tunnel trên máy bạn, nên server thấy **tất cả
điện thoại có chung một IP** là `127.0.0.1`, và giới hạn theo IP bị áp chung cho tất cả.

* Demo với vài điện thoại: thường không chạm giới hạn, không cần làm gì.
* Nhiều người dùng cùng lúc và bị báo "thao tác quá nhanh" (429): vào Quản trị → **Cấu hình thực nghiệm** → tạm tắt
  **Rate limiting** trong lúc demo (thiết lập này mất khi khởi động lại server).
* Server có hỗ trợ đọc IP thật từ header `X-Forwarded-For` mà ngrok/Cloudflare gắn vào, nhưng tuỳ chọn này không hiện
  trên giao diện (client có thể tự gửi header này để giả IP); bộ đo thực nghiệm E6 tự bật nó khi chạy rồi tắt lại.

### 12.7. Thanh toán VNPay (sandbox) qua tunnel

`application.yml` đã có sẵn khoá VNPay sandbox của nhóm, nên VNPay hiện ngay mà không cần khai báo gì. Muốn dùng merchant
khác thì thêm hai biến môi trường vào ô **Environment variables** ở Bước 7.3 (chúng ghi đè giá trị mặc định):

```text
DB_PASSWORD=...;AUTH_SECRET=...;VNPAY_TMN_CODE=<ma-website>;VNPAY_HASH_SECRET=<chuoi-bi-mat>;APP_PUBLIC_URL=https://<ten-mien-ngrok>
```

* `APP_PUBLIC_URL` (không bắt buộc): địa chỉ tunnel, dùng để VNPay đưa khách quay về sau khi trả tiền. Bỏ trống thì
  server tự lấy theo địa chỉ khách đang mở trang (đúng khi khách mở bằng địa chỉ tunnel).
* Nên dùng **ngrok với tên miền cố định** (`ngrok http 8080 --url=<ten-mien>.ngrok-free.dev`), vì IPN URL khai báo với
  VNPay phải giữ nguyên: `https://<ten-mien>.ngrok-free.dev/api/payments/vnpay/ipn`.
* **Khai báo IPN URL trên trang Merchant Admin** (chỉ người giữ tài khoản sandbox làm, một lần):
  1. Mở https://sandbox.vnpayment.vn/merchantv2/, đăng nhập bằng email và mật khẩu trong email VNPay gửi khi đăng ký.
  2. Vào phần quản lý website / cấu hình merchant, chọn website có mã TMN của nhóm.
  3. Ở ô **IPN URL**, điền `https://<ten-mien>.ngrok-free.dev/api/payments/vnpay/ipn` → lưu.
  4. Kiểm tra: chạy server và ngrok, thanh toán thử, rồi mở Quản trị → **💳 Thanh toán**. Cột **Xác nhận bởi** là
     `vnpay-ipn` nghĩa là IPN đã về; còn `vnpay-return` nghĩa là IPN chưa tới (sai địa chỉ, ngrok tắt, hoặc VNPay chưa áp dụng cấu hình mới).

  Đổi tên miền ngrok thì phải vào sửa lại ô này.
* Cách thử: khách bấm **Thanh toán → VNPay** → trang VNPay → **Thẻ nội địa và tài khoản ngân hàng** → **NCB**, nhập
  thẻ test của VNPay sandbox: số thẻ `9704198526191432198`, tên `NGUYEN VAN A`, ngày phát hành `07/15`, OTP `123456` →
  VNPay đưa về trang gọi món, bàn hiện "Đã thanh toán đủ", thu ngân thấy bàn chuyển "Đã thanh toán".
* **Khoá sandbox dùng chung cả nhóm, nhưng IPN URL chỉ khai báo được một địa chỉ.** Máy nào có tên miền ngrok trùng với
  IPN URL đã khai báo thì nhận được IPN; các máy khác vẫn thanh toán được nhờ Return URL và tra cứu giao dịch bên dưới.
* Server xác nhận tiền bằng hai đường: **IPN** (server VNPay gọi thẳng server mình, có chữ ký) và **Return URL** (dữ
  liệu có chữ ký trên trình duyệt). Chưa khai báo được IPN với VNPay thì đường thứ hai vẫn đủ; ngoài ra server tự **tra
  cứu giao dịch** với VNPay trước khi cho một lần thanh toán hết hạn (15 phút).

### 12.8. Trợ lý gợi ý món (Gemini API, miễn phí)

Trang gọi món có nút **💬 Gợi ý món**: khách chat với trợ lý, trợ lý gợi ý món kèm nút **Thêm vào giỏ** (trợ lý không
tự đặt món). Không có khoá thì trợ lý vẫn chạy bằng **gợi ý dự phòng** (theo quy tắc, không dùng AI). Muốn dùng AI:

1. Vào https://aistudio.google.com, đăng nhập tài khoản Google → **Get API key** → **Create API key** (hạng miễn phí,
   không cần gói Gemini / ChatGPT trả phí; các gói đó không dùng được cho API).
2. Thêm vào ô **Environment variables** ở Bước 7.3: `GEMINI_API_KEY=<khoá vừa tạo>` (**không** ghi khoá vào file trong
   dự án). Tuỳ chọn: `GEMINI_MODEL=<tên model>` nếu muốn đổi model, mặc định `gemini-flash-lite-latest`.
3. Chạy lại server. Máy chủ phải có Internet để gọi Gemini.

* Hạng miễn phí giới hạn số request mỗi phút / mỗi ngày (xem trong AI Studio). Server tự giới hạn mỗi bàn 5 câu hỏi
  liên tiếp, hồi 6 câu mỗi phút; Gemini báo hết lượt (429) thì server tạm dùng gợi ý dự phòng trong thời gian Gemini yêu
  cầu chờ (mặc định 60 giây), khách vẫn nhận được gợi ý.
* Dữ liệu gửi cho Gemini gồm thực đơn, các món bàn đã gọi và tải bếp; không gửi tên khách hay mã thiết bị. Gói miễn phí
  có thể được Google dùng để cải thiện sản phẩm.

---

## 13. Chạy test

Luôn chạy test trên chính máy chủ, trỏ vào `localhost`, **không** chạy qua tunnel.

### 13.1. JUnit (không cần server đang chạy, không cần MySQL)

Trong IntelliJ: cửa sổ **Maven** (thanh bên phải) → `qrorder-server` → **Lifecycle** → nhấp đúp `test`. Hoặc chuột
phải thư mục `src/test/java` → **Run 'All Tests'**. Hoặc trong terminal:

```bash
cd C:\Projects\LTM\source\server
mvn test
```

Kết quả đúng: `Tests run: 29, Failures: 0, Errors: 0`. Test chạy bằng cơ sở dữ liệu H2 riêng, không đụng tới MySQL.

### 13.2. End-to-end (server phải đang chạy ở cổng 8080)

```bash
cd C:\Projects\LTM\source\loadtest
npm run e2e
```

Kết quả đúng: `KẾT QUẢ: 212 đạt, 0 lỗi` (cần Node.js và đã chạy `npm install` ở Bước 8.3). Nếu server chạy cổng khác:
`node e2e-test.js --base=http://localhost:8081`.

---

## 14. Chạy thực nghiệm E1–E6

Trong lúc đo:

* **Tắt tunnel** và đóng các tab trình duyệt của hệ thống, để không có request lạ làm sai số liệu.
* Bộ đo mặc định gọi `http://localhost:8080`. Không đổi sang địa chỉ tunnel: độ trễ và giới hạn của dịch vụ tunnel sẽ
  làm sai lệch kết quả, và lượng request rất lớn có thể vượt giới hạn của gói miễn phí.

```bash
cd C:\Projects\LTM\source\loadtest
node run-all.js
```

* Bản đầy đủ mất khoảng 15 phút; bản rút gọn để thử: `node run-all.js --quick`.
* Kết quả: `statics/results/REPORT.md` (bảng tổng hợp) và các file `.json`/`.csv` (số liệu thô).
* Chạy riêng một kịch bản, ví dụ: `node experiment.js e2 --mode=NAIVE_PUSH --orders=600`.
* **E7 – trợ lý gợi ý món** (chạy riêng, cần `GEMINI_API_KEY` ở Bước 12.8): `node assistant-eval.js`. Script dựng sẵn
  các kịch bản (bếp đang dồn món, món hết hàng, bàn đã gọi sẵn), hỏi 24 câu với hai cấu hình `live` (AI có ngữ cảnh thời
  gian thực) và `static` (AI chỉ biết thực đơn in sẵn), tự chấm các ràng buộc và ghi kết quả vào
  `statics/results/e7_assistant_*.json`. Mỗi câu cách nhau 7 giây để không vượt hạn mức miễn phí (khoảng 6 phút).
* Sau khi chạy, cấu hình server tự trở về mặc định. Nếu thực nghiệm bị dừng giữa chừng, chạy
  `node experiment.js cleanup`.

---

## 15. Xoá dữ liệu, làm lại từ đầu

| Trường hợp | Cách làm |
|---|---|
| Xoá toàn bộ dữ liệu | Trong MySQL Workbench chạy `DROP DATABASE qrorder;`, rồi chạy lại server: database, bảng và dữ liệu mẫu được tạo lại (mã QR các bàn cũng đổi, phải in lại) |
| Chỉ xoá đơn của thực nghiệm | `node experiment.js cleanup` trong `source/loadtest` |

---

## 16. Lỗi thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `'java' is not recognized...` / `'mvn' is not recognized...` / `'node' is not recognized...` | Chưa thêm vào PATH hoặc chưa mở terminal mới sau khi cài. Đóng mọi terminal và IntelliJ rồi mở lại; kiểm tra lại PATH ở Bước 2–4 |
| `mvn -v` hoặc build báo `release version 17 not supported` | Maven đang dùng JDK cũ. Đặt `JAVA_HOME` trỏ tới JDK 17 và đưa `%JAVA_HOME%\bin` lên đầu PATH |
| IntelliJ build báo `java: error: release version 5 not supported` | IntelliJ đặt mức ngôn ngữ của module về Java 5. Chọn SDK 17/21 (**File → Project Structure → Project**); **Modules → qrorder-server → Language level: 17**; **Settings → Build, Execution, Deployment → Compiler → Java Compiler**: bytecode version **17**; cửa sổ **Maven** → **Reload All Maven Projects**; rồi **Build → Rebuild Project** |
| PowerShell báo `npm.ps1 cannot be loaded because running scripts is disabled` | Chạy lệnh trong **cmd** thay vì PowerShell, hoặc gõ `npm.cmd install` thay cho `npm install` |
| `npm install` lỗi mạng/timeout | Kiểm tra Internet/proxy; thử lại `npm install`; mạng trường có thể chặn registry |
| Thư mục `java` màu xám, file `.java` có icon cốc cà phê màu cam, không có nút ▶ cạnh `main` | IntelliJ chưa nhận dự án Maven (thường do mở thư mục cha thay vì `source/server`): chuột phải `server/pom.xml` → **Add as Maven Project**, hoặc **File → Open…** đúng thư mục `source/server` (Bước 7.2) |
| IntelliJ gạch đỏ toàn bộ code Java | Chưa chọn JDK 17 (Bước 7.2) hoặc Maven chưa tải xong thư viện: cửa sổ **Maven** → nút **Reload All Maven Projects** |
| Server báo `Access denied for user 'root'@'localhost'` | Chưa khai báo hoặc sai `DB_PASSWORD` (Bước 7.3; chạy bằng terminal thì Bước 9.2) |
| Server báo `Communications link failure` | MySQL chưa chạy: mở `services.msc` → **MySQL80** → **Start** |
| `Port 8080 was already in use` | Đã có server khác đang chạy (lần chạy trước chưa tắt, hoặc vừa chạy trong IntelliJ vừa chạy bằng terminal). Tắt bớt một cái |
| Mở `http://localhost:8080` chỉ thấy trang lỗi, không có giao diện | Thư mục `static/` bị thiếu (chưa pull bản mới hoặc lỡ xoá). Chạy `git pull`, hoặc build lại giao diện (Bước 8.1) rồi chạy lại server |
| Mở địa chỉ tunnel báo lỗi 502 / "failed to complete tunnel connection" / "origin unreachable" | Server chưa chạy hoặc chạy cổng khác cổng tunnel trỏ tới. Kiểm tra `http://localhost:8080` trên máy chủ trước |
| Qua tunnel, trang mở được nhưng không cập nhật real-time (badge không xanh, đơn không tự hiện ở bếp) | WebSocket không đi qua được: kiểm tra dịch vụ tunnel có hỗ trợ WebSocket (ngrok và cloudflared đều có); đảm bảo tunnel trỏ tới **8080**, không phải 5173 |
| Điện thoại quét QR nhưng mở ra `localhost` | Trang Quản trị đang được mở bằng `localhost`. Mở lại bằng địa chỉ tunnel (Bước 12.4) hoặc sửa ô "Địa chỉ in trong QR", rồi in lại QR |
| Mã QR cũ không dùng được sau khi chạy lại tunnel | Địa chỉ quick tunnel của Cloudflare (hoặc ngrok không dùng tên miền cố định) đổi mỗi lần chạy. In lại QR, hoặc dùng tên miền cố định của ngrok |
| Trang cảnh báo của ngrok hiện ra trước trang gọi món | Bình thường với gói miễn phí: bấm **Visit Site** |
| Nhiều người cùng dùng qua tunnel bị báo "thao tác quá nhanh" (429) | Mọi request qua tunnel có chung IP: xem Bước 12.6 |
| Đặt món báo "thao tác quá nhanh" (429) khi test tay | Giới hạn 10 đơn/phút/bàn: chờ vài giây, hoặc tắt Rate limiting ở Quản trị → Cấu hình thực nghiệm |
| Trang khách không có lựa chọn **VNPay** | Ô Environment variables có `VNPAY_TMN_CODE=` hoặc `VNPAY_HASH_SECRET=` để trống: biến trống ghi đè khoá mặc định. Xoá hai biến đó đi |
| VNPay báo "Sai chữ ký" / "Website này chưa được phê duyệt" | Khoá VNPay sai hoặc bị gõ thừa dấu cách. Xoá biến `VNPAY_*` để dùng khoá mặc định trong `application.yml` |
| Trả tiền VNPay xong nhưng bàn vẫn "Chờ thanh toán" | Khách đóng trình duyệt trước khi VNPay đưa về và chưa khai báo IPN: chờ tối đa 15 phút để server tự tra cứu giao dịch, hoặc thu ngân mở bàn kiểm tra |
| Trang khách báo "Phiên đã kết thúc" | Thu ngân đã **Trả bàn**, hoặc phiên tự kết thúc (30 phút không gọi món). Quét lại QR để mở phiên mới |
| Admin bấm **Đóng bàn** bị báo bàn đang có khách | Đúng thiết kế: phải **Trả bàn** ở trang Thu ngân trước |
| ngrok báo `unknown flag: --url` hoặc `ERR_NGROK_121` | ngrok quá cũ: chạy `ngrok update` rồi chạy lại |
| Trang bếp báo "Lỗi kết nối" sau một thời gian | Phiên đăng nhập hết hạn (12 giờ), hoặc vừa đổi `AUTH_SECRET`: Đăng xuất rồi đăng nhập lại |
| Link trong log server dạng `localhost:5173/...` không mở được | Link đó dành cho `npm run dev`. Khi chạy server bình thường, đổi `5173` thành `8080` |

---

## Tóm tắt (khi máy đã cài đủ phần mềm và MySQL đang chạy)

1. `git clone -b feat/separate_visual https://github.com/LDCin/LTM.git`, mở `LTM/source/server` bằng IntelliJ, chọn JDK 17.
2. **Run → Edit Configurations → QrOrderApplication → Environment variables**:
   `DB_PASSWORD=mat_khau_root_cua_ban;AUTH_SECRET=mot-chuoi-ngau-nhien-that-dai`.
3. (Chỉ khi sửa code React) Terminal IntelliJ: `cd C:\Projects\LTM\source\client`, `npm install`, `npm run build`.
4. Bấm ▶ chạy `QrOrderApplication`, chờ `Started QrOrderApplication`.
5. Terminal khác: `ngrok http 8080` (hoặc `cloudflared tunnel --url http://localhost:8080`).
6. Mở `https://<dia-chi-tunnel>/admin` (`admin` / `admin123`) để in mã QR cho điện thoại; thu ngân ở `/cashier`
   (`thungan` / `thungan123`). VNPay sandbox dùng được ngay, không cần khai báo khoá.
