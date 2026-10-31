package com.ltm.qrorder.payment;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ltm.qrorder.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Giao tiếp với cổng VNPay (API phiên bản 2.1.0, môi trường sandbox).
 *
 * - Tạo link thanh toán: các tham số vnp_* được sắp xếp theo tên, URL-encode, rồi ký HMAC-SHA512 bằng
 *   Hash Secret -> vnp_SecureHash. Khách được chuyển sang trang VNPay bằng link này.
 * - Kiểm tra chữ ký của dữ liệu VNPay gửi về (IPN, Return URL): tính lại chữ ký với cùng khoá bí mật;
 *   ai không có khoá thì không làm giả được kết quả thanh toán.
 * - Tra cứu giao dịch (querydr): server gọi thẳng API của VNPay qua HTTPS để hỏi trạng thái thật,
 *   dùng làm đường dự phòng khi không nhận được IPN.
 */
@Component
public class VnpayGateway {

    public static final ZoneId VN_ZONE = ZoneId.of("Asia/Ho_Chi_Minh");
    public static final DateTimeFormatter VNP_DATE = DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(VN_ZONE);

    private static final Logger log = LoggerFactory.getLogger(VnpayGateway.class);

    private final AppProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public VnpayGateway(AppProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
    }

    public boolean isConfigured() {
        return props.getVnpay().isConfigured();
    }

    public static String formatDate(long epochMs) {
        return VNP_DATE.format(Instant.ofEpochMilli(epochMs));
    }

    /**
     * Link sang trang thanh toán VNPay. Các tham số đều lấy từ bản ghi đã lưu (số tiền, mã giao dịch, ngày tạo,
     * hạn) nên gọi lại nhiều lần vẫn ra cùng một link.
     */
    public String buildPayUrl(String txnRef, long amount, String orderInfo, String createDate, long expiresAt,
                              String clientIp, String returnUrl) {
        AppProperties.Vnpay cfg = props.getVnpay();
        Map<String, String> params = new TreeMap<>();
        params.put("vnp_Version", "2.1.0");
        params.put("vnp_Command", "pay");
        params.put("vnp_TmnCode", cfg.getTmnCode());
        params.put("vnp_Amount", String.valueOf(amount * 100));   // VNPay tính theo đơn vị 1/100 đồng
        params.put("vnp_CurrCode", "VND");
        params.put("vnp_TxnRef", txnRef);
        params.put("vnp_OrderInfo", orderInfo);
        params.put("vnp_OrderType", "other");
        params.put("vnp_Locale", "vn");
        params.put("vnp_ReturnUrl", returnUrl);
        params.put("vnp_IpAddr", clientIp);
        params.put("vnp_CreateDate", createDate);
        params.put("vnp_ExpireDate", formatDate(expiresAt));
        String query = canonical(params);
        return cfg.getPayUrl() + "?" + query + "&vnp_SecureHash=" + hmacSha512(cfg.getHashSecret(), query);
    }

    /** Kiểm tra chữ ký của bộ tham số VNPay gửi về (bỏ qua vnp_SecureHash, vnp_SecureHashType khi tính). */
    public boolean verify(Map<String, String> allParams) {
        String received = allParams.get("vnp_SecureHash");
        if (received == null || !isConfigured()) {
            return false;
        }
        Map<String, String> fields = new TreeMap<>();
        allParams.forEach((k, v) -> {
            if (k.startsWith("vnp_") && !k.equals("vnp_SecureHash") && !k.equals("vnp_SecureHashType")
                    && v != null && !v.isEmpty()) {
                fields.put(k, v);
            }
        });
        String expected = hmacSha512(props.getVnpay().getHashSecret(), canonical(fields));
        // So sánh thời gian hằng định (tránh đoán chữ ký qua thời gian phản hồi)
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII),
                received.toLowerCase().getBytes(StandardCharsets.US_ASCII));
    }

    /** Kết quả tra cứu. success = VNPay xác nhận giao dịch thành công. */
    public record QueryResult(boolean answered, boolean success, Long amount, String transactionNo, String raw) {
    }

    /**
     * Gọi API tra cứu giao dịch (vnp_Command=querydr).
     * Chữ ký request: HMAC-SHA512 của chuỗi các trường nối bằng dấu "|" theo thứ tự VNPay quy định.
     */
    public QueryResult query(String txnRef, String orderInfo, String transactionDate, String clientIp) {
        if (!isConfigured()) {
            return new QueryResult(false, false, null, null, "VNPay chưa được cấu hình");
        }
        AppProperties.Vnpay cfg = props.getVnpay();
        String requestId = UUID.randomUUID().toString().replace("-", "");
        String createDate = formatDate(System.currentTimeMillis());
        String data = String.join("|", requestId, "2.1.0", "querydr", cfg.getTmnCode(), txnRef, transactionDate,
                createDate, clientIp, orderInfo);
        Map<String, String> body = new LinkedHashMap<>();
        body.put("vnp_RequestId", requestId);
        body.put("vnp_Version", "2.1.0");
        body.put("vnp_Command", "querydr");
        body.put("vnp_TmnCode", cfg.getTmnCode());
        body.put("vnp_TxnRef", txnRef);
        body.put("vnp_OrderInfo", orderInfo);
        body.put("vnp_TransactionDate", transactionDate);
        body.put("vnp_CreateDate", createDate);
        body.put("vnp_IpAddr", clientIp);
        body.put("vnp_SecureHash", hmacSha512(cfg.getHashSecret(), data));
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(cfg.getApiUrl()))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode json = mapper.readTree(res.body());
            String responseCode = json.path("vnp_ResponseCode").asText("");
            String txnStatus = json.path("vnp_TransactionStatus").asText("");
            Long amount = json.hasNonNull("vnp_Amount") ? json.get("vnp_Amount").asLong() / 100 : null;
            String txnNo = json.path("vnp_TransactionNo").asText(null);
            // "00" = tra cứu thành công; vnp_TransactionStatus "00" = giao dịch đã thanh toán
            return new QueryResult("00".equals(responseCode), "00".equals(responseCode) && "00".equals(txnStatus),
                    amount, txnNo, res.body());
        } catch (Exception e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.warn("Tra cứu VNPay {} thất bại: {}", txnRef, e.getMessage());
            return new QueryResult(false, false, null, null, e.getMessage());
        }
    }

    // ------------------------------------------------------------------ tiện ích

    /** Chuỗi tham số đã sắp xếp theo tên, giá trị URL-encode (dùng cho cả query string và dữ liệu ký). */
    public static String canonical(Map<String, String> sorted) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : sorted.entrySet()) {
            if (e.getValue() == null || e.getValue().isEmpty()) {
                continue;
            }
            if (!sb.isEmpty()) {
                sb.append('&');
            }
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.US_ASCII))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.US_ASCII));
        }
        return sb.toString();
    }

    public static String hmacSha512(String key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA512");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA512"));
            return HexFormat.of().formatHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Không tính được HMAC-SHA512", e);
        }
    }
}
