package com.ltm.qrorder.ws;

import com.ltm.qrorder.config.AppProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

/**
 * WebSocket + STOMP.
 *
 * Luồng kết nối: HTTP GET /ws (Upgrade: websocket) -> 101 Switching Protocols -> frame STOMP CONNECT
 * -> CONNECTED (thoả thuận heart-beat) -> SUBSCRIBE / SEND / MESSAGE ... -> DISCONNECT hoặc đóng TCP.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthInterceptor authInterceptor;
    private final AppProperties props;

    public WebSocketConfig(StompAuthInterceptor authInterceptor, AppProperties props) {
        this.authInterceptor = authInterceptor;
        this.props = props;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws").setAllowedOriginPatterns("*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        long hb = props.getWs().getHeartbeatMs();
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[]{hb, hb})   // server gửi/nhận heart-beat mỗi 10s
                .setTaskScheduler(wsHeartbeatScheduler());
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
        // Outbound channel có nhiều thread: bật để mỗi session nhận message đúng thứ tự đã publish
        registry.setPreservePublishOrder(true);
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        AppProperties.Ws ws = props.getWs();
        registration
                // Client nhận quá chậm (buffer đầy hoặc gửi quá lâu) bị ngắt, không làm nghẽn người khác
                .setSendTimeLimit(ws.getSendTimeLimitMs())
                .setSendBufferSizeLimit(ws.getSendBufferSizeLimit())
                // Frame lớn hơn giới hạn bị từ chối (chống gửi dữ liệu rác cỡ lớn)
                .setMessageSizeLimit(ws.getMessageSizeLimit())
                // Mở kết nối mà 10s không gửi CONNECT -> đóng (chống giữ kết nối chiếm chỗ).
                // Spring kiểm tra điều này mỗi khi có kết nối mới được thiết lập (không chạy theo timer).
                .setTimeToFirstMessage(10_000);
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(authInterceptor);
        registration.taskExecutor().corePoolSize(8).maxPoolSize(32).queueCapacity(10_000);
    }

    @Override
    public void configureClientOutboundChannel(ChannelRegistration registration) {
        registration.taskExecutor().corePoolSize(8).maxPoolSize(32).queueCapacity(10_000);
    }

    @Bean
    public ThreadPoolTaskScheduler wsHeartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("ws-heartbeat-");
        return scheduler;
    }
}
