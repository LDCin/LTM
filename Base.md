# Hiểu phần mạng của QR Order trong 15 phút

File này giải thích **từ con số 0**, không cần biết trước về mạng. Mỗi khái niệm đều có một ví dụ đời thường, rồi chỉ ra
nó nằm ở đâu trong dự án. Đọc theo thứ tự từ trên xuống.

---

## 1. Client và Server

* **Server (máy chủ)**: chương trình chạy liên tục, **chờ người khác gửi yêu cầu tới** rồi trả lời. Trong dự án, đó là
  chương trình Java Spring Boot bạn bấm ▶ trong IntelliJ.
* **Client (máy khách)**: chương trình **chủ động gửi yêu cầu** tới server. Trong dự án, đó là trang web mở trên điện
  thoại của khách, trên máy tính bảng ở bếp, trên máy tính ở quầy thu ngân và trên laptop của quản lý.

> Ví dụ đời thường: server giống **quầy lễ tân** của nhà hàng, ngồi cố định một chỗ. Khách, bếp, thu ngân, quản lý là
> những người **đi tới quầy** để hỏi hoặc báo việc.

Điểm quan trọng: **khách và bếp không nói chuyện trực tiếp với nhau.** Khách đưa đơn cho quầy (server), quầy chuyển
xuống bếp.

```text
  Điện thoại khách ──┐
  Màn hình bếp ──────┤
                     ├──▶  SERVER  ──▶  Cơ sở dữ liệu (MySQL)
  Máy thu ngân ──────┤       ▲
  Laptop quản lý ────┘       │
                       Cổng thanh toán VNPay (một server khác, mục 13)
```

---

## 2. Địa chỉ IP và cổng (port)

* **Địa chỉ IP**: địa chỉ của một máy trong mạng, ví dụ `192.168.1.10`. Giống **địa chỉ toà nhà**.
* **Cổng (port)**: một con số chỉ **chương trình nào** trong máy đó nhận dữ liệu. Giống **số phòng** trong toà nhà.
  * Server QR Order dùng cổng **8080**.
  * MySQL dùng cổng **3306**.

Vì vậy địa chỉ `http://localhost:8080/admin` nghĩa là: máy này (`localhost`), phòng số 8080, trang `/admin`.

---

## 3. TCP: đường ống chở dữ liệu

Trước khi gửi bất cứ thứ gì, client và server phải **nối một "đường ống"** với nhau. Đường ống đó là **kết nối TCP**.

* TCP bảo đảm dữ liệu đi qua ống **tới đủ và đúng thứ tự**. Gửi "A, B, C" thì bên kia nhận đúng "A, B, C".
* Nhưng nếu **ống bị đứt** (điện thoại mất sóng) thì phải nối ống mới, và những gì đang nằm trong ống cũ **bị mất**.
  Nhớ ý này, nó là lý do của mục 8.

Bạn không phải tự lập trình TCP; Java và trình duyệt làm sẵn. Mọi thứ phía dưới (HTTP, WebSocket) đều chạy bên trong
đường ống TCP.

---

## 4. HTTP và REST: kiểu "hỏi – đáp"

### 4.1. HTTP là gì

**HTTP** là cách trình duyệt và server nói chuyện theo kiểu **hỏi một câu, đáp một câu**:

1. Client gửi một **request** (yêu cầu).
2. Server trả về một **response** (trả lời).
3. Xong. Server **không tự nói gì thêm** nếu client không hỏi.

> Ví dụ đời thường: **gửi phiếu yêu cầu ở quầy** rồi đứng chờ nhận phiếu trả lời. Quầy không bao giờ tự đi tìm bạn.

### 4.2. REST là gì

**REST** chỉ là một **quy ước đặt tên** cho các request HTTP để ai đọc cũng hiểu. Mỗi request gồm:

| Thành phần | Ý nghĩa | Ví dụ trong dự án |
|---|---|---|
| **Method** (động từ) | Muốn làm gì: `GET` = lấy, `POST` = tạo mới, `PATCH` = sửa một phần | `POST` |
| **Đường dẫn (URL)** | Làm với cái gì | `/api/orders` (các đơn hàng) |
| **Header** | Thông tin kèm theo, ví dụ bạn là ai | `X-Table-Token: <mã QR của bàn>`, `X-Session-Id: <mã lượt khách>` |
| **Body** | Dữ liệu gửi đi, viết dạng **JSON** | `{"guestName":"Minh","items":[{"menuItemId":12,"quantity":2}]}` |

Server trả lời bằng một **mã trạng thái** (con số) và dữ liệu JSON:

| Mã | Nghĩa |
|---|---|
| `200` / `201` | Thành công / đã tạo mới |
| `400` | Bạn gửi sai dữ liệu |
| `401` | Bạn chưa đăng nhập hoặc mã QR sai |
| `409` | Xung đột, ví dụ người khác vừa sửa món này, hoặc bàn đang thanh toán nên chưa gọi thêm được |
| `422` | Món đã hết |
| `429` | Bạn gửi quá nhanh |

Ví dụ thật – khách đặt món:

```text
Điện thoại gửi:   POST /api/orders
                  {"items":[{"menuItemId":12,"quantity":2,"note":"ít cay"}]}

Server trả:       201 Created
                  {"id":17, "status":"NEW", "total":120000, ...}
```

### 4.3. "Tầng REST" trong dự án là gì

**Tầng REST** = phần code của server **nhận các request HTTP này và trả lời**. Trong code, đó là các lớp có chữ
`Controller`:

| File | Nhận những request nào |
|---|---|
| `order/OrderController.java` | Khách đặt món, xem đơn chung của bàn, huỷ đơn |
| `order/KitchenController.java` | Bếp lấy danh sách đơn, đổi trạng thái món |
| `PublicController.java` | Lấy thực đơn, đổi mã QR thành thông tin bàn, **vào bàn** (`POST .../join`) |
| `payment/PaymentController.java` | Khách xem hóa đơn, bấm thanh toán; VNPay gọi về (IPN, Return URL) |
| `payment/CashierController.java` | Thu ngân xem sơ đồ bàn, xác nhận đã nhận tiền, trả bàn |
| `auth/AuthController.java` | Nhân viên đăng nhập |
| `admin/AdminController.java` | Quản lý bàn, thực đơn, lịch sử thanh toán, xem giám sát |

Phía client, file `source/client/src/lib/api.js` là chỗ gửi các request này đi.

---

## 5. Vấn đề của HTTP: server không tự báo được

Khách vừa đặt món. Làm sao **màn hình bếp biết** có đơn mới?

Với HTTP, server không thể tự gọi bếp, vì server chỉ được **trả lời** khi có người hỏi. Có hai cách:

| Cách | Làm thế nào | Nhược điểm |
|---|---|---|
| **Hỏi liên tục (polling)** | Cứ 3 giây bếp hỏi một lần: "Có đơn mới không?" | Đơn có thể phải chờ tới 3 giây mới hiện; hỏi nhiều lần vô ích khi không có đơn |
| **Giữ một đường dây luôn mở (WebSocket)** | Bếp mở sẵn một kết nối; có đơn là server **tự đẩy xuống ngay** | Phải xử lý chuyện đường dây bị đứt (mục 8) |

Dự án dùng cách thứ hai.

---

## 6. WebSocket: đường dây điện thoại luôn mở

> Ví dụ đời thường: HTTP giống **gửi thư**, mỗi lá thư một câu hỏi. **WebSocket giống gọi điện thoại**: nhấc máy một lần,
> giữ máy, và **hai bên muốn nói lúc nào cũng được**.

Cách mở "cuộc gọi":

1. Trình duyệt gửi một request HTTP đặc biệt tới `/ws`, kèm lời đề nghị: "Mình chuyển sang WebSocket nhé"
   (header `Upgrade: websocket`).
2. Server đồng ý bằng mã `101 Switching Protocols`.
3. Từ lúc này, **cùng đường ống TCP đó** không còn chạy kiểu hỏi–đáp nữa: hai bên gửi tin nhắn qua lại tự do, và
   đường ống **được giữ mở** suốt thời gian trang web còn mở.

Vì WebSocket bắt đầu bằng một request HTTP, nó dùng **chung cổng 8080** với REST.

---

## 7. STOMP: quy ước nói chuyện trên đường dây

WebSocket chỉ cho bạn một đường dây để gửi chữ qua lại. Nó **không quy định** tin nhắn viết thế nào, gửi cho ai. Nếu
không có quy ước, server đẩy một tin "có đơn mới" thì gửi cho ai: bếp, hay mọi khách?

**STOMP** là một **quy ước** chạy trên WebSocket, giống **bộ đàm có nhiều kênh**:

* Mỗi kênh có một tên, gọi là **destination** (đích), ví dụ:
  * `/topic/kitchen`: kênh của bếp
  * `/topic/table.5`: kênh chung của bàn 5 (**mọi điện thoại** đang ngồi bàn 5 cùng nghe)
  * `/topic/cashier`: kênh của quầy thu ngân (bàn nào đang ăn, đang chờ thanh toán, đã thanh toán)
  * `/topic/menu`: kênh thông báo thực đơn thay đổi
* Client **đăng ký nghe** kênh nào thì gõ lệnh `SUBSCRIBE` kênh đó.
* Server **phát** một tin vào kênh, mọi client đang nghe kênh đó đều nhận được.

> Bếp bật bộ đàm kênh "bếp". Mọi điện thoại bàn 5 bật kênh "bàn 5". Thu ngân bật kênh "thu ngân". Khi một người ở bàn 5
> đặt món, server nói vào **cả ba kênh**: bếp nghe thấy đơn mới, **mọi điện thoại bàn 5** thấy đơn đó trong danh sách
> chung của bàn, thu ngân thấy tạm tính của bàn 5 tăng lên. Bàn 6 không nghe thấy gì.

Mỗi tin nhắn STOMP gọi là một **frame**, viết bằng chữ thường, rất dễ đọc:

```text
SUBSCRIBE                      ← lệnh: đăng ký nghe
destination:/topic/kitchen     ← nghe kênh nào

```

```text
MESSAGE                        ← lệnh: server gửi tin
destination:/topic/kitchen

{"type":"ORDER_CREATED","seq":42,"payload":{"id":17,"tableCode":"B05", ...}}
```

Các lệnh STOMP dùng trong dự án:

| Lệnh | Ai gửi | Nghĩa |
|---|---|---|
| `CONNECT` | Client | "Chào, tôi là bếp, đây là token của tôi" (bắt đầu nói chuyện) |
| `CONNECTED` | Server | "OK, đã nhận ra bạn" |
| `SUBSCRIBE` | Client | "Cho tôi nghe kênh này" |
| `MESSAGE` | Server | Một tin trên kênh đã đăng ký |
| `SEND` | Client | Client gửi tin lên server (bếp dùng để gửi ACK, RESUME) |
| `ERROR` | Server | "Bạn làm sai" (ví dụ khách đòi nghe kênh bếp hay kênh thu ngân) rồi ngắt |
| `DISCONNECT` | Client | "Tạm biệt" |

### "Tầng WebSocket/STOMP" trong dự án là gì

Là phần code **giữ các đường dây luôn mở với client và đẩy tin nhắn xuống**:

| File | Làm gì |
|---|---|
| `ws/WebSocketConfig.java` | Mở cửa `/ws`, bật "bộ đàm" (broker) với các kênh `/topic/...` |
| `ws/StompAuthInterceptor.java` | **Người gác cửa**: kiểm tra ai được kết nối, ai được nghe kênh nào |
| `ws/KitchenWsController.java` | Nhận ACK và RESUME từ bếp |
| `ws/SessionRegistry.java` | Danh sách các đường dây đang mở |
| `event/EventPublisher.java` | Nói tin vào kênh (đẩy sự kiện xuống client) |

Phía client, file `source/client/src/lib/stomp.js` là bộ đàm do nhóm **tự viết** (không dùng thư viện có sẵn).

---

## 8. Khi mạng chập chờn

### 8.1. Làm sao biết đường dây còn sống: heart-beat

Điện thoại mất sóng thường **không kịp báo** "tôi cúp máy". Hai bên vẫn tưởng đường dây còn.

Giải pháp: cứ **10 giây**, mỗi bên gửi một tín hiệu nhỏ, kiểu "alo, còn đó không" (gọi là **heart-beat**). Quá khoảng
**20 giây** không nghe thấy gì thì coi như đường dây đã đứt.

### 8.2. Gọi lại: backoff + jitter

Khi đường dây đứt, client **tự gọi lại**, nhưng chờ lâu dần: khoảng 1 giây, rồi 2, 4, 8… tối đa 30 giây, và mỗi lần
cộng thêm một chút **ngẫu nhiên**. Phần ngẫu nhiên giúp cả quán có Wi-Fi lại cùng lúc thì các điện thoại cũng không gọi
lại vào **đúng cùng một giây** làm server quá tải. (File `source/client/src/lib/connection.js`.)

### 8.3. Bếp mất mạng thì đơn có mất không: số thứ tự `seq`

Nhớ lại mục 3: ống TCP đứt thì tin đang ở trong ống bị mất. Giả sử bếp mất Wi-Fi 8 giây, trong lúc đó có 2 đơn mới:
server đã "nói vào bộ đàm" nhưng bếp không nghe được.

> Ví dụ đời thường: mỗi đơn được **đánh số thứ tự** như số phiếu ở ngân hàng: 41, 42, 43…
> Bếp nhớ "mình đã nhận tới phiếu 41". Có mạng lại, bếp nói với server: "**gửi lại cho tôi mọi phiếu sau số 41**".

Đó chính là cơ chế của dự án:

```text
Bếp                               Server
  │◀── đơn số 41 ──────────────────│
  │─── "đã nhận số 41" (ACK) ─────▶│
  │  ✕ mất Wi-Fi                    │  đơn số 42, 43 được phát ra → bếp không nghe được
  │  ... gọi lại ...                │
  │─── "gửi tôi mọi đơn sau số 41" (RESUME) ─▶│  server tra trong MySQL
  │◀── gửi bù đơn 42, 43 ──────────│
```

* **ACK** = bếp báo "tôi đã nhận tới số mấy".
* **RESUME** = bếp xin gửi lại phần bị lỡ.
* Server tìm được đơn bị lỡ vì **mọi sự kiện đều được lưu vào MySQL** (bảng `order_event`) kèm số thứ tự `seq`.
* Nếu một đơn tới hai lần (một lần bình thường, một lần do gửi bù), bếp thấy trùng số thì **bỏ qua**, nên không bị
  hiện hai lần.

(File phía bếp: `source/client/src/lib/kitchenFeed.js`.)

### 8.4. Khách mất mạng lúc đặt món thì có bị trùng đơn không: Idempotency-Key

Tình huống: khách bấm "Đặt món", đơn **đã tới server và được tạo**, nhưng câu trả lời của server bị mất trên đường về.
Khách không biết đơn đã gửi được chưa, nên bấm gửi lại. Nếu server tạo thêm một đơn nữa thì bếp làm hai lần.

> Ví dụ đời thường: mỗi lần đặt món, điện thoại ghi lên phiếu một **mã riêng** (gọi là `Idempotency-Key`). Gửi lại bao
> nhiêu lần cũng **dùng đúng mã đó**. Quầy thấy mã đã gặp rồi thì nói "đơn này tôi nhận rồi" và **không tạo đơn mới**.

---

## 9. Cơ sở dữ liệu (MySQL)

Server không tự nhớ dữ liệu lâu dài; nó cất vào **MySQL**: bàn, các lượt khách (phiên bàn), thực đơn, đơn hàng, các
món trong đơn, danh sách sự kiện có số thứ tự, các mã `Idempotency-Key` đã dùng, các lần thanh toán. Server nói chuyện với MySQL cũng qua một đường ống TCP (cổng
3306). Phần này dùng JDBC, bạn chỉ cần biết nó là "cách Java gửi câu lệnh SQL tới MySQL".

---

## 10. Tunnel: đưa server ra Internet

Server chạy trên laptop của bạn ở `localhost:8080`, nên chỉ máy bạn mới vào được. Điện thoại dùng 4G không thể vào
`localhost` của laptop.

**Tunnel** (cloudflared / ngrok) là một chương trình chạy trên laptop, **nối ra một máy chủ trung gian trên Internet**
và nhận về một địa chỉ công khai, ví dụ `https://abc.trycloudflare.com`. Ai mở địa chỉ đó thì yêu cầu được chuyển về
`localhost:8080` trên laptop.

```text
Điện thoại 4G ──▶ https://abc.trycloudflare.com ──▶ (máy chủ Cloudflare) ──▶ cloudflared trên laptop ──▶ localhost:8080
```

REST và WebSocket đều đi qua đường này. Khi dùng VNPay, **server của VNPay cũng gọi về server mình qua đúng đường này**
(mục 13), nên địa chỉ tunnel phải cố định (ngrok có tên miền cố định).

---

## 11. Ghép lại: hành trình của một đơn hàng

1. Khách quét QR → điện thoại mở trang web → gửi **REST** `POST .../join` để **vào bàn** (mục 12), nhập tên, rồi `GET`
   lấy thực đơn.
2. Điện thoại mở **WebSocket**, gửi STOMP `CONNECT` rồi `SUBSCRIBE` kênh `/topic/table.5` của bàn mình.
3. Khách bấm "Đặt món" → **REST** `POST /api/orders` kèm `Idempotency-Key` và tên khách.
4. Server lưu đơn vào **MySQL**, gán số thứ tự (ví dụ 42), rồi trả lời điện thoại `201 Created`.
5. Server đẩy sự kiện "có đơn mới số 42" qua **STOMP** vào kênh `/topic/kitchen` và kênh `/topic/table.5` (mọi điện
   thoại của bàn), đồng thời báo kênh `/topic/cashier`.
6. Màn hình bếp (đang nghe `/topic/kitchen`) hiện đơn ngay, gửi **ACK** "đã nhận 42".
7. Đầu bếp bấm "Nhận" → **REST** `PATCH` đổi trạng thái món.
8. Server lưu, rồi đẩy sự kiện "món đã được nhận" qua **STOMP** → điện thoại khách cập nhật ngay.
9. Ăn xong, khách bấm "Thanh toán" → trả tiền mặt hoặc VNPay (mục 13) → thu ngân bấm **Trả bàn** → mọi điện thoại của
   bàn hiện "Cảm ơn quý khách".

Tóm lại:

| | REST | WebSocket / STOMP |
|---|---|---|
| Giống | Gửi phiếu, chờ phiếu trả lời | Bộ đàm luôn mở, nhiều kênh |
| Ai bắt đầu | Luôn là client | Server tự nói khi có chuyện |
| Dùng để | **Ra lệnh**: vào bàn, đặt món, huỷ, đổi trạng thái, thanh toán, trả bàn, đăng nhập | **Báo tin**: có đơn mới, món đã xong, đã thanh toán, bàn đã trả, thực đơn đổi |
| Code server | Các lớp `...Controller.java` | Thư mục `ws/` và `event/` |
| Code client | `lib/api.js` | `lib/stomp.js`, `lib/connection.js`, `lib/kitchenFeed.js` |

---

## 12. Phiên bàn: nhiều điện thoại chung một bàn

**Phiên bàn** (lượt khách) = một nhóm khách ngồi vào bàn cho tới khi trả bàn và ra về.

* **Tự mở**: khách đầu tiên quét QR thì điện thoại gửi `POST /api/public/tables/{mã QR}/join`. Bàn đang trống → server
  mở phiên mới; bàn đã có người → vào phiên đang có. Nhân viên không phải bấm gì. Dùng `POST` chứ không `GET` vì
  request này có thể **tạo** ra phiên mới.
* **Hai máy quét cùng lúc vẫn chỉ một phiên**: server chạy câu lệnh "gắn phiên mới cho bàn **chỉ khi bàn chưa có
  phiên**" (`... WHERE current_session_id IS NULL`). MySQL chỉ cho một máy làm được; máy kia thấy bàn đã có phiên thì
  vào phiên đó.

> Ví dụ đời thường: bàn trống có một tấm biển "Còn trống". Hai người cùng chạy tới lật biển thành "Có khách"; chỉ người
> lật trước thành công, người sau thấy biển đã lật thì ngồi chung.

* **Đơn chung**: mọi điện thoại trong cùng phiên thấy **tất cả đơn** của bàn, mỗi đơn ghi tên người đặt (khách nhập tên
  khi vào, có thể bỏ qua). Đơn của chính máy mình có nhãn **BẠN ĐẶT**.
* **Mã thiết bị** (`X-Device-Id`): trình duyệt tự sinh một mã ngẫu nhiên. Server chỉ dùng nó để biết **máy nào được huỷ
  đơn nào** (chỉ máy đã đặt mới huỷ được); mã này không bao giờ được gửi cho máy khác.
* **Mã phiên** (`X-Session-Id`): điện thoại gửi kèm mỗi request. Sau khi trả bàn, điện thoại của lượt cũ gửi mã phiên
  cũ thì bị từ chối (`409`), nên không đặt nhầm vào lượt của khách sau.
* **Kết thúc phiên**: thu ngân bấm **Trả bàn** ở trang `/cashier`. Server báo `TABLE_SESSION_ENDED` vào kênh bàn → mọi
  điện thoại hiện "Cảm ơn quý khách". Phiên cũng tự kết thúc nếu mở 30 phút mà không gọi món, hoặc 30 phút sau khi đã
  trả đủ tiền.
* **Đóng bàn / Mở bàn** ở trang Quản trị là chuyện khác: **ngừng phục vụ / phục vụ lại** (ví dụ bàn hỏng). Bàn đang có
  khách thì không đóng được.

---

## 13. Thanh toán: tiền mặt và VNPay

Thanh toán theo **cả bàn**. Số tiền **luôn do server tự tính** từ MySQL (tổng các món không bị huỷ trừ phần đã trả),
không tin con số điện thoại gửi lên.

* Khách bấm **Thanh toán** → server tạo một "lần thanh toán đang chờ", hết hạn sau 15 phút. Trong lúc chờ, bàn không
  gọi thêm món được (muốn gọi thêm thì huỷ thanh toán).
* **Mỗi bàn chỉ có một lần đang chờ**: hai người cùng bàn bấm "Thanh toán" cùng lúc thì MySQL chỉ cho tạo một lần
  (ràng buộc `UNIQUE`); người sau nhận lại đúng lần đó kèm thông báo "Bạn cùng bàn đang thanh toán".
* Server báo tin `PAYMENT_UPDATED` vào **kênh bàn** (điện thoại khách) và **kênh thu ngân** (`/topic/cashier`).

### 13.1. Tiền mặt

Khách ra quầy trả tiền → thu ngân bấm **Đã nhận tiền**. Hai thu ngân cùng bấm thì chỉ một người thành công, người kia
nhận `409` (cùng kiểu khoá lạc quan `version` như món ăn ở bếp).

### 13.2. VNPay (môi trường thử – sandbox)

VNPay là **một server khác** (của cổng thanh toán). Có ba "đường" thông tin:

```text
Điện thoại khách           Server của mình                       Server VNPay
  │ Thanh toán VNPay ───────▶│ tạo link thanh toán có CHỮ KÝ          │
  │◀── link ─────────────────│                                        │
  │── mở trang VNPay, nhập thẻ test ─────────────────────────────────▶│
  │                          │◀── (1) IPN: "giao dịch X thành công" ──│  server gọi server
  │                          │    kiểm chữ ký + số tiền → ghi ĐÃ TRẢ  │
  │                          │──── "00: đã nhận" ────────────────────▶│
  │◀── (2) VNPay chuyển trình duyệt về Return URL (cũng có chữ ký) ───│
  │─────────────────────────▶│ kiểm chữ ký → đưa về trang gọi món      │
  │◀═ "Bàn đã thanh toán đủ" (WebSocket) ═│                            │
  │                          │── (3) quá hạn mà chưa có tin: hỏi lại ─▶│  tra cứu querydr
```

* **IPN** (Instant Payment Notification) là **server VNPay gọi thẳng server mình**, không đi qua điện thoại khách. Nhờ
  vậy khách lỡ tắt trình duyệt giữa chừng thì tiền vẫn được ghi nhận.
* **Chữ ký (HMAC-SHA512)**: VNPay và server mình cùng biết một **khoá bí mật**. Dữ liệu gửi qua lại kèm một "chữ ký"
  tính từ dữ liệu và khoá đó. Server tự tính lại chữ ký; khớp thì tin, không khớp thì từ chối (mã `97`). Ai sửa số tiền
  trên đường đi mà không có khoá thì chữ ký sai ngay.

> Ví dụ đời thường: giống **con dấu giáp lai** trên giấy tờ. Chỉ người có con dấu thật mới đóng được; sửa nội dung thì
> dấu không còn khớp.

* **Gọi lặp không sao (idempotent)**: VNPay có thể gửi IPN nhiều lần. Lần đầu server ghi "đã trả" (`00`); các lần sau
  server thấy đã ghi rồi thì trả `02` ("đã xử lý"), **không cộng tiền hai lần**.
* **Return URL** là trang mà VNPay chuyển trình duyệt khách về sau khi trả. Dữ liệu trên đó cũng có chữ ký, nên dùng
  được làm đường dự phòng khi IPN bị lạc.
* **Tra cứu (querydr)**: nếu sau 15 phút vẫn chưa có tin, server tự **hỏi lại VNPay** trước khi cho lần thanh toán hết hạn.
* Mã cửa hàng và khoá bí mật chỉ đặt bằng **biến môi trường** (`VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`), không ghi vào
  code. Thiếu thì trang khách ẩn nút VNPay, chỉ còn tiền mặt.

(File: `payment/PaymentService.java`, `payment/VnpayGateway.java`, `payment/CashierService.java`; trang thu ngân
`source/client/src/pages/Cashier.jsx`.)

---

## 14. Bảng thuật ngữ

| Thuật ngữ | Giải thích một câu |
|---|---|
| Client | Chương trình gửi yêu cầu (trang web trên điện thoại, máy bếp) |
| Server | Chương trình chờ và trả lời yêu cầu (Spring Boot) |
| IP | Địa chỉ của một máy trong mạng |
| Port (cổng) | Số chỉ chương trình nào trong máy nhận dữ liệu (8080, 3306) |
| TCP | Đường ống chở dữ liệu đủ và đúng thứ tự, nhưng đứt là mất phần đang chở |
| HTTP | Nói chuyện kiểu hỏi một câu, đáp một câu |
| REST | Quy ước đặt tên request HTTP: method + đường dẫn + JSON |
| JSON | Cách viết dữ liệu dạng `{"tên": giá trị}` |
| Request / Response | Câu hỏi / câu trả lời trong HTTP |
| Mã trạng thái | Con số trong câu trả lời: 200 thành công, 400 sai dữ liệu, 409 xung đột... |
| WebSocket | Đường dây luôn mở, hai bên nói lúc nào cũng được |
| STOMP | Quy ước nói chuyện trên WebSocket, có các "kênh" để đăng ký nghe |
| Destination / topic | Tên kênh, ví dụ `/topic/kitchen` |
| Subscribe | Đăng ký nghe một kênh |
| Frame | Một tin nhắn STOMP |
| Broker | Phần của server chuyển tin từ kênh tới những ai đang nghe |
| Heart-beat | Tín hiệu "còn sống" gửi định kỳ |
| Backoff + jitter | Gọi lại chờ lâu dần và lệch ngẫu nhiên |
| seq | Số thứ tự của sự kiện, dùng để biết mình bị lỡ cái nào |
| ACK | "Tôi đã nhận tới số này" |
| RESUME | "Gửi lại cho tôi những gì sau số này" |
| Idempotency-Key | Mã riêng của một lần đặt món, gửi lại không bị trùng |
| Token | "Thẻ ra vào" chứng minh bạn đã đăng nhập |
| Tunnel | Chương trình đưa server trên laptop ra một địa chỉ công khai trên Internet |
| Phiên bàn | Một lượt khách ngồi bàn, tự mở khi quét QR, kết thúc khi thu ngân bấm "Trả bàn" |
| Đơn chung | Mọi điện thoại cùng phiên thấy tất cả đơn của bàn, ghi tên người đặt |
| `/topic/cashier` | Kênh STOMP của quầy thu ngân (chỉ thu ngân và quản trị được nghe) |
| IPN | Server cổng thanh toán gọi thẳng server mình để báo kết quả giao dịch |
| Return URL | Trang mà cổng thanh toán đưa trình duyệt khách quay về sau khi trả tiền |
| HMAC-SHA512 / chữ ký | "Con dấu" tính từ dữ liệu + khoá bí mật; sửa dữ liệu là chữ ký không khớp |
| querydr | API tra cứu của VNPay: server hỏi lại trạng thái thật của một giao dịch |

Muốn đọc sâu hơn (thread, định dạng lỗi đầy đủ, chi tiết VNPay, câu hỏi bảo vệ): xem [`NETWORK.md`](NETWORK.md).
