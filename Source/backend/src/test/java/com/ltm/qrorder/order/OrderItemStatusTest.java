package com.ltm.qrorder.order;

import org.junit.jupiter.api.Test;

import java.util.List;

import static com.ltm.qrorder.order.OrderItemStatus.ACCEPTED;
import static com.ltm.qrorder.order.OrderItemStatus.CANCELLED;
import static com.ltm.qrorder.order.OrderItemStatus.PENDING;
import static com.ltm.qrorder.order.OrderItemStatus.SERVED;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OrderItemStatusTest {

    @Test
    void happyPath() {
        assertTrue(PENDING.canTransitionTo(ACCEPTED));
        assertTrue(ACCEPTED.canTransitionTo(SERVED));
    }

    @Test
    void rejectsInvalidTransitions() {
        assertFalse(PENDING.canTransitionTo(SERVED));
        assertFalse(ACCEPTED.canTransitionTo(CANCELLED));
        assertFalse(SERVED.canTransitionTo(PENDING));
        assertFalse(CANCELLED.canTransitionTo(ACCEPTED));
    }

    @Test
    void derivesOrderStatus() {
        assertEquals(OrderStatus.NEW, OrderStatus.derive(List.of(PENDING, PENDING)));
        assertEquals(OrderStatus.IN_PROGRESS, OrderStatus.derive(List.of(PENDING, ACCEPTED)));
        assertEquals(OrderStatus.COMPLETED, OrderStatus.derive(List.of(SERVED, CANCELLED)));
        assertEquals(OrderStatus.CANCELLED, OrderStatus.derive(List.of(CANCELLED, CANCELLED)));
    }
}
