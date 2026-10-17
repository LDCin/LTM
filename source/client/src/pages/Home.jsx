import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="center-page">
      <div className="card home">
        <h1>🍜 QR Order</h1>
        <p>Hệ thống gọi món bằng mã QR và màn hình bếp thời gian thực.</p>
        <div className="home-links">
          <Link className="btn primary" to="/kitchen">
            👨‍🍳 Màn hình bếp
          </Link>
          <Link className="btn" to="/admin">
            ⚙️ Quản trị (bàn, QR, thực đơn, giám sát)
          </Link>
        </div>
        <p className="hint">
          Khách hàng truy cập bằng cách quét mã QR tại bàn (đường dẫn dạng <code>/t/&lt;mã-bàn&gt;</code>). Mã QR của từng
          bàn xem ở trang Quản trị hoặc trong log khi khởi động server.
        </p>
      </div>
    </div>
  );
}
