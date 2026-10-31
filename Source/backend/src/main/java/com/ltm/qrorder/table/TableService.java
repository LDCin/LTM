package com.ltm.qrorder.table;

import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.common.Jdbc;
import com.ltm.qrorder.event.EventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * Bàn ăn và phiên bàn.
 *
 * - Mỗi bàn có một qr_token ngẫu nhiên (khó đoán) in trong mã QR.
 * - status: OPEN = đang phục vụ, CLOSED = ngừng phục vụ (admin bảo trì).
 * - Phiên (table_session) = một lượt khách. Phiên tự mở khi khách đầu tiên "vào bàn" (join),
 *   kết thúc khi thu ngân bấm "Trả bàn" hoặc tác vụ tự động. Nhiều điện thoại cùng bàn dùng chung một phiên.
 */
@Service
public class TableService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String SELECT =
            "SELECT id, code, qr_token, status, current_session_id FROM restaurant_table ";
    private static final RowMapper<TableInfo> MAPPER = (rs, i) -> new TableInfo(
            rs.getLong("id"), rs.getString("code"), rs.getString("qr_token"), rs.getString("status"),
            rs.getObject("current_session_id", Long.class));

    private final JdbcTemplate jdbc;
    private final EventPublisher publisher;
    private final TransactionTemplate tx;

    public TableService(JdbcTemplate jdbc, EventPublisher publisher, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.publisher = publisher;
        this.tx = tx;
    }

    public static String newToken() {
        byte[] bytes = new byte[18];          // 144 bit ngẫu nhiên -> không thể đoán
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    // ================================================================ tra cứu

    public TableInfo resolveToken(String token) {
        if (token == null || token.isBlank() || token.length() > 64) {
            throw new ApiException(ErrorCode.INVALID_TABLE_TOKEN, "Mã QR không hợp lệ");
        }
        List<TableInfo> rows = jdbc.query(SELECT + "WHERE qr_token = ?", MAPPER, token);
        if (rows.isEmpty()) {
            throw new ApiException(ErrorCode.INVALID_TABLE_TOKEN, "Mã QR không hợp lệ hoặc đã bị thay đổi");
        }
        return rows.get(0);
    }

    /**
     * Bàn phải đang phục vụ và đang có phiên.
     * expectedSessionId (header X-Session-Id của khách): nếu gửi thì phải trùng phiên hiện tại,
     * để máy của lượt khách trước (chưa đóng trang) không đặt món vào phiên của lượt khách sau.
     */
    public TableInfo requireSession(String token, Long expectedSessionId) {
        TableInfo t = resolveToken(token);
        if (!t.inService()) {
            throw new ApiException(ErrorCode.TABLE_CLOSED,
                    "Bàn " + t.code() + " đang tạm ngừng phục vụ", Map.of("tableCode", t.code()));
        }
        if (!t.hasSession() || (expectedSessionId != null && !expectedSessionId.equals(t.sessionId()))) {
            throw new ApiException(ErrorCode.SESSION_ENDED,
                    "Lượt của bạn ở bàn " + t.code() + " đã kết thúc, vui lòng tải lại trang",
                    Map.of("tableCode", t.code()));
        }
        return t;
    }

    public TableInfo requireOpen(String token) {
        return requireSession(token, null);
    }

    public List<TableInfo> list() {
        return jdbc.query(SELECT + "ORDER BY code", MAPPER);
    }

    public TableInfo get(long id) {
        List<TableInfo> rows = jdbc.query(SELECT + "WHERE id = ?", MAPPER, id);
        if (rows.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy bàn #" + id);
        }
        return rows.get(0);
    }

    public Long sessionOpenedAt(long sessionId) {
        List<Long> rows = jdbc.query("SELECT opened_at FROM table_session WHERE id = ?",
                (rs, i) -> rs.getLong("opened_at"), sessionId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ================================================================ khách vào bàn

    /**
     * Khách quét QR: vào phiên đang có, hoặc mở phiên mới nếu bàn trống.
     *
     * Hai điện thoại quét cùng lúc khi bàn trống: cả hai cùng INSERT một phiên, nhưng câu UPDATE có điều kiện
     * "current_session_id IS NULL" chỉ thành công với một bên. Bên thua rollback (phiên nó tạo bị huỷ)
     * rồi đọc lại và vào chung phiên của bên thắng -> cả bàn luôn chung một phiên.
     *
     * @return bàn kèm phiên hiện tại, và created = true nếu phiên vừa được mở bởi lần gọi này
     */
    public JoinResult join(String token) {
        for (int attempt = 0; attempt < 3; attempt++) {
            TableInfo t = resolveToken(token);
            if (!t.inService()) {
                throw new ApiException(ErrorCode.TABLE_CLOSED,
                        "Bàn " + t.code() + " đang tạm ngừng phục vụ, vui lòng gọi nhân viên",
                        Map.of("tableCode", t.code()));
            }
            if (t.hasSession()) {
                return new JoinResult(t, false);
            }
            Boolean opened = tx.execute(status -> {
                if (startSessionIfIdle(t.id()) == null) {
                    status.setRollbackOnly();
                    return false;
                }
                return true;
            });
            if (Boolean.TRUE.equals(opened)) {
                publisher.broadcast(EventPublisher.CASHIER_TOPIC, Map.of("type", "TABLE_STATE_CHANGED", "tableId", t.id()));
                return new JoinResult(get(t.id()), true);
            }
            // Máy khác vừa mở phiên trước: vòng lặp đọc lại và vào chung phiên đó
        }
        throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, "Bàn đang bận, vui lòng thử lại",
                Map.of("retryAfterSeconds", 1));
    }

    public record JoinResult(TableInfo table, boolean created) {
    }

    /**
     * Mở phiên mới nếu bàn đang phục vụ và đang trống. Phải chạy trong transaction.
     * @return id phiên mới, hoặc null nếu bàn đã có phiên / ngừng phục vụ (không thay đổi gì)
     */
    private Long startSessionIfIdle(long tableId) {
        long sessionId = Jdbc.insert(jdbc,
                "INSERT INTO table_session (table_id, opened_at) VALUES (?, ?)",
                "id", tableId, System.currentTimeMillis());
        int updated = jdbc.update(
                "UPDATE restaurant_table SET current_session_id = ? " +
                        "WHERE id = ? AND current_session_id IS NULL AND status = 'OPEN'",
                sessionId, tableId);
        return updated == 1 ? sessionId : null;
    }

    // ================================================================ kết thúc phiên ("Trả bàn")

    /**
     * Kết thúc phiên hiện tại của bàn: bàn trở về trống, lượt khách sau quét QR sẽ có phiên mới.
     * Chỉ kết thúc đúng phiên expectedSessionId (nếu truyền vào) để tác vụ tự động không kết thúc nhầm
     * phiên mới mở xen giữa.
     *
     * @return true nếu đã kết thúc một phiên
     */
    @Transactional
    public boolean endSession(long tableId, Long expectedSessionId, String reason, String note, String by) {
        TableInfo t = get(tableId);
        if (!t.hasSession() || (expectedSessionId != null && !expectedSessionId.equals(t.sessionId()))) {
            return false;
        }
        int updated = jdbc.update("UPDATE restaurant_table SET current_session_id = NULL WHERE id = ? AND current_session_id = ?",
                tableId, t.sessionId());
        if (updated == 0) {
            return false;
        }
        jdbc.update("UPDATE table_session SET closed_at = ?, end_reason = ?, end_note = ?, ended_by = ? WHERE id = ?",
                System.currentTimeMillis(), reason, note, by, t.sessionId());
        publisher.broadcast(EventPublisher.tableTopic(tableId),
                Map.of("type", "TABLE_SESSION_ENDED", "tableId", tableId, "sessionId", t.sessionId()));
        publisher.broadcast(EventPublisher.CASHIER_TOPIC, Map.of("type", "TABLE_STATE_CHANGED", "tableId", tableId));
        return true;
    }

    // ================================================================ quản trị

    @Transactional
    public TableInfo create(String code) {
        long id = Jdbc.insert(jdbc,
                "INSERT INTO restaurant_table (code, qr_token, status) VALUES (?, ?, 'OPEN')",
                "id", code, newToken());
        publisher.broadcast(EventPublisher.CASHIER_TOPIC, Map.of("type", "TABLE_STATE_CHANGED", "tableId", id));
        return get(id);
    }

    /**
     * Tạo nhanh nhiều bàn (dùng cho thực nghiệm tải). Bàn đã tồn tại thì bỏ qua.
     * withSession = true: mở sẵn phiên để bộ đo đặt món ngay, không cần gọi /join.
     */
    @Transactional
    public List<TableInfo> bulkCreate(String prefix, int count, boolean withSession) {
        List<TableInfo> result = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            String code = prefix + String.format("%03d", i);
            List<TableInfo> existing = jdbc.query(SELECT + "WHERE code = ?", MAPPER, code);
            TableInfo t = existing.isEmpty() ? create(code) : existing.get(0);
            if (withSession) {
                if (!t.inService()) {
                    jdbc.update("UPDATE restaurant_table SET status = 'OPEN' WHERE id = ?", t.id());
                }
                startSessionIfIdle(t.id());
            }
            result.add(get(t.id()));
        }
        return result;
    }

    /** Admin: cho bàn phục vụ trở lại. Không mở phiên; phiên mở khi khách quét QR. */
    @Transactional
    public TableInfo open(long id) {
        TableInfo t = get(id);
        if (!t.inService()) {
            jdbc.update("UPDATE restaurant_table SET status = 'OPEN' WHERE id = ?", id);
            publisher.broadcast(EventPublisher.CASHIER_TOPIC, Map.of("type", "TABLE_STATE_CHANGED", "tableId", id));
        }
        return get(id);
    }

    /** Admin: ngừng phục vụ bàn (bảo trì). Không cho đóng khi bàn đang có khách. */
    @Transactional
    public TableInfo close(long id) {
        TableInfo t = get(id);
        if (t.hasSession()) {
            throw new ApiException(ErrorCode.TABLE_HAS_GUESTS,
                    "Bàn " + t.code() + " đang có khách, cần thanh toán và trả bàn trước", Map.of("tableCode", t.code()));
        }
        if (t.inService()) {
            jdbc.update("UPDATE restaurant_table SET status = 'CLOSED' WHERE id = ?", id);
            publisher.broadcast(EventPublisher.tableTopic(id), Map.of("type", "TABLE_CLOSED", "tableId", id));
            publisher.broadcast(EventPublisher.CASHIER_TOPIC, Map.of("type", "TABLE_STATE_CHANGED", "tableId", id));
        }
        return get(id);
    }

    /** Kết thúc rồi mở lại phiên của mọi bàn có mã bắt đầu bằng prefix. Dùng để dọn dữ liệu thực nghiệm. */
    @Transactional
    public int resetSessions(String codePrefix) {
        List<TableInfo> list = jdbc.query(SELECT + "WHERE code LIKE ?", MAPPER, codePrefix + "%");
        for (TableInfo t : list) {
            endSession(t.id(), null, "OTHER", "Dọn dữ liệu thực nghiệm", "system");
            if (!t.inService()) {
                jdbc.update("UPDATE restaurant_table SET status = 'OPEN' WHERE id = ?", t.id());
            }
            startSessionIfIdle(t.id());
        }
        return list.size();
    }

    /** Đổi mã QR: ảnh QR cũ (VD khách chụp mang về) không dùng được nữa. */
    @Transactional
    public TableInfo rotateToken(long id) {
        get(id);
        jdbc.update("UPDATE restaurant_table SET qr_token = ? WHERE id = ?", newToken(), id);
        publisher.broadcast(EventPublisher.tableTopic(id), Map.of("type", "TABLE_TOKEN_ROTATED", "tableId", id));
        return get(id);
    }
}
