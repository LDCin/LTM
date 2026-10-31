import { useState } from 'react';
import Icon from './Icon.jsx';
import { RESTAURANT } from '../lib/format.js';

const ROLE_LABEL = { ADMIN: 'Quản lý', KITCHEN: 'Bếp', CASHIER: 'Thu ngân' };

function readCollapsed() {
  try {
    return localStorage.getItem('qrorder.sidebar') === '1';
  } catch {
    return false;
  }
}

/** Khung chung của các trang nhân viên: sidebar bên trái (điều hướng), nội dung bên phải. */
export default function AppShell({ area, nav, active, onNav, session, onLogout, title, subtitle, actions, children }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('qrorder.sidebar', c ? '0' : '1');
      } catch {
        /* bỏ qua */
      }
      return !c;
    });
  };
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="side-brand">
          <span className="logo"><Icon name="lantern" /></span>
          <div>
            <strong>{RESTAURANT.name}</strong>
            <span>{area}</span>
          </div>
        </div>
        <div className="side-label">Điều hướng</div>
        <nav className="side-nav">
          {nav.map((n) => (
            <button key={n.key} className={`side-link ${active === n.key ? 'active' : ''}`} onClick={() => onNav(n.key)} title={n.label}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.count > 0 && <em className="count">{n.count}</em>}
            </button>
          ))}
        </nav>
        <button className="side-link collapse-btn" onClick={toggle} title={collapsed ? 'Mở rộng' : 'Thu gọn'}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
          <span>Thu gọn</span>
        </button>
        <div className="side-foot">
          <span className="avatar">{session.username.slice(0, 2)}</span>
          <div className="who">
            <strong>{session.username}</strong>
            <span>{ROLE_LABEL[session.role] || session.role}</span>
          </div>
          <button className="btn ghost small icon-only" onClick={onLogout} title="Đăng xuất">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <div className="sub"><Icon name="calendar" />{subtitle || today}</div>
          </div>
          <div className="topbar-actions">{actions}</div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
