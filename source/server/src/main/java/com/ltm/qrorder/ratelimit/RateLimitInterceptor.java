package com.ltm.qrorder.ratelimit;

import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Map;

/**
 * Chặn request vượt ngưỡng TRƯỚC khi vào controller/DB, nên chi phí từ chối rất thấp.
 * Hai lớp: theo IP (mọi API) và theo bàn (riêng POST /api/orders).
 * Vượt ngưỡng: 429 Too Many Requests + header Retry-After.
 */
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private final RateLimiter limiter;
    private final AppProperties props;
    private final Metrics metrics;

    public RateLimitInterceptor(RateLimiter limiter, AppProperties props, Metrics metrics) {
        this.limiter = limiter;
        this.props = props;
        this.metrics = metrics;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        AppProperties.RateLimit cfg = props.getRateLimit();
        if (!cfg.isEnabled() || "OPTIONS".equalsIgnoreCase(req.getMethod())) {
            return true;
        }
        long waitMs = limiter.tryAcquire("ip:" + clientIp(req, cfg), cfg.getApiCapacity(), cfg.getApiRefillPerSecond());

        if (waitMs == 0 && "POST".equalsIgnoreCase(req.getMethod()) && "/api/orders".equals(req.getRequestURI())) {
            String tableToken = req.getHeader("X-Table-Token");
            if (tableToken != null && !tableToken.isBlank()) {
                waitMs = limiter.tryAcquire("order:" + tableToken,
                        cfg.getOrderCapacity(), cfg.getOrderRefillPerMinute() / 60.0);
            }
        }

        if (waitMs > 0) {
            metrics.rateLimited.incrementAndGet();
            long seconds = Math.max(1, (waitMs + 999) / 1000);
            throw new ApiException(ErrorCode.RATE_LIMITED,
                    "Bạn thao tác quá nhanh, vui lòng thử lại sau " + seconds + " giây",
                    Map.of("retryAfterSeconds", seconds));
        }
        return true;
    }

    /**
     * Mặc định dùng địa chỉ IP của kết nối TCP. Chỉ tin header X-Forwarded-For khi bật cấu hình
     * (dùng trong thực nghiệm để giả lập nhiều IP từ một máy), vì client có thể giả mạo header này.
     */
    private String clientIp(HttpServletRequest req, AppProperties.RateLimit cfg) {
        if (cfg.isTrustForwardedFor()) {
            String forwarded = req.getHeader("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                return forwarded.split(",")[0].trim();
            }
        }
        return req.getRemoteAddr();
    }
}
