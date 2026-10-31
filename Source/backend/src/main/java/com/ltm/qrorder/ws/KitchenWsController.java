package com.ltm.qrorder.ws;

import com.ltm.qrorder.common.ApiError;
import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.event.EventEnvelope;
import com.ltm.qrorder.event.EventStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.List;
import java.util.Map;

/**
 * Phần "reliable delivery" phía server.
 *
 * ACK:    client báo đã nhận tới seq nào -> dùng để giám sát độ trễ (lag) của từng màn hình bếp.
 * RESUME: client (mới kết nối lại, hoặc phát hiện thiếu seq) gửi lastSeq; server đọc event log
 *         và gửi riêng cho session đó tất cả sự kiện có seq > lastSeq (REPLAY_BATCH).
 */
@Controller
public class KitchenWsController {

    private static final Logger log = LoggerFactory.getLogger(KitchenWsController.class);

    public record AckMessage(long seq) {
    }

    public record ResumeMessage(long lastSeq) {
    }

    public record ReplayBatch(String type, long fromSeq, long latestSeq, boolean hasMore, List<EventEnvelope> events) {
    }

    private final SessionRegistry registry;
    private final EventStore events;
    private final AppProperties props;
    private final Metrics metrics;

    public KitchenWsController(SessionRegistry registry, EventStore events, AppProperties props, Metrics metrics) {
        this.registry = registry;
        this.events = events;
        this.props = props;
        this.metrics = metrics;
    }

    @MessageMapping("/ack")
    public void ack(@Payload AckMessage msg, SimpMessageHeaderAccessor headers) {
        registry.onAck(headers.getSessionId(), msg.seq());
    }

    @MessageMapping("/resume")
    @SendToUser(destinations = "/queue/replay", broadcast = false)
    public ReplayBatch resume(@Payload ResumeMessage msg, SimpMessageHeaderAccessor headers) {
        metrics.replayRequests.incrementAndGet();
        long fromSeq = Math.max(0, msg.lastSeq());
        // Client RESUME từ lastSeq nghĩa là đã có đủ mọi sự kiện <= lastSeq -> coi như đã ACK tới đó
        registry.onAck(headers.getSessionId(), fromSeq);
        long latestSeq = events.latestSeq();
        int limit = props.getWs().getReplayBatchLimit();
        List<EventEnvelope> batch = events.after(fromSeq, limit);
        return new ReplayBatch("REPLAY_BATCH", fromSeq, latestSeq, batch.size() == limit, batch);
    }

    /** Lỗi khi xử lý frame của client: gửi riêng về /user/queue/errors, không đóng server. */
    @MessageExceptionHandler
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ApiError onError(Exception e) {
        log.warn("Lỗi xử lý message STOMP: {}", e.getMessage());
        return ApiError.of("INVALID_MESSAGE", "Message không hợp lệ: " + e.getMessage(), Map.of());
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        registry.remove(event.getSessionId());
    }
}
