package com.ltm.qrorder.event;

/**
 * Envelope chung của mọi sự kiện đẩy qua WebSocket (giao thức do nhóm thiết kế).
 *
 * <pre>
 * { "type": "ORDER_CREATED", "seq": 1024, "eventId": "uuid", "serverTime": 1760692991123, "payload": {...} }
 * </pre>
 *
 * seq tăng dần toàn cục (do order_event.seq cấp) giúp client phát hiện mất/trùng/sai thứ tự.
 */
public record EventEnvelope(String type, long seq, String eventId, long serverTime, Object payload) {
}
