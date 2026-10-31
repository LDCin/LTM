package com.ltm.qrorder.order;

import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.DeviceIds;
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
import com.ltm.qrorder.order.OrderDtos.VoidItemRequest;
import com.ltm.qrorder.order.OrderDtos.VoidReason;
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
    public PlaceOrderResult placeOrder(String tableToken, String deviceId, Long sessionId, String idempotencyKey,
                                       PlaceOrderRequest req) {
        if (idempotencyKey != null && !KEY_PATTERN.matcher(idempotencyKey).matches()) {
            throw new ApiException(ErrorCode.INVALID_REQUEST, "Idempotency-Key phải gồm 8-64 ký tự [A-Za-z0-9_-]");
        }
        DeviceIds.optional(deviceId);
        TableInfo table = tables.requireSession(tableToken, sessionId);
        boolean useKey = props.isIdempotencyEnabled() && idempotencyKey != null;
        // Hash gồm cả mã thiết bị: máy khác dùng lại key (dù cùng nội dung) cũng không lấy được đơn của máy này
        String hash = useKey ? requestHash(table.id(), deviceId, req) : null;

        if (useKey) {
            Optional<OrderDto> replay = findReplay(idempotencyKey, hash);
            if (replay.isPresent()) {
                return new PlaceOrderResult(replay.get(), true);
            }
        }
        try {
            OrderDto order = tx.execute(status -> createOrder(table, deviceId, req, useKey ? idempotencyKey : null, hash));
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
    private OrderDto createOrder(TableInfo table, String deviceId, PlaceOrderRequest req, String key, String hash) {
        long now = System.currentTimeMillis();
        if (key != null) {
            idempotency.insert(key, hash, now);   // chiếm key trước tiên
        }
        requireNoPendingPayment(table);

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

        long orderId = orders.insertOrder(table.sessionId(), table.id(), total, now, deviceId, normalizeGuestName(req.guestName()));
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

    // ================================================================ BẾP HUỶ / KHÁCH TRẢ LẠI MÓN ĐÃ NHẬN

    /**
     * Bếp huỷ món đã nhận (hết nguyên liệu, làm hỏng...) hoặc ghi nhận khách trả lại món đã phục vụ.
     * - Chỉ cho món ACCEPTED / SERVED (món PENDING dùng "Từ chối" như cũ).
     * - Huỷ một phần: dòng cũ bớt số suất, phần huỷ thành dòng mới CANCELLED. Cả hai bước nằm trong một transaction
     *   và dòng cũ được khoá lạc quan theo version, nên hai người cùng huỷ thì chỉ một người thành công.
     * - Món huỷ không tính tiền (tổng hóa đơn tính theo món chưa huỷ). Bàn đã trả tiền thì phần dư hiện ở quầy
     *   thu ngân là "cần trả lại khách".
     * - Món chưa bắt đầu nấu (ACCEPTED) thì hoàn lại tồn kho.
     * - Đang có lần thanh toán chờ -> 409 PAYMENT_IN_PROGRESS (số tiền của lần đó đã chốt).
     * Sự kiện ORDER_UPDATED (cả đơn mới nhất) tới bếp, các máy của bàn và quầy thu ngân.
     */
    public OrderDto voidItem(long itemId, VoidItemRequest req, StaffPrincipal staff) {
        if (req.reason() == VoidReason.OTHER && (req.note() == null || req.note().isBlank())) {
            throw new ApiException(ErrorCode.INVALID_REQUEST, "Lý do khác: vui lòng ghi rõ lý do");
        }
        try {
            return tx.execute(status -> doVoidItem(itemId, req, staff));
        } catch (ConcurrencyFailureException e) {
            metrics.versionConflicts.incrementAndGet();
            throw new ApiException(ErrorCode.VERSION_CONFLICT, "Món vừa được người khác cập nhật, vui lòng tải lại");
        }
    }

    private OrderDto doVoidItem(long itemId, VoidItemRequest req, StaffPrincipal staff) {
        ItemRow row = orders.findItem(itemId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy món #" + itemId));
        OrderItemDto current = row.item();
        OrderItemStatus from = OrderItemStatus.valueOf(current.status());
        if (current.version() != req.version()) {
            throw versionConflict(current);
        }
        if (from == OrderItemStatus.PENDING || from == OrderItemStatus.CANCELLED) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    from == OrderItemStatus.PENDING ? "Món chưa nhận: dùng nút Từ chối" : "Món đã huỷ rồi",
                    Map.of("from", from.name()));
        }
        if (req.quantity() > current.quantity()) {
            throw new ApiException(ErrorCode.INVALID_REQUEST,
                    "Dòng này chỉ có " + current.quantity() + " suất", Map.of("quantity", current.quantity()));
        }
        OrderDto order = orders.findOrder(current.orderId()).orElseThrow();
        if (orders.hasPendingPayment(order.sessionId())) {
            throw new ApiException(ErrorCode.PAYMENT_IN_PROGRESS,
                    "Bàn " + row.tableCode() + " đang thanh toán: nhờ thu ngân huỷ lần thanh toán chờ rồi huỷ món",
                    Map.of("tableCode", row.tableCode()));
        }

        long now = System.currentTimeMillis();
        String note = normalizeNote(req.note());
        String reason = req.reason().name();
        int updated = req.quantity() == current.quantity()
                ? orders.voidItem(itemId, req.version(), reason, note, staff.username(), now)
                : orders.reduceQuantity(itemId, req.version(), req.quantity(), now);
        if (updated == 0) {
            throw versionConflict(current);
        }
        if (req.quantity() < current.quantity()) {
            orders.insertCancelledPart(itemId, req.quantity(), reason, note, staff.username(), now);
        }
        boolean stockRestored = from == OrderItemStatus.ACCEPTED
                && menu.restoreStock(current.menuItemId(), req.quantity());
        orders.recomputeOrderTotal(current.orderId(), now);
        OrderStatus orderStatus = OrderStatus.derive(orders.itemStatuses(current.orderId()));
        orders.updateOrderStatus(current.orderId(), orderStatus.name(), now);

        OrderDto updatedOrder = orders.findOrder(current.orderId()).orElseThrow();
        Map<String, Object> change = new LinkedHashMap<>();
        change.put("orderItemId", itemId);
        change.put("name", current.name());
        change.put("quantity", req.quantity());
        change.put("from", from.name());
        change.put("reason", reason);
        change.put("note", note);
        change.put("by", staff.username());
        EventEnvelope envelope = events.append(current.orderId(), row.tableId(), "ORDER_UPDATED",
                Map.of("order", updatedOrder, "change", change));
        publisher.publishOrderEvent(envelope, row.tableId());
        if (stockRestored) {
            menu.markChanged();
        }
        return updatedOrder;
    }

    /** Khách huỷ một món PENDING trong đơn do chính máy này đặt (bếp chưa tiếp nhận món đó). */
    public OrderDto cancelItemByCustomer(String tableToken, String deviceId, Long sessionId, long orderId, long itemId) {
        DeviceIds.require(deviceId);
        TableInfo table = tables.requireSession(tableToken, sessionId);
        return tx.execute(status -> {
            requireNoPendingPayment(table);
            OrderDto order = orders.findOrder(orderId)
                    .filter(o -> o.tableId() == table.id() && o.sessionId() == table.sessionId())
                    .filter(o -> deviceId.equals(orders.findDeviceId(o.id()).orElse(null)))
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy đơn #" + orderId));
            OrderItemDto item = order.items().stream().filter(i -> i.id() == itemId).findFirst()
                    .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy món #" + itemId));
            if (!OrderItemStatus.PENDING.name().equals(item.status())) {
                throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION, "Bếp đã tiếp nhận món này, không thể huỷ");
            }
            long now = System.currentTimeMillis();
            if (orders.voidItem(itemId, item.version(), VoidReason.CUSTOMER_CHANGED_MIND.name(), null, "guest", now) == 0) {
                throw new ApiException(ErrorCode.VERSION_CONFLICT, "Bếp vừa tiếp nhận món, không thể huỷ");
            }
            boolean stockRestored = menu.restoreStock(item.menuItemId(), item.quantity());
            orders.recomputeOrderTotal(orderId, now);
            OrderStatus orderStatus = OrderStatus.derive(orders.itemStatuses(orderId));
            orders.updateOrderStatus(orderId, orderStatus.name(), now);
            OrderDto updated = orders.findOrder(orderId).orElseThrow();
            Map<String, Object> change = new LinkedHashMap<>();
            change.put("orderItemId", itemId);
            change.put("name", item.name());
            change.put("quantity", item.quantity());
            change.put("reason", VoidReason.CUSTOMER_CHANGED_MIND.name());
            change.put("by", "guest");
            EventEnvelope envelope = events.append(orderId, table.id(), "ORDER_UPDATED", Map.of("order", updated, "change", change));
            publisher.publishOrderEvent(envelope, table.id());
            if (stockRestored) {
                menu.markChanged();
            }
            return updated;
        });
    }

    // ================================================================ HUỶ CẢ ĐƠN / QUÁ HẠN

    /** Bếp huỷ cả đơn: mọi món chưa phục vụ bị huỷ kèm lý do, món đã phục vụ giữ nguyên. */
    public OrderDto cancelWholeOrder(long orderId, VoidReason reason, String note, StaffPrincipal staff) {
        if (reason == VoidReason.OTHER && (note == null || note.isBlank())) {
            throw new ApiException(ErrorCode.INVALID_REQUEST, "Lý do khác: vui lòng ghi rõ lý do");
        }
        try {
            return tx.execute(status -> doCancelWhole(orderId, reason.name(), normalizeNote(note), staff.username(), false));
        } catch (ConcurrencyFailureException e) {
            metrics.versionConflicts.incrementAndGet();
            throw new ApiException(ErrorCode.VERSION_CONFLICT, "Đơn vừa được người khác cập nhật, vui lòng tải lại");
        }
    }

    /** Tự huỷ các món chờ bếp tiếp nhận quá lâu (khách không phải chờ mãi một đơn bị bỏ quên). @return số đơn bị ảnh hưởng */
    public int expireStalePending(long cutoff) {
        int n = 0;
        for (long orderId : orders.findOrdersWithPendingBefore(cutoff)) {
            try {
                tx.execute(status -> doCancelWhole(orderId, VoidReason.OTHER.name(),
                        "Quá thời gian chờ bếp tiếp nhận", "system", true));
                n++;
            } catch (RuntimeException e) {
                // bếp vừa nhận món / bàn đang thanh toán: bỏ qua, lần chạy sau xét lại
            }
        }
        return n;
    }

    private OrderDto doCancelWhole(long orderId, String reason, String note, String by, boolean onlyPending) {
        OrderDto order = orders.findOrder(orderId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy đơn #" + orderId));
        if (orders.hasPendingPayment(order.sessionId())) {
            throw new ApiException(ErrorCode.PAYMENT_IN_PROGRESS,
                    "Bàn " + order.tableCode() + " đang thanh toán: nhờ thu ngân huỷ lần thanh toán chờ rồi huỷ đơn");
        }
        long now = System.currentTimeMillis();
        int count = 0;
        boolean stockRestored = false;
        for (OrderItemDto item : order.items()) {
            OrderItemStatus s = OrderItemStatus.valueOf(item.status());
            if (s != OrderItemStatus.PENDING && (onlyPending || s != OrderItemStatus.ACCEPTED)) {
                continue;
            }
            if (orders.voidItem(item.id(), item.version(), reason, note, by, now) == 0) {
                throw versionConflict(item);
            }
            stockRestored |= menu.restoreStock(item.menuItemId(), item.quantity());
            count += item.quantity();
        }
        if (count == 0) {
            if (onlyPending) {
                throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION, "Không còn món chờ");
            }
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION, "Đơn không còn món nào để huỷ");
        }
        orders.recomputeOrderTotal(orderId, now);
        OrderStatus orderStatus = OrderStatus.derive(orders.itemStatuses(orderId));
        orders.updateOrderStatus(orderId, orderStatus.name(), now);
        OrderDto updatedOrder = orders.findOrder(orderId).orElseThrow();
        Map<String, Object> change = new LinkedHashMap<>();
        change.put("whole", true);
        change.put("name", "đơn #" + orderId);
        change.put("quantity", count);
        change.put("reason", reason);
        change.put("note", note);
        change.put("by", by);
        EventEnvelope envelope = events.append(orderId, order.tableId(), "ORDER_UPDATED",
                Map.of("order", updatedOrder, "change", change));
        publisher.publishOrderEvent(envelope, order.tableId());
        if (stockRestored) {
            menu.markChanged();
        }
        return updatedOrder;
    }

    /** Đơn có món đã phục vụ của các bàn đang có khách (bếp ghi nhận khách trả lại món). */
    public List<OrderDto> servedInOpenSessions() {
        return orders.findServedInOpenSessions();
    }

    private ApiException versionConflict(OrderItemDto current) {
        metrics.versionConflicts.incrementAndGet();
        return new ApiException(ErrorCode.VERSION_CONFLICT, "Món vừa được người khác cập nhật, vui lòng tải lại",
                Map.of("currentVersion", current.version(), "currentStatus", current.status()));
    }

    // ================================================================ KHÁCH HUỶ ĐƠN

    public OrderDto cancelOrder(String tableToken, String deviceId, Long sessionId, long orderId) {
        DeviceIds.require(deviceId);
        TableInfo table = tables.requireSession(tableToken, sessionId);
        return tx.execute(status -> {
            requireNoPendingPayment(table);
            // Chỉ huỷ được đơn do chính máy này đặt, trong phiên hiện tại của bàn
            OrderDto order = orders.findOrder(orderId)
                    .filter(o -> o.tableId() == table.id() && o.sessionId() == table.sessionId())
                    .filter(o -> deviceId.equals(orders.findDeviceId(o.id()).orElse(null)))
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

    /**
     * Mọi đơn trong phiên hiện tại của bàn (các điện thoại cùng phiên thấy chung),
     * kèm id các đơn do chính máy này đặt.
     * sessionId (header X-Session-Id): nếu máy đang giữ một phiên đã kết thúc -> 409 SESSION_ENDED để máy vào lại.
     */
    public TableOrdersView ordersForSession(String tableToken, String deviceId, Long sessionId) {
        DeviceIds.optional(deviceId);
        TableInfo t = tables.resolveToken(tableToken);
        if (sessionId != null && !sessionId.equals(t.sessionId())) {
            throw new ApiException(ErrorCode.SESSION_ENDED, "Lượt của bạn ở bàn " + t.code() + " đã kết thúc",
                    Map.of("tableCode", t.code()));
        }
        TableView view = new TableView(t.id(), t.code(), t.status(), t.isOpen());
        if (t.sessionId() == null) {
            return new TableOrdersView(view, null, List.of(), List.of());
        }
        return new TableOrdersView(view, t.sessionId(), orders.findBySession(t.sessionId()),
                orders.findOrderIdsOfDevice(t.sessionId(), deviceId));
    }

    /** Đang có lần thanh toán chờ xử lý -> chưa cho gọi thêm / huỷ đơn (số tiền đã chốt). */
    private void requireNoPendingPayment(TableInfo table) {
        if (orders.hasPendingPayment(table.sessionId())) {
            throw new ApiException(ErrorCode.PAYMENT_IN_PROGRESS,
                    "Bàn đang thanh toán, vui lòng đợi hoặc huỷ thanh toán để gọi thêm",
                    Map.of("tableCode", table.code()));
        }
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

    /** Tên khách: bỏ khoảng trắng thừa, tối đa 20 ký tự; rỗng = không có tên. */
    public static String normalizeGuestName(String name) {
        if (name == null) {
            return null;
        }
        String trimmed = name.strip().replaceAll("\\s+", " ");
        if (trimmed.isEmpty()) {
            return null;
        }
        return trimmed.length() > 20 ? trimmed.substring(0, 20).strip() : trimmed;
    }

    /** SHA-256 của nội dung đơn: phát hiện cùng key nhưng nội dung khác. */
    static String requestHash(long tableId, String deviceId, PlaceOrderRequest req) {
        StringBuilder sb = new StringBuilder().append(tableId).append('|').append(deviceId == null ? "" : deviceId);
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
