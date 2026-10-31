const LABELS = {
  connected: ['ok', 'Trực tuyến'],
  connecting: ['warn', 'Đang kết nối...'],
  reconnecting: ['warn', 'Đang kết nối lại'],
  offline: ['danger', 'Mất kết nối'],
  polling: ['ok', 'Trực tuyến (polling)'],
  error: ['danger', 'Lỗi kết nối'],
  disconnected: ['danger', 'Mất kết nối'],
};

export default function ConnectionBadge({ status, info }) {
  const [tone, label] = LABELS[status] || ['muted', status];
  const extra = status === 'reconnecting' && info?.delay ? ` · ${(info.delay / 1000).toFixed(0)}s` : '';
  return (
    <span className={`badge badge-${tone}`} title={info?.message || ''}>
      <span className="dot" />
      {label}
      {extra}
    </span>
  );
}
