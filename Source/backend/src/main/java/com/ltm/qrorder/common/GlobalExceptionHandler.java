package com.ltm.qrorder.common;

import jakarta.servlet.ServletException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Chuyển mọi lỗi thành JSON thống nhất. Một client gửi dữ liệu sai chỉ nhận về 4xx,
 * server không bao giờ dừng vì request lỗi.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApi(ApiException ex) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(ex.getCode().getStatus());
        Object retryAfter = ex.getDetails().get("retryAfterSeconds");
        if (retryAfter != null) {
            builder.header(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter));
        }
        return builder.body(ApiError.of(ex.getCode().name(), ex.getMessage(), ex.getDetails()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, Object> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
                .forEach(e -> fields.put(e.getField(), e.getDefaultMessage()));
        return badRequest("Dữ liệu không hợp lệ", fields);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ApiError> handleMethodValidation(HandlerMethodValidationException ex) {
        return badRequest("Dữ liệu không hợp lệ", Map.of());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleUnreadable(HttpMessageNotReadableException ex) {
        return badRequest("Body không phải JSON hợp lệ hoặc sai kiểu dữ liệu", Map.of());
    }

    @ExceptionHandler({MissingRequestHeaderException.class, MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ApiError> handleBadParam(Exception ex) {
        return badRequest(ex.getMessage(), Map.of());
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleIntegrity(DataIntegrityViolationException ex) {
        log.warn("Vi phạm ràng buộc dữ liệu: {}", ex.getMostSpecificCause().getMessage());
        return ResponseEntity.status(ErrorCode.DUPLICATE.getStatus())
                .body(ApiError.of(ErrorCode.DUPLICATE.name(), "Dữ liệu bị trùng hoặc vi phạm ràng buộc", Map.of()));
    }

    /** DB không kết nối được, hết connection pool, timeout, deadlock: lỗi tạm thời nên client có thể thử lại. */
    @ExceptionHandler({DataAccessResourceFailureException.class, TransientDataAccessException.class})
    public ResponseEntity<ApiError> handleDbUnavailable(DataAccessException ex) {
        log.warn("CSDL tạm thời không phục vụ được: {}", ex.getMessage());
        return ResponseEntity.status(ErrorCode.SERVICE_UNAVAILABLE.getStatus())
                .header(HttpHeaders.RETRY_AFTER, "2")
                .body(ApiError.of(ErrorCode.SERVICE_UNAVAILABLE.name(), "Hệ thống đang bận, vui lòng thử lại", Map.of()));
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ApiError> handleDb(DataAccessException ex) {
        log.error("Lỗi cơ sở dữ liệu", ex);
        return ResponseEntity.status(ErrorCode.SERVICE_UNAVAILABLE.getStatus())
                .body(ApiError.of(ErrorCode.SERVICE_UNAVAILABLE.name(), "Lỗi cơ sở dữ liệu", Map.of()));
    }

    /** 404 không có route, 405 sai method, 415 sai Content-Type... */
    @ExceptionHandler(ServletException.class)
    public ResponseEntity<ApiError> handleServlet(ServletException ex) {
        HttpStatusCode status = ex instanceof ErrorResponse er ? er.getStatusCode() : HttpStatusCode.valueOf(500);
        String code = status.value() == 404 ? ErrorCode.NOT_FOUND.name()
                : status.is4xxClientError() ? ErrorCode.INVALID_REQUEST.name() : ErrorCode.INTERNAL_ERROR.name();
        return ResponseEntity.status(status).body(ApiError.of(code, ex.getMessage(), Map.of()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        log.error("Lỗi không mong muốn", ex);
        return ResponseEntity.status(ErrorCode.INTERNAL_ERROR.getStatus())
                .body(ApiError.of(ErrorCode.INTERNAL_ERROR.name(), "Lỗi máy chủ", Map.of()));
    }

    private ResponseEntity<ApiError> badRequest(String message, Map<String, Object> details) {
        return ResponseEntity.badRequest().body(ApiError.of(ErrorCode.INVALID_REQUEST.name(), message, details));
    }
}
