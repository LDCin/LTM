package com.ltm.qrorder.payment;

import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.DeviceIds;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.event.EventPublisher;
import com.ltm.qrorder.payment.PaymentDtos.BillView;
import com.ltm.qrorder.payment.PaymentDtos.CreatePaymentResult;
import com.ltm.qrorder.payment.PaymentDtos.PaymentDto;
import com.ltm.qrorder.payment.PaymentDtos.PaymentMethod;
import com.ltm.qrorder.payment.PaymentDtos.PaymentStatus;
import com.ltm.qrorder.payment.PaymentRepository.PaymentRow;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Thanh toán theo phiên bàn.
 *
 * - Số tiền LUÔN do server tính từ database (không tin client): còn phải trả = tổng món không huỷ - đã trả.
 * - Mỗi phiên tối đa một lần đang chờ (ràng buộc UNIQUE pending_session_id).
 * - Idempotency-Key: bấm "Thanh toán" hai lần / gửi lại -> trả lại đúng lần đã tạo.
 * - Xác nhận "đã trả":
 *     CASH : thu ngân bấm "Đã nhận tiền" (khoá lạc quan theo version).
 *     VNPAY: server VNPay gọi IPN (có chữ ký), hoặc trình duyệt quay về Return URL (có chữ ký),
 *            hoặc server tự tra cứu (querydr) trước khi cho hết hạn.
 *   Mọi đường đều dùng chung UPDATE có điều kiện trạng thái -> gọi lặp không xử lý hai lần.
 * - Tiền về muộn (lần đã EXPIRED/CANCELLED mà VNPay báo thành công): vẫn ghi nhận PAID, không bỏ qua tiền;
 *   nếu lúc đó hóa đơn đã trả đủ bằng cách khác thì đánh dấu needs_refund để thu ngân hoàn tiền.
 */
@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);
    private static final Pattern KEY_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final List<String> FROM_PENDING = List.of("PENDING");
    /** Tiền VNPay có thể về sau khi lần thanh toán đã bị đánh dấu hết hạn / huỷ / thất bại. */
    private static final List<String> FROM_ANY_UNPAID = List.of("PENDING", "EXPIRED", "CANCELLED", "FAILED");

    private final PaymentRepository payments;
    private final TableService tables;
    private final VnpayGateway vnpay;
    private final EventPublisher publisher;
    private final TransactionTemplate tx;
    private final AppProperties props;
    private final Metrics metrics;

    public PaymentService(PaymentRepository payments, TableService tables, VnpayGateway vnpay,
                          EventPublisher publisher, TransactionTemplate tx, AppProperties props, Metrics metrics) {
        this.payments = payments;
        this.tables = tables;
        this.vnpay = vnpay;
        this.publisher = publisher;
        this.tx = tx;
        this.props = props;
        this.metrics = metrics;
    }

    public List<String> availableMethods() {
        List<String> methods = new ArrayList<>(List.of(PaymentMethod.CASH.name()));
        if (vnpay.isConfigured()) {
            methods.add(PaymentMethod.VNPAY.name());
        }
        return methods;
    }

    // ================================================================ hóa đơn

    public BillView billForCustomer(String tableToken, String sessionHeader, RequestInfo req) {
        TableInfo t = tables.requireSession(tableToken, DeviceIds.sessionId(sessionHeader));
        return bill(t, req);
    }

    public BillView bill(TableInfo t, RequestInfo req) {
        if (!t.hasSession()) {
            return new BillView(t.id(), t.code(), null, 0, 0, 0, null, List.of(), availableMethods());
        }
        long total = payments.sessionTotal(t.sessionId());
        long paid = payments.sessionPaid(t.sessionId(), null);
        List<PaymentDto> list = payments.listBySession(t.sessionId()).stream().map(r -> withLink(r, req)).toList();
        PaymentDto pending = list.stream().filter(p -> PaymentStatus.PENDING.name().equals(p.status())).findFirst()
                .orElse(null);
        return new BillView(t.id(), t.code(), t.sessionId(), total, paid, total - paid, pending, list, availableMethods());
    }

    // ================================================================ khách tạo / huỷ thanh toán

    /**
     * Khách bấm "Thanh toán".
     * replayed = true khi trả lại lần đã có: gửi lại cùng Idempotency-Key, hoặc bạn cùng bàn đã bấm trước.
     */
    public CreatePaymentResult create(String tableToken, String deviceId, String sessionHeader, String idempotencyKey,
                                      PaymentMethod method, RequestInfo req) {
        if (idempotencyKey != null && !KEY_PATTERN.matcher(idempotencyKey).matches()) {
            throw new ApiException(ErrorCode.INVALID_REQUEST, "Idempotency-Key phải gồm 8-64 ký tự [A-Za-z0-9_-]");
        }
        DeviceIds.optional(deviceId);
        TableInfo t = tables.requireSession(tableToken, DeviceIds.sessionId(sessionHeader));
        if (method == PaymentMethod.VNPAY && !vnpay.isConfigured()) {
            throw new ApiException(ErrorCode.PAYMENT_METHOD_UNAVAILABLE, "Thanh toán VNPay chưa được bật");
        }
        if (idempotencyKey != null) {
            Optional<PaymentRow> same = payments.findByIdempotencyKey(idempotencyKey);
            if (same.isPresent()) {
                if (same.get().dto().sessionId() != t.sessionId()) {
                    throw new ApiException(ErrorCode.IDEMPOTENCY_KEY_REUSED, "Idempotency-Key đã được dùng cho lần khác");
                }
                metrics.duplicateRequestsBlocked.incrementAndGet();
                return new CreatePaymentResult(withLink(same.get(), req), true);
            }
        }
        Optional<PaymentRow> pending = payments.findPending(t.sessionId());
        if (pending.isPresent()) {
            return new CreatePaymentResult(withLink(pending.get(), req), true);
        }
        return insertPending(t, method, idempotencyKey, deviceId, req);
    }

    private CreatePaymentResult insertPending(TableInfo t, PaymentMethod method, String key, String deviceId,
                                              RequestInfo req) {
        long now = System.currentTimeMillis();
        long expiresAt = now + props.getPayment().getExpireMinutes() * 60_000L;
        try {
            Long id = tx.execute(status -> {
                long remaining = payments.sessionTotal(t.sessionId()) - payments.sessionPaid(t.sessionId(), null);
                if (remaining <= 0) {
                    throw new ApiException(ErrorCode.NOTHING_TO_PAY, "Bàn không còn khoản nào cần thanh toán");
                }
                return payments.insertPending(t.sessionId(), t.id(), remaining, method.name(), newTxnRef(),
                        key, deviceId, VnpayGateway.formatDate(now), now, expiresAt);
            });
            metrics.paymentsCreated.incrementAndGet();
            PaymentRow row = payments.find(id).orElseThrow();
            publishUpdated(row.dto());
            return new CreatePaymentResult(withLink(row, req), false);
        } catch (DuplicateKeyException e) {
            // Máy khác cùng bàn vừa tạo lần chờ, hoặc request song song cùng key: trả lại lần đã có
            Optional<PaymentRow> existing = key != null ? payments.findByIdempotencyKey(key) : Optional.empty();
            if (existing.isEmpty()) {
                existing = payments.findPending(t.sessionId());
            }
            return existing.map(r -> new CreatePaymentResult(withLink(r, req), true))
                    .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE,
                            "Bàn đang được thanh toán, vui lòng thử lại", Map.of("retryAfterSeconds", 1)));
        }
    }

    public PaymentDto getForCustomer(String tableToken, long paymentId, RequestInfo req) {
        TableInfo t = tables.resolveToken(tableToken);
        PaymentRow row = payments.find(paymentId).filter(p -> p.dto().tableId() == t.id())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy lần thanh toán #" + paymentId));
        return withLink(row, req);
    }

    /** Khách huỷ lần đang chờ (VD muốn gọi thêm món). Ai trong phiên cũng huỷ được. */
    public PaymentDto cancelByCustomer(String tableToken, String sessionHeader, long paymentId) {
        TableInfo t = tables.requireSession(tableToken, DeviceIds.sessionId(sessionHeader));
        PaymentRow row = payments.find(paymentId).filter(p -> p.dto().sessionId() == t.sessionId())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy lần thanh toán #" + paymentId));
        return closePending(row, PaymentStatus.CANCELLED, null);
    }

    // ================================================================ thu ngân

    /** Khách ra quầy trả tiền mặt mà không bấm gì trên điện thoại: thu ngân tạo lần chờ cho bàn. */
    public CreatePaymentResult createCashAtCounter(long tableId, StaffPrincipal staff, RequestInfo req) {
        TableInfo t = tables.get(tableId);
        if (!t.hasSession()) {
            throw new ApiException(ErrorCode.NOTHING_TO_PAY, "Bàn " + t.code() + " đang trống");
        }
        Optional<PaymentRow> pending = payments.findPending(t.sessionId());
        if (pending.isPresent()) {
            return new CreatePaymentResult(withLink(pending.get(), req), true);
        }
        return insertPending(t, PaymentMethod.CASH, null, null, req);
    }

    /** Thu ngân xác nhận đã nhận tiền mặt. Hai thu ngân cùng bấm -> người sau nhận 409 (sai version). */
    public PaymentDto confirmCash(long paymentId, int version, StaffPrincipal staff) {
        PaymentRow row = payments.find(paymentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy lần thanh toán #" + paymentId));
        if (!PaymentMethod.CASH.name().equals(row.dto().method())) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Lần thanh toán VNPay được xác nhận tự động qua cổng, không xác nhận tay");
        }
        int updated = payments.markPaid(paymentId, FROM_PENDING, version, null, staff.username(), false,
                System.currentTimeMillis());
        if (updated == 0) {
            PaymentRow now = payments.find(paymentId).orElseThrow();
            throw new ApiException(ErrorCode.VERSION_CONFLICT, "Lần thanh toán đã được xử lý hoặc vừa thay đổi",
                    Map.of("currentStatus", now.dto().status(), "currentVersion", now.dto().version()));
        }
        metrics.paymentsPaid.incrementAndGet();
        PaymentDto dto = payments.find(paymentId).orElseThrow().dto();
        publishUpdated(dto);
        return dto;
    }

    public PaymentDto cancelByStaff(long paymentId, StaffPrincipal staff) {
        PaymentRow row = payments.find(paymentId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy lần thanh toán #" + paymentId));
        return closePending(row, PaymentStatus.CANCELLED, staff.username());
    }

    private PaymentDto closePending(PaymentRow row, PaymentStatus to, String by) {
        if (payments.closePending(row.dto().id(), to.name(), by, System.currentTimeMillis()) == 0) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "Lần thanh toán không còn ở trạng thái chờ", Map.of("currentStatus", row.dto().status()));
        }
        PaymentDto dto = payments.find(row.dto().id()).orElseThrow().dto();
        publishUpdated(dto);
        return dto;
    }

    // ================================================================ VNPay gọi về

    /** Kết quả xử lý dữ liệu VNPay. rspCode theo chuẩn IPN của VNPay. */
    public record VnpayOutcome(String rspCode, String message, PaymentRow payment) {
    }

    /**
     * Xử lý dữ liệu VNPay gửi về (dùng chung cho IPN và Return URL).
     * Mã trả lời: 00 đã xử lý; 01 không tìm thấy; 02 đã xử lý trước đó; 04 sai số tiền; 97 sai chữ ký; 99 lỗi khác.
     */
    public VnpayOutcome handleVnpayCallback(Map<String, String> params, String source) {
        if (!vnpay.verify(params)) {
            log.warn("VNPay {}: sai chữ ký (txnRef={})", source, params.get("vnp_TxnRef"));
            return new VnpayOutcome("97", "Invalid Checksum", null);
        }
        String txnRef = params.get("vnp_TxnRef");
        Optional<PaymentRow> found = txnRef == null ? Optional.empty() : payments.findByTxnRef(txnRef);
        if (found.isEmpty()) {
            return new VnpayOutcome("01", "Order not Found", null);
        }
        PaymentRow row = found.get();
        long amount;
        try {
            amount = Long.parseLong(params.getOrDefault("vnp_Amount", "-1")) / 100;
        } catch (NumberFormatException e) {
            amount = -1;
        }
        if (amount != row.dto().amount()) {
            log.warn("VNPay {}: sai số tiền cho {} ({} khác {})", source, txnRef, amount, row.dto().amount());
            return new VnpayOutcome("04", "Invalid amount", row);
        }
        if (PaymentStatus.PAID.name().equals(row.dto().status())) {
            return new VnpayOutcome("02", "Order already confirmed", row);
        }
        boolean success = "00".equals(params.get("vnp_ResponseCode")) && "00".equals(params.get("vnp_TransactionStatus"));
        if (success) {
            applyVnpaySuccess(row, params.get("vnp_TransactionNo"), "vnpay-" + source);
        } else if (PaymentStatus.PENDING.name().equals(row.dto().status())) {
            closePendingQuietly(row, PaymentStatus.FAILED, "vnpay-" + source);
        } else {
            return new VnpayOutcome("02", "Order already confirmed", row);
        }
        return new VnpayOutcome("00", "Confirm Success", payments.find(row.dto().id()).orElse(row));
    }

    /** Ghi nhận tiền VNPay đã về (kể cả về muộn). */
    private void applyVnpaySuccess(PaymentRow row, String transactionNo, String by) {
        PaymentDto p = row.dto();
        boolean wasPending = PaymentStatus.PENDING.name().equals(p.status());
        boolean needsRefund = false;
        if (!wasPending) {
            long others = payments.sessionPaid(p.sessionId(), p.id());
            needsRefund = payments.sessionTotal(p.sessionId()) - others <= 0;
            log.warn("VNPay: tiền về muộn cho lần #{} ({}), needsRefund={}", p.id(), p.status(), needsRefund);
        }
        int updated = payments.markPaid(p.id(), FROM_ANY_UNPAID, null, transactionNo, by, needsRefund,
                System.currentTimeMillis());
        if (updated > 0) {
            metrics.paymentsPaid.incrementAndGet();
            publishUpdated(payments.find(p.id()).orElseThrow().dto());
        }
    }

    private void closePendingQuietly(PaymentRow row, PaymentStatus to, String by) {
        if (payments.closePending(row.dto().id(), to.name(), by, System.currentTimeMillis()) > 0) {
            publishUpdated(payments.find(row.dto().id()).orElseThrow().dto());
        }
    }

    /** Đường dẫn trang khách để chuyển trình duyệt về sau khi VNPay trả về. */
    public String customerPageFor(PaymentRow row) {
        if (row == null) {
            return "/";
        }
        TableInfo t = tables.get(row.dto().tableId());
        return "/t/" + t.qrToken() + "?payment=" + row.dto().id();
    }

    // ================================================================ tác vụ định kỳ

    /**
     * Các lần PENDING đã quá hạn: với VNPay, hỏi lại VNPay trước (có thể khách đã trả nhưng IPN bị lạc);
     * có tiền thì ghi PAID, không có thì EXPIRED. Tiền mặt quá hạn -> EXPIRED.
     */
    public int expireOverdue() {
        int n = 0;
        for (PaymentRow row : payments.listPendingExpired(System.currentTimeMillis())) {
            if (PaymentMethod.VNPAY.name().equals(row.dto().method()) && vnpay.isConfigured()) {
                VnpayGateway.QueryResult q = vnpay.query(row.txnRef(), orderInfo(row), row.providerCreateDate(),
                        "127.0.0.1");
                if (q.success() && (q.amount() == null || q.amount() == row.dto().amount())) {
                    applyVnpaySuccess(row, q.transactionNo(), "vnpay-querydr");
                    n++;
                    continue;
                }
            }
            closePendingQuietly(row, PaymentStatus.EXPIRED, "system");
            n++;
        }
        return n;
    }

    // ================================================================ tiện ích

    /** Thông tin request cần để tạo link VNPay (IP khách, địa chỉ công khai của server). */
    public record RequestInfo(String clientIp, String baseUrl) {
    }

    private PaymentDto withLink(PaymentRow row, RequestInfo req) {
        PaymentDto p = row.dto();
        if (req == null || !PaymentMethod.VNPAY.name().equals(p.method())
                || !PaymentStatus.PENDING.name().equals(p.status()) || !vnpay.isConfigured()) {
            return p;
        }
        String returnUrl = req.baseUrl() + "/api/payments/vnpay/return";
        return p.withPayUrl(vnpay.buildPayUrl(row.txnRef(), p.amount(), orderInfo(row), row.providerCreateDate(),
                p.expiresAt(), req.clientIp(), returnUrl));
    }

    /** Nội dung giao dịch gửi VNPay: không dấu, không ký tự đặc biệt (theo khuyến nghị của VNPay). */
    private static String orderInfo(PaymentRow row) {
        return "Thanh toan ban " + row.dto().tableCode().replaceAll("[^A-Za-z0-9]", "") + " ma " + row.txnRef();
    }

    /** Mã giao dịch duy nhất gửi VNPay (không dùng id tự tăng vì có thể trùng sau khi xoá database). */
    private static String newTxnRef() {
        String time = Long.toString(System.currentTimeMillis(), 36).toUpperCase();
        String rand = Integer.toString(RANDOM.nextInt(36 * 36 * 36 * 36), 36).toUpperCase();
        return "QR" + time + rand;
    }

    private void publishUpdated(PaymentDto p) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", "PAYMENT_UPDATED");
        event.put("tableId", p.tableId());
        event.put("payment", p);
        publisher.broadcast(EventPublisher.tableTopic(p.tableId()), event);
        publisher.broadcast(EventPublisher.CASHIER_TOPIC, event);
    }
}
