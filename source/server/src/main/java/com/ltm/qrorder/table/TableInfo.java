package com.ltm.qrorder.table;

/**
 * status: OPEN = bàn đang phục vụ, CLOSED = ngừng phục vụ (admin đóng để bảo trì).
 * sessionId: phiên của lượt khách đang ngồi; null = bàn trống.
 */
public record TableInfo(long id, String code, String qrToken, String status, Long sessionId) {

    /** Admin cho phép phục vụ bàn này. */
    public boolean inService() {
        return "OPEN".equals(status);
    }

    /** Đang có lượt khách (phiên) ngồi ở bàn. */
    public boolean hasSession() {
        return sessionId != null;
    }

    /** Đặt món được: bàn đang phục vụ và đang có phiên. */
    public boolean isOpen() {
        return inService() && hasSession();
    }
}
