import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

/**
 * Sign out endpoint. POST-only so a GET from a malicious image/email can't
 * trigger it (basic CSRF hardening — matches NextAuth convention).
 */
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const res = NextResponse.redirect(`${origin}/login`, { status: 303 });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
