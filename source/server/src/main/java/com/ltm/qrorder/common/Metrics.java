package com.ltm.qrorder.common;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** Bộ đếm dùng cho trang giám sát và thực nghiệm (AtomicLong để an toàn khi nhiều thread). */
@Component
public class Metrics {

    public final AtomicLong ordersCreated = new AtomicLong();
    public final AtomicLong duplicateRequestsBlocked = new AtomicLong();
    public final AtomicLong rateLimited = new AtomicLong();
    public final AtomicLong versionConflicts = new AtomicLong();
    public final AtomicLong wsConnectRejected = new AtomicLong();
    public final AtomicLong eventsPublished = new AtomicLong();
    public final AtomicLong replayRequests = new AtomicLong();
    public final AtomicLong paymentsCreated = new AtomicLong();
    public final AtomicLong paymentsPaid = new AtomicLong();
    public final AtomicLong sessionsAutoEnded = new AtomicLong();
    public final AtomicLong assistantRequests = new AtomicLong();
    public final AtomicLong assistantAiReplies = new AtomicLong();
    public final AtomicLong assistantFallbacks = new AtomicLong();
    public final AtomicLong assistantSuggestionsDropped = new AtomicLong();

    public Map<String, Long> snapshot() {
        Map<String, Long> m = new LinkedHashMap<>();
        m.put("ordersCreated", ordersCreated.get());
        m.put("duplicateRequestsBlocked", duplicateRequestsBlocked.get());
        m.put("rateLimited", rateLimited.get());
        m.put("versionConflicts", versionConflicts.get());
        m.put("wsConnectRejected", wsConnectRejected.get());
        m.put("eventsPublished", eventsPublished.get());
        m.put("replayRequests", replayRequests.get());
        m.put("paymentsCreated", paymentsCreated.get());
        m.put("paymentsPaid", paymentsPaid.get());
        m.put("sessionsAutoEnded", sessionsAutoEnded.get());
        m.put("assistantRequests", assistantRequests.get());
        m.put("assistantAiReplies", assistantAiReplies.get());
        m.put("assistantFallbacks", assistantFallbacks.get());
        m.put("assistantSuggestionsDropped", assistantSuggestionsDropped.get());
        return m;
    }
}
