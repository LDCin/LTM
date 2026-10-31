package com.ltm.qrorder.payment;

import com.ltm.qrorder.common.DeviceIds;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.payment.PaymentDtos.BillView;
import com.ltm.qrorder.payment.PaymentDtos.CreatePaymentRequest;
import com.ltm.qrorder.payment.PaymentDtos.CreatePaymentResult;
import com.ltm.qrorder.payment.PaymentDtos.PaymentDto;
import com.ltm.qrorder.payment.PaymentService.RequestInfo;
import com.ltm.qrorder.payment.PaymentService.VnpayOutcome;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Thanh toán phía khách (xác thực bằng X-Table-Token như đặt món) và hai endpoint VNPay gọi về:
 *  - /vnpay/ipn    : server VNPay gọi server mình (server-to-server), trả JSON {RspCode, Message}.
 *  - /vnpay/return : trình duyệt của khách được VNPay chuyển về sau khi trả tiền -> chuyển tiếp về trang gọi món.
 */
@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    private final PaymentService payments;
    private final AppProperties props;

    public PaymentController(PaymentService payments, AppProperties props) {
        this.payments = payments;
        this.props = props;
    }

    @GetMapping("/bill")
    public BillView bill(@RequestHeader("X-Table-Token") String tableToken,
                         @RequestHeader(value = DeviceIds.SESSION_HEADER, required = false) String session,
                         HttpServletRequest http) {
        return payments.billForCustomer(tableToken, session, requestInfo(http, props));
    }

    /** 201: lần thanh toán mới. 200 + Idempotent-Replayed: true: trả lại lần đã có (gửi lại / bạn cùng bàn đang trả). */
    @PostMapping
    public ResponseEntity<PaymentDto> create(@RequestHeader("X-Table-Token") String tableToken,
                                             @RequestHeader(value = DeviceIds.HEADER, required = false) String deviceId,
                                             @RequestHeader(value = DeviceIds.SESSION_HEADER, required = false) String session,
                                             @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                             @Valid @RequestBody CreatePaymentRequest req,
                                             HttpServletRequest http) {
        CreatePaymentResult r = payments.create(tableToken, deviceId, session, key, req.method(), requestInfo(http, props));
        return ResponseEntity.status(r.replayed() ? HttpStatus.OK : HttpStatus.CREATED)
                .header("Idempotent-Replayed", String.valueOf(r.replayed()))
                .body(r.payment());
    }

    @GetMapping("/{id}")
    public PaymentDto get(@RequestHeader("X-Table-Token") String tableToken, @PathVariable long id,
                          HttpServletRequest http) {
        return payments.getForCustomer(tableToken, id, requestInfo(http, props));
    }

    @PostMapping("/{id}/cancel")
    public PaymentDto cancel(@RequestHeader("X-Table-Token") String tableToken,
                             @RequestHeader(value = DeviceIds.SESSION_HEADER, required = false) String session,
                             @PathVariable long id) {
        return payments.cancelByCustomer(tableToken, session, id);
    }

    // ------------------------------------------------------------------ VNPay

    /** IPN: VNPay gọi tới khi có kết quả. Luôn trả HTTP 200 với mã RspCode theo chuẩn VNPay. */
    @GetMapping("/vnpay/ipn")
    public Map<String, String> vnpayIpn(@RequestParam Map<String, String> params) {
        VnpayOutcome o = payments.handleVnpayCallback(params, "ipn");
        return Map.of("RspCode", o.rspCode(), "Message", o.message());
    }

    /**
     * Return URL: dữ liệu trên URL có chữ ký VNPay nên được kiểm tra rồi ghi nhận như IPN
     * (không ai sửa được kết quả mà không có khoá bí mật). Sau đó chuyển trình duyệt về trang gọi món.
     */
    @GetMapping("/vnpay/return")
    public ResponseEntity<Void> vnpayReturn(@RequestParam Map<String, String> params) {
        VnpayOutcome o = payments.handleVnpayCallback(params, "return");
        String target = payments.customerPageFor(o.payment());
        if (!"00".equals(o.rspCode()) && !"02".equals(o.rspCode())) {
            target += (target.contains("?") ? "&" : "?") + "vnpay=" + o.rspCode();
        }
        return ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.LOCATION, target).build();
    }

    // ------------------------------------------------------------------ tiện ích

    /** IP của khách và địa chỉ công khai của server (để tạo Return URL cho VNPay). */
    static RequestInfo requestInfo(HttpServletRequest http, AppProperties props) {
        String forwarded = http.getHeader("X-Forwarded-For");
        String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
        if (ip == null || ip.contains(":")) {
            ip = "127.0.0.1";   // VNPay chỉ nhận IPv4
        }
        String base = props.getVnpay().getPublicUrl();
        if (base == null || base.isBlank()) {
            String proto = firstValue(http.getHeader("X-Forwarded-Proto"), http.getScheme());
            String host = firstValue(http.getHeader("X-Forwarded-Host"), http.getHeader("Host"));
            base = proto + "://" + host;
        }
        return new RequestInfo(ip, base.replaceAll("/+$", ""));
    }

    private static String firstValue(String header, String fallback) {
        return header != null && !header.isBlank() ? header.split(",")[0].trim() : fallback;
    }
}
