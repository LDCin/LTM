package com.ltm.qrorder.config;

import com.ltm.qrorder.auth.StaffAuthInterceptor;
import com.ltm.qrorder.ratelimit.RateLimitInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final RateLimitInterceptor rateLimitInterceptor;
    private final StaffAuthInterceptor staffAuthInterceptor;

    public WebConfig(RateLimitInterceptor rateLimitInterceptor, StaffAuthInterceptor staffAuthInterceptor) {
        this.rateLimitInterceptor = rateLimitInterceptor;
        this.staffAuthInterceptor = staffAuthInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Thứ tự: rate limit trước (rẻ nhất), sau đó mới xác thực
        registry.addInterceptor(rateLimitInterceptor).addPathPatterns("/api/**");
        registry.addInterceptor(staffAuthInterceptor).addPathPatterns("/api/kitchen/**", "/api/cashier/**", "/api/admin/**");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .exposedHeaders("ETag", "Retry-After", "Idempotent-Replayed");
    }

    /** Khi frontend đã build vào static/, các route của React Router trả về index.html. */
    @Controller
    static class SpaForwardController {
        @GetMapping({"/t/{token}", "/kitchen", "/cashier", "/admin"})
        public String forward() {
            return "forward:/index.html";
        }
    }
}
