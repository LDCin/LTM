package com.ltm.qrorder.servicecall;

import com.ltm.qrorder.common.Jdbc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class ServiceCallRepository {

    /** Một lượt khách gọi phục vụ. handledAt = null: đang chờ nhân viên. */
    public record ServiceCallDto(long id, long tableId, String tableCode, long sessionId, String guestName,
                                 long createdAt, Long handledAt, String handledBy) {
    }

    private static final String SELECT =
            "SELECT c.id, c.table_id, t.code AS table_code, c.session_id, c.guest_name, c.created_at, " +
                    "c.handled_at, c.handled_by FROM service_call c JOIN restaurant_table t ON t.id = c.table_id ";

    private static final RowMapper<ServiceCallDto> MAPPER = (rs, n) -> new ServiceCallDto(
            rs.getLong("id"), rs.getLong("table_id"), rs.getString("table_code"), rs.getLong("session_id"),
            rs.getString("guest_name"), rs.getLong("created_at"), rs.getObject("handled_at", Long.class),
            rs.getString("handled_by"));

    private final JdbcTemplate jdbc;

    public ServiceCallRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Ném DuplicateKeyException nếu phiên đã có lượt gọi đang mở (ràng buộc UNIQUE open_session_id). */
    public long insertOpen(long sessionId, long tableId, String guestName, long now) {
        return Jdbc.insert(jdbc,
                "INSERT INTO service_call (session_id, table_id, guest_name, open_session_id, created_at) " +
                        "VALUES (?, ?, ?, ?, ?)",
                "id", sessionId, tableId, guestName, sessionId, now);
    }

    public Optional<ServiceCallDto> find(long id) {
        return jdbc.query(SELECT + "WHERE c.id = ?", MAPPER, id).stream().findFirst();
    }

    public Optional<ServiceCallDto> findOpen(long sessionId) {
        return jdbc.query(SELECT + "WHERE c.open_session_id = ?", MAPPER, sessionId).stream().findFirst();
    }

    /** Lượt gọi đang mở của các phiên còn hoạt động (phiên đã kết thúc thì bỏ qua), cũ nhất trước. */
    public List<ServiceCallDto> findOpenOfActiveSessions() {
        return jdbc.query(SELECT + "WHERE c.open_session_id IS NOT NULL AND t.current_session_id = c.session_id " +
                "ORDER BY c.created_at", MAPPER);
    }

    /** @return true nếu lượt gọi vừa được đóng bởi lần gọi này (false: đã có người xử lý trước). */
    public boolean markHandled(long id, String by, long now) {
        return jdbc.update("UPDATE service_call SET handled_at = ?, handled_by = ?, open_session_id = NULL " +
                "WHERE id = ? AND open_session_id IS NOT NULL", now, by, id) == 1;
    }
}
