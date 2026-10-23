package com.ltm.qrorder.ws;

import java.security.Principal;

/**
 * Danh tính của một kết nối WebSocket, gán lúc STOMP CONNECT.
 * name là duy nhất theo session để server gửi riêng cho đúng kết nối (/user/queue/...).
 * deviceId (chỉ với khách) quyết định topic riêng /topic/guest.{deviceId} mà kết nối được phép nghe.
 */
public record WsPrincipal(String name, String sessionId, ClientRole role, Long tableId, String label, String deviceId)
        implements Principal {

    public enum ClientRole { STAFF, CUSTOMER }

    @Override
    public String getName() {
        return name;
    }
}
