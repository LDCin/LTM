package com.ltm.qrorder.ws;

import java.security.Principal;

/**
 * Danh tính của một kết nối WebSocket, gán lúc STOMP CONNECT.
 * name là duy nhất theo session để server gửi riêng cho đúng kết nối (/user/queue/...).
 */
public record WsPrincipal(String name, String sessionId, ClientRole role, Long tableId, String label)
        implements Principal {

    public enum ClientRole { STAFF, CUSTOMER }

    @Override
    public String getName() {
        return name;
    }
}
