package com.ltm.qrorder.event;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ltm.qrorder.common.Jdbc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Event log (outbox pattern). Mỗi thay đổi trạng thái đơn được ghi thành một dòng trong
 * order_event CÙNG transaction với thay đổi dữ liệu, nên log luôn khớp với DB.
 * Khi màn hình bếp kết nối lại, server đọc log từ seq bị lỡ để gửi bù (replay).
 */
@Repository
public class EventStore {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public EventStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public EventEnvelope append(long orderId, long tableId, String type, Object payload) {
        long now = System.currentTimeMillis();
        String eventId = UUID.randomUUID().toString();
        String json;
        try {
            json = mapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Không serialize được payload sự kiện", e);
        }
        long seq = Jdbc.insert(jdbc,
                "INSERT INTO order_event (event_id, order_id, table_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                "seq", eventId, orderId, tableId, type, json, now);
        return new EventEnvelope(type, seq, eventId, now, payload);
    }

    public long latestSeq() {
        Long seq = jdbc.queryForObject("SELECT COALESCE(MAX(seq), 0) FROM order_event", Long.class);
        return seq == null ? 0 : seq;
    }

    /** Các sự kiện có seq > afterSeq, theo thứ tự tăng dần. */
    public List<EventEnvelope> after(long afterSeq, int limit) {
        return jdbc.query(
                "SELECT seq, event_id, type, payload, created_at FROM order_event WHERE seq > ? ORDER BY seq LIMIT ?",
                (rs, i) -> new EventEnvelope(
                        rs.getString("type"),
                        rs.getLong("seq"),
                        rs.getString("event_id"),
                        rs.getLong("created_at"),
                        readJson(rs.getString("payload"))),
                afterSeq, limit);
    }

    private Object readJson(String json) {
        try {
            return mapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Payload sự kiện hỏng", e);
        }
    }
}
