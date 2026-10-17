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
                                    List<@Valid @NotNull OrderLine> items) {
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

    public record OrderDto(long id, long tableId, String tableCode, long sessionId, String status, long total,
                           long createdAt, List<OrderItemDto> items) {
    }

    public record PlaceOrderResult(OrderDto order, boolean replayed) {
    }

    public record TableView(long tableId, String code, String status, boolean open) {
    }

    public record TableOrdersView(TableView table, List<OrderDto> orders) {
    }

    /** Ảnh chụp ban đầu cho màn hình bếp: latestSeq được đọc TRƯỚC danh sách đơn. */
    public record KitchenSnapshot(long latestSeq, List<OrderDto> orders) {
    }

    public record EventPage(long latestSeq, List<EventEnvelope> events) {
    }
}
