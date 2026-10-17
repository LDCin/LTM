package com.ltm.qrorder.table;

public record TableInfo(long id, String code, String qrToken, String status, Long sessionId) {

    public boolean isOpen() {
        return "OPEN".equals(status) && sessionId != null;
    }
}
