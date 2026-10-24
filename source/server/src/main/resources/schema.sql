-- Schema dùng chung cho MySQL 8 và H2 (MODE=MySQL).
-- Thời gian lưu dạng epoch milliseconds (BIGINT) để tránh lệch múi giờ và tiện đo độ trễ.

CREATE TABLE IF NOT EXISTS staff (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    role          VARCHAR(20)  NOT NULL
);

-- status: OPEN = đang phục vụ, CLOSED = ngừng phục vụ (admin bảo trì).
-- current_session_id: phiên của lượt khách đang ngồi; NULL = bàn trống.
CREATE TABLE IF NOT EXISTS restaurant_table (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    code               VARCHAR(20) NOT NULL UNIQUE,
    qr_token           VARCHAR(64) NOT NULL UNIQUE,
    status             VARCHAR(10) NOT NULL,
    current_session_id BIGINT NULL
);

-- Một phiên = một lượt khách, từ lúc khách đầu tiên vào bàn tới lúc "Trả bàn".
CREATE TABLE IF NOT EXISTS table_session (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_id   BIGINT NOT NULL,
    opened_at  BIGINT NOT NULL,
    closed_at  BIGINT NULL,
    end_reason VARCHAR(30)  NULL,   -- CHECKOUT, UNPAID_LEFT, COMPED, OTHER, AUTO_IDLE, AUTO_AFTER_PAID
    end_note   VARCHAR(200) NULL,
    ended_by   VARCHAR(50)  NULL,
    INDEX idx_session_table (table_id),
    FOREIGN KEY (table_id) REFERENCES restaurant_table (id)
);

CREATE TABLE IF NOT EXISTS category (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_item (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    category_id BIGINT       NOT NULL,
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(500) NULL,
    price       BIGINT       NOT NULL,
    image_url   VARCHAR(255) NULL,
    available   BOOLEAN      NOT NULL DEFAULT TRUE,
    stock       INT          NULL,          -- NULL = không giới hạn số lượng
    station     VARCHAR(20)  NOT NULL DEFAULT 'KITCHEN',
    INDEX idx_menu_category (category_id),
    FOREIGN KEY (category_id) REFERENCES category (id)
);

CREATE TABLE IF NOT EXISTS orders (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT      NOT NULL,
    table_id   BIGINT      NOT NULL,
    status     VARCHAR(20) NOT NULL,
    total      BIGINT      NOT NULL,
    created_at BIGINT      NOT NULL,
    updated_at BIGINT      NOT NULL,
    device_id  VARCHAR(64) NULL,           -- mã thiết bị đã đặt đơn: chỉ máy này được huỷ đơn (không bao giờ trả ra ngoài)
    guest_name VARCHAR(30) NULL,           -- tên khách tự nhập, hiện cho cả bàn và bếp
    INDEX idx_orders_session (session_id),
    INDEX idx_orders_session_device (session_id, device_id),
    INDEX idx_orders_status (status),
    INDEX idx_orders_created (created_at),
    FOREIGN KEY (session_id) REFERENCES table_session (id),
    FOREIGN KEY (table_id) REFERENCES restaurant_table (id)
);

CREATE TABLE IF NOT EXISTS order_item (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id     BIGINT       NOT NULL,
    menu_item_id BIGINT       NOT NULL,
    name         VARCHAR(100) NOT NULL,      -- snapshot tên món tại thời điểm đặt
    unit_price   BIGINT       NOT NULL,      -- snapshot giá tại thời điểm đặt
    quantity     INT          NOT NULL,
    note         VARCHAR(200) NULL,
    status       VARCHAR(20)  NOT NULL,
    version      INT          NOT NULL DEFAULT 0,   -- optimistic locking
    station      VARCHAR(20)  NOT NULL,
    updated_at   BIGINT       NOT NULL,
    INDEX idx_item_order (order_id),
    FOREIGN KEY (order_id) REFERENCES orders (id),
    FOREIGN KEY (menu_item_id) REFERENCES menu_item (id)
);

-- Event log (outbox): nguồn sự thật để replay khi màn hình bếp mất kết nối.
-- seq tăng dần toàn cục = số thứ tự của sự kiện trong giao thức.
CREATE TABLE IF NOT EXISTS order_event (
    seq        BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_id   VARCHAR(36) NOT NULL,
    order_id   BIGINT      NOT NULL,
    table_id   BIGINT      NOT NULL,
    type       VARCHAR(40) NOT NULL,
    payload    TEXT        NOT NULL,
    created_at BIGINT      NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders (id)
);

-- Chống đặt trùng: mỗi Idempotency-Key chỉ tạo được đúng 1 đơn.
CREATE TABLE IF NOT EXISTS idempotency_key (
    key_value    VARCHAR(64) PRIMARY KEY,
    request_hash CHAR(64)    NOT NULL,
    order_id     BIGINT      NULL,
    created_at   BIGINT      NOT NULL,
    INDEX idx_idem_created (created_at)
);

-- Thanh toán theo phiên bàn. Một phiên có thể có nhiều lần thanh toán (VD trả xong rồi gọi thêm),
-- nhưng tối đa MỘT lần đang chờ: pending_session_id = session_id khi PENDING, NULL ở trạng thái khác,
-- ràng buộc UNIQUE (cho phép nhiều NULL) để database tự chặn hai lần chờ song song.
CREATE TABLE IF NOT EXISTS payment (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id         BIGINT       NOT NULL,
    table_id           BIGINT       NOT NULL,
    amount             BIGINT       NOT NULL,
    method             VARCHAR(10)  NOT NULL,      -- CASH, VNPAY
    status             VARCHAR(12)  NOT NULL,      -- PENDING, PAID, FAILED, EXPIRED, CANCELLED
    version            INT          NOT NULL DEFAULT 0,
    txn_ref            VARCHAR(40)  NOT NULL UNIQUE,   -- mã giao dịch gửi cho VNPay (vnp_TxnRef)
    idempotency_key    VARCHAR(64)  NULL UNIQUE,
    pending_session_id BIGINT       NULL UNIQUE,
    provider_txn_no    VARCHAR(40)  NULL,          -- vnp_TransactionNo
    provider_create_date VARCHAR(14) NULL,         -- vnp_CreateDate (cần cho API tra cứu)
    needs_refund       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by_device  VARCHAR(64)  NULL,
    created_at         BIGINT       NOT NULL,
    expires_at         BIGINT       NOT NULL,
    paid_at            BIGINT       NULL,
    updated_at         BIGINT       NOT NULL,
    confirmed_by       VARCHAR(50)  NULL,
    INDEX idx_payment_session (session_id),
    INDEX idx_payment_status (status),
    FOREIGN KEY (session_id) REFERENCES table_session (id),
    FOREIGN KEY (table_id) REFERENCES restaurant_table (id)
);

-- Khách bấm "Gọi phục vụ": báo tới quầy lễ tân / thu ngân để điều phối nhân viên.
-- open_session_id = session_id khi lượt gọi còn mở, NULL khi đã xử lý -> mỗi phiên có tối đa một lượt gọi đang mở
-- (bấm lặp, nhiều điện thoại cùng bàn bấm cùng lúc đều gộp về một lượt).
CREATE TABLE IF NOT EXISTS service_call (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id      BIGINT       NOT NULL,
    table_id        BIGINT       NOT NULL,
    guest_name      VARCHAR(50)  NULL,
    open_session_id BIGINT       NULL UNIQUE,
    created_at      BIGINT       NOT NULL,
    handled_at      BIGINT       NULL,
    handled_by      VARCHAR(50)  NULL,
    INDEX idx_service_call_session (session_id),
    FOREIGN KEY (session_id) REFERENCES table_session (id),
    FOREIGN KEY (table_id) REFERENCES restaurant_table (id)
);
