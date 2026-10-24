package com.ltm.qrorder.order;

import com.ltm.qrorder.event.EventEnvelope;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class OrderDtos {

    private OrderDtos() {
    }

    // ------------------------------------------------------------ request

    public record PlaceOrderRequest(@NotEmpty(message = "Đơn phải có ít nhất 1 món")
                                    @Size(max = 30, message = "Tối đa 30 dòng món mỗi đơn")
                                    List<@Valid @NotNull OrderLine> items,
                                    /** Tên khách tự nhập (hiện cho cả bàn và bếp); null = khách bỏ qua. */
                                    @Size(max = 60, message = "Tên quá dài") String guestName) {

        public PlaceOrderRequest(List<OrderLine> items) {
            this(items, null);
        }
    }

    public record OrderLine(@NotNull Long menuItemId,
                            @NotNull @Min(1) @Max(50) Integer quantity,
                            @Size(max = 200) String note) {
    }

    public record UpdateStatusRequest(@NotNull OrderItemStatus status, @NotNull Integer version) {
    }

    // ------------------------------------------------------------ response

    public record OrderItemDto(long id, long orderId, long menuItemId, String name, long unitPrice, int quantity,
                               String note, String status, int version, String station, long updatedAt) {
    }

    /**
     * guestName: tên người đặt (có thể null). firstInSession: đơn đầu tiên của lượt khách
     * (bếp hiện nhãn "Bàn mới mở" để nhân viên liếc xem bàn có người thật không).
     * Không chứa mã thiết bị: mã này là bí mật dùng để xác định quyền huỷ đơn.
     */
    public record OrderDto(long id, long tableId, String tableCode, long sessionId, String status, long total,
                           long createdAt, String guestName, boolean firstInSession, List<OrderItemDto> items) {
    }

    public record PlaceOrderResult(OrderDto order, boolean replayed) {
    }

    public record TableView(long tableId, String code, String status, boolean open) {
    }

    /**
     * Đơn của cả phiên (mọi điện thoại cùng bàn thấy chung).
     * mineOrderIds: các đơn do chính máy đang hỏi đặt (máy đó được huỷ, hiện nhãn "BẠN ĐẶT").
     */
    public record TableOrdersView(TableView table, Long sessionId, List<OrderDto> orders, List<Long> mineOrderIds) {
    }

    /** Ảnh chụp ban đầu cho màn hình bếp: latestSeq được đọc TRƯỚC danh sách đơn. */
    public record KitchenSnapshot(long latestSeq, List<OrderDto> orders) {
    }

    public record EventPage(long latestSeq, List<EventEnvelope> events) {
    }
}
