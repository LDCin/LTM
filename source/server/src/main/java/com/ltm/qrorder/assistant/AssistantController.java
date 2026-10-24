package com.ltm.qrorder.assistant;

import com.ltm.qrorder.assistant.AssistantDtos.ChatReply;
import com.ltm.qrorder.assistant.AssistantDtos.ChatRequest;
import com.ltm.qrorder.common.DeviceIds;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Trợ lý gợi ý món cho khách: chỉ gợi ý, không đặt món. */
@RestController
public class AssistantController {

    private final AssistantService assistant;

    public AssistantController(AssistantService assistant) {
        this.assistant = assistant;
    }

    @PostMapping("/api/assistant/chat")
    public ChatReply chat(@RequestHeader("X-Table-Token") String tableToken,
                          @RequestHeader(value = DeviceIds.SESSION_HEADER, required = false) String session,
                          @Valid @RequestBody ChatRequest req) {
        return assistant.chat(tableToken, session, req);
    }
}
