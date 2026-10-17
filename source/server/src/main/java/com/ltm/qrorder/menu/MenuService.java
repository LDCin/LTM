package com.ltm.qrorder.menu;

import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.common.Jdbc;
import com.ltm.qrorder.event.EventPublisher;
import com.ltm.qrorder.menu.MenuDtos.CategoryDto;
import com.ltm.qrorder.menu.MenuDtos.CategoryRequest;
import com.ltm.qrorder.menu.MenuDtos.MenuItemDto;
import com.ltm.qrorder.menu.MenuDtos.MenuItemRequest;
import com.ltm.qrorder.menu.MenuDtos.MenuSnapshot;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * Thực đơn. Đây là dữ liệu đọc rất nhiều (mọi khách mở QR đều tải) nhưng ít thay đổi,
 * nên được cache trong RAM kèm số version. Version cũng là ETag: client gửi If-None-Match
 * mà khớp thì server trả 304 Not Modified, không gửi lại toàn bộ thực đơn.
 */
@Service
public class MenuService {

    private static final String ITEM_COLUMNS =
            "id, category_id, name, description, price, image_url, available, stock, station";
    private static final RowMapper<MenuItemDto> ITEM_MAPPER = (rs, i) -> new MenuItemDto(
            rs.getLong("id"), rs.getLong("category_id"), rs.getString("name"), rs.getString("description"),
            rs.getLong("price"), rs.getString("image_url"), rs.getBoolean("available"),
            rs.getObject("stock", Integer.class), rs.getString("station"));

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final EventPublisher publisher;
    private final AtomicLong version = new AtomicLong(1);
    private volatile MenuSnapshot cache;

    public MenuService(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, EventPublisher publisher) {
        this.jdbc = jdbc;
        this.named = named;
        this.publisher = publisher;
    }

    public long currentVersion() {
        return version.get();
    }

    public MenuSnapshot getMenu() {
        MenuSnapshot snapshot = cache;
        if (snapshot != null && snapshot.version() == version.get()) {
            return snapshot;
        }
        // Double-checked locking: khi cache hết hạn, chỉ một thread đọc DB, các thread khác chờ rồi dùng lại
        synchronized (this) {
            long v = version.get();
            snapshot = cache;
            if (snapshot == null || snapshot.version() != v) {
                snapshot = load(v);
                cache = snapshot;
            }
            return snapshot;
        }
    }

    private MenuSnapshot load(long v) {
        List<MenuItemDto> items = jdbc.query("SELECT " + ITEM_COLUMNS + " FROM menu_item ORDER BY category_id, id", ITEM_MAPPER);
        Map<Long, List<MenuItemDto>> byCategory = items.stream()
                .collect(Collectors.groupingBy(MenuItemDto::categoryId, LinkedHashMap::new, Collectors.toList()));
        List<CategoryDto> categories = jdbc.query(
                "SELECT id, name, sort_order FROM category ORDER BY sort_order, id",
                (rs, i) -> new CategoryDto(rs.getLong("id"), rs.getString("name"), rs.getInt("sort_order"),
                        byCategory.getOrDefault(rs.getLong("id"), List.of())));
        return new MenuSnapshot(v, categories);
    }

    /**
     * Đánh dấu thực đơn đã đổi: tăng version SAU KHI commit (tránh cache đọc dữ liệu chưa commit)
     * và báo cho khách tải lại thực đơn.
     */
    public void markChanged() {
        publisher.afterCommit(() -> {
            long v = version.incrementAndGet();
            publisher.sendNow(EventPublisher.MENU_TOPIC, Map.of("type", "MENU_UPDATED", "version", v));
        });
    }

    /** Đọc trực tiếp từ DB (không qua cache) để lấy giá và trạng thái mới nhất khi đặt món. */
    public Map<Long, MenuItemDto> findForOrder(Collection<Long> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        List<MenuItemDto> items = named.query(
                "SELECT " + ITEM_COLUMNS + " FROM menu_item WHERE id IN (:ids)", Map.of("ids", ids), ITEM_MAPPER);
        return items.stream().collect(Collectors.toMap(MenuItemDto::id, m -> m));
    }

    /**
     * Trừ tồn kho NGUYÊN TỬ: điều kiện "stock >= qty" nằm ngay trong câu UPDATE nên hai bàn
     * tranh suất cuối cùng thì chỉ một bàn thành công (bàn kia nhận 0 dòng bị ảnh hưởng).
     * Cột available được gán trước stock để cả MySQL lẫn H2 đều dùng giá trị stock cũ.
     */
    public boolean decrementStock(long menuItemId, int quantity) {
        int rows = jdbc.update(
                "UPDATE menu_item SET available = CASE WHEN stock - ? <= 0 THEN FALSE ELSE available END, " +
                        "stock = stock - ? WHERE id = ? AND stock IS NOT NULL AND stock >= ? AND available = TRUE",
                quantity, quantity, menuItemId, quantity);
        return rows == 1;
    }

    public boolean restoreStock(long menuItemId, int quantity) {
        int rows = jdbc.update(
                "UPDATE menu_item SET available = CASE WHEN stock = 0 THEN TRUE ELSE available END, " +
                        "stock = stock + ? WHERE id = ? AND stock IS NOT NULL",
                quantity, menuItemId);
        return rows == 1;
    }

    // ---------------------------------------------------------------- quản trị

    public List<MenuItemDto> listAll() {
        return jdbc.query("SELECT " + ITEM_COLUMNS + " FROM menu_item ORDER BY category_id, id", ITEM_MAPPER);
    }

    public List<CategoryDto> listCategories() {
        return jdbc.query("SELECT id, name, sort_order FROM category ORDER BY sort_order, id",
                (rs, i) -> new CategoryDto(rs.getLong("id"), rs.getString("name"), rs.getInt("sort_order"), List.of()));
    }

    @Transactional
    public CategoryDto createCategory(CategoryRequest req) {
        long id = Jdbc.insert(jdbc, "INSERT INTO category (name, sort_order) VALUES (?, ?)", "id",
                req.name(), req.sortOrder());
        markChanged();
        return new CategoryDto(id, req.name(), req.sortOrder(), List.of());
    }

    @Transactional
    public MenuItemDto create(MenuItemRequest req) {
        ensureCategory(req.categoryId());
        long id = Jdbc.insert(jdbc,
                "INSERT INTO menu_item (category_id, name, description, price, image_url, available, stock, station) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                "id", req.categoryId(), req.name(), req.description(), req.price(), req.imageUrl(),
                req.available(), req.stock(), req.station());
        markChanged();
        return get(id);
    }

    @Transactional
    public MenuItemDto update(long id, MenuItemRequest req) {
        get(id);
        ensureCategory(req.categoryId());
        jdbc.update("UPDATE menu_item SET category_id = ?, name = ?, description = ?, price = ?, image_url = ?, " +
                        "available = ?, stock = ?, station = ? WHERE id = ?",
                req.categoryId(), req.name(), req.description(), req.price(), req.imageUrl(),
                req.available(), req.stock(), req.station(), id);
        markChanged();
        return get(id);
    }

    public MenuItemDto get(long id) {
        List<MenuItemDto> rows = jdbc.query("SELECT " + ITEM_COLUMNS + " FROM menu_item WHERE id = ?", ITEM_MAPPER, id);
        if (rows.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy món #" + id);
        }
        return rows.get(0);
    }

    private void ensureCategory(long categoryId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM category WHERE id = ?", Integer.class, categoryId);
        if (count == null || count == 0) {
            throw new ApiException(ErrorCode.INVALID_REQUEST, "Danh mục #" + categoryId + " không tồn tại");
        }
    }
}
