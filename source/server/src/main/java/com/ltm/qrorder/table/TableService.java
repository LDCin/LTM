package com.ltm.qrorder.table;

import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.common.Jdbc;
import com.ltm.qrorder.event.EventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * Bàn ăn và phiên bàn. Mỗi bàn có một qr_token ngẫu nhiên (khó đoán) in trong mã QR.
 * Khách chỉ đặt được món khi bàn đang OPEN (nhân viên mở bàn khi khách ngồi).
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

    public TableService(JdbcTemplate jdbc, EventPublisher publisher) {
        this.jdbc = jdbc;
        this.publisher = publisher;
    }

    public static String newToken() {
        byte[] bytes = new byte[18];          // 144 bit ngẫu nhiên -> không thể đoán
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

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

    public TableInfo requireOpen(String token) {
        TableInfo t = resolveToken(token);
        if (!t.isOpen()) {
            throw new ApiException(ErrorCode.TABLE_CLOSED,
                    "Bàn " + t.code() + " chưa được mở, vui lòng gọi nhân viên", Map.of("tableCode", t.code()));
        }
        return t;
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

    @Transactional
    public TableInfo create(String code) {
        long id = Jdbc.insert(jdbc,
                "INSERT INTO restaurant_table (code, qr_token, status) VALUES (?, ?, 'CLOSED')",
                "id", code, newToken());
        return get(id);
    }

    /** Tạo nhanh nhiều bàn (dùng cho thực nghiệm tải). Bàn đã tồn tại thì bỏ qua. */
    @Transactional
    public List<TableInfo> bulkCreate(String prefix, int count, boolean open) {
        List<TableInfo> result = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            String code = prefix + String.format("%03d", i);
            List<TableInfo> existing = jdbc.query(SELECT + "WHERE code = ?", MAPPER, code);
            TableInfo t = existing.isEmpty() ? create(code) : existing.get(0);
            result.add(open ? open(t.id()) : t);
        }
        return result;
    }

    @Transactional
    public TableInfo open(long id) {
        TableInfo t = get(id);
        if (t.isOpen()) {
            return t;
        }
        long sessionId = Jdbc.insert(jdbc,
                "INSERT INTO table_session (table_id, opened_at) VALUES (?, ?)",
                "id", id, System.currentTimeMillis());
        jdbc.update("UPDATE restaurant_table SET status = 'OPEN', current_session_id = ? WHERE id = ?", sessionId, id);
        return get(id);
    }

    @Transactional
    public TableInfo close(long id) {
        TableInfo t = get(id);
        if (!t.isOpen()) {
            return t;
        }
        jdbc.update("UPDATE table_session SET closed_at = ? WHERE id = ?", System.currentTimeMillis(), t.sessionId());
        jdbc.update("UPDATE restaurant_table SET status = 'CLOSED', current_session_id = NULL WHERE id = ?", id);
        publisher.broadcast(EventPublisher.tableTopic(id), Map.of("type", "TABLE_CLOSED", "tableId", id));
        return get(id);
    }

    /** Đóng rồi mở lại (phiên mới) mọi bàn có mã bắt đầu bằng prefix. Dùng để dọn dữ liệu thực nghiệm. */
    @Transactional
    public int resetSessions(String codePrefix) {
        List<TableInfo> list = jdbc.query(SELECT + "WHERE code LIKE ?", MAPPER, codePrefix + "%");
        for (TableInfo t : list) {
            close(t.id());
            open(t.id());
        }
        return list.size();
    }

    /** Đổi mã QR: ảnh QR cũ (VD khách chụp mang về) không dùng được nữa. */
    @Transactional
    public TableInfo rotateToken(long id) {
        get(id);
        jdbc.update("UPDATE restaurant_table SET qr_token = ? WHERE id = ?", newToken(), id);
        publisher.broadcast(EventPublisher.tableTopic(id), Map.of("type", "TABLE_CLOSED", "tableId", id));
        return get(id);
    }
}
