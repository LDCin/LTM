package com.ltm.qrorder.order;

import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.event.EventEnvelope;
import com.ltm.qrorder.event.EventPublisher;
import com.ltm.qrorder.event.EventStore;
import com.ltm.qrorder.menu.MenuDtos.MenuItemDto;
import com.ltm.qrorder.menu.MenuService;
import com.ltm.qrorder.order.IdempotencyRepository.IdempotencyRecord;
import com.ltm.qrorder.order.OrderDtos.EventPage;
import com.ltm.qrorder.order.OrderDtos.KitchenSnapshot;
import com.ltm.qrorder.order.OrderDtos.OrderDto;
import com.ltm.qrorder.order.OrderDtos.OrderItemDto;
import com.ltm.qrorder.order.OrderDtos.OrderLine;
import com.ltm.qrorder.order.OrderDtos.PlaceOrderRequest;
import com.ltm.qrorder.order.OrderDtos.PlaceOrderResult;
import com.ltm.qrorder.order.OrderDtos.TableOrdersView;
import com.ltm.qrorder.order.OrderDtos.TableView;
import com.ltm.qrorder.order.OrderDtos.UpdateStatusRequest;
import com.ltm.qrorder.order.OrderRepository.ItemRow;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Nghiệp vụ đơn hàng: đặt món (idempotent), cập nhật trạng thái (state machine + optimistic lock), huỷ đơn.
 * Transaction được điều khiển tường minh bằng TransactionTemplate để thấy rõ ranh giới commit/rollback.
 */
@Service
public class OrderService {

    private static final Pattern KEY_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");

    private final TableService tables;
    private final MenuService menu;
    private final OrderRepository orders;
    private final IdempotencyRepository idempotency;
    private final EventStore events;
    private final EventPublisher publisher;
    private final TransactionTemplate tx;
    private final AppProperties props;
    private final Metrics metrics;

    public OrderService(TableService tables, MenuService menu, OrderRepository orders,
                        IdempotencyRepository idempotency, EventStore events, EventPublisher publisher,
                        TransactionTemplate tx, AppProperties props, Metrics metrics) {
        this.tables = tables;
        this.menu = menu;
        this.orders = orders;
        this.idempotency = idempotency;
        this.events = events;
        this.publisher = publisher;
        this.tx = tx;
        this.props = props;
        this.metrics = metrics;
    }

    // ================================================================ ĐẶT MÓN

    /**
     * Đặt món với Idempotency-Key.
     *
     * 1. Key đã có trong DB và nội dung giống hệt -> trả lại đơn cũ (replayed = true), không tạo đơn mới.
     * 2. Key đã có nhưng nội dung khác -> 409 IDEMPOTENCY_KEY_REUSED.
     * 3. Key mới -> tạo đơn trong một transaction. Hai request cùng key tới ĐỒNG THỜI: cả hai cùng
     *    INSERT key, ràng buộc PRIMARY KEY chỉ cho một bên thắng; bên thua nhận DuplicateKeyException
     *    rồi đọc lại đơn mà bên thắng đã tạo.
     */
    public PlaceOrderResult placeOrder(String tableToken, String idempotencyKey, PlaceOrderRequest req) {
        if (idempotencyKey != null && !KEY_PATTERN.matcher(idempotencyKey).matches()) {
            throw new ApiException(ErrorCode.INVALID_REQUEST, "Idempotency-Key phải gồm 8-64 ký tự [A-Za-z0-9_-]");
        }
        TableInfo table = tables.requireOpen(tableToken);
        boolean useKey = props.isIdempotencyEnabled() && idempotencyKey != null;
        String hash = useKey ? requestHash(table.id(), req) : null;

        if (useKey) {
            Optional<OrderDto> replay = findReplay(idempotencyKey, hash);
            if (replay.isPresent()) {
                return new PlaceOrderResult(replay.get(), true);
            }
        }
        try {
            OrderDto order = tx.execute(status -> createOrder(table, req, useKey ? idempotencyKey : null, hash));
            metrics.ordersCreated.incrementAndGet();
            return new PlaceOrderResult(order, false);
        } catch (DuplicateKeyException e) {
            if (!useKey) {
                throw e;
            }
            // Request song song cùng key đã thắng: chờ ngắn rồi trả về đơn của nó
            for (int attempt = 0; attempt < 40; attempt++) {
                Optional<OrderDto> replay = findReplay(idempotencyKey, hash);
                if (replay.isPresent()) {
                    return new PlaceOrderResult(replay.get(), true);
                }
                sleepQuietly(50);
            }
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, "Yêu cầu trùng đang được xử lý, vui lòng thử lại",
                    Map.of("retryAfterSeconds", 1));
        }
    }

    private Optional<OrderDto> findReplay(String key, String hash) {
        Optional<IdempotencyRecord> record = idempotency.find(key);
        if (record.isEmpty() || record.get().orderId() == null) {
            return Optional.empty();
        }
        if (!record.get().requestHash().equals(hash)) {
            throw new ApiException(ErrorCode.IDEMPOTENCY_KEY_REUSED, "Idempotency-Key đã được dùng cho một đơn khác");
        }
        metrics.duplicateRequestsBlocked.incrementAndGet();
        return orders.findOrder(record.get().orderId());
    }

    /** Chạy BÊN TRONG transaction. Ném exception bất kỳ -> rollback toàn bộ, không phát sự kiện. */
    private OrderDto createOrder(TableInfo table, PlaceOrderRequest req, String key, String hash) {
        long now = System.currentTimeMillis();
        if (key != null) {
            idempotency.insert(key, hash, now);   // chiếm key trước tiên
        }

        Set<Long> ids = req.items().stream().map(OrderLine::menuItemId).collect(Collectors.toSet());
        Map<Long, MenuItemDto> menuItems = menu.findForOrder(ids);
        Map<Long, Integer> quantityByItem = new LinkedHashMap<>();
        long total = 0;
        for (OrderLine line : req.items()) {
            MenuItemDto m = menuItems.get(line.menuItemId());
            if (m == null) {
                throw new ApiException(ErrorCode.ITEM_UNAVAILABLE, "Món #" + line.menuItemId() + " không tồn tại",
                        Map.of("menuItemId", line.menuItemId()));
            }
            if (!m.available()) {
                throw new ApiException(ErrorCode.ITEM_UNAVAILABLE, "Món '" + m.name() + "' đã hết",
                        Map.of("menuItemId", m.id()));
            }
            quantityByItem.merge(m.id(), line.quantity(), Integer::sum);
            total += m.price() * line.quantity();
        }

        boolean stockChanged = false;
        for (Map.Entry<Long, Integer> e : quantityByItem.entrySet()) {
            MenuItemDto m = menuItems.get(e.getKey());
            if (m.stock() == null) {
                continue;
            }
            if (!menu.decrementStock(m.id(), e.getValue())) {
                throw new ApiException(ErrorCode.ITEM_UNAVAILABLE, "Món '" + m.name() + "' không còn đủ số lượng",
                        Map.of("menuItemId", m.id(), "requested", e.getValue()));
            }
            stockChanged = true;
        }

        long orderId = orders.insertOrder(table.sessionId(), table.id(), total, now);
        for (OrderLine line : req.items()) {
            orders.insertItem(orderId, menuItems.get(line.menuItemId()), line.quantity(), normalizeNote(line.note()), now);
        }
        if (key != null) {
            idempotency.attachOrder(key, orderId);
        }

        OrderDto order = orders.findOrder(orderId).orElseThrow();
        EventEnvelope envelope = events.append(orderId, table.id(), "ORDER_CREATED", order);
        publisher.publishOrderEvent(envelope, table.id());   // chỉ thực sự gửi sau khi commit
        if (stockChanged) {
            menu.markChanged();
        }
        return order;
    }

    // ================================================================ BẾP CẬP NHẬT TRẠNG THÁI

    public OrderItemDto updateItemStatus(long itemId, UpdateStatusRequest req, StaffPrincipal staff) {
        try {
            return tx.execute(status -> doUpdateItemStatus(itemId, req, staff));
        } catch (ConcurrencyFailureException e) {
            // Deadlock/lock timeout giữa hai giao dịch cùng sửa một món -> coi như xung đột phiên bản
            metrics.versionConflicts.incrementAndGet();
            throw new ApiException(ErrorCode.VERSION_CONFLICT, "Món vừa được người khác cập nhật, vui lòng tải lại");
        }
    }

    private OrderItemDto doUpdateItemStatus(long itemId, UpdateStatusRequest req, StaffPrincipal staff) {
        ItemRow row = orders.findItem(itemId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy món #" + itemId));
        OrderItemDto current = row.item();
        OrderItemStatus from = OrderItemStatus.valueOf(current.status());
        OrderItemStatus to = req.status();
        boolean useLock = props.isOptimisticLockEnabled();

        if (useLock && current.version() != req.version()) {
            throw versionConflict(current);
        }
        if (!from.canTransitionTo(to)) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION, "Không thể chuyển " + from + " → " + to,
                    Map.of("from", from.name(), "to", to.name(), "allowed", from.allowedNextNames()));
        }

        long now = System.currentTimeMillis();
        int updated = orders.updateItemStatus(itemId, to.name(), useLock ? req.version() : null, now);
        if (updated == 0) {
            throw versionConflict(current);   // có người cập nhật xen giữa lúc đọc và lúc ghi
        }

        OrderItemDto item = orders.findItem(itemId).orElseThrow().item();
        OrderStatus orderStatus = OrderStatus.derive(orders.itemStatuses(current.orderId()));
        orders.updateOrderStatus(current.orderId(), orderStatus.name(), now);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("orderId", current.orderId());
        payload.put("tableId", row.tableId());
        payload.put("tableCode", row.tableCode());
        payload.put("orderItemId", itemId);
        payload.put("name", item.name());
        payload.put("quantity", item.quantity());
        payload.put("from", from.name());
        payload.put("to", to.name());
        payload.put("version", item.version());
        payload.put("orderStatus", orderStatus.name());
        payload.put("updatedAt", now);
        payload.put("by", staff.username());
        EventEnvelope envelope = events.append(current.orderId(), row.tableId(), "ITEM_STATUS_CHANGED", payload);
        publisher.publishOrderEvent(envelope, row.tableId());
        return item;
    }

    private ApiException versionConflict(OrderItemDto current) {
        metrics.versionConflicts.incrementAndGet();
        return new ApiException(ErrorCode.VERSION_CONFLICT, "Món vừa được người khác cập nhật, vui lòng tải lại",
                Map.of("currentVersion", current.version(), "currentStatus", current.status()));
    }

    // ================================================================ KHÁCH HUỶ ĐƠN

    public OrderDto cancelOrder(String tableToken, long orderId) {
        TableInfo table = tables.requireOpen(tableToken);
        return tx.execute(status -> {
            OrderDto order = orders.findOrder(orderId)
                    .filter(o -> o.tableId() == table.id() && o.sessionId() == table.sessionId())
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy đơn #" + orderId));
            boolean allPending = order.items().stream().allMatch(i -> OrderItemStatus.PENDING.name().equals(i.status()));
            if (!allPending) {
                throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION, "Bếp đã nhận đơn, không thể huỷ");
            }
            long now = System.currentTimeMillis();
            int cancelled = orders.cancelPendingItems(orderId, now);
            if (cancelled != order.items().size()) {
                // Bếp vừa nhận một món xen giữa -> rollback toàn bộ
                throw new ApiException(ErrorCode.VERSION_CONFLICT, "Bếp vừa nhận đơn, không thể huỷ");
            }
            boolean stockRestored = false;
            for (OrderItemDto item : order.items()) {
                stockRestored |= menu.restoreStock(item.menuItemId(), item.quantity());
            }
            orders.updateOrderStatus(orderId, OrderStatus.CANCELLED.name(), now);
            EventEnvelope envelope = events.append(orderId, table.id(), "ORDER_CANCELLED",
                    Map.of("orderId", orderId, "tableId", table.id(), "tableCode", table.code()));
            publisher.publishOrderEvent(envelope, table.id());
            if (stockRestored) {
                menu.markChanged();
            }
            return orders.findOrder(orderId).orElseThrow();
        });
    }

    // ================================================================ TRUY VẤN

    public TableOrdersView ordersForTable(String tableToken) {
        TableInfo t = tables.resolveToken(tableToken);
        TableView view = new TableView(t.id(), t.code(), t.status(), t.isOpen());
        List<OrderDto> list = t.sessionId() == null ? List.of() : orders.findBySession(t.sessionId());
        return new TableOrdersView(view, list);
    }

    public KitchenSnapshot kitchenSnapshot() {
        long latestSeq = events.latestSeq();   // đọc seq TRƯỚC để không bỏ lỡ sự kiện xảy ra giữa hai câu truy vấn
        return new KitchenSnapshot(latestSeq, orders.findActive());
    }

    public EventPage eventsAfter(long afterSeq, int limit) {
        long latestSeq = events.latestSeq();
        return new EventPage(latestSeq, events.after(Math.max(0, afterSeq), Math.min(Math.max(limit, 1), 1000)));
    }

    // ================================================================ tiện ích

    private static String normalizeNote(String note) {
        if (note == null) {
            return null;
        }
        String trimmed = note.strip();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** SHA-256 của nội dung đơn: phát hiện cùng key nhưng nội dung khác. */
    static String requestHash(long tableId, PlaceOrderRequest req) {
        StringBuilder sb = new StringBuilder().append(tableId);
        for (OrderLine line : req.items()) {
            sb.append('|').append(line.menuItemId()).append(':').append(line.quantity())
                    .append(':').append(normalizeNote(line.note()) == null ? "" : normalizeNote(line.note()));
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
