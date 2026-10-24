package com.ltm.qrorder.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ltm.qrorder.assistant.AssistantDtos.ChatMessage;
import com.ltm.qrorder.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Gọi Gemini API (REST, generateContent) qua HTTPS.
 * Yêu cầu mô hình trả JSON theo lược đồ cố định (responseSchema) để máy chủ đọc được gợi ý dạng có cấu trúc.
 * Khoá API gửi trong header x-goog-api-key, không đặt trên URL (URL hay bị ghi vào log).
 */
@Component
public class GeminiClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(GeminiClient.class);
    private static final Pattern RETRY_DELAY = Pattern.compile("\"retryDelay\"\\s*:\\s*\"(\\d+)(?:\\.\\d+)?s\"");

    private final AppProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public GeminiClient(AppProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
    }

    @Override
    public boolean isConfigured() {
        return props.getAssistant().isConfigured();
    }

    @Override
    public String generate(String systemPrompt, List<ChatMessage> messages) throws LlmUnavailableException {
        AppProperties.Assistant cfg = props.getAssistant();
        String body;
        try {
            body = mapper.writeValueAsString(requestBody(systemPrompt, messages));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(cfg.getGeminiUrl() + "/" + cfg.getGeminiModel() + ":generateContent"))
                .timeout(Duration.ofMillis(cfg.getTimeoutMs()))
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", cfg.getGeminiApiKey())
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> res;
        try {
            res = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (HttpTimeoutException e) {
            throw new LlmUnavailableException("Gemini quá thời gian chờ", false, 0);
        } catch (IOException e) {
            throw new LlmUnavailableException("Không kết nối được Gemini: " + e.getMessage(), false, 0);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LlmUnavailableException("Bị ngắt khi gọi Gemini", false, 0);
        }

        if (res.statusCode() == 429) {
            throw new LlmUnavailableException("Gemini báo hết lượt (429)", true, retryAfterSeconds(res));
        }
        if (res.statusCode() != 200) {
            // Không ghi nguyên thân lỗi: có thể dài; chỉ cần mã trạng thái để chẩn đoán
            log.warn("Gemini trả HTTP {}", res.statusCode());
            throw new LlmUnavailableException("Gemini trả HTTP " + res.statusCode(), false, 0);
        }
        try {
            JsonNode text = mapper.readTree(res.body()).path("candidates").path(0).path("content").path("parts").path(0).path("text");
            if (!text.isTextual()) {
                throw new LlmUnavailableException("Gemini không trả nội dung", false, 0);
            }
            return text.asText();
        } catch (IOException e) {
            throw new LlmUnavailableException("Không đọc được phản hồi Gemini", false, 0);
        }
    }

    private ObjectNode requestBody(String systemPrompt, List<ChatMessage> messages) {
        ObjectNode root = mapper.createObjectNode();
        root.putObject("systemInstruction").putArray("parts").addObject().put("text", systemPrompt);
        ArrayNode contents = root.putArray("contents");
        boolean started = false;
        for (ChatMessage m : messages) {
            boolean user = "user".equals(m.role());
            if (!started && !user) {
                continue;   // Gemini yêu cầu lượt đầu là của người dùng: bỏ lời chào của trợ lý ở đầu
            }
            started = true;
            contents.addObject().put("role", user ? "user" : "model").putArray("parts").addObject().put("text", m.text());
        }
        ObjectNode gen = root.putObject("generationConfig");
        gen.put("responseMimeType", "application/json");
        gen.put("temperature", 0.4);
        gen.put("maxOutputTokens", 2048);
        gen.set("responseSchema", responseSchema());
        return root;
    }

    /** {reply: string, suggestions: [{menuItemId, quantity, reason}]} */
    private ObjectNode responseSchema() {
        ObjectNode item = mapper.createObjectNode().put("type", "OBJECT");
        ObjectNode itemProps = item.putObject("properties");
        itemProps.putObject("menuItemId").put("type", "INTEGER");
        itemProps.putObject("quantity").put("type", "INTEGER");
        itemProps.putObject("reason").put("type", "STRING");
        item.putArray("required").add("menuItemId").add("quantity").add("reason");

        ObjectNode schema = mapper.createObjectNode().put("type", "OBJECT");
        ObjectNode p = schema.putObject("properties");
        p.putObject("reply").put("type", "STRING");
        p.putObject("suggestions").put("type", "ARRAY").set("items", item);
        schema.putArray("required").add("reply").add("suggestions");
        return schema;
    }

    /** Số giây nên chờ: header Retry-After, hoặc trường retryDelay (VD "27s") trong thân lỗi của Google; không có thì 0. */
    static long retryAfterSeconds(HttpResponse<String> res) {
        try {
            return res.headers().firstValue("Retry-After").map(Long::parseLong).orElseGet(() -> {
                Matcher m = RETRY_DELAY.matcher(res.body() == null ? "" : res.body());
                return m.find() ? Long.parseLong(m.group(1)) : 0L;
            });
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
