package com.ltm.qrorder.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Nâng cấp schema cho database đã tạo từ phiên bản trước.
 * schema.sql chỉ dùng CREATE TABLE IF NOT EXISTS nên không tự thêm cột mới vào bảng đã có;
 * MySQL 8 lại không hỗ trợ "ADD COLUMN IF NOT EXISTS" -> kiểm tra cột rồi mới ALTER.
 * Chạy trước DataSeeder.
 */
@Component
@Order(0)
public class SchemaMigrator implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(SchemaMigrator.class);

    private final JdbcTemplate jdbc;

    public SchemaMigrator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(String... args) {
        if (!columnExists("orders", "device_id")) {
            log.info("Nâng cấp schema: thêm cột orders.device_id");
            jdbc.execute("ALTER TABLE orders ADD COLUMN device_id VARCHAR(64) NULL");
            jdbc.execute("CREATE INDEX idx_orders_session_device ON orders (session_id, device_id)");
        }
        if (!columnExists("orders", "guest_name")) {
            log.info("Nâng cấp schema: thêm cột orders.guest_name");
            jdbc.execute("ALTER TABLE orders ADD COLUMN guest_name VARCHAR(30) NULL");
        }
        if (!columnExists("table_session", "end_reason")) {
            log.info("Nâng cấp schema: phiên bàn tự động (end_reason, end_note, ended_by)");
            jdbc.execute("ALTER TABLE table_session ADD COLUMN end_reason VARCHAR(30) NULL");
            jdbc.execute("ALTER TABLE table_session ADD COLUMN end_note VARCHAR(200) NULL");
            jdbc.execute("ALTER TABLE table_session ADD COLUMN ended_by VARCHAR(50) NULL");
            // Trước đây CLOSED nghĩa là "chưa có phiên"; nay CLOSED nghĩa là "ngừng phục vụ".
            // Mọi bàn cũ đều đang phục vụ, phiên vẫn giữ nguyên trong current_session_id.
            jdbc.update("UPDATE restaurant_table SET status = 'OPEN'");
        }
    }

    private boolean columnExists(String table, String column) {
        try {
            jdbc.queryForList("SELECT " + column + " FROM " + table + " WHERE 1 = 0");
            return true;
        } catch (DataAccessException e) {
            return false;
        }
    }
}
