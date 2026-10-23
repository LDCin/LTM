package com.ltm.qrorder.order;

import com.ltm.qrorder.common.DeviceIds;
import com.ltm.qrorder.order.OrderDtos.OrderDto;
import com.ltm.qrorder.order.OrderDtos.PlaceOrderRequest;
import com.ltm.qrorder.order.OrderDtos.PlaceOrderResult;
import com.ltm.qrorder.order.OrderDtos.TableOrdersView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** API cho khách (xác thực bằng header X-Table-Token lấy từ mã QR). */
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orders;

    public OrderController(OrderService orders) {
        this.orders = orders;
    }

    /**
     * 201 Created: đơn mới được tạo.
     * 200 OK + Idempotent-Replayed: true: request trùng, trả lại đơn đã tạo trước đó.
     */
    @PostMapping
    public ResponseEntity<OrderDto> placeOrder(@RequestHeader("X-Table-Token") String tableToken,
                                               @RequestHeader(value = DeviceIds.HEADER, required = false) String deviceId,
                                               @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                               @Valid @RequestBody PlaceOrderRequest req) {
        PlaceOrderResult result = orders.placeOrder(tableToken, deviceId, key, req);
        return ResponseEntity.status(result.replayed() ? HttpStatus.OK : HttpStatus.CREATED)
                .header("Idempotent-Replayed", String.valueOf(result.replayed()))
                .body(result.order());
    }

    /** Đơn do chính thiết bị này đặt trong phiên hiện tại của bàn. */
    @GetMapping
    public TableOrdersView myOrders(@RequestHeader("X-Table-Token") String tableToken,
                                    @RequestHeader(value = DeviceIds.HEADER, required = false) String deviceId) {
        return orders.ordersForDevice(tableToken, deviceId);
    }

    @PostMapping("/{orderId}/cancel")
    public OrderDto cancel(@RequestHeader("X-Table-Token") String tableToken,
                           @RequestHeader(value = DeviceIds.HEADER, required = false) String deviceId,
                           @PathVariable long orderId) {
        return orders.cancelOrder(tableToken, deviceId, orderId);
    }
}
