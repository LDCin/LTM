-- Dữ liệu mẫu (MySQL 8 / H2 MODE=MySQL), khớp với dữ liệu server tự tạo khi database trống (DataSeeder).
-- Chạy SAU schema.sql trên database trống. Tài khoản nhân viên (admin, bep, thungan) do server tự tạo
-- khi khởi động vì mật khẩu được băm bằng thuật toán của ứng dụng.

INSERT INTO category (id, name, sort_order) VALUES
    (1, 'Món chính', 1),
    (2, 'Khai vị', 2),
    (3, 'Đồ uống', 3),
    (4, 'Tráng miệng', 4);

INSERT INTO menu_item (category_id, name, description, price, image_url, available, stock, station, vat_rate) VALUES
    (1, 'Phở bò tái', 'Bánh phở, bò tái, nước dùng hầm xương 12 tiếng', 55000, '/images/menu/01.jpg', TRUE, NULL, 'KITCHEN', 8),
    (1, 'Bún chả Hà Nội', 'Chả nướng than hoa, bún, rau sống', 50000, '/images/menu/02.jpg', TRUE, NULL, 'KITCHEN', 8),
    (1, 'Cơm tấm sườn bì chả', 'Sườn nướng, bì, chả trứng, nước mắm', 55000, '/images/menu/03.jpg', TRUE, NULL, 'KITCHEN', 8),
    (1, 'Bò lúc lắc', 'Thăn bò Úc xào bơ tỏi (số lượng có hạn)', 120000, '/images/menu/04.jpg', TRUE, 10, 'KITCHEN', 8),
    (1, 'Gà nướng mật ong', 'Nửa con gà ta nướng mật ong', 95000, '/images/menu/05.jpg', TRUE, NULL, 'KITCHEN', 8),
    (1, 'Mì xào hải sản', 'Tôm, mực, rau cải', 70000, '/images/menu/06.jpg', TRUE, NULL, 'KITCHEN', 8),
    (2, 'Gỏi cuốn tôm thịt', '2 cuốn, kèm tương đậu', 35000, '/images/menu/07.jpg', TRUE, NULL, 'KITCHEN', 8),
    (2, 'Chả giò', '5 cuốn chả giò giòn', 40000, '/images/menu/08.jpg', TRUE, NULL, 'KITCHEN', 8),
    (2, 'Đậu hũ chiên sả', 'Đậu hũ non chiên sả ớt', 35000, '/images/menu/09.jpg', TRUE, NULL, 'KITCHEN', 8),
    (3, 'Trà đá', NULL, 5000, '/images/menu/10.jpg', TRUE, NULL, 'BAR', 8),
    (3, 'Cà phê sữa đá', NULL, 25000, '/images/menu/11.jpg', TRUE, NULL, 'BAR', 8),
    (3, 'Nước cam ép', NULL, 35000, '/images/menu/12.jpg', TRUE, NULL, 'BAR', 8),
    (3, 'Sinh tố bơ', NULL, 40000, '/images/menu/13.jpg', TRUE, NULL, 'BAR', 8),
    (3, 'Bia Hà Nội', 'Chai 450ml', 20000, '/images/menu/14.jpg', TRUE, NULL, 'BAR', 8),
    (4, 'Chè khúc bạch', 'Số lượng có hạn', 30000, '/images/menu/15.jpg', TRUE, 15, 'KITCHEN', 8),
    (4, 'Bánh flan', NULL, 20000, '/images/menu/16.jpg', TRUE, NULL, 'KITCHEN', 8);

-- 12 bàn đang phục vụ, chưa có khách. qr_token là mã in trên QR (đổi được ở trang Quản lý).
INSERT INTO restaurant_table (code, qr_token, status, current_session_id) VALUES
    ('B01', 'sample-token-b01', 'OPEN', NULL), ('B02', 'sample-token-b02', 'OPEN', NULL),
    ('B03', 'sample-token-b03', 'OPEN', NULL), ('B04', 'sample-token-b04', 'OPEN', NULL),
    ('B05', 'sample-token-b05', 'OPEN', NULL), ('B06', 'sample-token-b06', 'OPEN', NULL),
    ('B07', 'sample-token-b07', 'OPEN', NULL), ('B08', 'sample-token-b08', 'OPEN', NULL),
    ('B09', 'sample-token-b09', 'OPEN', NULL), ('B10', 'sample-token-b10', 'OPEN', NULL),
    ('B11', 'sample-token-b11', 'OPEN', NULL), ('B12', 'sample-token-b12', 'OPEN', NULL);
