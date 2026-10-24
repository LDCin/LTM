package com.ltm.qrorder.config;

import com.ltm.qrorder.auth.AuthService;
import com.ltm.qrorder.common.Jdbc;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Dữ liệu mẫu (chỉ chạy khi DB còn trống): tài khoản nhân viên, thực đơn, 12 bàn đang phục vụ (chưa có khách).
 * Database đã có từ phiên bản trước mà chưa có tài khoản thu ngân thì tạo thêm tài khoản thu ngân.
 * Mỗi lần khởi động đều in link gọi món của từng bàn để tiện demo.
 */
@Component
@Order(1)
public class DataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final TableService tables;

    public DataSeeder(JdbcTemplate jdbc, AuthService auth, TableService tables) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.tables = tables;
    }

    @Override
    @Transactional
    public void run(String... args) {
        Integer staffCount = jdbc.queryForObject("SELECT COUNT(*) FROM staff", Integer.class);
        if (staffCount != null && staffCount == 0) {
            seed();
        }
        Integer cashiers = jdbc.queryForObject("SELECT COUNT(*) FROM staff WHERE role = 'CASHIER'", Integer.class);
        if (cashiers != null && cashiers == 0) {
            jdbc.update("INSERT INTO staff (username, password_hash, role) VALUES (?, ?, 'CASHIER')",
                    "thungan", auth.hashPassword("thungan123"));
            log.info("Đã tạo tài khoản thu ngân thungan/thungan123");
        }
        log.info("=== Link gọi món (mở qua Vite dev server cổng 5173) ===");
        for (TableInfo t : tables.list()) {
            if (t.code().startsWith("B")) {
                log.info("Bàn {} [{}]: http://localhost:5173/t/{}", t.code(), t.status(), t.qrToken());
            }
        }
        log.info("Bếp: /kitchen (bep/bep123) | Thu ngân: /cashier (thungan/thungan123) | Quản trị: /admin (admin/admin123)");
    }

    private void seed() {
        log.info("CSDL trống -> tạo dữ liệu mẫu");
        jdbc.update("INSERT INTO staff (username, password_hash, role) VALUES (?, ?, 'ADMIN')", "admin", auth.hashPassword("admin123"));
        jdbc.update("INSERT INTO staff (username, password_hash, role) VALUES (?, ?, 'KITCHEN')", "bep", auth.hashPassword("bep123"));

        long main = category("Món chính", 1);
        long starter = category("Khai vị", 2);
        long drink = category("Đồ uống", 3);
        long dessert = category("Tráng miệng", 4);

        item(main, "Phở bò tái", "Bánh phở, bò tái, nước dùng hầm xương 12 tiếng", 55000, null, "KITCHEN");
        item(main, "Bún chả Hà Nội", "Chả nướng than hoa, bún, rau sống", 50000, null, "KITCHEN");
        item(main, "Cơm tấm sườn bì chả", "Sườn nướng, bì, chả trứng, nước mắm", 55000, null, "KITCHEN");
        item(main, "Bò lúc lắc", "Thăn bò Úc xào bơ tỏi (số lượng có hạn)", 120000, 10, "KITCHEN");
        item(main, "Gà nướng mật ong", "Nửa con gà ta nướng mật ong", 95000, null, "KITCHEN");
        item(main, "Mì xào hải sản", "Tôm, mực, rau cải", 70000, null, "KITCHEN");
        item(starter, "Gỏi cuốn tôm thịt", "2 cuốn, kèm tương đậu", 35000, null, "KITCHEN");
        item(starter, "Chả giò", "5 cuốn chả giò giòn", 40000, null, "KITCHEN");
        item(starter, "Đậu hũ chiên sả", "Đậu hũ non chiên sả ớt", 35000, null, "KITCHEN");
        item(drink, "Trà đá", null, 5000, null, "BAR");
        item(drink, "Cà phê sữa đá", null, 25000, null, "BAR");
        item(drink, "Nước cam ép", null, 35000, null, "BAR");
        item(drink, "Sinh tố bơ", null, 40000, null, "BAR");
        item(drink, "Bia Hà Nội", "Chai 450ml", 20000, null, "BAR");
        item(dessert, "Chè khúc bạch", "Số lượng có hạn", 30000, 15, "KITCHEN");
        item(dessert, "Bánh flan", null, 20000, null, "KITCHEN");

        for (int i = 1; i <= 12; i++) {
            tables.create(String.format("B%02d", i));   // phiên tự mở khi khách đầu tiên quét QR
        }
    }

    private long category(String name, int sortOrder) {
        return Jdbc.insert(jdbc, "INSERT INTO category (name, sort_order) VALUES (?, ?)", "id", name, sortOrder);
    }

    private void item(long categoryId, String name, String description, long price, Integer stock, String station) {
        jdbc.update("INSERT INTO menu_item (category_id, name, description, price, available, stock, station) " +
                "VALUES (?, ?, ?, ?, TRUE, ?, ?)", categoryId, name, description, price, stock, station);
    }
}
