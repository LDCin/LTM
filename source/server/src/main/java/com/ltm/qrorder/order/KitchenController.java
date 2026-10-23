package com.ltm.qrorder.order;

import com.ltm.qrorder.auth.StaffAuthInterceptor;
import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.order.OrderDtos.EventPage;
import com.ltm.qrorder.order.OrderDtos.KitchenSnapshot;
import com.ltm.qrorder.order.OrderDtos.KitchenTableView;
import com.ltm.qrorder.order.OrderDtos.OrderItemDto;
import com.ltm.qrorder.order.OrderDtos.UpdateStatusRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;

import java.util.List;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** API cho màn hình bếp (cần token nhân viên). */
@RestController
@RequestMapping("/api/kitchen")
public class KitchenController {

    private final OrderService orders;

    public KitchenController(OrderService orders) {
        this.orders = orders;
    }

    /** Trạng thái ban đầu khi mở màn hình bếp: các đơn đang làm + latestSeq để bắt đầu nghe sự kiện. */
    @GetMapping("/orders")
    public KitchenSnapshot activeOrders() {
        return orders.kitchenSnapshot();
    }

    /** Dùng cho chế độ POLLING (baseline) và làm đường dự phòng khi WebSocket bị chặn. */
    @GetMapping("/events")
    public EventPage events(@RequestParam(defaultValue = "0") long afterSeq,
                            @RequestParam(defaultValue = "500") int limit) {
        return orders.eventsAfter(afterSeq, limit);
    }

    /** Danh sách bàn và tình trạng phiên hiện tại (số đơn, số món chưa phục vụ). */
    @GetMapping("/tables")
    public List<KitchenTableView> tables() {
        return orders.kitchenTables();
    }

    /**
     * Dọn bàn: kết thúc phiên của khách cũ, mở phiên mới cho khách sau.
     * 409 TABLE_HAS_ACTIVE_ORDERS nếu bàn còn món chưa phục vụ (gửi lại với force=true để vẫn dọn).
     */
    @PostMapping("/tables/{tableId}/reset-session")
    public KitchenTableView resetSession(@PathVariable long tableId,
                                         @RequestParam(defaultValue = "false") boolean force) {
        return orders.resetTableSession(tableId, force);
    }

    @PatchMapping("/order-items/{itemId}/status")
    public OrderItemDto updateStatus(@PathVariable long itemId,
                                     @Valid @RequestBody UpdateStatusRequest req,
                                     @RequestAttribute(StaffAuthInterceptor.ATTR) StaffPrincipal staff) {
        return orders.updateItemStatus(itemId, req, staff);
    }
}
