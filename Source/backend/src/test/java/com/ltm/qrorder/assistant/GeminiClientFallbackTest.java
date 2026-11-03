package com.ltm.qrorder.assistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ltm.qrorder.assistant.AssistantDtos.ChatMessage;
import com.ltm.qrorder.config.AppProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** GeminiClient chuyển sang model dự phòng khi model chính lỗi, với máy chủ Gemini giả chạy cục bộ. */
class GeminiClientFallbackTest {

    /** Hành vi của từng model: mã HTTP trả về (200 = trả lời "ok-{model}"), hoặc -1 = treo quá lâu. */
    private final Map<String, Integer> behavior = new ConcurrentHashMap<>();
    private final List<String> called = new CopyOnWriteArrayList<>();
    private HttpServer server;
    private AppProperties props;
    private GeminiClient client;

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/models/", ex -> {
            String model = ex.getRequestURI().getPath().replace("/models/", "").replace(":generateContent", "");
            called.add(model);
            int code = behavior.getOrDefault(model, 404);
            if (code == -1) {
                try {
                    Thread.sleep(3000);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                code = 200;
            }
            byte[] body = (code == 200
                    ? "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok-" + model + "\"}]}}]}"
                    : "{}").getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(code, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();

        props = new AppProperties();
        AppProperties.Assistant cfg = props.getAssistant();
        cfg.setGeminiApiKey("test-key");
        cfg.setGeminiUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/models");
        cfg.setGeminiModel("main");
        cfg.setGeminiFallbackModels(List.of("backup"));
        cfg.setTimeoutMs(2000);
        client = new GeminiClient(props, new ObjectMapper());
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private String ask() throws LlmClient.LlmUnavailableException {
        return client.generate("system", List.of(new ChatMessage("user", "xin chao")));
    }

    @Test
    void overloadedMainModelFallsBackToBackup() throws Exception {
        behavior.put("main", 503);
        behavior.put("backup", 200);
        assertEquals("ok-backup", ask());
        assertEquals(List.of("main", "backup"), called);
    }

    @Test
    void healthyMainModelDoesNotCallBackup() throws Exception {
        behavior.put("main", 200);
        assertEquals("ok-main", ask());
        assertEquals(List.of("main"), called);
    }

    @Test
    void slowMainModelLeavesTimeForBackup() throws Exception {
        behavior.put("main", -1);
        behavior.put("backup", 200);
        long start = System.currentTimeMillis();
        assertEquals("ok-backup", ask());
        assertTrue(System.currentTimeMillis() - start < 2500, "tổng thời gian không vượt timeoutMs đáng kể");
    }

    @Test
    void badKeyStopsWithoutTryingBackup() {
        behavior.put("main", 403);
        behavior.put("backup", 200);
        LlmClient.LlmUnavailableException e = assertThrows(LlmClient.LlmUnavailableException.class, this::ask);
        assertFalse(e.isRateLimited());
        assertEquals(List.of("main"), called);
    }

    @Test
    void allModelsRateLimitedIsReportedAsRateLimited() {
        behavior.put("main", 429);
        behavior.put("backup", 429);
        assertTrue(assertThrows(LlmClient.LlmUnavailableException.class, this::ask).isRateLimited());
    }

    @Test
    void mixedFailuresAreNotReportedAsRateLimited() {
        behavior.put("main", 429);
        behavior.put("backup", 503);
        assertFalse(assertThrows(LlmClient.LlmUnavailableException.class, this::ask).isRateLimited());
        assertEquals(List.of("main", "backup"), called);
    }
}
