import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { request } from '../lib/api.js';
import { RESTAURANT, formatVnd } from '../lib/format.js';

const STEPS = [
  ['qr', 'Quét mã tại bàn', 'Mỗi bàn có một mã QR riêng. Mở camera điện thoại và quét — không cần cài ứng dụng.'],
  ['bowl', 'Chọn món yêu thích', 'Xem ảnh món, ghi chú khẩu vị, cả bàn cùng gọi chung một hóa đơn.'],
  ['card', 'Thưởng thức & thanh toán', 'Theo dõi món từ bếp tới bàn, thanh toán bằng QR hoặc tiền mặt tại quầy.'],
];

/** Trang giới thiệu nhà hàng dành cho thực khách. Không có lối vào các trang nội bộ của nhân viên. */
export default function Home() {
  const [dishes, setDishes] = useState(null);

  useEffect(() => {
    request('GET', '/api/public/menu')
      .then(({ data }) => setDishes(data.categories.flatMap((c) => c.items).filter((i) => i.imageUrl && i.available).slice(0, 8)))
      .catch(() => setDishes([]));
  }, []);

  return (
    <div className="landing">
      <nav className="land-nav">
        <span className="brandmark"><span className="logo"><Icon name="lantern" /></span><strong>{RESTAURANT.name}</strong></span>
        <span className="spacer" />
        <span><Icon name="clock" size={16} /> Mở cửa 10:00 – 22:00 mỗi ngày</span>
      </nav>

      <header className="hero" style={{ backgroundImage: 'url(/images/hero.jpg)' }}>
        <div className="hero-inner">
          <span className="eyebrow">{RESTAURANT.tagline}</span>
          <h1>Hương vị quê nhà,<br /><em>trọn vẹn</em> từng món.</h1>
          <p>Phở hầm xương mười hai tiếng, bún chả than hoa, chè khúc bạch mát lạnh… Quét mã QR trên bàn để xem thực đơn và gọi món ngay.</p>
          <div className="hero-cta">
            <a className="btn primary lg" href="#menu"><Icon name="menu" size={18} /> Xem thực đơn</a>
            <a className="btn lg" href="#how"><Icon name="qr" size={18} /> Cách gọi món</a>
          </div>
        </div>
        <div className="hero-badge">
          <div className="glass row"><span className="ic"><Icon name="qr" /></span><div><strong>Gọi món bằng QR</strong><span>Nhanh, không phải chờ</span></div></div>
          <div className="glass row"><span className="ic"><Icon name="flame" /></span><div><strong>Bếp nhận đơn tức thì</strong><span>Theo dõi trạng thái từng món</span></div></div>
        </div>
      </header>

      <section className="section" id="menu">
        <div className="section-head">
          <div><span className="eyebrow">Thực đơn nổi bật</span><h2>Món ngon được yêu thích</h2></div>
          <p>Nguyên liệu tươi mỗi sáng, công thức gia truyền, phục vụ trong không gian ấm cúng.</p>
        </div>
        <div className="dish-grid stagger">
          {dishes === null && Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 260, borderRadius: 20 }} />)}
          {dishes?.map((d) => (
            <article key={d.id} className="dish">
              <div className="ph"><img src={d.imageUrl} alt={d.name} loading="lazy" /></div>
              <div className="bd">
                <strong>{d.name}</strong>
                {d.description && <span className="hint">{d.description}</span>}
                <span className="money">{formatVnd(d.price)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="how" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <div><span className="eyebrow">Gọi món tại bàn</span><h2>Ba bước, không cần chờ</h2></div>
        </div>
        <div className="steps stagger">
          {STEPS.map(([icon, title, text], i) => (
            <div key={title} className="step">
              <b>0{i + 1}</b>
              <span className="ic"><Icon name={icon} size={24} /></span>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section story" style={{ paddingTop: 0 }}>
        <img src="/images/hoian.jpg" alt="Phố cổ Hội An về đêm" loading="lazy" />
        <div>
          <span className="eyebrow">Câu chuyện của chúng tôi</span>
          <h2>Không gian phố cổ giữa lòng thành phố</h2>
          <p>{RESTAURANT.name} lấy cảm hứng từ những con phố đèn lồng, mái ngói rêu phong và căn bếp ấm lửa của gia đình Việt.</p>
          <p>Mỗi món ăn được chuẩn bị theo công thức truyền thống, phục vụ tận bàn bằng sự chu đáo — và một chút công nghệ để bạn không phải chờ lâu.</p>
        </div>
      </section>

      <footer className="land-foot">
        <span className="logo"><Icon name="lantern" /></span>
        <div><strong>{RESTAURANT.name}</strong><div>{RESTAURANT.tagline}</div></div>
        <span className="credit">Ảnh minh hoạ: Wikimedia Commons (CC BY-SA)</span>
      </footer>
    </div>
  );
}
