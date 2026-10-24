package com.ltm.qrorder.payment;

import com.ltm.qrorder.common.Jdbc;
import com.ltm.qrorder.payment.PaymentDtos.PaymentDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class PaymentRepository {

    private static final String SELECT =
            "SELECT p.id, p.table_id, t.code AS table_code, p.session_id, p.amount, p.method, p.status, p.version, " +
                    "p.created_at, p.expires_at, p.paid_at, p.needs_refund, p.confirmed_by, p.txn_ref, " +
                    "p.provider_create_date FROM payment p JOIN restaurant_table t ON t.id = p.table_id ";

    /** Bản ghi đầy đủ (gồm cả các cột nội bộ không trả ra ngoài như txn_ref). */
    public record PaymentRow(PaymentDto dto, String txnRef, String providerCreateDate) {
    }

    private static final RowMapper<PaymentRow> MAPPER = (rs, n) -> new PaymentRow(new PaymentDto(
            rs.getLong("id"), rs.getLong("table_id"), rs.getString("table_code"), rs.getLong("session_id"),
            rs.getLong("amount"), rs.getString("method"), rs.getString("status"), rs.getInt("version"),
            rs.getLong("created_at"), rs.getLong("expires_at"), rs.getObject("paid_at", Long.class),
            rs.getBoolean("needs_refund"), rs.getString("confirmed_by"), null),
            rs.getString("txn_ref"), rs.getString("provider_create_date"));

    private final JdbcTemplate jdbc;

    public PaymentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Tạo lần thanh toán PENDING. pending_session_id = session_id: nếu phiên đã có lần đang chờ,
     * ràng buộc UNIQUE ném DuplicateKeyException (cũng vậy nếu trùng idempotency_key).
     */
    public long insertPending(long sessionId, long tableId, long amount, String method, String txnRef,
                              String idempotencyKey, String deviceId, String providerCreateDate,
                              long now, long expiresAt) {
        return Jdbc.insert(jdbc,
                "INSERT INTO payment (session_id, table_id, amount, method, status, version, txn_ref, idempotency_key, " +
                        "pending_session_id, provider_create_date, created_by_device, created_at, expires_at, updated_at) " +
                        "VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?, ?, ?, ?, ?)",
                "id", sessionId, tableId, amount, method, txnRef, idempotencyKey, sessionId, providerCreateDate,
                deviceId, now, expiresAt, now);
    }

    public Optional<PaymentRow> find(long id) {
        return jdbc.query(SELECT + "WHERE p.id = ?", MAPPER, id).stream().findFirst();
    }

    public Optional<PaymentRow> findByTxnRef(String txnRef) {
        return jdbc.query(SELECT + "WHERE p.txn_ref = ?", MAPPER, txnRef).stream().findFirst();
    }

    public Optional<PaymentRow> findByIdempotencyKey(String key) {
        return jdbc.query(SELECT + "WHERE p.idempotency_key = ?", MAPPER, key).stream().findFirst();
    }

    public Optional<PaymentRow> findPending(long sessionId) {
        return jdbc.query(SELECT + "WHERE p.pending_session_id = ?", MAPPER, sessionId).stream().findFirst();
    }

    public List<PaymentRow> listBySession(long sessionId) {
        return jdbc.query(SELECT + "WHERE p.session_id = ? ORDER BY p.id", MAPPER, sessionId);
    }

    public List<PaymentRow> listRecent(int limit) {
        return jdbc.query(SELECT + "ORDER BY p.id DESC LIMIT " + Math.max(1, Math.min(limit, 500)), MAPPER);
    }

    public List<PaymentRow> listPendingExpired(long now) {
        return jdbc.query(SELECT + "WHERE p.status = 'PENDING' AND p.expires_at < ?", MAPPER, now);
    }

    /**
     * Ghi nhận đã trả tiền. Chỉ cập nhật nếu trạng thái hiện tại nằm trong allowedFrom
     * (và version khớp, nếu truyền vào) -> gọi lặp (IPN gửi lại, hai thu ngân cùng bấm) không xử lý hai lần.
     *
     * @return số dòng cập nhật (0 = đã bị xử lý trước đó / sai version)
     */
    public int markPaid(long id, List<String> allowedFrom, Integer expectedVersion, String providerTxnNo,
                        String confirmedBy, boolean needsRefund, long now) {
        String statuses = "'" + String.join("','", allowedFrom) + "'";
        String sql = "UPDATE payment SET status = 'PAID', pending_session_id = NULL, version = version + 1, " +
                "paid_at = ?, provider_txn_no = COALESCE(?, provider_txn_no), confirmed_by = ?, needs_refund = ?, " +
                "updated_at = ? WHERE id = ? AND status IN (" + statuses + ")";
        if (expectedVersion != null) {
            return jdbc.update(sql + " AND version = ?", now, providerTxnNo, confirmedBy, needsRefund, now, id,
                    expectedVersion);
        }
        return jdbc.update(sql, now, providerTxnNo, confirmedBy, needsRefund, now, id);
    }

    /** Chuyển một lần đang PENDING sang FAILED / EXPIRED / CANCELLED (giải phóng chỗ "đang chờ" của phiên). */
    public int closePending(long id, String toStatus, String by, long now) {
        return jdbc.update("UPDATE payment SET status = ?, pending_session_id = NULL, version = version + 1, " +
                        "confirmed_by = COALESCE(?, confirmed_by), updated_at = ? WHERE id = ? AND status = 'PENDING'",
                toStatus, by, now, id);
    }

    // ------------------------------------------------------------------ số liệu hóa đơn

    /** Tổng tiền các món không bị huỷ trong phiên (giá đã chụp lại lúc đặt). */
    public long sessionTotal(long sessionId) {
        Long v = jdbc.queryForObject(
                "SELECT COALESCE(SUM(i.unit_price * i.quantity), 0) FROM order_item i JOIN orders o ON o.id = i.order_id " +
                        "WHERE o.session_id = ? AND i.status <> 'CANCELLED'", Long.class, sessionId);
        return v == null ? 0 : v;
    }

    /** Tổng các lần đã trả của phiên, trừ lần excludeId (dùng khi xét tiền về muộn). */
    public long sessionPaid(long sessionId, Long excludeId) {
        Long v = jdbc.queryForObject(
                "SELECT COALESCE(SUM(amount), 0) FROM payment WHERE session_id = ? AND status = 'PAID' AND id <> ?",
                Long.class, sessionId, excludeId == null ? -1L : excludeId);
        return v == null ? 0 : v;
    }

    public Long lastPaidAt(long sessionId) {
        return jdbc.queryForObject("SELECT MAX(paid_at) FROM payment WHERE session_id = ? AND status = 'PAID'",
                Long.class, sessionId);
    }

    public boolean sessionNeedsRefund(long sessionId) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM payment WHERE session_id = ? AND needs_refund = TRUE",
                Long.class, sessionId);
        return n != null && n > 0;
    }

    /** Các bàn đang có phiên: [tableId, sessionId, openedAt]. Dùng cho tác vụ tự động. */
    public List<long[]> openSessions() {
        return jdbc.query("SELECT t.id, t.current_session_id, s.opened_at FROM restaurant_table t " +
                        "JOIN table_session s ON s.id = t.current_session_id",
                (rs, n) -> new long[]{rs.getLong(1), rs.getLong(2), rs.getLong(3)});
    }
}
