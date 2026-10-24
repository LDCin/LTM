package com.ltm.qrorder.auth;

import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/** Bảo vệ /api/kitchen/** (KITCHEN, ADMIN), /api/cashier/** (CASHIER, ADMIN) và /api/admin/** (chỉ ADMIN). */
@Component
public class StaffAuthInterceptor implements HandlerInterceptor {

    public static final String ATTR = "staff";

    private final AuthService auth;

    public StaffAuthInterceptor(AuthService auth) {
        this.auth = auth;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        if ("OPTIONS".equalsIgnoreCase(req.getMethod())) {
            return true;
        }
        StaffPrincipal staff = auth.verify(AuthService.bearer(req.getHeader("Authorization")));
        if (staff == null) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Cần đăng nhập tài khoản nhân viên");
        }
        String uri = req.getRequestURI();
        if (uri.startsWith("/api/admin") && !staff.isAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Chỉ quản trị viên được truy cập");
        }
        if (uri.startsWith("/api/kitchen") && !staff.canUseKitchen()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Chỉ nhân viên bếp được truy cập");
        }
        if (uri.startsWith("/api/cashier") && !staff.canUseCashier()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Chỉ thu ngân được truy cập");
        }
        req.setAttribute(ATTR, staff);
        return true;
    }
}
