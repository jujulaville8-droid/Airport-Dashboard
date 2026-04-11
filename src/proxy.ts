import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/**
 * Auth gate for the entire app.
 *
 * Runs on every request (see `config.matcher` below). Blocks access to
 * anything outside `/login` and `/auth/*` unless the request carries a valid
 * HMAC-signed session cookie.
 *
 * Design notes:
 * - Single authorization boundary: the service-role Supabase client in
 *   src/lib/db.ts is never exposed to callers; every /api/* and /dashboard/*
 *   route sits behind this proxy.
 * - For API routes we return 401 JSON (instead of a redirect) so fetch()
 *   callers get a real error they can handle.
 *
 * Next.js 16 renamed this file convention from `middleware.ts` to `proxy.ts`
 * and the exported function from `middleware` to `proxy`. Behavior is identical.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicPath =
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname === '/favicon.ico';

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (isPublicPath) {
    // Already signed in? Bounce away from /login to dashboard.
    if (session && pathname === '/login') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!session) {
    // API routes: return JSON 401 so fetch() callers can handle cleanly
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Pages: redirect to login, preserving intended destination
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - public static assets (svg, png, etc.)
     */
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
