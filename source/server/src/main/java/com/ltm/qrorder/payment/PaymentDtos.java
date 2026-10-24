package com.ltm.qrorder.payment;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class PaymentDtos {

    private PaymentDtos() {
    }

    public enum PaymentMethod { CASH, VNPAY }

    /**
     * PENDING: đang chờ trả. PAID: đã nhận tiền. FAILED: cổng báo thất bại.
     * EXPIRED: quá hạn. CANCELLED: khách/thu ngân huỷ (VD để gọi thêm món).
     */
    public enum PaymentStatus { PENDING, PAID, FAILED, EXPIRED, CANCELLED }

    /** Lý do kết thúc phiên khi thu ngân bấm "Trả bàn". */
    public enum CheckoutReason { CHECKOUT, UNPAID_LEFT, COMPED, OTHER }

    // ------------------------------------------------------------ request

    public record CreatePaymentRequest(@NotNull PaymentMethod method) {
    }

    public record ConfirmPaymentRequest(@NotNull Integer version) {
    }

    public record CheckoutRequest(CheckoutReason reason, @Size(max = 200) String note) {
    }

    // ------------------------------------------------------------ response

    /** payUrl chỉ có với lần thanh toán VNPay còn PENDING (link sang trang thanh toán của VNPay). */
    public record PaymentDto(long id, long tableId, String tableCode, long sessionId, long amount, String method,
                             String status, int version, long createdAt, long expiresAt, Long paidAt,
                             boolean needsRefund, String confirmedBy, String payUrl) {

        public PaymentDto withPayUrl(String url) {
            return new PaymentDto(id, tableId, tableCode, sessionId, amount, method, status, version, createdAt,
                    expiresAt, paidAt, needsRefund, confirmedBy, url);
        }
    }

    /** Kết quả tạo thanh toán: replayed = true nếu trả lại lần đã có (gửi lại cùng key, hoặc bạn cùng bàn đang trả). */
    public record CreatePaymentResult(PaymentDto payment, boolean replayed) {
    }

    /**
     * Hóa đơn của phiên: total = tổng món không bị huỷ; paid = tổng các lần PAID; remaining = total - paid
     * (âm nghĩa là trả thừa). pending = lần đang chờ (nếu có). methods = cách trả đang bật.
     */
    public record BillView(long tableId, String tableCode, Long sessionId, long total, long paid, long remaining,
                           PaymentDto pending, List<PaymentDto> payments, List<String> methods) {
    }

    /**
     * Một ô trên sơ đồ bàn của thu ngân.
     * state: OUT_OF_SERVICE | EMPTY | DINING | AWAITING_PAYMENT | PAID.
     */
    public record CashierTableView(long id, String code, boolean inService, Long sessionId, Long sessionOpenedAt,
                                   String state, long total, long paid, long remaining, long orderCount,
                                   long activeItemCount, PaymentDto pending, Long lastPaidAt, boolean needsRefund) {
    }
}
