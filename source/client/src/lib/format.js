export function formatVnd(amount) {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}

export const ITEM_STATUS = {
  PENDING: { label: 'Chờ bếp nhận', short: 'Chờ', tone: 'warn' },
  ACCEPTED: { label: 'Bếp đã nhận', short: 'Đã nhận', tone: 'info' },
  COOKING: { label: 'Đang nấu', short: 'Đang nấu', tone: 'info' },
  READY: { label: 'Sẵn sàng phục vụ', short: 'Sẵn sàng', tone: 'ok' },
  SERVED: { label: 'Đã phục vụ', short: 'Đã phục vụ', tone: 'muted' },
  CANCELLED: { label: 'Đã huỷ', short: 'Huỷ', tone: 'danger' },
};

export function minutesSince(ms, now = Date.now()) {
  return Math.max(0, Math.floor((now - ms) / 60000));
}

export function categoryIcon(name = '') {
  const n = name.toLowerCase();
  if (n.includes('uống')) return '🥤';
  if (n.includes('tráng')) return '🍮';
  if (n.includes('khai')) return '🥟';
  return '🍜';
}

/** Lý do bếp huỷ / khách trả lại món đã nhận (khớp enum VoidReason ở server). */
export const VOID_REASON = {
  OUT_OF_STOCK: 'Hết nguyên liệu',
  KITCHEN_MISTAKE: 'Làm sai / hỏng',
  CUSTOMER_CHANGED_MIND: 'Khách đổi ý',
  RETURNED: 'Khách trả lại',
  OTHER: 'Lý do khác',
};

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
