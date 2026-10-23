-- Schema dùng chung cho MySQL 8 và H2 (MODE=MySQL).
-- Thời gian lưu dạng epoch milliseconds (BIGINT) để tránh lệch múi giờ và tiện đo độ trễ.

CREATE TABLE IF NOT EXISTS staff (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    role          VARCHAR(20)  NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurant_table (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    code               VARCHAR(20) NOT NULL UNIQUE,
    qr_token           VARCHAR(64) NOT NULL UNIQUE,
    status             VARCHAR(10) NOT NULL,
    current_session_id BIGINT NULL
);

CREATE TABLE IF NOT EXISTS table_session (
    id        BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_id  BIGINT NOT NULL,
    opened_at BIGINT NOT NULL,
    closed_at BIGINT NULL,
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
    device_id  VARCHAR(64) NULL,           -- mã thiết bị (trình duyệt) đã đặt đơn: khách chỉ thấy đơn của máy mình
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
