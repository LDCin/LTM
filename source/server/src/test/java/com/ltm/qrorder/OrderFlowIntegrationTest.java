package com.ltm.qrorder;

import com.fasterxml.jackson.databind.JsonNode;
import com.ltm.qrorder.payment.CashierService;
import com.ltm.qrorder.payment.VnpayGateway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Kiểm thử tích hợp qua HTTP thật (server chạy cổng ngẫu nhiên, DB H2).
 * VNPay dùng mã và khoá GIẢ chỉ có trong test (không phải tài khoản thật), để tự ký dữ liệu IPN.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"app.rate-limit.enabled=false",
                "app.vnpay.tmn-code=TESTTMN1", "app.vnpay.hash-secret=TEST-ONLY-SECRET-NOT-REAL"})
@ActiveProfiles("h2")
class OrderFlowIntegrationTest {

    static final String TEST_SECRET = "TEST-ONLY-SECRET-NOT-REAL";

    @Autowired
    TestRestTemplate http;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    CashierService cashier;

    String tableToken;
    long phoId;
    String kitchenToken;

    @BeforeEach
    void setUp() {
        tableToken = token("B01");
        join(tableToken, device());
        phoId = jdbc.queryForObject("SELECT id FROM menu_item WHERE name = 'Phở bò tái'", Long.class);
        kitchenToken = login("bep", "bep123");
    }

    // ================================================================ đặt món (giữ nguyên hành vi cũ)

    @Test
    void sameIdempotencyKeyCreatesOnlyOneOrder() {
        String key = UUID.randomUUID().toString();
        ResponseEntity<JsonNode> first = placeOrder(key, phoId, 2);
        ResponseEntity<JsonNode> second = placeOrder(key, phoId, 2);

        assertEquals(201, first.getStatusCode().value());
        assertEquals(200, second.getStatusCode().value());
        assertEquals("true", second.getHeaders().getFirst("Idempotent-Replayed"));
        assertEquals(first.getBody().get("id").asLong(), second.getBody().get("id").asLong());
    }

    @Test
    void concurrentRequestsWithSameKeyCreateOneOrder() throws Exception {
        String key = UUID.randomUUID().toString();
        ExecutorService pool = Executors.newFixedThreadPool(8);
        List<Callable<ResponseEntity<JsonNode>>> tasks = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            tasks.add(() -> placeOrder(key, phoId, 1));
        }
        List<Long> ids = new ArrayList<>();
        for (Future<ResponseEntity<JsonNode>> f : pool.invokeAll(tasks)) {
            ResponseEntity<JsonNode> r = f.get();
            assertEquals(true, r.getStatusCode().is2xxSuccessful(), "status " + r.getStatusCode());
            ids.add(r.getBody().get("id").asLong());
        }
        pool.shutdown();
        assertEquals(1, ids.stream().distinct().count(), "8 request song song cùng key phải trả về cùng 1 đơn");
    }

    @Test
    void sameKeyDifferentBodyIsRejected() {
        String key = UUID.randomUUID().toString();
        placeOrder(key, phoId, 1);
        ResponseEntity<JsonNode> r = placeOrder(key, phoId, 3);
        assertEquals(409, r.getStatusCode().value());
        assertEquals("IDEMPOTENCY_KEY_REUSED", r.getBody().get("error").asText());
    }

    @Test
    void invalidRequestReturns400() {
        HttpHeaders h = new HttpHeaders();
        h.set("X-Table-Token", tableToken);
        ResponseEntity<JsonNode> r = http.postForEntity("/api/orders", json("{\"items\":[]}", h), JsonNode.class);
        assertEquals(400, r.getStatusCode().value());
        ResponseEntity<JsonNode> broken = http.postForEntity("/api/orders", json("{not json", h), JsonNode.class);
        assertEquals(400, broken.getStatusCode().value());
    }

    @Test
    void invalidTableTokenReturns401() {
        HttpHeaders h = new HttpHeaders();
        h.set("X-Table-Token", "khong-ton-tai");
        ResponseEntity<JsonNode> r = http.postForEntity("/api/orders",
                json("{\"items\":[{\"menuItemId\":" + phoId + ",\"quantity\":1}]}", h), JsonNode.class);
        assertEquals(401, r.getStatusCode().value());
    }

    @Test
    void stateMachineAndOptimisticLock() {
        JsonNode order = placeOrder(UUID.randomUUID().toString(), phoId, 1).getBody();
        long itemId = order.get("items").get(0).get("id").asLong();

        assertEquals(200, updateStatus(itemId, "ACCEPTED", 0).getStatusCode().value());
        ResponseEntity<JsonNode> stale = updateStatus(itemId, "COOKING", 0);
        assertEquals(409, stale.getStatusCode().value());
        assertEquals("VERSION_CONFLICT", stale.getBody().get("error").asText());
        ResponseEntity<JsonNode> invalid = updateStatus(itemId, "SERVED", 1);
        assertEquals("INVALID_STATE_TRANSITION", invalid.getBody().get("error").asText());
        assertEquals(200, updateStatus(itemId, "COOKING", 1).getStatusCode().value());
    }

    @Test
    void kitchenRequiresLogin() {
        ResponseEntity<JsonNode> r = http.getForEntity("/api/kitchen/orders", JsonNode.class);
        assertEquals(401, r.getStatusCode().value());
    }

    @Test
    void menuSupportsEtag() {
        ResponseEntity<JsonNode> first = http.getForEntity("/api/public/menu", JsonNode.class);
        String etag = first.getHeaders().getETag();
        assertNotNull(etag);
        HttpHeaders h = new HttpHeaders();
        h.setIfNoneMatch(etag);
        ResponseEntity<String> second = http.exchange("/api/public/menu", HttpMethod.GET, new HttpEntity<>(h), String.class);
        assertEquals(304, second.getStatusCode().value());
    }

    // ================================================================ phiên bàn, đơn chung, tên khách

    @Test
    void concurrentJoinOpensOnlyOneSession() throws Exception {
        String token = token("B04");
        ExecutorService pool = Executors.newFixedThreadPool(8);
        List<Callable<JsonNode>> tasks = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            tasks.add(() -> join(token, device()));
        }
        List<Long> sessions = new ArrayList<>();
        for (Future<JsonNode> f : pool.invokeAll(tasks)) {
            sessions.add(f.get().get("sessionId").asLong());
        }
        pool.shutdown();
        assertEquals(1, sessions.stream().distinct().count(), "8 máy cùng vào bàn trống phải chung 1 phiên");
        Long opened = jdbc.queryForObject("SELECT COUNT(*) FROM table_session s JOIN restaurant_table t ON t.id = s.table_id " +
                "WHERE t.code = 'B04' AND s.closed_at IS NULL", Long.class);
        assertEquals(1L, opened, "database chỉ còn đúng 1 phiên đang mở");
    }

    @Test
    void devicesInSameSessionShareOrdersButOnlyOwnerCancels() {
        String token = token("B02");
        String deviceA = device();
        String deviceB = device();
        long session = join(token, deviceA).get("sessionId").asLong();
        assertEquals(session, join(token, deviceB).get("sessionId").asLong());

        HttpHeaders a = customerHeaders(token, deviceA, session);
        a.set("Idempotency-Key", UUID.randomUUID().toString());
        JsonNode order = http.postForEntity("/api/orders",
                json("{\"items\":[{\"menuItemId\":" + phoId + ",\"quantity\":1}],\"guestName\":\"  Minh  \"}", a),
                JsonNode.class).getBody();
        long orderId = order.get("id").asLong();
        assertEquals("Minh", order.get("guestName").asText());

        JsonNode seenByA = tableOrders(token, deviceA, session);
        JsonNode seenByB = tableOrders(token, deviceB, session);
        assertTrue(containsOrder(seenByB, orderId), "máy khác cùng phiên thấy đơn chung");
        assertTrue(containsId(seenByA.get("mineOrderIds"), orderId), "máy A biết đơn là của mình");
        assertTrue(!containsId(seenByB.get("mineOrderIds"), orderId), "máy B không coi đơn là của mình");
        assertTrue(!seenByB.toString().contains(deviceA), "mã thiết bị không bao giờ lộ ra ngoài");

        ResponseEntity<JsonNode> cancelByB = http.postForEntity("/api/orders/" + orderId + "/cancel",
                new HttpEntity<>(customerHeaders(token, deviceB, session)), JsonNode.class);
        assertEquals(404, cancelByB.getStatusCode().value());
        ResponseEntity<JsonNode> cancelByA = http.postForEntity("/api/orders/" + orderId + "/cancel",
                new HttpEntity<>(customerHeaders(token, deviceA, session)), JsonNode.class);
        assertEquals(200, cancelByA.getStatusCode().value());
    }

    @Test
    void endedSessionIsRejectedAndAdminCannotCloseOccupiedTable() {
        String token = token("B05");
        long tableId = tableId("B05");
        String dev = device();
        long session = join(token, dev).get("sessionId").asLong();

        ResponseEntity<JsonNode> closeBusy = http.postForEntity("/api/admin/tables/" + tableId + "/close",
                new HttpEntity<>(bearer(login("admin", "admin123"))), JsonNode.class);
        assertEquals(409, closeBusy.getStatusCode().value());
        assertEquals("TABLE_HAS_GUESTS", closeBusy.getBody().get("error").asText());

        ResponseEntity<JsonNode> checkout = http.postForEntity("/api/cashier/tables/" + tableId + "/checkout",
                json("{}", bearer(login("thungan", "thungan123"))), JsonNode.class);
        assertEquals(200, checkout.getStatusCode().value());
        assertEquals("EMPTY", checkout.getBody().get("state").asText());

        HttpHeaders stale = customerHeaders(token, dev, session);
        stale.set("Idempotency-Key", UUID.randomUUID().toString());
        ResponseEntity<JsonNode> late = http.postForEntity("/api/orders",
                json("{\"items\":[{\"menuItemId\":" + phoId + ",\"quantity\":1}]}", stale), JsonNode.class);
        assertEquals(409, late.getStatusCode().value());
        assertEquals("SESSION_ENDED", late.getBody().get("error").asText(), "máy của lượt trước không đặt vào phiên mới");

        long newSession = join(token, dev).get("sessionId").asLong();
        assertTrue(newSession != session, "lượt khách sau có phiên mới");
        assertEquals(0, tableOrders(token, dev, newSession).get("orders").size());
    }

    @Test
    void idleSessionWithoutOrdersEndsAutomatically() {
        String token = token("B10");
        long session = join(token, device()).get("sessionId").asLong();
        cashier.autoEndSessions(System.currentTimeMillis());
        assertEquals(session, join(token, device()).get("sessionId").asLong(), "chưa quá 30 phút -> giữ phiên");

        cashier.autoEndSessions(System.currentTimeMillis() + 31 * 60_000L);
        String reason = jdbc.queryForObject("SELECT end_reason FROM table_session WHERE id = ?", String.class, session);
        assertEquals("AUTO_IDLE", reason);
        assertTrue(join(token, device()).get("sessionId").asLong() != session, "khách sau được phiên mới");
    }

    // ================================================================ thanh toán tiền mặt, trả bàn

    @Test
    void cashPaymentFlowAndCheckout() {
        String token = token("B07");
        long tableId = tableId("B07");
        String devA = device();
        String devB = device();
        long session = join(token, devA).get("sessionId").asLong();
        placeOrderAt(token, devA, session, 2);   // 2 x 55.000

        String key = UUID.randomUUID().toString();
        ResponseEntity<JsonNode> pay = createPayment(token, devA, session, key, "CASH");
        assertEquals(201, pay.getStatusCode().value());
        long paymentId = pay.getBody().get("id").asLong();
        assertEquals(110000, pay.getBody().get("amount").asLong(), "số tiền do server tính");
        assertEquals(200, createPayment(token, devA, session, key, "CASH").getStatusCode().value(), "gửi lại cùng key");
        ResponseEntity<JsonNode> byB = createPayment(token, devB, session, UUID.randomUUID().toString(), "CASH");
        assertEquals(paymentId, byB.getBody().get("id").asLong(), "bạn cùng bàn thấy lần đang chờ, không tạo lần mới");

        HttpHeaders more = customerHeaders(token, devA, session);
        more.set("Idempotency-Key", UUID.randomUUID().toString());
        ResponseEntity<JsonNode> blocked = http.postForEntity("/api/orders",
                json("{\"items\":[{\"menuItemId\":" + phoId + ",\"quantity\":1}]}", more), JsonNode.class);
        assertEquals("PAYMENT_IN_PROGRESS", blocked.getBody().get("error").asText());

        HttpHeaders kitchen = bearer(kitchenToken);
        assertEquals(403, http.exchange("/api/cashier/tables", HttpMethod.GET, new HttpEntity<>(kitchen), JsonNode.class)
                .getStatusCode().value(), "tài khoản bếp không vào được quầy thu ngân");

        HttpHeaders cashier = bearer(login("thungan", "thungan123"));
        ResponseEntity<JsonNode> confirm = http.exchange("/api/cashier/payments/" + paymentId + "/confirm",
                HttpMethod.PATCH, json("{\"version\":0}", cashier), JsonNode.class);
        assertEquals(200, confirm.getStatusCode().value());
        assertEquals("PAID", confirm.getBody().get("status").asText());
        ResponseEntity<JsonNode> again = http.exchange("/api/cashier/payments/" + paymentId + "/confirm",
                HttpMethod.PATCH, json("{\"version\":0}", cashier), JsonNode.class);
        assertEquals(409, again.getStatusCode().value(), "bấm xác nhận lần hai bị từ chối");

        JsonNode bill = http.exchange("/api/payments/bill", HttpMethod.GET,
                new HttpEntity<>(customerHeaders(token, devA, session)), JsonNode.class).getBody();
        assertEquals(0, bill.get("remaining").asLong());

        ResponseEntity<JsonNode> checkout = http.postForEntity("/api/cashier/tables/" + tableId + "/checkout",
                json("{}", cashier), JsonNode.class);
        assertEquals(409, checkout.getStatusCode().value(), "còn món chưa phục vụ -> cần lý do");
        assertEquals("CONFIRM_REQUIRED", checkout.getBody().get("error").asText());
        ResponseEntity<JsonNode> forced = http.postForEntity("/api/cashier/tables/" + tableId + "/checkout",
                json("{\"reason\":\"OTHER\",\"note\":\"test\"}", cashier), JsonNode.class);
        assertEquals("EMPTY", forced.getBody().get("state").asText());
    }

    // ================================================================ VNPay (khoá giả của test)

    @Test
    void vnpayIpnVerifiesSignatureAmountAndIsIdempotent() {
        String token = token("B09");
        String dev = device();
        long session = join(token, dev).get("sessionId").asLong();
        placeOrderAt(token, dev, session, 1);

        JsonNode payment = createPayment(token, dev, session, UUID.randomUUID().toString(), "VNPAY").getBody();
        String payUrl = payment.get("payUrl").asText();
        assertTrue(payUrl.startsWith("https://sandbox.vnpayment.vn/"), payUrl);
        Map<String, String> query = UriComponentsBuilder.fromUri(URI.create(payUrl)).build().getQueryParams()
                .toSingleValueMap();
        String txnRef = query.get("vnp_TxnRef");
        assertEquals(String.valueOf(55000 * 100), query.get("vnp_Amount"));

        Map<String, String> ipn = new TreeMap<>();
        ipn.put("vnp_TmnCode", "TESTTMN1");
        ipn.put("vnp_TxnRef", txnRef);
        ipn.put("vnp_Amount", String.valueOf(55000 * 100));
        ipn.put("vnp_ResponseCode", "00");
        ipn.put("vnp_TransactionStatus", "00");
        ipn.put("vnp_TransactionNo", "14000001");

        assertEquals("97", ipn(ipn, "chu-ky-sai").get("RspCode").asText(), "sai chữ ký");
        Map<String, String> wrongAmount = new TreeMap<>(ipn);
        wrongAmount.put("vnp_Amount", "100");
        assertEquals("04", ipn(wrongAmount, sign(wrongAmount)).get("RspCode").asText(), "sai số tiền");
        assertEquals("00", ipn(ipn, sign(ipn)).get("RspCode").asText(), "hợp lệ");
        assertEquals("02", ipn(ipn, sign(ipn)).get("RspCode").asText(), "VNPay gọi lặp -> đã xử lý");

        String status = jdbc.queryForObject("SELECT status FROM payment WHERE txn_ref = ?", String.class, txnRef);
        assertEquals("PAID", status);
    }

    @Test
    void vnpayHmacMatchesWhenRecomputed() {
        Map<String, String> p = new TreeMap<>(Map.of("vnp_Amount", "1000000", "vnp_OrderInfo", "Thanh toan ban B01",
                "vnp_TxnRef", "QRABC"));
        String sig = VnpayGateway.hmacSha512(TEST_SECRET, VnpayGateway.canonical(p));
        assertEquals(128, sig.length(), "HMAC-SHA512 dạng hex dài 128 ký tự");
        p.put("vnp_Amount", "1000001");
        assertTrue(!sig.equals(VnpayGateway.hmacSha512(TEST_SECRET, VnpayGateway.canonical(p))), "đổi dữ liệu -> đổi chữ ký");
    }

    // ================================================================ tiện ích

    private String token(String code) {
        return jdbc.queryForObject("SELECT qr_token FROM restaurant_table WHERE code = ?", String.class, code);
    }

    private long tableId(String code) {
        return jdbc.queryForObject("SELECT id FROM restaurant_table WHERE code = ?", Long.class, code);
    }

    private static String device() {
        return "dev" + UUID.randomUUID().toString().replace("-", "");
    }

    private String login(String username, String password) {
        JsonNode r = http.postForObject("/api/auth/login",
                json("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}", new HttpHeaders()),
                JsonNode.class);
        return r.get("token").asText();
    }

    private static HttpHeaders bearer(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        return h;
    }

    private JsonNode join(String token, String deviceId) {
        HttpHeaders h = new HttpHeaders();
        h.set("X-Device-Id", deviceId);
        ResponseEntity<JsonNode> r = http.postForEntity("/api/public/tables/" + token + "/join", new HttpEntity<>(h),
                JsonNode.class);
        assertEquals(200, r.getStatusCode().value(), String.valueOf(r.getBody()));
        return r.getBody();
    }

    private HttpHeaders customerHeaders(String token, String deviceId, Long session) {
        HttpHeaders h = new HttpHeaders();
        h.set("X-Table-Token", token);
        if (deviceId != null) {
            h.set("X-Device-Id", deviceId);
        }
        if (session != null) {
            h.set("X-Session-Id", String.valueOf(session));
        }
        return h;
    }

    private JsonNode tableOrders(String token, String deviceId, long session) {
        return http.exchange("/api/orders", HttpMethod.GET, new HttpEntity<>(customerHeaders(token, deviceId, session)),
                JsonNode.class).getBody();
    }

    private void placeOrderAt(String token, String deviceId, long session, int quantity) {
        HttpHeaders h = customerHeaders(token, deviceId, session);
        h.set("Idempotency-Key", UUID.randomUUID().toString());
        ResponseEntity<JsonNode> r = http.postForEntity("/api/orders",
                json("{\"items\":[{\"menuItemId\":" + phoId + ",\"quantity\":" + quantity + "}]}", h), JsonNode.class);
        assertEquals(201, r.getStatusCode().value(), String.valueOf(r.getBody()));
    }

    private ResponseEntity<JsonNode> createPayment(String token, String deviceId, long session, String key, String method) {
        HttpHeaders h = customerHeaders(token, deviceId, session);
        h.set("Idempotency-Key", key);
        return http.postForEntity("/api/payments", json("{\"method\":\"" + method + "\"}", h), JsonNode.class);
    }

    private static String sign(Map<String, String> params) {
        return VnpayGateway.hmacSha512(TEST_SECRET, VnpayGateway.canonical(new TreeMap<>(params)));
    }

    private JsonNode ipn(Map<String, String> params, String signature) {
        UriComponentsBuilder b = UriComponentsBuilder.fromPath("/api/payments/vnpay/ipn");
        params.forEach(b::queryParam);
        b.queryParam("vnp_SecureHash", signature);
        return http.getForObject(b.build().encode().toUriString(), JsonNode.class);
    }

    private static boolean containsOrder(JsonNode view, long orderId) {
        for (JsonNode o : view.get("orders")) {
            if (o.get("id").asLong() == orderId) {
                return true;
            }
        }
        return false;
    }

    private static boolean containsId(JsonNode ids, long id) {
        for (JsonNode n : ids) {
            if (n.asLong() == id) {
                return true;
            }
        }
        return false;
    }

    private ResponseEntity<JsonNode> placeOrder(String key, long menuItemId, int quantity) {
        HttpHeaders h = new HttpHeaders();
        h.set("X-Table-Token", tableToken);
        h.set("Idempotency-Key", key);
        String body = "{\"items\":[{\"menuItemId\":" + menuItemId + ",\"quantity\":" + quantity + "}]}";
        return http.postForEntity("/api/orders", json(body, h), JsonNode.class);
    }

    private ResponseEntity<JsonNode> updateStatus(long itemId, String status, int version) {
        HttpHeaders h = bearer(kitchenToken);
        return http.exchange("/api/kitchen/order-items/" + itemId + "/status", HttpMethod.PATCH,
                json("{\"status\":\"" + status + "\",\"version\":" + version + "}", h), JsonNode.class);
    }

    private static HttpEntity<String> json(String body, HttpHeaders headers) {
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }
}
