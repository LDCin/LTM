package com.ltm.qrorder.order;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Lưu Idempotency-Key đã dùng. key_value là PRIMARY KEY nên DB đảm bảo
 * mỗi key chỉ được INSERT thành công đúng một lần, kể cả khi hai request tới cùng lúc.
 */
@Repository
public class IdempotencyRepository {

    private static final long RETENTION_MS = 24 * 60 * 60 * 1000L;

    public record IdempotencyRecord(String key, String requestHash, Long orderId) {
    }

    private final JdbcTemplate jdbc;

    public IdempotencyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<IdempotencyRecord> find(String key) {
        List<IdempotencyRecord> rows = jdbc.query(
                "SELECT key_value, request_hash, order_id FROM idempotency_key WHERE key_value = ?",
                (rs, i) -> new IdempotencyRecord(rs.getString("key_value"), rs.getString("request_hash"),
                        rs.getObject("order_id", Long.class)),
                key);
        return rows.stream().findFirst();
    }

    /** Ném DuplicateKeyException nếu key đã tồn tại. */
    public void insert(String key, String requestHash, long now) {
        jdbc.update("INSERT INTO idempotency_key (key_value, request_hash, created_at) VALUES (?, ?, ?)",
                key, requestHash, now);
    }

    public void attachOrder(String key, long orderId) {
        jdbc.update("UPDATE idempotency_key SET order_id = ? WHERE key_value = ?", orderId, key);
    }

    /** Key chỉ cần giữ đủ lâu để bao phủ thời gian retry; xoá key cũ hơn 24h. */
    @Scheduled(fixedDelay = 60 * 60 * 1000L)
    public void purgeExpired() {
        jdbc.update("DELETE FROM idempotency_key WHERE created_at < ?", System.currentTimeMillis() - RETENTION_MS);
    }
}
