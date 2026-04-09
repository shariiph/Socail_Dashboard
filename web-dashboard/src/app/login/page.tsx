'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Login failed');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050510] text-slate-100 flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#0E0E25] p-6 space-y-4"
      >
        <h1 className="text-xl font-bold">Wallet Hub Login</h1>
        <p className="text-xs text-slate-400">Sign in to access the dashboard.</p>
        <div className="space-y-2">
          <label className="text-xs text-slate-400">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50"
            autoComplete="username"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-slate-400">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50"
            autoComplete="current-password"
          />
        </div>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-bold hover:bg-indigo-500 disabled:opacity-60"
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
