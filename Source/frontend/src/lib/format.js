export function formatVnd(amount) {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}

export const ITEM_STATUS = {
  PENDING: { label: 'Chưa tiếp nhận', short: 'Chưa nhận', tone: 'warn' },
  ACCEPTED: { label: 'Đã tiếp nhận', short: 'Đã nhận', tone: 'info' },
  SERVED: { label: 'Đã phục vụ', short: 'Đã phục vụ', tone: 'ok' },
  CANCELLED: { label: 'Đã huỷ', short: 'Đã huỷ', tone: 'danger' },
};

export function minutesSince(ms, now = Date.now()) {
  return Math.max(0, Math.floor((now - ms) / 60000));
}

/** Thời lượng dễ đọc: "12 phút", "2 giờ 5 phút", "3 ngày" (không còn hiện hàng nghìn phút). */
export function formatDuration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
  return `${Math.floor(h / 24)} ngày`;
}

export const since = (ms, now = Date.now()) => formatDuration(now - ms);

/** Đếm ngược mm:ss tới thời điểm until (ms). */
export function countdown(until, now = Date.now()) {
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Icon theo tên danh mục (dùng khi món chưa có ảnh). */
export function categoryIcon(name = '') {
  const n = name.toLowerCase();
  if (n.includes('uống')) return 'coffee';
  if (n.includes('tráng')) return 'cake';
  if (n.includes('khai')) return 'leaf';
  return 'bowl';
}

/** Lý do bếp huỷ / khách trả lại món đã nhận (khớp enum VoidReason ở server). */
export const VOID_REASON = {
  OUT_OF_STOCK: 'Hết nguyên liệu',
  KITCHEN_MISTAKE: 'Làm sai / hỏng',
  CUSTOMER_CHANGED_MIND: 'Khách đổi ý',
  RETURNED: 'Khách trả lại',
  OTHER: 'Lý do khác',
};

export const RESTAURANT = { name: 'Hương Việt', tagline: 'Nhà hàng ẩm thực truyền thống' };

/**
 * Gộp bản đơn mới nhất (sự kiện ORDER_UPDATED) vào bản đang có: món nào có version cao hơn thì lấy,
 * món mới (phần huỷ tách ra) thì thêm. Áp dụng lại nhiều lần vẫn ra cùng kết quả.
 */
export function mergeOrder(current, incoming) {
  if (!current) return incoming;
  const byId = new Map(current.items.map((i) => [i.id, i]));
  incoming.items.forEach((i) => {
    const old = byId.get(i.id);
    if (!old || i.version >= old.version) byId.set(i.id, i);
  });
  return { ...current, status: incoming.status, total: incoming.total, items: [...byId.values()].sort((a, b) => a.id - b.id) };
}
