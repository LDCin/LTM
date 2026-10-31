package com.ltm.qrorder.payment;

import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.common.Metrics;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.order.OrderRepository;
import com.ltm.qrorder.order.OrderService;
import com.ltm.qrorder.payment.PaymentDtos.CashierTableView;
import com.ltm.qrorder.payment.PaymentDtos.CheckoutReason;
import com.ltm.qrorder.payment.PaymentDtos.CheckoutRequest;
import com.ltm.qrorder.payment.PaymentDtos.PaymentDto;
import com.ltm.qrorder.payment.PaymentRepository.PaymentRow;
import com.ltm.qrorder.servicecall.ServiceCallRepository;
import com.ltm.qrorder.servicecall.ServiceCallService;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Quầy thu ngân: sơ đồ bàn, "Trả bàn" (kết thúc phiên), và các tác vụ tự động:
 *  - phiên mở mà không gọi món quá idle-timeout -> tự kết thúc (AUTO_IDLE);
 *  - đã trả đúng đủ tiền (không thừa: thừa thì chờ thu ngân trả lại khách), món đã phục vụ hết, quá auto-checkout-after-paid mà chưa ai bấm "Trả bàn" -> tự trả bàn;
 *  - lần thanh toán quá hạn -> hỏi lại VNPay rồi EXPIRED;
 *  - món chờ bếp tiếp nhận quá hạn -> tự huỷ; lượt gọi phục vụ quá hạn -> tự đóng;
 *  - phiên có đơn nhưng quá lâu không hoạt động (không chờ thanh toán) -> tự kết thúc (AUTO_IDLE).
 */
@Service
public class CashierService {

    private static final Logger log = LoggerFactory.getLogger(CashierService.class);

    private final TableService tables;
    private final OrderRepository orders;
    private final PaymentRepository payments;
    private final PaymentService paymentService;
    private final AppProperties props;
    private final Metrics metrics;
    private final ServiceCallRepository serviceCalls;
    private final OrderService orderService;
    private final ServiceCallService serviceCallService;

    public CashierService(TableService tables, OrderRepository orders, PaymentRepository payments,
                          PaymentService paymentService, AppProperties props, Metrics metrics,
                          ServiceCallRepository serviceCalls, OrderService orderService,
                          ServiceCallService serviceCallService) {
        this.orderService = orderService;
        this.serviceCallService = serviceCallService;
        this.serviceCalls = serviceCalls;
        this.tables = tables;
        this.orders = orders;
        this.payments = payments;
        this.paymentService = paymentService;
        this.props = props;
        this.metrics = metrics;
    }

    /** Sơ đồ bàn (ẩn bàn của bộ thực nghiệm, mã bắt đầu bằng "LT"). */
    public List<CashierTableView> tables() {
        return tables.list().stream()
                .filter(t -> !t.code().startsWith("LT"))
                .map(this::view)
                .toList();
    }

    public CashierTableView table(long tableId) {
        return view(tables.get(tableId));
    }

    CashierTableView view(TableInfo t) {
        if (!t.hasSession()) {
            return new CashierTableView(t.id(), t.code(), t.inService(), null, null,
                    t.inService() ? "EMPTY" : "OUT_OF_SERVICE", 0, 0, 0, 0, 0, null, null, false, null, 0);
        }
        long sessionId = t.sessionId();
        long total = payments.sessionTotal(sessionId);
        long paid = payments.sessionPaid(sessionId, null);
        PaymentDto pending = payments.findPending(sessionId).map(PaymentRow::dto).orElse(null);
        String state;
        if (pending != null) {
            state = "AWAITING_PAYMENT";
        } else if (paid > total) {
            state = "REFUND_DUE";
        } else if (total > 0 && total - paid <= 0) {
            state = "PAID";
        } else {
            state = "DINING";
        }
        return new CashierTableView(t.id(), t.code(), t.inService(), sessionId, tables.sessionOpenedAt(sessionId),
                state, total, paid, total - paid, orders.countOrdersInSession(sessionId),
                orders.countActiveItemsInSession(sessionId), pending, payments.lastPaidAt(sessionId),
                payments.sessionNeedsRefund(sessionId), serviceCalls.findOpen(sessionId).orElse(null),
                Math.max(0, paid - total));
    }

    /**
     * "Trả bàn": kết thúc phiên, bàn về trống.
     * - Đang có lần thanh toán chờ -> 409 PAYMENT_IN_PROGRESS (xác nhận hoặc huỷ trước).
     * - Còn tiền chưa trả hoặc còn món chưa phục vụ mà lý do là CHECKOUT (hoặc không có lý do)
     *   -> 409 CONFIRM_REQUIRED kèm số liệu; client hỏi lý do (khách bỏ về / mời khách / khác) rồi gửi lại.
     */
    public CashierTableView checkout(long tableId, CheckoutRequest req, StaffPrincipal staff) {
        TableInfo t = tables.get(tableId);
        if (!t.hasSession()) {
            return view(t);   // bàn đã trống: coi như xong (gọi lặp không lỗi)
        }
        CashierTableView v = view(t);
        if (v.pending() != null) {
            throw new ApiException(ErrorCode.PAYMENT_IN_PROGRESS,
                    "Bàn " + t.code() + " đang có lần thanh toán chờ, hãy xác nhận hoặc huỷ trước khi trả bàn");
        }
        if (v.refundDue() > 0 && (req == null || !Boolean.TRUE.equals(req.refundReturned()))) {
            throw new ApiException(ErrorCode.CONFIRM_REQUIRED,
                    "Bàn " + t.code() + " cần trả lại khách " + v.refundDue() + "đ (món bị huỷ sau khi đã thanh toán)."
                            + " Xác nhận đã trả lại tiền để trả bàn", Map.of("refundDue", v.refundDue()));
        }
        CheckoutReason reason = req == null || req.reason() == null ? CheckoutReason.CHECKOUT : req.reason();
        if (reason == CheckoutReason.CHECKOUT && (v.remaining() > 0 || v.activeItemCount() > 0)) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("remaining", v.remaining());
            details.put("activeItemCount", v.activeItemCount());
            throw new ApiException(ErrorCode.CONFIRM_REQUIRED,
                    "Bàn " + t.code() + (v.remaining() > 0 ? " còn " + v.remaining() + "đ chưa thanh toán" : "")
                            + (v.activeItemCount() > 0 ? " còn " + v.activeItemCount() + " món chưa phục vụ" : "")
                            + ". Chọn lý do để vẫn trả bàn", details);
        }
        String note = req == null ? null : req.note();
        if (v.refundDue() > 0) {
            String refundNote = "Đã trả lại khách " + v.refundDue() + "đ";
            note = note == null || note.isBlank() ? refundNote : note + "; " + refundNote;
            if (note.length() > 200) {   // cột end_note tối đa 200 ký tự: giữ phần ghi chú về tiền ở cuối
                note = note.substring(note.length() - 200);
            }
        }
        tables.endSession(tableId, t.sessionId(), reason.name(), note, staff.username());
        return view(tables.get(tableId));
    }

    // ================================================================ tác vụ tự động

    @Scheduled(initialDelay = 30_000, fixedDelay = 60_000)
    public void runAutomaticTasks() {
        try {
            long now = System.currentTimeMillis();
            paymentService.expireOverdue();
            orderService.expireStalePending(now - props.getSession().getOrderPendingTimeoutMinutes() * 60_000L);
            serviceCallService.expireOverdue(now - props.getSession().getServiceCallTimeoutMinutes() * 60_000L);
            autoEndSessions(now);
        } catch (RuntimeException e) {
            log.warn("Tác vụ tự động của thu ngân lỗi: {}", e.getMessage());
        }
    }

    /** @return số phiên đã tự kết thúc */
    public int autoEndSessions(long now) {
        long idleMs = props.getSession().getIdleTimeoutMinutes() * 60_000L;
        long afterPaidMs = props.getSession().getAutoCheckoutAfterPaidMinutes() * 60_000L;
        long inactiveMs = props.getSession().getInactiveTimeoutMinutes() * 60_000L;
        int ended = 0;
        for (long[] s : payments.openSessions()) {
            long tableId = s[0];
            long sessionId = s[1];
            long openedAt = s[2];
            if (orders.hasPendingPayment(sessionId)) {
                continue;
            }
            boolean ok = false;
            if (orders.countOrdersInSession(sessionId) == 0) {
                if (now - openedAt > idleMs) {
                    ok = tables.endSession(tableId, sessionId, "AUTO_IDLE", "Không gọi món", "system");
                }
            } else {
                long total = payments.sessionTotal(sessionId);
                long paid = payments.sessionPaid(sessionId, null);
                Long lastPaid = payments.lastPaidAt(sessionId);
                if (total > 0 && total == paid && lastPaid != null && now - lastPaid > afterPaidMs
                        && orders.countActiveItemsInSession(sessionId) == 0) {
                    ok = tables.endSession(tableId, sessionId, "AUTO_AFTER_PAID", "Tự trả bàn sau khi thanh toán", "system");
                }
                Long last = orders.lastActivityAt(sessionId);
                if (!ok && last != null && now - Math.max(last, lastPaid == null ? 0 : lastPaid) > inactiveMs) {
                    ok = tables.endSession(tableId, sessionId, "AUTO_IDLE", "Quá lâu không hoạt động", "system");
                }
            }
            if (ok) {
                ended++;
                metrics.sessionsAutoEnded.incrementAndGet();
            }
        }
        return ended;
    }
}
