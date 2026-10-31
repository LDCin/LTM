package com.ltm.qrorder.ratelimit;

/**
 * Thuật toán Token Bucket (tự cài đặt).
 *
 * Mỗi bucket chứa tối đa {@code capacity} token và được nạp lại đều đặn {@code refillPerSecond} token/giây.
 * Mỗi request lấy 1 token; hết token thì bị từ chối. Thuật toán cho phép "burst" ngắn
 * (dùng hết capacity) nhưng giới hạn tốc độ trung bình dài hạn.
 *
 * synchronized vì nhiều thread Tomcat có thể cùng truy cập một bucket.
 */
public final class TokenBucket {

    private final double capacity;
    private final double refillPerMs;
    private double tokens;
    private long lastRefillMs;
    private volatile long lastUsedMs;

    public TokenBucket(double capacity, double refillPerSecond, long nowMs) {
        if (capacity <= 0 || refillPerSecond <= 0) {
            throw new IllegalArgumentException("capacity và refillPerSecond phải > 0");
        }
        this.capacity = capacity;
        this.refillPerMs = refillPerSecond / 1000.0;
        this.tokens = capacity;
        this.lastRefillMs = nowMs;
        this.lastUsedMs = nowMs;
    }

    /**
     * Thử lấy 1 token.
     *
     * @return 0 nếu được phép; ngược lại là số ms cần chờ cho tới khi có token tiếp theo.
     */
    public synchronized long tryConsume(long nowMs) {
        refill(nowMs);
        lastUsedMs = nowMs;
        if (tokens >= 1) {
            tokens -= 1;
            return 0;
        }
        return (long) Math.ceil((1 - tokens) / refillPerMs);
    }

    public synchronized double availableTokens(long nowMs) {
        refill(nowMs);
        return tokens;
    }

    public long lastUsedMs() {
        return lastUsedMs;
    }

    private void refill(long nowMs) {
        long elapsed = nowMs - lastRefillMs;
        if (elapsed > 0) {
            tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
            lastRefillMs = nowMs;
        }
    }
}
