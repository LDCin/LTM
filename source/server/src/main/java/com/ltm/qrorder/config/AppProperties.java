package com.ltm.qrorder.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cấu hình ứng dụng (prefix "app" trong application.yml).
 * Các trường volatile có thể đổi lúc chạy qua PUT /api/admin/settings để chạy thực nghiệm
 * baseline và proposed trên cùng một codebase.
 */
@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private volatile DeliveryMode deliveryMode = DeliveryMode.RELIABLE_PUSH;
    private volatile boolean idempotencyEnabled = true;
    private volatile boolean optimisticLockEnabled = true;
    private long pollingIntervalMs = 3000;
    private String authSecret = "change-this-secret";
    private long authTokenTtlMs = 12 * 60 * 60 * 1000L;
    private final RateLimit rateLimit = new RateLimit();
    private final Ws ws = new Ws();
    private final Session session = new Session();
    private final Payment payment = new Payment();
    private final Vnpay vnpay = new Vnpay();

    public DeliveryMode getDeliveryMode() { return deliveryMode; }
    public void setDeliveryMode(DeliveryMode deliveryMode) { this.deliveryMode = deliveryMode; }
    public boolean isIdempotencyEnabled() { return idempotencyEnabled; }
    public void setIdempotencyEnabled(boolean idempotencyEnabled) { this.idempotencyEnabled = idempotencyEnabled; }
    public boolean isOptimisticLockEnabled() { return optimisticLockEnabled; }
    public void setOptimisticLockEnabled(boolean optimisticLockEnabled) { this.optimisticLockEnabled = optimisticLockEnabled; }
    public long getPollingIntervalMs() { return pollingIntervalMs; }
    public void setPollingIntervalMs(long pollingIntervalMs) { this.pollingIntervalMs = pollingIntervalMs; }
    public String getAuthSecret() { return authSecret; }
    public void setAuthSecret(String authSecret) { this.authSecret = authSecret; }
    public long getAuthTokenTtlMs() { return authTokenTtlMs; }
    public void setAuthTokenTtlMs(long authTokenTtlMs) { this.authTokenTtlMs = authTokenTtlMs; }
    public RateLimit getRateLimit() { return rateLimit; }
    public Ws getWs() { return ws; }
    public Session getSession() { return session; }
    public Payment getPayment() { return payment; }
    public Vnpay getVnpay() { return vnpay; }

    /** Phiên bàn tự động kết thúc. */
    public static class Session {
        private int idleTimeoutMinutes = 30;
        private int autoCheckoutAfterPaidMinutes = 30;

        public int getIdleTimeoutMinutes() { return idleTimeoutMinutes; }
        public void setIdleTimeoutMinutes(int idleTimeoutMinutes) { this.idleTimeoutMinutes = idleTimeoutMinutes; }
        public int getAutoCheckoutAfterPaidMinutes() { return autoCheckoutAfterPaidMinutes; }
        public void setAutoCheckoutAfterPaidMinutes(int v) { this.autoCheckoutAfterPaidMinutes = v; }
    }

    public static class Payment {
        private int expireMinutes = 15;

        public int getExpireMinutes() { return expireMinutes; }
        public void setExpireMinutes(int expireMinutes) { this.expireMinutes = expireMinutes; }
    }

    /** Cổng VNPay (sandbox). tmnCode/hashSecret chỉ lấy từ biến môi trường. */
    public static class Vnpay {
        private String tmnCode = "";
        private String hashSecret = "";
        private String payUrl = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
        private String apiUrl = "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction";
        private String publicUrl = "";

        public boolean isConfigured() {
            return tmnCode != null && !tmnCode.isBlank() && hashSecret != null && !hashSecret.isBlank();
        }

        public String getTmnCode() { return tmnCode; }
        public void setTmnCode(String tmnCode) { this.tmnCode = tmnCode; }
        public String getHashSecret() { return hashSecret; }
        public void setHashSecret(String hashSecret) { this.hashSecret = hashSecret; }
        public String getPayUrl() { return payUrl; }
        public void setPayUrl(String payUrl) { this.payUrl = payUrl; }
        public String getApiUrl() { return apiUrl; }
        public void setApiUrl(String apiUrl) { this.apiUrl = apiUrl; }
        public String getPublicUrl() { return publicUrl; }
        public void setPublicUrl(String publicUrl) { this.publicUrl = publicUrl; }
    }

    public static class RateLimit {
        private volatile boolean enabled = true;
        private volatile boolean trustForwardedFor = false;
        private int orderCapacity = 10;
        private double orderRefillPerMinute = 10;
        private int apiCapacity = 60;
        private double apiRefillPerSecond = 20;

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public boolean isTrustForwardedFor() { return trustForwardedFor; }
        public void setTrustForwardedFor(boolean trustForwardedFor) { this.trustForwardedFor = trustForwardedFor; }
        public int getOrderCapacity() { return orderCapacity; }
        public void setOrderCapacity(int orderCapacity) { this.orderCapacity = orderCapacity; }
        public double getOrderRefillPerMinute() { return orderRefillPerMinute; }
        public void setOrderRefillPerMinute(double orderRefillPerMinute) { this.orderRefillPerMinute = orderRefillPerMinute; }
        public int getApiCapacity() { return apiCapacity; }
        public void setApiCapacity(int apiCapacity) { this.apiCapacity = apiCapacity; }
        public double getApiRefillPerSecond() { return apiRefillPerSecond; }
        public void setApiRefillPerSecond(double apiRefillPerSecond) { this.apiRefillPerSecond = apiRefillPerSecond; }
    }

    public static class Ws {
        private long heartbeatMs = 10000;
        private int maxConnectionsPerTable = 8;
        private int sendTimeLimitMs = 10000;
        private int sendBufferSizeLimit = 512 * 1024;
        private int messageSizeLimit = 64 * 1024;
        private int replayBatchLimit = 500;

        public long getHeartbeatMs() { return heartbeatMs; }
        public void setHeartbeatMs(long heartbeatMs) { this.heartbeatMs = heartbeatMs; }
        public int getMaxConnectionsPerTable() { return maxConnectionsPerTable; }
        public void setMaxConnectionsPerTable(int maxConnectionsPerTable) { this.maxConnectionsPerTable = maxConnectionsPerTable; }
        public int getSendTimeLimitMs() { return sendTimeLimitMs; }
        public void setSendTimeLimitMs(int sendTimeLimitMs) { this.sendTimeLimitMs = sendTimeLimitMs; }
        public int getSendBufferSizeLimit() { return sendBufferSizeLimit; }
        public void setSendBufferSizeLimit(int sendBufferSizeLimit) { this.sendBufferSizeLimit = sendBufferSizeLimit; }
        public int getMessageSizeLimit() { return messageSizeLimit; }
        public void setMessageSizeLimit(int messageSizeLimit) { this.messageSizeLimit = messageSizeLimit; }
        public int getReplayBatchLimit() { return replayBatchLimit; }
        public void setReplayBatchLimit(int replayBatchLimit) { this.replayBatchLimit = replayBatchLimit; }
    }
}
