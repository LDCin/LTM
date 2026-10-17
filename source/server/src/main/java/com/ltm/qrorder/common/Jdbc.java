package com.ltm.qrorder.common;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;

import java.sql.PreparedStatement;

public final class Jdbc {

    private Jdbc() {
    }

    /** INSERT và trả về khoá tự tăng (AUTO_INCREMENT) của dòng vừa thêm. */
    public static long insert(JdbcTemplate jdbc, String sql, String keyColumn, Object... args) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(sql, new String[]{keyColumn});
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Không lấy được khoá tự tăng cho: " + sql);
        }
        return key.longValue();
    }
}
