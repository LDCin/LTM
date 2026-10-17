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
