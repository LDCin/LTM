package com.ltm.qrorder.assistant;

import com.ltm.qrorder.assistant.AssistantDtos.ChatMessage;

import java.util.List;

/** Mô hình ngôn ngữ dùng cho trợ lý (Gemini; test thay bằng bản giả). Trả về chuỗi JSON theo lược đồ đã yêu cầu. */
public interface LlmClient {

    boolean isConfigured();

    String generate(String systemPrompt, List<ChatMessage> messages) throws LlmUnavailableException;

    /**
     * Không gọi được mô hình: hết lượt (429, kèm số giây nên chờ nếu nhà cung cấp báo), timeout, lỗi mạng hoặc 5xx.
     * rateLimited = true chỉ khi nhà cung cấp báo hết lượt.
     */
    class LlmUnavailableException extends Exception {
        private final boolean rateLimited;
        private final long retryAfterSeconds;

        public LlmUnavailableException(String message, boolean rateLimited, long retryAfterSeconds) {
            super(message);
            this.rateLimited = rateLimited;
            this.retryAfterSeconds = retryAfterSeconds;
        }

        public boolean isRateLimited() {
            return rateLimited;
        }

        public long getRetryAfterSeconds() {
            return retryAfterSeconds;
        }
    }
}
