package com.ltm.qrorder.admin;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Thống kê kinh doanh cho trang quản trị trong khoảng [from, to) (epoch ms).
 * Doanh thu = tiền đã thu thực tế (payment PAID theo paid_at); doanh số món = món không bị huỷ theo giờ đặt.
 * tzOffsetMs: lệch múi giờ của trình duyệt để gom theo ngày / giờ địa phương.
 */
@Service
public class ReportService {

    private static final long DAY = 86_400_000L;
    private static final String ITEMS = "FROM order_item i JOIN orders o ON o.id = i.order_id " +
            "WHERE o.created_at >= ? AND o.created_at < ? ";
    private static final String LINE_TOTAL = "FLOOR((i.unit_price * i.quantity * (100 + i.vat_rate) + 50) / 100)";

    private final JdbcTemplate jdbc;

    public ReportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> report(long from, long to, long tzOffsetMs) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("from", from);
        r.put("to", to);

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("revenue", num("SELECT COALESCE(SUM(amount), 0) FROM payment WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ?", from, to));
        summary.put("payments", num("SELECT COUNT(*) FROM payment WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ?", from, to));
        summary.put("orders", num("SELECT COUNT(*) FROM orders WHERE created_at >= ? AND created_at < ? AND status <> 'CANCELLED'", from, to));
        summary.put("sessions", num("SELECT COUNT(*) FROM table_session WHERE opened_at >= ? AND opened_at < ?", from, to));
        summary.put("itemsSold", num("SELECT COALESCE(SUM(i.quantity), 0) " + ITEMS + "AND i.status <> 'CANCELLED'", from, to));
        summary.put("itemsCancelled", num("SELECT COALESCE(SUM(i.quantity), 0) " + ITEMS + "AND i.status = 'CANCELLED'", from, to));
        summary.put("grossSales", num("SELECT COALESCE(SUM(i.unit_price * i.quantity), 0) " + ITEMS + "AND i.status <> 'CANCELLED'", from, to));
        summary.put("vat", num("SELECT COALESCE(SUM(" + LINE_TOTAL + " - i.unit_price * i.quantity), 0) " + ITEMS
                + "AND i.status <> 'CANCELLED'", from, to));
        summary.put("cancelledValue", num("SELECT COALESCE(SUM(i.unit_price * i.quantity), 0) " + ITEMS + "AND i.status = 'CANCELLED'", from, to));
        r.put("summary", summary);

        r.put("revenueByDay", jdbc.queryForList(
                "SELECT FLOOR((paid_at + ?) / " + DAY + ") AS day_index, SUM(amount) AS revenue, COUNT(*) AS payments " +
                        "FROM payment WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ? " +
                        "GROUP BY day_index ORDER BY day_index",
                tzOffsetMs, from, to).stream().map(this::lower).toList());
        r.put("ordersByHour", jdbc.queryForList(
                "SELECT FLOOR(MOD(created_at + ?, " + DAY + ") / 3600000) AS hour_of_day, COUNT(*) AS orders " +
                        "FROM orders WHERE created_at >= ? AND created_at < ? AND status <> 'CANCELLED' " +
                        "GROUP BY hour_of_day ORDER BY hour_of_day",
                tzOffsetMs, from, to).stream().map(this::lower).toList());
        r.put("topItems", jdbc.queryForList(
                "SELECT i.menu_item_id AS id, MAX(i.name) AS name, SUM(i.quantity) AS quantity, " +
                        "SUM(i.unit_price * i.quantity) AS sales, MAX(m.image_url) AS image_url " + ITEMS.replace(
                        "JOIN orders o ON o.id = i.order_id ", "JOIN orders o ON o.id = i.order_id LEFT JOIN menu_item m ON m.id = i.menu_item_id ") +
                        "AND i.status <> 'CANCELLED' GROUP BY i.menu_item_id ORDER BY quantity DESC, sales DESC LIMIT 10",
                from, to).stream().map(this::lower).toList());
        r.put("byCategory", jdbc.queryForList(
                "SELECT c.name AS name, SUM(i.quantity) AS quantity, SUM(i.unit_price * i.quantity) AS sales " +
                        ITEMS.replace("WHERE", "JOIN menu_item m ON m.id = i.menu_item_id JOIN category c ON c.id = m.category_id WHERE") +
                        "AND i.status <> 'CANCELLED' GROUP BY c.name ORDER BY sales DESC",
                from, to).stream().map(this::lower).toList());
        r.put("cancelReasons", jdbc.queryForList(
                "SELECT COALESCE(i.cancel_reason, 'CUSTOMER') AS reason, SUM(i.quantity) AS quantity " + ITEMS +
                        "AND i.status = 'CANCELLED' GROUP BY COALESCE(i.cancel_reason, 'CUSTOMER') ORDER BY quantity DESC",
                from, to).stream().map(this::lower).toList());
        r.put("byMethod", jdbc.queryForList(
                "SELECT method, SUM(amount) AS amount, COUNT(*) AS payments FROM payment " +
                        "WHERE status = 'PAID' AND paid_at >= ? AND paid_at < ? GROUP BY method",
                from, to).stream().map(this::lower).toList());
        return r;
    }

    private long num(String sql, Object... args) {
        Number n = jdbc.queryForObject(sql, Number.class, args);
        return n == null ? 0 : n.longValue();
    }

    /** H2 trả tên cột viết hoa, MySQL giữ nguyên: chuẩn hoá về chữ thường để client dùng chung. */
    private Map<String, Object> lower(Map<String, Object> row) {
        Map<String, Object> m = new LinkedHashMap<>();
        row.forEach((k, v) -> m.put(k.toLowerCase(), v instanceof Number n ? n.longValue() : v));
        return m;
    }
}
