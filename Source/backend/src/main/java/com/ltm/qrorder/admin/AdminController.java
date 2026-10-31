package com.ltm.qrorder.admin;

import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.config.DeliveryMode;
import com.ltm.qrorder.event.EventPublisher;
import com.ltm.qrorder.event.EventStore;
import com.ltm.qrorder.menu.MenuDtos.CategoryDto;
import com.ltm.qrorder.menu.MenuDtos.CategoryRequest;
import com.ltm.qrorder.menu.MenuDtos.MenuItemDto;
import com.ltm.qrorder.menu.MenuDtos.MenuItemRequest;
import com.ltm.qrorder.menu.MenuDtos.VatRequest;
import com.ltm.qrorder.menu.MenuService;
import com.ltm.qrorder.order.OrderRepository;
import com.ltm.qrorder.payment.PaymentDtos.PaymentDto;
import com.ltm.qrorder.payment.PaymentRepository;
import com.ltm.qrorder.ratelimit.RateLimiter;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import com.ltm.qrorder.ws.SessionRegistry;
import com.ltm.qrorder.ws.WsPrincipal.ClientRole;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** API quản trị: bàn, thực đơn, VAT, thống kê kinh doanh, cấu hình thực nghiệm. Chỉ ADMIN. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final TableService tables;
    private final MenuService menu;
    private final OrderRepository orders;
    private final EventStore events;
    private final EventPublisher publisher;
    private final SessionRegistry registry;
    private final RateLimiter rateLimiter;
    private final AppProperties props;
    private final Metrics metrics;
    private final PaymentRepository payments;
    private final ReportService reports;

    public AdminController(TableService tables, MenuService menu, OrderRepository orders, EventStore events,
                           EventPublisher publisher, SessionRegistry registry, RateLimiter rateLimiter,
                           AppProperties props, Metrics metrics, PaymentRepository payments,
                           ReportService reports) {
        this.reports = reports;
        this.payments = payments;
        this.tables = tables;
        this.menu = menu;
        this.orders = orders;
        this.events = events;
        this.publisher = publisher;
        this.registry = registry;
        this.rateLimiter = rateLimiter;
        this.props = props;
        this.metrics = metrics;
    }

    // ------------------------------------------------------------------ bàn

    public record CreateTableRequest(@NotBlank @Size(max = 20) @Pattern(regexp = "[A-Za-z0-9_-]+") String code) {
    }

    /** open = true: mở sẵn phiên cho các bàn (dùng cho bộ thực nghiệm, đặt món ngay không cần /join). */
    public record BulkTablesRequest(@NotBlank @Size(max = 10) @Pattern(regexp = "[A-Za-z0-9_-]+") String prefix,
                                    @NotNull @Min(1) @Max(1000) Integer count,
                                    boolean open) {
    }

    @GetMapping("/tables")
    public List<TableInfo> listTables() {
        return tables.list();
    }

    @PostMapping("/tables")
    @ResponseStatus(HttpStatus.CREATED)
    public TableInfo createTable(@Valid @RequestBody CreateTableRequest req) {
        return tables.create(req.code());
    }

    @PostMapping("/tables/bulk")
    public List<TableInfo> bulkTables(@Valid @RequestBody BulkTablesRequest req) {
        return tables.bulkCreate(req.prefix(), req.count(), req.open());
    }

    /** Cho bàn phục vụ trở lại (không mở phiên; phiên mở khi khách quét QR). */
    @PostMapping("/tables/{id}/open")
    public TableInfo openTable(@PathVariable long id) {
        return tables.open(id);
    }

    /** Ngừng phục vụ bàn (bảo trì). 409 TABLE_HAS_GUESTS nếu bàn đang có khách. */
    @PostMapping("/tables/{id}/close")
    public TableInfo closeTable(@PathVariable long id) {
        return tables.close(id);
    }

    @PostMapping("/tables/{id}/rotate-token")
    public TableInfo rotateToken(@PathVariable long id) {
        return tables.rotateToken(id);
    }

    // ------------------------------------------------------------------ thanh toán (chỉ xem)

    @GetMapping("/payments")
    public List<PaymentDto> payments(@RequestParam(defaultValue = "100") int limit) {
        return payments.listRecent(limit).stream().map(PaymentRepository.PaymentRow::dto).toList();
    }

    // ------------------------------------------------------------------ thực đơn

    @GetMapping("/categories")
    public List<CategoryDto> categories() {
        return menu.listCategories();
    }

    @PostMapping("/categories")
    @ResponseStatus(HttpStatus.CREATED)
    public CategoryDto createCategory(@Valid @RequestBody CategoryRequest req) {
        return menu.createCategory(req);
    }

    @GetMapping("/menu-items")
    public List<MenuItemDto> menuItems() {
        return menu.listAll();
    }

    @PostMapping("/menu-items")
    @ResponseStatus(HttpStatus.CREATED)
    public MenuItemDto createMenuItem(@Valid @RequestBody MenuItemRequest req) {
        return menu.create(req);
    }

    /** Áp một mức VAT cho mọi món. */
    @PutMapping("/menu-items/vat")
    public Map<String, Object> setVatForAll(@Valid @RequestBody VatRequest req) {
        return Map.of("updated", menu.setVatForAll(req.vatRate()), "vatRate", req.vatRate());
    }

    /** Thống kê kinh doanh: doanh thu, đơn, món bán chạy... trong khoảng [from, to). */
    @GetMapping("/reports")
    public Map<String, Object> report(@RequestParam long from, @RequestParam long to,
                                      @RequestParam(defaultValue = "0") long tzOffsetMinutes) {
        return reports.report(from, to, tzOffsetMinutes * 60_000L);
    }

    @PutMapping("/menu-items/{id}")
    public MenuItemDto updateMenuItem(@PathVariable long id, @Valid @RequestBody MenuItemRequest req) {
        return menu.update(id, req);
    }

    // ------------------------------------------------------------------ giám sát

    @GetMapping("/monitor")
    public Map<String, Object> monitor() {
        long latestSeq = events.latestSeq();
        List<Map<String, Object>> connections = registry.all().stream()
                .sorted(Comparator.comparing(SessionRegistry.ClientSession::getConnectedAt))
                .map(s -> {
                    Map<String, Object> c = new LinkedHashMap<>();
                    c.put("sessionId", s.getSessionId());
                    c.put("role", s.getRole());
                    c.put("label", s.getLabel());
                    c.put("tableId", s.getTableId());
                    c.put("connectedAt", s.getConnectedAt());
                    c.put("lastAckSeq", s.getLastAckSeq());
                    c.put("lastAckAt", s.getLastAckAt());
                    c.put("lag", s.getRole() == ClientRole.STAFF ? Math.max(0, latestSeq - s.getLastAckSeq()) : null);
                    return c;
                })
                .toList();

        Runtime rt = Runtime.getRuntime();
        Map<String, Object> jvm = new LinkedHashMap<>();
        jvm.put("threads", ManagementFactory.getThreadMXBean().getThreadCount());
        jvm.put("heapUsedMb", (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024));
        jvm.put("heapMaxMb", rt.maxMemory() / (1024 * 1024));

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("settings", settings());
        m.put("latestSeq", latestSeq);
        m.put("staffConnections", registry.count(ClientRole.STAFF));
        m.put("customerConnections", registry.count(ClientRole.CUSTOMER));
        m.put("rateLimitBuckets", rateLimiter.size());
        m.put("counters", metrics.snapshot());
        m.put("jvm", jvm);
        m.put("connections", connections);
        return m;
    }

    @GetMapping("/stats")
    public Map<String, Long> stats(@RequestParam(defaultValue = "0") long since) {
        return orders.countSince(since);
    }

    /** Dọn đơn của các bàn load test (mã LT...) và mở phiên mới cho các bàn đó. */
    @PostMapping("/maintenance/clear-test-orders")
    public Map<String, Object> clearTestOrders() {
        int completed = orders.completeOrdersOfTables("LT", System.currentTimeMillis());
        int reset = tables.resetSessions("LT");
        return Map.of("completedOrders", completed, "tablesReset", reset);
    }

    // ------------------------------------------------------------------ cấu hình thực nghiệm

    public record SettingsDto(DeliveryMode deliveryMode, Boolean idempotencyEnabled, Boolean optimisticLockEnabled,
                              Boolean rateLimitEnabled, Boolean trustForwardedFor, Boolean assistantLiveContext) {
    }

    @GetMapping("/settings")
    public SettingsDto settings() {
        return new SettingsDto(props.getDeliveryMode(), props.isIdempotencyEnabled(), props.isOptimisticLockEnabled(),
                props.getRateLimit().isEnabled(), props.getRateLimit().isTrustForwardedFor(),
                props.getAssistant().isLiveContext());
    }

    /** Đổi chế độ lúc chạy để so sánh baseline và proposed mà không cần khởi động lại server. */
    @PutMapping("/settings")
    public SettingsDto updateSettings(@RequestBody SettingsDto req) {
        if (req.deliveryMode() != null) {
            props.setDeliveryMode(req.deliveryMode());
        }
        if (req.idempotencyEnabled() != null) {
            props.setIdempotencyEnabled(req.idempotencyEnabled());
        }
        if (req.optimisticLockEnabled() != null) {
            props.setOptimisticLockEnabled(req.optimisticLockEnabled());
        }
        if (req.rateLimitEnabled() != null) {
            props.getRateLimit().setEnabled(req.rateLimitEnabled());
        }
        if (req.trustForwardedFor() != null) {
            props.getRateLimit().setTrustForwardedFor(req.trustForwardedFor());
        }
        if (req.assistantLiveContext() != null) {
            props.getAssistant().setLiveContext(req.assistantLiveContext());
        }
        rateLimiter.clear();
        SettingsDto current = settings();
        publisher.sendNow(EventPublisher.KITCHEN_TOPIC, Map.of("type", "CONFIG_CHANGED", "settings", current));
        return current;
    }
}
