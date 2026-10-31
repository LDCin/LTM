package com.ltm.qrorder.ws;

import java.security.Principal;

/**
 * Danh tính của một kết nối WebSocket, gán lúc STOMP CONNECT.
 * name là duy nhất theo session để server gửi riêng cho đúng kết nối (/user/queue/...).
 * staffRole (chỉ với nhân viên): ADMIN / KITCHEN / CASHIER, quyết định được nghe /topic/cashier hay không.
 */
public record WsPrincipal(String name, String sessionId, ClientRole role, Long tableId, String label, String staffRole)
        implements Principal {

    public enum ClientRole { STAFF, CUSTOMER }

    @Override
    public String getName() {
        return name;
    }

    public boolean canUseCashier() {
        return "ADMIN".equals(staffRole) || "CASHIER".equals(staffRole);
    }
}
