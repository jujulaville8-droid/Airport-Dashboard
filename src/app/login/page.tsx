'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#FAF8F5]">
      <div className="text-sm text-brand-wood/60">Loading…</div>
    </div>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/dashboard';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!res.ok) {
        let msg = 'Invalid credentials';
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch { /* non-JSON */ }
        console.error('[login] failed:', res.status, msg);
        setErrorMessage(msg);
        return;
      }

      // Hard navigate so the browser sends the newly-set cookie on the very
      // first request. Client-side router.replace() doesn't pick up cookie
      // changes and the proxy would bounce us right back to /login.
      window.location.href = next.startsWith('/') ? next : '/dashboard';
    } catch (err) {
      console.error('[login] network error:', err);
      setErrorMessage('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#FAF8F5]">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="font-serif text-[40px] leading-tight text-brand-black tracking-tight mb-2">
            The Tailor&apos;s Daughter
          </h1>
          <p className="text-sm font-medium text-brand-wood/70">
            V.C. Bird International Airport · Antigua &amp; Barbuda
          </p>
        </div>

        <div className="bg-white rounded-[20px] border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.08)] p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <h2 className="font-serif text-xl text-brand-black mb-1">Sign in</h2>
              <p className="text-xs text-brand-wood/60">
                Enter your credentials to access the dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="username" className="text-[10px] text-brand-wood/60 uppercase font-medium tracking-wider">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                className="text-sm border border-brand-wood/20 rounded-lg px-4 py-3 bg-white focus:outline-none focus:border-brand-gold disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-[10px] text-brand-wood/60 uppercase font-medium tracking-wider">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="text-sm border border-brand-wood/20 rounded-lg px-4 py-3 bg-white focus:outline-none focus:border-brand-gold disabled:opacity-50"
              />
            </div>

            {errorMessage && (
              <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !username.trim() || !password}
              className="px-4 py-3 bg-brand-gold text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-brand-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
