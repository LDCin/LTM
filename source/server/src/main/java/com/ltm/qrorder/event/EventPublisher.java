package com.ltm.qrorder.event;

import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.config.DeliveryMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Đẩy sự kiện tới client qua STOMP broker.
 *
 * Quy tắc quan trọng: chỉ gửi SAU KHI transaction commit. Nếu transaction rollback
 * (VD: món hết hàng, lỗi DB) thì không có "đơn ma" xuất hiện ở bếp.
 *
 * SimpMessagingTemplate được lấy qua ObjectProvider để tránh vòng phụ thuộc
 * (WebSocketConfig -> StompAuthInterceptor -> TableService -> EventPublisher -> template).
 */
@Component
public class EventPublisher {

    public static final String KITCHEN_TOPIC = "/topic/kitchen";
    public static final String MENU_TOPIC = "/topic/menu";

    private static final Logger log = LoggerFactory.getLogger(EventPublisher.class);

    private final ObjectProvider<SimpMessagingTemplate> template;
    private final AppProperties props;
    private final Metrics metrics;

    public EventPublisher(ObjectProvider<SimpMessagingTemplate> template, AppProperties props, Metrics metrics) {
        this.template = template;
        this.props = props;
        this.metrics = metrics;
    }

    public static String tableTopic(long tableId) {
        return "/topic/table." + tableId;
    }

    /** Topic riêng của một thiết bị khách: chỉ máy đặt đơn mới nhận được trạng thái đơn của mình. */
    public static String guestTopic(String deviceId) {
        return "/topic/guest." + deviceId;
    }

    /**
     * Sự kiện đơn hàng: tới bếp (trừ chế độ POLLING) và tới đúng thiết bị đã đặt đơn.
     * Không gửi dữ liệu đơn lên topic chung của bàn, để khách khác quét cùng QR không nhận được.
     */
    public void publishOrderEvent(EventEnvelope envelope, String deviceId) {
        afterCommit(() -> {
            if (props.getDeliveryMode() != DeliveryMode.POLLING) {
                sendNow(KITCHEN_TOPIC, envelope);
            }
            if (deviceId != null) {
                sendNow(guestTopic(deviceId), envelope);
            }
            metrics.eventsPublished.incrementAndGet();
        });
    }

    /** Thông báo không cần seq (MENU_UPDATED, TABLE_CLOSED, TABLE_SESSION_RESET, CONFIG_CHANGED). */
    public void broadcast(String destination, Object payload) {
        afterCommit(() -> sendNow(destination, payload));
    }

    /**
     * Chạy sau khi transaction hiện tại commit; nếu không có transaction thì chạy ngay.
     * Lưu ý: bên trong action phải dùng sendNow (đăng ký thêm synchronization trong pha
     * afterCommit sẽ không bao giờ được gọi).
     */
    public void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }

    public void sendNow(String destination, Object payload) {
        try {
            template.getObject().convertAndSend(destination, payload);
        } catch (MessagingException e) {
            // Mất một lần gửi không làm mất đơn: đơn đã nằm trong event log, client sẽ replay.
            log.warn("Gửi tới {} thất bại: {}", destination, e.getMessage());
        }
    }
}
