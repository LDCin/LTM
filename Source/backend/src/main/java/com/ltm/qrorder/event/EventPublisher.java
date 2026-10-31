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
    /** Quầy thu ngân: trạng thái bàn và thanh toán (chỉ CASHIER, ADMIN được nghe). */
    public static final String CASHIER_TOPIC = "/topic/cashier";

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

    /**
     * Sự kiện đơn hàng: tới bếp (trừ chế độ POLLING) và tới mọi máy đang ngồi ở bàn đó.
     * Các máy cùng một phiên dùng chung danh sách đơn; payload không chứa mã thiết bị.
     * Sau mỗi sự kiện đơn, quầy thu ngân cũng được báo để cập nhật tạm tính của bàn.
     */
    public void publishOrderEvent(EventEnvelope envelope, long tableId) {
        afterCommit(() -> {
            if (props.getDeliveryMode() != DeliveryMode.POLLING) {
                sendNow(KITCHEN_TOPIC, envelope);
            }
            sendNow(tableTopic(tableId), envelope);
            sendNow(CASHIER_TOPIC, java.util.Map.of("type", "TABLE_STATE_CHANGED", "tableId", tableId));
            metrics.eventsPublished.incrementAndGet();
        });
    }

    /** Thông báo không cần seq (MENU_UPDATED, TABLE_*, PAYMENT_UPDATED, CONFIG_CHANGED). */
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
