package com.ltm.qrorder.payment;

import com.ltm.qrorder.auth.StaffAuthInterceptor;
import com.ltm.qrorder.auth.StaffPrincipal;
import com.ltm.qrorder.config.AppProperties;
import com.ltm.qrorder.order.OrderDtos.OrderDto;
import com.ltm.qrorder.order.OrderRepository;
import com.ltm.qrorder.payment.PaymentDtos.BillView;
import com.ltm.qrorder.payment.PaymentDtos.CashierTableView;
import com.ltm.qrorder.payment.PaymentDtos.CheckoutRequest;
import com.ltm.qrorder.payment.PaymentDtos.ConfirmPaymentRequest;
import com.ltm.qrorder.payment.PaymentDtos.PaymentDto;
import com.ltm.qrorder.table.TableInfo;
import com.ltm.qrorder.table.TableService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** API của quầy thu ngân (CASHIER hoặc ADMIN). */
@RestController
@RequestMapping("/api/cashier")
public class CashierController {

    private final CashierService cashier;
    private final PaymentService payments;
    private final TableService tables;
    private final OrderRepository orders;
    private final AppProperties props;

    public CashierController(CashierService cashier, PaymentService payments, TableService tables,
                             OrderRepository orders, AppProperties props) {
        this.cashier = cashier;
        this.payments = payments;
        this.tables = tables;
        this.orders = orders;
        this.props = props;
    }

    /** Sơ đồ bàn: trạng thái, tạm tính, lần thanh toán đang chờ. */
    @GetMapping("/tables")
    public List<CashierTableView> tables() {
        return cashier.tables();
    }

    /** Chi tiết một bàn: trạng thái + hóa đơn + các đơn của phiên. */
    @GetMapping("/tables/{id}")
    public Map<String, Object> table(@PathVariable long id, HttpServletRequest http) {
        TableInfo t = tables.get(id);
        BillView bill = payments.bill(t, PaymentController.requestInfo(http, props));
        List<OrderDto> list = t.hasSession() ? orders.findBySession(t.sessionId()) : List.of();
        return Map.of("table", cashier.view(t), "bill", bill, "orders", list);
    }

    /** Khách ra quầy trả tiền mặt: tạo lần chờ cho bàn (hoặc trả lại lần đang chờ). */
    @PostMapping("/tables/{id}/payments")
    public ResponseEntity<PaymentDto> createCash(@PathVariable long id,
                                                 @RequestAttribute(StaffAuthInterceptor.ATTR) StaffPrincipal staff,
                                                 HttpServletRequest http) {
        var result = payments.createCashAtCounter(id, staff, PaymentController.requestInfo(http, props));
        return ResponseEntity.status(result.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(result.payment());
    }

    /** "Đã nhận tiền" (chỉ tiền mặt). Gửi kèm version đang thấy; sai version -> 409. */
    @PatchMapping("/payments/{id}/confirm")
    public PaymentDto confirm(@PathVariable long id, @Valid @RequestBody ConfirmPaymentRequest req,
                              @RequestAttribute(StaffAuthInterceptor.ATTR) StaffPrincipal staff) {
        return payments.confirmCash(id, req.version(), staff);
    }

    @PostMapping("/payments/{id}/cancel")
    public PaymentDto cancel(@PathVariable long id,
                             @RequestAttribute(StaffAuthInterceptor.ATTR) StaffPrincipal staff) {
        return payments.cancelByStaff(id, staff);
    }

    /** "Trả bàn": kết thúc phiên. 409 CONFIRM_REQUIRED nếu còn nợ / còn món mà chưa chọn lý do. */
    @PostMapping("/tables/{id}/checkout")
    public CashierTableView checkout(@PathVariable long id, @RequestBody(required = false) @Valid CheckoutRequest req,
                                     @RequestAttribute(StaffAuthInterceptor.ATTR) StaffPrincipal staff) {
        return cashier.checkout(id, req, staff);
    }
}
