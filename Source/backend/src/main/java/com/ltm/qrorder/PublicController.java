package com.ltm.qrorder;

import com.ltm.qrorder.assistant.AssistantService;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.menu.MenuDtos.MenuSnapshot;
import com.ltm.qrorder.menu.MenuService;
import com.ltm.qrorder.common.DeviceIds;
import com.ltm.qrorder.order.OrderDtos.TableView;
import com.ltm.qrorder.payment.PaymentService;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import com.ltm.qrorder.table.TableService.JoinResult;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/** API công khai: cấu hình client, đổi mã QR -> bàn, thực đơn. */
@RestController
@RequestMapping("/api/public")
public class PublicController {

    private final AppProperties props;
    private final TableService tables;
    private final MenuService menu;
    private final PaymentService payments;
    private final AssistantService assistant;

    public PublicController(AppProperties props, TableService tables, MenuService menu, PaymentService payments,
                            AssistantService assistant) {
        this.assistant = assistant;
        this.props = props;
        this.tables = tables;
        this.menu = menu;
        this.payments = payments;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("deliveryMode", props.getDeliveryMode());
        m.put("pollingIntervalMs", props.getPollingIntervalMs());
        m.put("heartbeatMs", props.getWs().getHeartbeatMs());
        m.put("paymentMethods", payments.availableMethods());
        m.put("assistantAi", assistant.aiAvailable());   // false: trợ lý chỉ dùng gợi ý dự phòng
        m.put("serverTime", System.currentTimeMillis());
        m.put("orderPendingTimeoutMinutes", props.getSession().getOrderPendingTimeoutMinutes());
        m.put("serviceCallTimeoutMinutes", props.getSession().getServiceCallTimeoutMinutes());
        m.put("paymentExpireMinutes", props.getPayment().getExpireMinutes());
        return m;
    }

    @GetMapping("/tables/{qrToken}")
    public TableView resolveTable(@PathVariable String qrToken) {
        TableInfo t = tables.resolveToken(qrToken);
        return new TableView(t.id(), t.code(), t.status(), t.isOpen());
    }

    /** Khách vào bàn: kết quả trả về cho trang gọi món. */
    public record JoinView(long tableId, String code, long sessionId, long sessionOpenedAt, boolean newSession) {
    }

    /**
     * Khách quét QR rồi "vào bàn": vào phiên đang có, hoặc mở phiên mới nếu bàn trống.
     * Dùng POST vì có thể TẠO phiên (GET không được có tác dụng phụ).
     * Bàn ngừng phục vụ -> 409 TABLE_CLOSED.
     */
    @PostMapping("/tables/{qrToken}/join")
    public JoinView join(@PathVariable String qrToken,
                         @RequestHeader(value = DeviceIds.HEADER, required = false) String deviceId) {
        DeviceIds.optional(deviceId);
        JoinResult r = tables.join(qrToken);
        TableInfo t = r.table();
        return new JoinView(t.id(), t.code(), t.sessionId(), tables.sessionOpenedAt(t.sessionId()), r.created());
    }

    /**
     * Thực đơn với HTTP conditional request:
     * client gửi If-None-Match = ETag lần trước; nếu thực đơn chưa đổi -> 304 (body rỗng).
     */
    @GetMapping("/menu")
    public ResponseEntity<MenuSnapshot> menu(@RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch) {
        String currentEtag = etag(menu.currentVersion());
        if (currentEtag.equals(ifNoneMatch)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(currentEtag).build();
        }
        MenuSnapshot snapshot = menu.getMenu();
        return ResponseEntity.ok()
                .eTag(etag(snapshot.version()))
                .cacheControl(CacheControl.noCache())   // được cache nhưng phải hỏi lại server trước khi dùng
                .body(snapshot);
    }

    private static String etag(long version) {
        return "\"menu-" + version + "\"";
    }
}
