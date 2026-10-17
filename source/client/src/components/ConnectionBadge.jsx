const LABELS = {
  connected: ['ok', 'Đã kết nối'],
  connecting: ['warn', 'Đang kết nối...'],
  reconnecting: ['warn', 'Đang kết nối lại'],
  offline: ['danger', 'Mất mạng (giả lập)'],
  polling: ['info', 'Polling'],
  error: ['danger', 'Lỗi kết nối'],
  disconnected: ['danger', 'Mất kết nối'],
};

export default function ConnectionBadge({ status, info }) {
  const [tone, label] = LABELS[status] || ['muted', status];
  let extra = '';
  if (status === 'reconnecting' && info?.delay) extra = ` (thử lại sau ${(info.delay / 1000).toFixed(1)}s)`;
  if (status === 'offline' && info?.delay) extra = ` (${(info.delay / 1000).toFixed(1)}s)`;
  return (
    <span className={`badge badge-${tone}`} title={info?.message || ''}>
      <span className="dot" />
      {label}
      {extra}
    </span>
  );
}
