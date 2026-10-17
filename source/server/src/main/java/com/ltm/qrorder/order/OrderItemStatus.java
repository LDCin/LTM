package com.ltm.qrorder.order;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * State machine của một món trong đơn.
 *
 * <pre>
 * PENDING ──▶ ACCEPTED ──▶ COOKING ──▶ READY ──▶ SERVED
 *    │
 *    └──▶ CANCELLED   (chỉ khi còn PENDING: khách huỷ hoặc bếp từ chối)
 * </pre>
 *
 * Mọi chuyển trạng thái khác bị từ chối với 409 INVALID_STATE_TRANSITION.
 */
public enum OrderItemStatus {
    PENDING, ACCEPTED, COOKING, READY, SERVED, CANCELLED;

    public Set<OrderItemStatus> allowedNext() {
        return switch (this) {
            case PENDING -> EnumSet.of(ACCEPTED, CANCELLED);
            case ACCEPTED -> EnumSet.of(COOKING);
            case COOKING -> EnumSet.of(READY);
            case READY -> EnumSet.of(SERVED);
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
