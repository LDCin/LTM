package com.ltm.qrorder.ratelimit;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

/** Quản lý nhiều token bucket theo khoá (VD "ip:10.0.0.5", "order:&lt;tableToken&gt;"). */
@Component
public class RateLimiter {

    private static final long IDLE_EVICT_MS = 10 * 60 * 1000;

    private final ConcurrentHashMap<String, TokenBucket> buckets = new ConcurrentHashMap<>();

    /** @return 0 nếu được phép, ngược lại số ms cần chờ. */
    public long tryAcquire(String key, double capacity, double refillPerSecond) {
        long now = System.currentTimeMillis();
        // computeIfAbsent là nguyên tử: hai thread cùng lúc chỉ tạo ra một bucket
        TokenBucket bucket = buckets.computeIfAbsent(key, k -> new TokenBucket(capacity, refillPerSecond, now));
        return bucket.tryConsume(now);
    }

    /** Dọn bucket không dùng nữa để map không phình vô hạn (chống tấn công dùng nhiều khoá). */
    @Scheduled(fixedDelay = 60_000)
    public void evictIdle() {
        long cutoff = System.currentTimeMillis() - IDLE_EVICT_MS;
        buckets.entrySet().removeIf(e -> e.getValue().lastUsedMs() < cutoff);
    }

    public int size() {
        return buckets.size();
    }

    public void clear() {
        buckets.clear();
    }
}
