package com.ltm.qrorder;

import com.fasterxml.jackson.databind.JsonNode;
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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/** Kiểm thử tích hợp qua HTTP thật (server chạy cổng ngẫu nhiên, DB H2). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "app.rate-limit.enabled=false")
@ActiveProfiles("h2")
class OrderFlowIntegrationTest {

    @Autowired
    TestRestTemplate http;
    @Autowired
    JdbcTemplate jdbc;

    String tableToken;
    long phoId;
    String kitchenToken;

    @BeforeEach
    void setUp() {
        tableToken = jdbc.queryForObject("SELECT qr_token FROM restaurant_table WHERE code = 'B01'", String.class);
        phoId = jdbc.queryForObject("SELECT id FROM menu_item WHERE name = 'Phở bò tái'", Long.class);
        JsonNode login = http.postForObject("/api/auth/login",
                json("{\"username\":\"bep\",\"password\":\"bep123\"}", new HttpHeaders()), JsonNode.class);
        kitchenToken = login.get("token").asText();
    }

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
        // version cũ -> xung đột
        ResponseEntity<JsonNode> stale = updateStatus(itemId, "COOKING", 0);
        assertEquals(409, stale.getStatusCode().value());
        assertEquals("VERSION_CONFLICT", stale.getBody().get("error").asText());
        // chuyển trạng thái sai -> 409
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

    @Test
    void ordersAreVisibleOnlyToTheDeviceThatPlacedThem() {
        String token = jdbc.queryForObject("SELECT qr_token FROM restaurant_table WHERE code = 'B02'", String.class);
        String deviceA = "deviceA-" + UUID.randomUUID().toString().replace("-", "");
        String deviceB = "deviceB-" + UUID.randomUUID().toString().replace("-", "");
        HttpHeaders a = customerHeaders(token, deviceA);
        a.set("Idempotency-Key", UUID.randomUUID().toString());
        long orderId = http.postForEntity("/api/orders",
                json("{\"items\":[{\"menuItemId\":" + phoId + ",\"quantity\":1}]}", a), JsonNode.class)
                .getBody().get("id").asLong();

        JsonNode seenByA = myOrders(token, deviceA);
        JsonNode seenByB = myOrders(token, deviceB);
        assertEquals(true, containsOrder(seenByA, orderId), "máy đặt đơn phải thấy đơn của mình");
        assertEquals(false, containsOrder(seenByB, orderId), "máy khác quét cùng QR không được thấy đơn");

        ResponseEntity<JsonNode> cancelByB = http.postForEntity("/api/orders/" + orderId + "/cancel",
                new HttpEntity<>(customerHeaders(token, deviceB)), JsonNode.class);
        assertEquals(404, cancelByB.getStatusCode().value());

        ResponseEntity<JsonNode> noDevice = http.exchange("/api/orders", HttpMethod.GET,
                new HttpEntity<>(customerHeaders(token, null)), JsonNode.class);
        assertEquals(400, noDevice.getStatusCode().value());
    }

    @Test
    void resetSessionHidesPreviousCustomersOrders() {
        String token = jdbc.queryForObject("SELECT qr_token FROM restaurant_table WHERE code = 'B03'", String.class);
        long tableId = jdbc.queryForObject("SELECT id FROM restaurant_table WHERE code = 'B03'", Long.class);
        String device = "device-" + UUID.randomUUID().toString().replace("-", "");
        HttpHeaders h = customerHeaders(token, device);
        h.set("Idempotency-Key", UUID.randomUUID().toString());
        http.postForEntity("/api/orders", json("{\"items\":[{\"menuItemId\":" + phoId + ",\"quantity\":1}]}", h), JsonNode.class);
        assertEquals(1, myOrders(token, device).get("orders").size());

        HttpHeaders kitchen = new HttpHeaders();
        kitchen.setBearerAuth(kitchenToken);
        ResponseEntity<JsonNode> refused = http.postForEntity("/api/kitchen/tables/" + tableId + "/reset-session",
                new HttpEntity<>(kitchen), JsonNode.class);
        assertEquals(409, refused.getStatusCode().value());
        assertEquals("TABLE_HAS_ACTIVE_ORDERS", refused.getBody().get("error").asText());

        ResponseEntity<JsonNode> forced = http.postForEntity("/api/kitchen/tables/" + tableId + "/reset-session?force=true",
                new HttpEntity<>(kitchen), JsonNode.class);
        assertEquals(200, forced.getStatusCode().value());
        assertEquals(0, myOrders(token, device).get("orders").size(), "lượt khách mới không thấy đơn cũ");
    }

    private HttpHeaders customerHeaders(String token, String deviceId) {
        HttpHeaders h = new HttpHeaders();
        h.set("X-Table-Token", token);
        if (deviceId != null) {
            h.set("X-Device-Id", deviceId);
        }
        return h;
    }

    private JsonNode myOrders(String token, String deviceId) {
        return http.exchange("/api/orders", HttpMethod.GET, new HttpEntity<>(customerHeaders(token, deviceId)), JsonNode.class)
                .getBody();
    }

    private static boolean containsOrder(JsonNode view, long orderId) {
        for (JsonNode o : view.get("orders")) {
            if (o.get("id").asLong() == orderId) {
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
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(kitchenToken);
        return http.exchange("/api/kitchen/order-items/" + itemId + "/status", HttpMethod.PATCH,
                json("{\"status\":\"" + status + "\",\"version\":" + version + "}", h), JsonNode.class);
    }

    private static HttpEntity<String> json(String body, HttpHeaders headers) {
        headers.setContentType(MediaType.APPLICATION_JSON);
        return new HttpEntity<>(body, headers);
    }
}
