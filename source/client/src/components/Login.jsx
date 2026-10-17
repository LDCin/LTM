import { useState } from 'react';
import { ApiError, request, setStaffSession } from '../lib/api.js';

export default function Login({ title, allowedRoles, onLogin, hint }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await request('POST', '/api/auth/login', { body: { username, password } });
      if (!allowedRoles.includes(data.role)) {
        setError('Tài khoản không có quyền truy cập trang này');
        return;
      }
      setStaffSession(data);
      onLogin(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card login" onSubmit={submit}>
        <h1>{title}</h1>
        <label>
          Tên đăng nhập
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label>
          Mật khẩu
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={loading || !username || !password}>
          {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
        {hint && <p className="hint">{hint}</p>}
      </form>
    </div>
  );
}
