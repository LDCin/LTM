import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { RESTAURANT } from '../lib/format.js';

const SPACES = [
  { to: '/kitchen', icon: 'chef', title: 'Bếp', text: 'Nhận đơn tức thì, tiếp nhận và báo đã phục vụ từng món.' },
  { to: '/cashier', icon: 'receipt', title: 'Thu ngân', text: 'Sơ đồ bàn, khách gọi phục vụ, thu tiền mặt hoặc QR, trả bàn.' },
  { to: '/admin', icon: 'chart', title: 'Quản lý', text: 'Thống kê kinh doanh, thực đơn & VAT, bàn và mã QR.' },
];

/** Cổng nội bộ cho nhân viên (đường dẫn riêng /staff, không liên kết từ trang của khách). */
export default function Staff() {
  return (
    <div className="portal" style={{ backgroundImage: 'url(/images/hoian.jpg)' }}>
      <div className="portal-box">
        <span className="eyebrow">{RESTAURANT.name} · Khu vực nhân viên</span>
        <h1>Chào ca làm việc mới</h1>
        <p>Chọn khu vực của bạn để đăng nhập.</p>
        <div className="portal-grid stagger">
          {SPACES.map((s) => (
            <Link key={s.to} to={s.to} className="portal-card">
              <span className="logo"><Icon name={s.icon} size={26} /></span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <span className="go">Vào khu vực <Icon name="arrowRight" size={18} /></span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
