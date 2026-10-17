package com.ltm.qrorder.config;

/**
 * Cách đơn hàng được giao tới màn hình bếp. Dùng để so sánh baseline với giải pháp đề xuất.
 */
public enum DeliveryMode {
    /** Baseline A: bếp tự hỏi server định kỳ (GET /api/kitchen/events). */
    POLLING,
    /** Baseline B: server đẩy qua WebSocket kiểu fire-and-forget, không ACK/replay. */
    NAIVE_PUSH,
    /** Đề xuất: đẩy qua WebSocket + seq + ACK + RESUME/replay từ event log. */
    RELIABLE_PUSH
}
