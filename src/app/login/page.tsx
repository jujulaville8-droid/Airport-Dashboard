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
    <div className="grid min-h-screen place-items-center bg-app-bg px-6">
      <div className="font-mono text-xs uppercase tracking-[0.16em] text-muted">Loading secure workspace…</div>
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
    <main className="relative grid min-h-screen overflow-hidden bg-app-bg lg:grid-cols-[minmax(0,1.15fr)_minmax(400px,.85fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-nav p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute right-[-11rem] top-[-12rem] h-[33rem] w-[33rem] rounded-full border border-white/10" />
        <div className="absolute bottom-[-16rem] left-[12%] h-[31rem] w-[31rem] rounded-full border border-accent/30" />
        <div className="relative">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent">The Tailor&apos;s Daughter</p>
          <div className="mt-24 max-w-xl">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/55">V.C. Bird International Airport</p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.05] tracking-tight">The shop floor, made operational.</h1>
            <p className="mt-6 max-w-md text-base leading-7 text-white/70">Sales, stock, flights, schedules and concession reporting in one protected workspace.</p>
          </div>
        </div>
        <div className="relative border-t border-white/15 pt-5 font-mono text-[11px] uppercase tracking-[0.15em] text-white/50">Antigua &amp; Barbuda · Operations workspace</div>
      </section>

      <section className="flex min-h-screen items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-9 lg:hidden">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">The Tailor&apos;s Daughter</p>
            <h1 className="mt-3 font-serif text-3xl text-ink">Operations terminal</h1>
          </div>
          <div className="rounded-lg border border-line bg-surface p-6 shadow-[0_20px_55px_-28px_rgba(20,37,53,0.35)] sm:p-8">
            <div className="mb-7">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Operations terminal</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Sign in to continue</h2>
              <p className="mt-2 text-sm leading-6 text-muted">Use your assigned dashboard credentials. Your session is protected.</p>
            </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="username" className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
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
                className="min-h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
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
                className="min-h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink disabled:opacity-50"
              />
            </div>

            {errorMessage && (
              <div role="alert" className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !username.trim() || !password}
              className="min-h-11 rounded-md bg-nav px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          </div>
          <p className="mt-5 text-center text-xs text-muted">Need access? Contact the store operations lead.</p>
        </div>
      </section>
    </main>
  );
}
