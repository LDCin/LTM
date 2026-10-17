package com.ltm.qrorder.auth;

import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.config.AppProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;

/**
 * Xác thực nhân viên.
 * Token tự ký theo dạng: base64url(id:username:role:expiry) + "." + base64url(HMAC-SHA256(payload)).
 * Server không cần lưu session: chỉ cần kiểm tra chữ ký và hạn dùng (stateless).
 */
@Service
public class AuthService {

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final JdbcTemplate jdbc;
    private final AppProperties props;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthService(JdbcTemplate jdbc, AppProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    public record LoginResponse(String token, String username, String role, long expiresAt) {
    }

    private record StaffRow(long id, String username, String passwordHash, String role) {
    }

    public LoginResponse login(String username, String password) {
        List<StaffRow> rows = jdbc.query(
                "SELECT id, username, password_hash, role FROM staff WHERE username = ?",
                (rs, i) -> new StaffRow(rs.getLong("id"), rs.getString("username"),
                        rs.getString("password_hash"), rs.getString("role")),
                username);
        if (rows.isEmpty() || !encoder.matches(password, rows.get(0).passwordHash())) {
            throw new ApiException(ErrorCode.UNAUTHORIZED, "Sai tên đăng nhập hoặc mật khẩu");
        }
        StaffRow s = rows.get(0);
        long expiresAt = System.currentTimeMillis() + props.getAuthTokenTtlMs();
        String token = issue(new StaffPrincipal(s.id(), s.username(), s.role()), expiresAt);
        return new LoginResponse(token, s.username(), s.role(), expiresAt);
    }

    public String hashPassword(String raw) {
        return encoder.encode(raw);
    }

    String issue(StaffPrincipal p, long expiresAt) {
        String payload = p.id() + ":" + p.username() + ":" + p.role() + ":" + expiresAt;
        return B64.encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + "." + B64.encodeToString(hmac(payload));
    }

    /** @return principal nếu token hợp lệ và còn hạn, ngược lại null. */
    public StaffPrincipal verify(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        int dot = token.indexOf('.');
        if (dot <= 0) {
            return null;
        }
        try {
            String payload = new String(B64D.decode(token.substring(0, dot)), StandardCharsets.UTF_8);
            byte[] signature = B64D.decode(token.substring(dot + 1));
            // So sánh thời gian hằng định để tránh timing attack
            if (!MessageDigest.isEqual(signature, hmac(payload))) {
                return null;
            }
            String[] parts = payload.split(":");
            if (parts.length != 4 || Long.parseLong(parts[3]) < System.currentTimeMillis()) {
                return null;
            }
            return new StaffPrincipal(Long.parseLong(parts[0]), parts[1], parts[2]);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public static String bearer(String header) {
        if (header == null || !header.startsWith("Bearer ")) {
            return null;
        }
        return header.substring(7).trim();
    }

    private byte[] hmac(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(props.getAuthSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
