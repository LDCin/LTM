package com.ltm.qrorder.servicecall;

import com.ltm.qrorder.auth.StaffAuthInterceptor;
import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.common.DeviceIds;
import com.ltm.qrorder.servicecall.ServiceCallRepository.ServiceCallDto;
import com.ltm.qrorder.servicecall.ServiceCallService.CallResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Gọi phục vụ.
 * Khách: POST /api/service-calls (201 lượt mới, 200 lượt đang mở), GET /api/service-calls/current (204 = không có).
 * Lễ tân / thu ngân: GET /api/cashier/service-calls, POST /api/cashier/service-calls/{id}/handle.
 */
@RestController
public class ServiceCallController {

    public record CallRequest(@Size(max = 50) String guestName) {
    }

    private final ServiceCallService service;

    public ServiceCallController(ServiceCallService service) {
        this.service = service;
    }

    @PostMapping("/api/service-calls")
    public ResponseEntity<ServiceCallDto> call(@RequestHeader("X-Table-Token") String tableToken,
                                               @RequestHeader(value = DeviceIds.SESSION_HEADER, required = false) String session,
                                               @RequestBody(required = false) @Valid CallRequest req) {
        CallResult r = service.call(tableToken, session, req == null ? null : req.guestName());
        return ResponseEntity.status(r.created() ? HttpStatus.CREATED : HttpStatus.OK).body(r.call());
    }

    @GetMapping("/api/service-calls/current")
    public ResponseEntity<ServiceCallDto> current(@RequestHeader("X-Table-Token") String tableToken,
                                                  @RequestHeader(value = DeviceIds.SESSION_HEADER, required = false) String session) {
        ServiceCallDto c = service.currentForCustomer(tableToken, session);
        return c == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(c);
    }

    @GetMapping("/api/cashier/service-calls")
    public List<ServiceCallDto> open() {
        return service.openCalls();
    }

    @PostMapping("/api/cashier/service-calls/{id}/handle")
    public ServiceCallDto handle(@PathVariable long id,
                                 @RequestAttribute(StaffAuthInterceptor.ATTR) StaffPrincipal staff) {
        return service.handle(id, staff.username());
    }
}
