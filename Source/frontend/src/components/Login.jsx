import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { ApiError, request, setStaffSession } from '../lib/api.js';
import { RESTAURANT } from '../lib/format.js';

/** Màn đăng nhập nhân viên: ảnh không gian nhà hàng bên trái, form bên phải. */
export default function Login({ title, icon = 'lock', allowedRoles, onLogin, hint, image = '/images/hoian.jpg' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await request('POST', '/api/auth/login', { body: { username, password } });
      if (!allowedRoles.includes(data.role)) {
        setError('Tài khoản không có quyền vào trang này');
        return;
      }
      setStaffSession(data);
      onLogin(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không kết nối được máy chủ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-art" style={{ backgroundImage: `url(${image})` }}>
        <span className="eyebrow">{RESTAURANT.tagline}</span>
        <h2>Mỗi món ăn là một câu chuyện, mỗi ca làm là một lời mời.</h2>
        <p>Hệ thống vận hành {RESTAURANT.name}: đơn từ bàn tới bếp, từ bếp tới quầy — tức thì và chính xác.</p>
      </div>
      <div className="auth-form">
        <form onSubmit={submit}>
          <div className="auth-role">
            <span className="logo"><Icon name={icon} /></span>
            <div>
              <span className="eyebrow">{RESTAURANT.name} · Nhân viên</span>
              <h1>{title}</h1>
            </div>
          </div>
          <p className="muted">Đăng nhập để bắt đầu ca làm việc của bạn.</p>
          <label className="field">
            Tên đăng nhập
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="Nhập tên đăng nhập" autoFocus />
          </label>
          <label className="field">
            Mật khẩu
            <span className="pw">
              <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" placeholder="Nhập mật khẩu" />
              <button type="button" className="btn ghost" onClick={() => setShow(!show)} aria-label="Hiện mật khẩu"><Icon name="eye" size={17} /></button>
            </span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary lg block" disabled={loading || !username || !password}>
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'} <Icon name="arrowRight" size={18} />
          </button>
          {hint && <div className="demo-hint"><Icon name="info" size={16} />{hint}</div>}
          <Link to="/staff" className="hint row"><Icon name="chevronLeft" size={14} /> Cổng nhân viên</Link>
        </form>
      </div>
    </div>
  );
}
