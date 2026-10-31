package com.ltm.qrorder.common;

import java.util.Map;

/** Định dạng response lỗi thống nhất: {"error","message","details","timestamp"}. */
public record ApiError(String error, String message, Map<String, Object> details, long timestamp) {

    public static ApiError of(String error, String message, Map<String, Object> details) {
        return new ApiError(error, message, details == null ? Map.of() : details, System.currentTimeMillis());
    }
}
