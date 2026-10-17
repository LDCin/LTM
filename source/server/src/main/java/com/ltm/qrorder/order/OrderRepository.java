package com.ltm.qrorder.order;

import com.ltm.qrorder.common.Jdbc;
import com.ltm.qrorder.menu.MenuDtos.MenuItemDto;
import com.ltm.qrorder.order.OrderDtos.OrderDto;
import com.ltm.qrorder.order.OrderDtos.OrderItemDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class OrderRepository {

    private static final String ITEM_COLUMNS =
            "i.id, i.order_id, i.menu_item_id, i.name, i.unit_price, i.quantity, i.note, i.status, i.version, i.station, i.updated_at";
    private static final RowMapper<OrderItemDto> ITEM_MAPPER = (rs, n) -> new OrderItemDto(
            rs.getLong("id"), rs.getLong("order_id"), rs.getLong("menu_item_id"), rs.getString("name"),
            rs.getLong("unit_price"), rs.getInt("quantity"), rs.getString("note"), rs.getString("status"),
            rs.getInt("version"), rs.getString("station"), rs.getLong("updated_at"));

    private record OrderRow(long id, long tableId, String tableCode, long sessionId, String status, long total,
                            long createdAt) {
    }

    /** Một món kèm thông tin đơn/bàn chứa nó. */
    public record ItemRow(OrderItemDto item, long tableId, String tableCode) {
    }

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;

    public OrderRepository(JdbcTemplate jdbc, NamedParameterJdbcTemplate named) {
        this.jdbc = jdbc;
        this.named = named;
    }

    public long insertOrder(long sessionId, long tableId, long total, long now) {
        return Jdbc.insert(jdbc,
                "INSERT INTO orders (session_id, table_id, status, total, created_at, updated_at) VALUES (?, ?, 'NEW', ?, ?, ?)",
                "id", sessionId, tableId, total, now, now);
    }

    public long insertItem(long orderId, MenuItemDto menuItem, int quantity, String note, long now) {
        return Jdbc.insert(jdbc,
                "INSERT INTO order_item (order_id, menu_item_id, name, unit_price, quantity, note, status, version, station, updated_at) " +
                        "VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)",
                "id", orderId, menuItem.id(), menuItem.name(), menuItem.price(), quantity, note, menuItem.station(), now);
    }

    /** Giới hạn số đơn trả về để một response không phình vô hạn (bảo vệ server, mạng và client). */
    public static final int MAX_ACTIVE_ORDERS = 500;
    public static final int MAX_SESSION_ORDERS = 100;
    private static final int IN_CHUNK = 500;

    public Optional<OrderDto> findOrder(long id) {
        return loadWithItems("WHERE o.id = ?", id).stream().findFirst();
    }

    /** 100 đơn gần nhất của phiên bàn. */
    public List<OrderDto> findBySession(long sessionId) {
        return loadWithItems("WHERE o.session_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT " + MAX_SESSION_ORDERS,
                sessionId);
    }

    /** Các đơn đang làm, cũ nhất trước (bếp ưu tiên đơn chờ lâu), tối đa 500 đơn. */
    public List<OrderDto> findActive() {
        return loadWithItems("WHERE o.status IN ('NEW', 'IN_PROGRESS') ORDER BY o.created_at, o.id LIMIT " + MAX_ACTIVE_ORDERS);
    }

    /**
     * Đọc đơn rồi đọc các món theo lô (tránh N+1 query, đồng thời không tạo câu IN quá nhiều tham số).
     * Kết quả luôn sắp xếp theo thời gian tạo tăng dần.
     */
    private List<OrderDto> loadWithItems(String whereOrderLimit, Object... args) {
        List<OrderRow> orders = new ArrayList<>(jdbc.query(
                "SELECT o.id, o.table_id, t.code AS table_code, o.session_id, o.status, o.total, o.created_at " +
                        "FROM orders o JOIN restaurant_table t ON t.id = o.table_id " + whereOrderLimit,
                (rs, n) -> new OrderRow(rs.getLong("id"), rs.getLong("table_id"), rs.getString("table_code"),
                        rs.getLong("session_id"), rs.getString("status"), rs.getLong("total"), rs.getLong("created_at")),
                args));
        if (orders.isEmpty()) {
            return List.of();
        }
        orders.sort((a, b) -> a.createdAt() != b.createdAt()
                ? Long.compare(a.createdAt(), b.createdAt()) : Long.compare(a.id(), b.id()));
        List<Long> ids = orders.stream().map(OrderRow::id).toList();
        Map<Long, List<OrderItemDto>> itemsByOrder = new LinkedHashMap<>();
        for (int from = 0; from < ids.size(); from += IN_CHUNK) {
            List<Long> chunk = ids.subList(from, Math.min(ids.size(), from + IN_CHUNK));
            named.query("SELECT " + ITEM_COLUMNS + " FROM order_item i WHERE i.order_id IN (:ids) ORDER BY i.id",
                            Map.of("ids", chunk), ITEM_MAPPER)
                    .forEach(item -> itemsByOrder.computeIfAbsent(item.orderId(), k -> new ArrayList<>()).add(item));
        }
        List<OrderDto> result = new ArrayList<>(orders.size());
        for (OrderRow o : orders) {
            result.add(new OrderDto(o.id(), o.tableId(), o.tableCode(), o.sessionId(), o.status(), o.total(),
                    o.createdAt(), itemsByOrder.getOrDefault(o.id(), List.of())));
        }
        return result;
    }

    public Optional<ItemRow> findItem(long itemId) {
        List<ItemRow> rows = jdbc.query(
                "SELECT " + ITEM_COLUMNS + ", o.table_id, t.code AS table_code FROM order_item i " +
                        "JOIN orders o ON o.id = i.order_id JOIN restaurant_table t ON t.id = o.table_id WHERE i.id = ?",
                (rs, n) -> new ItemRow(ITEM_MAPPER.mapRow(rs, n), rs.getLong("table_id"), rs.getString("table_code")),
                itemId);
        return rows.stream().findFirst();
    }

    /**
     * Cập nhật trạng thái món.
     * expectedVersion != null: optimistic locking, chỉ cập nhật nếu version chưa bị ai đổi.
     * expectedVersion == null: baseline không khoá (dùng cho thực nghiệm lost update).
     *
     * @return số dòng được cập nhật (0 = xung đột)
     */
    public int updateItemStatus(long itemId, String status, Integer expectedVersion, long now) {
        if (expectedVersion != null) {
            return jdbc.update(
                    "UPDATE order_item SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
                    status, now, itemId, expectedVersion);
        }
        return jdbc.update("UPDATE order_item SET status = ?, version = version + 1, updated_at = ? WHERE id = ?",
                status, now, itemId);
    }

    public List<OrderItemStatus> itemStatuses(long orderId) {
        return jdbc.query("SELECT status FROM order_item WHERE order_id = ?",
                (rs, n) -> OrderItemStatus.valueOf(rs.getString("status")), orderId);
    }

    public void updateOrderStatus(long orderId, String status, long now) {
        jdbc.update("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", status, now, orderId);
    }

    /** Huỷ các món còn PENDING; trả về số món đã huỷ. */
    public int cancelPendingItems(long orderId, long now) {
        return jdbc.update(
                "UPDATE order_item SET status = 'CANCELLED', version = version + 1, updated_at = ? WHERE order_id = ? AND status = 'PENDING'",
                now, orderId);
    }

    /**
     * Dọn dữ liệu thực nghiệm: đánh dấu hoàn tất mọi đơn đang mở của các bàn load test (mã bắt đầu bằng prefix)
     * để chúng không còn hiện ở màn hình bếp và không ảnh hưởng tới lần thực nghiệm sau.
     */
    public int completeOrdersOfTables(String codePrefix, long now) {
        String tableFilter = "SELECT id FROM restaurant_table WHERE code LIKE ?";
        jdbc.update("UPDATE order_item SET status = 'SERVED', version = version + 1, updated_at = ? " +
                        "WHERE status NOT IN ('SERVED', 'CANCELLED') AND order_id IN " +
                        "(SELECT id FROM orders WHERE status IN ('NEW', 'IN_PROGRESS') AND table_id IN (" + tableFilter + "))",
                now, codePrefix + "%");
        return jdbc.update("UPDATE orders SET status = 'COMPLETED', updated_at = ? " +
                        "WHERE status IN ('NEW', 'IN_PROGRESS') AND table_id IN (" + tableFilter + ")",
                now, codePrefix + "%");
    }

    public Map<String, Long> countSince(long sinceMs) {
        Map<String, Long> m = new LinkedHashMap<>();
        m.put("orders", jdbc.queryForObject("SELECT COUNT(*) FROM orders WHERE created_at >= ?", Long.class, sinceMs));
        m.put("orderItems", jdbc.queryForObject(
                "SELECT COUNT(*) FROM order_item i JOIN orders o ON o.id = i.order_id WHERE o.created_at >= ?", Long.class, sinceMs));
        m.put("events", jdbc.queryForObject("SELECT COUNT(*) FROM order_event WHERE created_at >= ?", Long.class, sinceMs));
        return m;
    }
}
