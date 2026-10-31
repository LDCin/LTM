package com.ltm.qrorder.servicecall;

import com.ltm.qrorder.common.ApiException;
import com.ltm.qrorder.common.DeviceIds;
import com.ltm.qrorder.common.ErrorCode;
import com.ltm.qrorder.event.EventPublisher;
import com.ltm.qrorder.order.OrderService;
import com.ltm.qrorder.servicecall.ServiceCallRepository.ServiceCallDto;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * "Gọi phục vụ": khách bấm nút, quầy lễ tân / thu ngân nhận thông báo real-time rồi điều phối nhân viên
 * (qua bộ đàm, ngoài hệ thống), sau đó bấm "Đã xử lý".
 *
 * Mỗi phiên bàn có tối đa một lượt gọi đang mở: bấm lặp hoặc nhiều điện thoại cùng bấm đều trả về lượt đang mở,
 * không tạo thông báo trùng. Lượt gọi của phiên đã kết thúc tự biến mất khỏi danh sách.
 *
 * Sự kiện: SERVICE_CALL_UPDATED gửi tới /topic/cashier và /topic/table.{id} (điện thoại của bàn thấy
 * "Nhân viên đang tới" rồi trở về nút bình thường khi lễ tân xử lý xong).
 */
@Service
public class ServiceCallService {

    private final ServiceCallRepository calls;
    private final TableService tables;
    private final EventPublisher publisher;

    public ServiceCallService(ServiceCallRepository calls, TableService tables, EventPublisher publisher) {
        this.calls = calls;
        this.tables = tables;
        this.publisher = publisher;
    }

    public record CallResult(ServiceCallDto call, boolean created) {
    }

    public CallResult call(String tableToken, String sessionHeader, String guestName) {
        TableInfo t = tables.requireSession(tableToken, DeviceIds.sessionId(sessionHeader));
        Optional<ServiceCallDto> open = calls.findOpen(t.sessionId());
        if (open.isPresent()) {
            return new CallResult(open.get(), false);
        }
        long id;
        try {
            id = calls.insertOpen(t.sessionId(), t.id(), OrderService.normalizeGuestName(guestName),
                    System.currentTimeMillis());
        } catch (DuplicateKeyException e) {
            // Máy khác cùng bàn vừa gọi trước một chút: dùng chung lượt đó
            return new CallResult(calls.findOpen(t.sessionId()).orElseThrow(), false);
        }
        ServiceCallDto created = calls.find(id).orElseThrow();
        announce(created);
        return new CallResult(created, true);
    }

    /** Lượt gọi đang mở của phiên khách đang ngồi (null nếu không có). */
    public ServiceCallDto currentForCustomer(String tableToken, String sessionHeader) {
        TableInfo t = tables.requireSession(tableToken, DeviceIds.sessionId(sessionHeader));
        return calls.findOpen(t.sessionId()).orElse(null);
    }

    public List<ServiceCallDto> openCalls() {
        return calls.findOpenOfActiveSessions();
    }

    /** "Đã xử lý". Gọi lặp (hai nhân viên cùng bấm) không lỗi, trả về trạng thái hiện tại. */
    public ServiceCallDto handle(long id, String by) {
        ServiceCallDto c = calls.find(id)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Không tìm thấy lượt gọi " + id));
        if (calls.markHandled(id, by, System.currentTimeMillis())) {
            c = calls.find(id).orElseThrow();
            announce(c);
        }
        return c;
    }

    /** Lượt gọi mở quá lâu mà chưa ai xử lý: tự đóng để khách gọi lại được, không treo mãi. @return số lượt đã đóng */
    public int expireOverdue(long cutoff) {
        int n = 0;
        for (ServiceCallDto c : calls.findOpenOfActiveSessions()) {
            if (c.createdAt() < cutoff && calls.markHandled(c.id(), "AUTO_TIMEOUT", System.currentTimeMillis())) {
                announce(calls.find(c.id()).orElseThrow());
                n++;
            }
        }
        return n;
    }

    private void announce(ServiceCallDto c) {
        Map<String, Object> event = Map.of("type", "SERVICE_CALL_UPDATED", "tableId", c.tableId(), "call", c);
        publisher.broadcast(EventPublisher.CASHIER_TOPIC, event);
        publisher.broadcast(EventPublisher.tableTopic(c.tableId()), event);
    }
}
