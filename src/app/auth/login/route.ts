import { NextResponse } from 'next/server';
import {
  checkCredentials,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from '@/lib/auth';

/**
 * Login endpoint. Accepts a JSON body with { username, password }.
 * Returns 200 + Set-Cookie on success, 401 otherwise.
 *
 * We deliberately do NOT echo the username back in the error body — just
 * "Invalid credentials" — so callers can't probe whether a given username
 * exists vs. the password is wrong.
 */
export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  if (!checkCredentials(username, password)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSessionToken(username);
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}
