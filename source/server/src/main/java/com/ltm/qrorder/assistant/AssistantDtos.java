package com.ltm.qrorder.assistant;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class AssistantDtos {

    private AssistantDtos() {
    }

    /** Một lượt trong cuộc trò chuyện. role: "user" (khách) hoặc "bot" (trợ lý). */
    public record ChatMessage(@NotNull @Pattern(regexp = "user|bot") String role,
                              @NotBlank @Size(max = 500, message = "Mỗi tin nhắn tối đa 500 ký tự") String text) {
    }

    /**
     * Lịch sử trò chuyện do trình duyệt giữ (máy chủ không lưu), lượt cuối là câu hỏi mới của khách.
     * Chỉ gửi tối đa 10 lượt gần nhất để giới hạn kích thước request tới Gemini.
     */
    public record ChatRequest(@NotEmpty @Size(max = 10, message = "Tối đa 10 tin nhắn gần nhất")
                              List<@Valid @NotNull ChatMessage> messages) {
    }

    /** Một món được gợi ý; tên và giá luôn lấy từ thực đơn của máy chủ, không lấy từ AI. */
    public record Suggestion(long menuItemId, String name, long price, int quantity, String reason) {
    }

    /**
     * source: "AI" (Gemini trả lời) hoặc "FALLBACK" (gợi ý dự phòng theo quy tắc khi không có khoá, Gemini hết lượt,
     * lỗi hoặc trả dữ liệu không đọc được). notice: lý do dùng dự phòng, để hiện cho khách.
     */
    public record ChatReply(String reply, List<Suggestion> suggestions, String source, String notice) {
    }
}
