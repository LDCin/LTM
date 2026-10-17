package com.ltm.qrorder.ws;

import com.ltm.qrorder.auth.AuthService;
import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import com.ltm.qrorder.ws.WsPrincipal.ClientRole;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

/**
 * Kiểm tra mọi frame STOMP đi vào server:
 * - CONNECT: xác thực (token nhân viên hoặc tableToken của khách), giới hạn số kết nối mỗi bàn.
 * - SUBSCRIBE: khách chỉ được nghe topic của bàn mình; chỉ nhân viên được nghe /topic/kitchen.
 * - SEND: chỉ nhân viên được gửi ACK/RESUME.
 * Ném MessageDeliveryException -> Spring trả frame ERROR cho client.
 */
@Component
public class StompAuthInterceptor implements ChannelInterceptor {

    private final AuthService auth;
    private final TableService tables;
    private final SessionRegistry registry;
    private final AppProperties props;
    private final Metrics metrics;

    public StompAuthInterceptor(AuthService auth, TableService tables, SessionRegistry registry,
                                AppProperties props, Metrics metrics) {
        this.auth = auth;
        this.tables = tables;
        this.registry = registry;
        this.props = props;
        this.metrics = metrics;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;   // heartbeat hoặc message nội bộ
        }
        switch (accessor.getCommand()) {
            case CONNECT -> onConnect(accessor);
            case SUBSCRIBE -> checkSubscribe(accessor);
            case SEND -> checkSend(accessor);
            default -> {
            }
        }
        return message;
    }

    private void onConnect(StompHeaderAccessor accessor) {
        String sessionId = accessor.getSessionId();

        StaffPrincipal staff = auth.verify(AuthService.bearer(accessor.getFirstNativeHeader("Authorization")));
        if (staff != null) {
            registry.registerStaff(sessionId, staff.username());
            accessor.setUser(new WsPrincipal("staff-" + sessionId, sessionId, ClientRole.STAFF, null, staff.username()));
            return;
        }

        String tableToken = accessor.getFirstNativeHeader("tableToken");
        if (tableToken != null) {
            TableInfo table;
            try {
                table = tables.resolveToken(tableToken);
            } catch (ApiException e) {
                throw reject("INVALID_TABLE_TOKEN: mã QR không hợp lệ");
            }
            int max = props.getWs().getMaxConnectionsPerTable();
            if (!registry.tryRegisterCustomer(sessionId, table.id(), table.code(), max)) {
                throw reject("TOO_MANY_CONNECTIONS: bàn " + table.code() + " đã có " + max + " kết nối");
            }
            accessor.setUser(new WsPrincipal("table-" + sessionId, sessionId, ClientRole.CUSTOMER,
                    table.id(), table.code()));
            return;
        }
        throw reject("UNAUTHORIZED: thiếu header Authorization hoặc tableToken");
    }

    private void checkSubscribe(StompHeaderAccessor accessor) {
        WsPrincipal p = principal(accessor);
        String dest = accessor.getDestination();
        if (dest == null) {
            throw new MessageDeliveryException("Thiếu destination");
        }
        boolean allowed = switch (p.role()) {
            case STAFF -> dest.equals("/topic/kitchen") || dest.startsWith("/topic/table.")
                    || dest.equals("/topic/menu") || dest.startsWith("/user/queue/");
            case CUSTOMER -> dest.equals("/topic/table." + p.tableId())
                    || dest.equals("/topic/menu") || dest.equals("/user/queue/errors");
        };
        if (!allowed) {
            throw new MessageDeliveryException("FORBIDDEN: không có quyền subscribe " + dest);
        }
    }

    private void checkSend(StompHeaderAccessor accessor) {
        WsPrincipal p = principal(accessor);
        String dest = accessor.getDestination();
        boolean allowed = p.role() == ClientRole.STAFF && ("/app/ack".equals(dest) || "/app/resume".equals(dest));
        if (!allowed) {
            throw new MessageDeliveryException("FORBIDDEN: không có quyền gửi tới " + dest);
        }
    }

    private WsPrincipal principal(StompHeaderAccessor accessor) {
        if (accessor.getUser() instanceof WsPrincipal p) {
            return p;
        }
        throw new MessageDeliveryException("UNAUTHORIZED: chưa CONNECT");
    }

    private MessageDeliveryException reject(String reason) {
        metrics.wsConnectRejected.incrementAndGet();
        return new MessageDeliveryException(reason);
    }
}
