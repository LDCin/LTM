package com.ltm.qrorder.order;

import java.util.Collection;

/** Trạng thái tổng của đơn, được suy ra từ trạng thái các món. */
public enum OrderStatus {
    NEW, IN_PROGRESS, COMPLETED, CANCELLED;

    public static OrderStatus derive(Collection<OrderItemStatus> items) {
        if (items.isEmpty() || items.stream().allMatch(s -> s == OrderItemStatus.CANCELLED)) {
            return CANCELLED;
        }
        if (items.stream().allMatch(OrderItemStatus::isFinished)) {
            return COMPLETED;
        }
        if (items.stream().allMatch(s -> s == OrderItemStatus.PENDING)) {
            return NEW;
        }
        return IN_PROGRESS;
    }
}
