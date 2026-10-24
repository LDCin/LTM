package com.ltm.qrorder.common;

import org.springframework.http.HttpStatus;

/** Mã lỗi thống nhất của giao thức REST, client dựa vào trường "error" để xử lý. */
public enum ErrorCode {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED),
    INVALID_TABLE_TOKEN(HttpStatus.UNAUTHORIZED),
    FORBIDDEN(HttpStatus.FORBIDDEN),
    NOT_FOUND(HttpStatus.NOT_FOUND),
    TABLE_CLOSED(HttpStatus.CONFLICT),              // bàn ngừng phục vụ (admin đóng để bảo trì)
    TABLE_HAS_GUESTS(HttpStatus.CONFLICT),          // admin đóng bàn khi đang có khách
    SESSION_ENDED(HttpStatus.CONFLICT),             // lượt khách của máy này đã kết thúc (đã trả bàn)
    PAYMENT_IN_PROGRESS(HttpStatus.CONFLICT),       // bàn đang thanh toán, chưa gọi thêm được
    CONFIRM_REQUIRED(HttpStatus.CONFLICT),          // thao tác cần xác nhận thêm (VD trả bàn khi chưa trả đủ tiền)
    NOTHING_TO_PAY(HttpStatus.UNPROCESSABLE_ENTITY),
    PAYMENT_METHOD_UNAVAILABLE(HttpStatus.UNPROCESSABLE_ENTITY),
    PAYMENT_PROVIDER_ERROR(HttpStatus.BAD_GATEWAY),
    INVALID_STATE_TRANSITION(HttpStatus.CONFLICT),
    VERSION_CONFLICT(HttpStatus.CONFLICT),
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT),
    DUPLICATE(HttpStatus.CONFLICT),
    ITEM_UNAVAILABLE(HttpStatus.UNPROCESSABLE_ENTITY),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS),
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR);

    private final HttpStatus status;

    ErrorCode(HttpStatus status) {
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
