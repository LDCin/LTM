package com.ltm.qrorder.auth;

/** Nhân viên đã xác thực (lấy từ token). role: ADMIN, KITCHEN hoặc CASHIER. */
public record StaffPrincipal(long id, String username, String role) {

    public boolean isAdmin() {
        return "ADMIN".equals(role);
    }

    /** Được dùng màn hình bếp (/api/kitchen). */
    public boolean canUseKitchen() {
        return isAdmin() || "KITCHEN".equals(role);
    }

    /** Được dùng quầy thu ngân (/api/cashier, /topic/cashier). */
    public boolean canUseCashier() {
        return isAdmin() || "CASHIER".equals(role);
    }
}
