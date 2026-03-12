'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({ username: '', email: '', password: '', full_name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = mode === 'login'
      ? { username: form.username, password: form.password }
      : form;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Đã có lỗi xảy ra.'); return; }
      router.push('/');
      router.refresh();
    } catch {
      setError('Không thể kết nối server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-3xl mx-auto mb-4">🩺</div>
          <h1 className="text-2xl font-bold text-white">Medical AI Assistant</h1>
          <p className="text-gray-500 text-sm mt-1">Trợ lý y tế AI tiếng Việt</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">

          {/* Tab */}
          <div className="flex gap-1 bg-gray-800 rounded-xl p-1 mb-6">
            {(['login', 'register'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  mode === m ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {m === 'login' ? 'Đăng nhập' : 'Đăng ký'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Họ và tên</label>
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="Nguyễn Văn A"
                  value={form.full_name}
                  onChange={e => set('full_name', e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Username</label>
              <input
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="username"
                value={form.username}
                onChange={e => set('username', e.target.value)}
                autoComplete="username"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Email</label>
                <input
                  required
                  type="email"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="example@email.com"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  autoComplete="email"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Mật khẩu</label>
              <input
                required
                type="password"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder={mode === 'register' ? 'Tối thiểu 6 ký tự' : '••••••••'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-2.5">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-2.5 rounded-xl text-sm transition-all duration-200 mt-2"
            >
              {loading ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          AI không thay thế bác sĩ · Đồ án tốt nghiệp 2025
        </p>
      </div>
    </div>
  );
}
