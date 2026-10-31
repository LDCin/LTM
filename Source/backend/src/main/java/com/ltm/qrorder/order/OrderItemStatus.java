package com.ltm.qrorder.order;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * State machine của một món trong đơn.
 *
 * <pre>
 * PENDING (chưa tiếp nhận) ──▶ ACCEPTED (đã tiếp nhận) ──▶ SERVED (đã phục vụ)
 *    │
 *    └──▶ CANCELLED   (chỉ khi còn PENDING: khách huỷ, bếp từ chối hoặc quá hạn chờ; món đã nhận dùng "Huỷ món" có lý do)
 * </pre>
 *
 * Mọi chuyển trạng thái khác bị từ chối với 409 INVALID_STATE_TRANSITION.
 */
public enum OrderItemStatus {
    PENDING, ACCEPTED, SERVED, CANCELLED;

    public Set<OrderItemStatus> allowedNext() {
        return switch (this) {
            case PENDING -> EnumSet.of(ACCEPTED, CANCELLED);
            case ACCEPTED -> EnumSet.of(SERVED);
            case SERVED, CANCELLED -> EnumSet.noneOf(OrderItemStatus.class);
        };
    }

    public boolean canTransitionTo(OrderItemStatus next) {
        return allowedNext().contains(next);
    }

    public boolean isFinished() {
        return this == SERVED || this == CANCELLED;
    }

    public List<String> allowedNextNames() {
        return allowedNext().stream().map(Enum::name).toList();
    }
}
