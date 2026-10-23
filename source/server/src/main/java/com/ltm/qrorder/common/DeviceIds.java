package com.ltm.qrorder.common;

import java.util.regex.Pattern;

/**
 * Mã thiết bị của khách: chuỗi ngẫu nhiên do trình duyệt tự sinh lần đầu và giữ trong localStorage.
 * Không ai khác biết mã này (nó không xuất hiện trong mã QR, sự kiện hay màn hình bếp),
 * nên dùng được làm "chìa khoá" để mỗi máy chỉ thấy đơn của chính mình.
 */
public final class DeviceIds {

    public static final String HEADER = "X-Device-Id";
    private static final Pattern PATTERN = Pattern.compile("^[A-Za-z0-9_-]{16,64}$");

    private DeviceIds() {
    }

    public static boolean isValid(String deviceId) {
        return deviceId != null && PATTERN.matcher(deviceId).matches();
    }

    /** Bắt buộc có mã thiết bị hợp lệ. */
    public static String require(String deviceId) {
        if (!isValid(deviceId)) {
            throw new ApiException(ErrorCode.INVALID_REQUEST,
                    "Thiếu hoặc sai header " + HEADER + " (16-64 ký tự [A-Za-z0-9_-])");
        }
        return deviceId;
    }

    /** Không bắt buộc, nhưng nếu gửi thì phải hợp lệ. */
    public static String optional(String deviceId) {
        return deviceId == null ? null : require(deviceId);
    }
}
