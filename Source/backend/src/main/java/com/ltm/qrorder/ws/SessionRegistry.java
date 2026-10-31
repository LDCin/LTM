package com.ltm.qrorder.ws;

import com.ltm.qrorder.ws.WsPrincipal.ClientRole;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Danh sách kết nối WebSocket đang mở (trạng thái dùng chung giữa nhiều thread).
 * - ConcurrentHashMap: thêm/xoá session an toàn khi nhiều kết nối đến/đi cùng lúc.
 * - Đếm số kết nối mỗi bàn bằng AtomicInteger + compareAndSet (không cần khoá).
 */
@Component
public class SessionRegistry {

    public static final class ClientSession {
        private final String sessionId;
        private final ClientRole role;
        private final Long tableId;
        private final String label;
        private final long connectedAt;
        private volatile long lastAckSeq;
        private volatile long lastAckAt;

        ClientSession(String sessionId, ClientRole role, Long tableId, String label) {
            this.sessionId = sessionId;
            this.role = role;
            this.tableId = tableId;
            this.label = label;
            this.connectedAt = System.currentTimeMillis();
        }

        public String getSessionId() { return sessionId; }
        public ClientRole getRole() { return role; }
        public Long getTableId() { return tableId; }
        public String getLabel() { return label; }
        public long getConnectedAt() { return connectedAt; }
        public long getLastAckSeq() { return lastAckSeq; }
        public long getLastAckAt() { return lastAckAt; }
    }

    private final ConcurrentHashMap<String, ClientSession> sessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, AtomicInteger> perTable = new ConcurrentHashMap<>();

    /** @return false nếu bàn đã đạt giới hạn kết nối. */
    public boolean tryRegisterCustomer(String sessionId, long tableId, String label, int maxPerTable) {
        AtomicInteger counter = perTable.computeIfAbsent(tableId, k -> new AtomicInteger());
        while (true) {
            int current = counter.get();
            if (current >= maxPerTable) {
                return false;
            }
            if (counter.compareAndSet(current, current + 1)) {
                break;
            }
        }
        sessions.put(sessionId, new ClientSession(sessionId, ClientRole.CUSTOMER, tableId, label));
        return true;
    }

    public void registerStaff(String sessionId, String label) {
        sessions.put(sessionId, new ClientSession(sessionId, ClientRole.STAFF, null, label));
    }

    public void remove(String sessionId) {
        ClientSession s = sessions.remove(sessionId);
        if (s != null && s.tableId != null) {
            AtomicInteger counter = perTable.get(s.tableId);
            if (counter != null) {
                counter.decrementAndGet();
            }
        }
    }

    public void onAck(String sessionId, long seq) {
        ClientSession s = sessions.get(sessionId);
        if (s != null && seq > s.lastAckSeq) {
            s.lastAckSeq = seq;
            s.lastAckAt = System.currentTimeMillis();
        }
    }

    public Collection<ClientSession> all() {
        return sessions.values();
    }

    public long count(ClientRole role) {
        return sessions.values().stream().filter(s -> s.role == role).count();
    }
}
