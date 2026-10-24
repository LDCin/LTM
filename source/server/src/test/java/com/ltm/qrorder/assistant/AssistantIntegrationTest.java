package com.ltm.qrorder.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.ltm.qrorder.assistant.AssistantDtos.ChatMessage;
import com.ltm.qrorder.menu.MenuService;
import com.ltm.qrorder.ratelimit.RateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Trợ lý gợi ý món qua HTTP thật, với mô hình ngôn ngữ GIẢ (không gọi Gemini): kiểm tra máy chủ lọc gợi ý bịa,
 * chuyển sang gợi ý dự phòng khi mô hình hết lượt / lỗi / trả dữ liệu hỏng, và giới hạn số câu hỏi mỗi bàn.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"app.rate-limit.enabled=false", "app.assistant.per-table-capacity=3",
                "app.assistant.per-table-refill-per-minute=1", "app.assistant.failure-threshold=2"})
@ActiveProfiles("h2")
@Import(AssistantIntegrationTest.FakeLlmConfig.class)
class AssistantIntegrationTest {

    /** Mô hình giả: trả nội dung đặt sẵn, hoặc ném lỗi; đếm số lần được gọi. */
    static class FakeLlm implements LlmClient {
        volatile boolean configured = true;
        volatile String response = "{}";
        volatile LlmUnavailableException failure;
        final AtomicInteger calls = new AtomicInteger();

        @Override
        public boolean isConfigured() {
            return configured;
        }

        @Override
        public String generate(String systemPrompt, List<ChatMessage> messages) throws LlmUnavailableException {
            calls.incrementAndGet();
            if (failure != null) {
                throw failure;
            }
            return response;
        }
    }

    @TestConfiguration
    static class FakeLlmConfig {
        @Bean
        @Primary
        FakeLlm fakeLlm() {
            return new FakeLlm();
        }
    }

    @Autowired
    TestRestTemplate http;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    FakeLlm llm;
    @Autowired
    AssistantService assistant;
    @Autowired
    RateLimiter limiter;
    @Autowired
    MenuService menu;

    @BeforeEach
    void reset() {
        llm.configured = true;
        llm.failure = null;
        llm.response = "{}";
        llm.calls.set(0);
        assistant.resetCircuit();
        limiter.clear();
    }

    @Test
    void aiSuggestionsAreValidatedAgainstTheRealMenu() {
        long pho = menuId("Phở bò tái");
        long che = menuId("Chè khúc bạch");
        jdbc.update("UPDATE menu_item SET stock = 1 WHERE id = ?", che);   // còn 1 suất
        menu.markChanged();
        llm.response = """
                ```json
                {"reply": "Bàn 2 người thì thử phở nhé.",
                 "suggestions": [
                   {"menuItemId": %d, "quantity": 2, "reason": "Món nước nóng"},
                   {"menuItemId": 999999, "quantity": 1, "reason": "Món không có thật"},
                   {"menuItemId": %d, "quantity": 1, "reason": "Trùng"},
                   {"menuItemId": %d, "quantity": 3, "reason": "Quá tồn kho"}
                 ]}
                ```""".formatted(pho, pho, che);
        JsonNode r = ask("B11", "2 người ăn gì ngon?").getBody();
        assertEquals("AI", r.get("source").asText());
        assertEquals(1, r.get("suggestions").size(), "chỉ giữ món có thật, không trùng, đủ tồn kho");
        JsonNode s = r.get("suggestions").get(0);
        assertEquals(pho, s.get("menuItemId").asLong());
        assertEquals("Phở bò tái", s.get("name").asText(), "tên lấy từ thực đơn của máy chủ");
        assertEquals(55000, s.get("price").asLong(), "giá lấy từ thực đơn của máy chủ, không lấy từ AI");
        assertEquals(2, s.get("quantity").asInt());
    }

    @Test
    void rateLimitedModelFallsBackAndIsNotCalledDuringCooldown() {
        llm.failure = new LlmClient.LlmUnavailableException("429", true, 30);
        JsonNode first = ask("B12", "gợi ý đồ uống").getBody();
        assertEquals("FALLBACK", first.get("source").asText());
        assertNotNull(first.get("notice").asText());
        assertTrue(first.get("suggestions").size() > 0, "vẫn có gợi ý dự phòng");
        for (JsonNode s : first.get("suggestions")) {
            assertEquals("Đồ uống", categoryOf(s.get("menuItemId").asLong()), "hỏi đồ uống thì chỉ gợi ý đồ uống");
        }
        for (JsonNode s : ask("B12", "có món tráng miệng nào không").getBody().get("suggestions")) {
            assertEquals("Tráng miệng", categoryOf(s.get("menuItemId").asLong()), "\"tráng\" không bị nhầm thành \"trà\"");
        }

        llm.failure = null;
        JsonNode second = ask("B12", "còn món nào nữa?").getBody();
        assertEquals("FALLBACK", second.get("source").asText(), "đang trong thời gian chờ Retry-After");
        assertEquals(1, llm.calls.get(), "không gọi mô hình trong thời gian chờ");
    }

    @Test
    void repeatedFailuresOpenTheCircuit() {
        llm.failure = new LlmClient.LlmUnavailableException("timeout", false, 0);
        ask("B10", "a");
        ask("B10", "b");   // lỗi lần 2 = ngưỡng -> ngừng gọi
        limiter.clear();
        llm.failure = null;
        assertEquals("FALLBACK", ask("B10", "c").getBody().get("source").asText());
        assertEquals(2, llm.calls.get(), "sau khi vượt ngưỡng lỗi thì không gọi mô hình nữa");
    }

    @Test
    void brokenJsonAndMissingKeyFallBack() {
        llm.response = "xin lỗi, tôi không trả JSON";
        assertEquals("FALLBACK", ask("B09", "gợi ý giúp").getBody().get("source").asText());
        llm.configured = false;
        assertEquals("FALLBACK", ask("B09", "gợi ý giúp").getBody().get("source").asText());
        assertEquals(1, llm.calls.get(), "chưa có khoá thì không gọi mô hình");
    }

    @Test
    void perTableLimitAndValidation() {
        HttpHeaders customerSameTable = customer("B08");
        for (int i = 0; i < 3; i++) {
            assertEquals(200, http.postForEntity("/api/assistant/chat", new HttpEntity<>(
                    "{\"messages\":[{\"role\":\"user\",\"text\":\"câu " + i + "\"}]}", customerSameTable), JsonNode.class)
                    .getStatusCode().value());
        }
        // Client không tự gửi lại khi gặp 429 (client mặc định của TestRestTemplate tự chờ Retry-After rồi thử lại)
        RestTemplate plain = new RestTemplate(new SimpleClientHttpRequestFactory());
        plain.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(org.springframework.http.client.ClientHttpResponse response) {
                return false;
            }
        });
        ResponseEntity<JsonNode> limited = plain.postForEntity(http.getRootUri() + "/api/assistant/chat",
                new HttpEntity<>("{\"messages\":[{\"role\":\"user\",\"text\":\"câu 4\"}]}", customerSameTable), JsonNode.class);
        assertEquals(429, limited.getStatusCode().value());
        assertNotNull(limited.getHeaders().getFirst("Retry-After"));

        HttpHeaders h = customer("B07");
        ResponseEntity<JsonNode> botLast = http.postForEntity("/api/assistant/chat",
                new HttpEntity<>("{\"messages\":[{\"role\":\"bot\",\"text\":\"xin chào\"}]}", h), JsonNode.class);
        assertEquals(400, botLast.getStatusCode().value(), "tin cuối phải là câu hỏi của khách");
        ResponseEntity<JsonNode> tooLong = http.postForEntity("/api/assistant/chat",
                new HttpEntity<>("{\"messages\":[{\"role\":\"user\",\"text\":\"" + "a".repeat(501) + "\"}]}", h), JsonNode.class);
        assertEquals(400, tooLong.getStatusCode().value());
    }

    // ---------------------------------------------------------------- tiện ích

    private ResponseEntity<JsonNode> ask(String tableCode, String question) {
        return http.postForEntity("/api/assistant/chat",
                new HttpEntity<>("{\"messages\":[{\"role\":\"bot\",\"text\":\"Chào bạn\"},{\"role\":\"user\",\"text\":\""
                        + question + "\"}]}", customer(tableCode)), JsonNode.class);
    }

    private HttpHeaders customer(String tableCode) {
        String token = jdbc.queryForObject("SELECT qr_token FROM restaurant_table WHERE code = ?", String.class, tableCode);
        HttpHeaders join = new HttpHeaders();
        join.set("X-Device-Id", "dev" + UUID.randomUUID().toString().replace("-", ""));
        JsonNode j = http.postForObject("/api/public/tables/" + token + "/join", new HttpEntity<>(join), JsonNode.class);
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.set("X-Table-Token", token);
        h.set("X-Session-Id", j.get("sessionId").asText());
        return h;
    }

    private long menuId(String name) {
        return jdbc.queryForObject("SELECT id FROM menu_item WHERE name = ?", Long.class, name);
    }

    private String categoryOf(long menuItemId) {
        return jdbc.queryForObject("SELECT c.name FROM menu_item m JOIN category c ON c.id = m.category_id WHERE m.id = ?",
                String.class, menuItemId);
    }
}
