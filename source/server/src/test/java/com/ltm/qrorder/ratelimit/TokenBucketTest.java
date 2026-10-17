package com.ltm.qrorder.ratelimit;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TokenBucketTest {

    @Test
    void allowsBurstUpToCapacityThenRejects() {
        TokenBucket bucket = new TokenBucket(3, 1, 0);
        assertEquals(0, bucket.tryConsume(0));
        assertEquals(0, bucket.tryConsume(0));
        assertEquals(0, bucket.tryConsume(0));
        long wait = bucket.tryConsume(0);
        assertTrue(wait > 0 && wait <= 1000, "phải chờ ~1s để có token mới, thực tế " + wait);
    }

    @Test
    void refillsOverTime() {
        TokenBucket bucket = new TokenBucket(2, 2, 0);   // 2 token/giây
        bucket.tryConsume(0);
        bucket.tryConsume(0);
        assertTrue(bucket.tryConsume(100) > 0);
        assertEquals(0, bucket.tryConsume(600));        // sau 0.6s đã hồi > 1 token
    }

    @Test
    void neverExceedsCapacity() {
        TokenBucket bucket = new TokenBucket(5, 10, 0);
        assertEquals(5.0, bucket.availableTokens(1_000_000), 1e-9);
    }
}
