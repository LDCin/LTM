package com.ltm.qrorder.auth;

/** Nhân viên đã xác thực (lấy từ token). role: ADMIN hoặc KITCHEN. */
public record StaffPrincipal(long id, String username, String role) {

    public boolean isAdmin() {
        return "ADMIN".equals(role);
    }
}
