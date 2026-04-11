/**
 * Minimal single-user auth using an HMAC-signed session cookie.
 *
 * Why not a real auth provider? This is a single-tenant ops dashboard with
 * exactly one login. The full Supabase Auth stack was overkill. This module
 * gives us:
 *  - Constant-time credential check against AUTH_USERNAME / AUTH_PASSWORD
 *  - HMAC-signed session payload (so cookies can't be forged without AUTH_SECRET)
 *  - Works in the Edge runtime (the proxy runs there) via Web Crypto
 *  - Rotating AUTH_SECRET instantly invalidates every existing session
 */

export const SESSION_COOKIE = 'tdash_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set and at least 32 characters');
  }
  return secret;
}

/**
 * Constant-time string comparison. Avoids the short-circuit leak of `===`
 * on the password check. Web Crypto doesn't expose timingSafeEqual directly,
 * so we roll it by XOR'ing codepoints.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a dummy comparison to keep timing roughly constant
    let diff = 1;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ 0;
    return diff === 0;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function checkCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.AUTH_USERNAME;
  const expectedPass = process.env.AUTH_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  // Run both comparisons unconditionally so a wrong username doesn't short-circuit.
  const userOk = constantTimeEqual(username, expectedUser);
  const passOk = constantTimeEqual(password, expectedPass);
  return userOk && passOk;
}

// --- Signed session cookie ---

interface SessionPayload {
  user: string;      // username (for display in the sidebar)
  iat: number;       // issued-at, unix seconds
  exp: number;       // expires-at, unix seconds
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}

async function hmacVerify(payload: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  try {
    return await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signature).buffer as ArrayBuffer,
      new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
}

/**
 * Create a signed session token for the given username. Returns a string
 * suitable for the Set-Cookie value (format: base64(payload).base64(sig)).
 */
export async function createSessionToken(username: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    user: username,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  const payloadStr = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(payloadStr);
  return `${payloadStr}.${sig}`;
}

/**
 * Verify a session token. Returns the decoded payload if valid+unexpired,
 * or null if the signature fails, the payload is malformed, or it's expired.
 */
export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadStr, sig] = parts;

  const ok = await hmacVerify(payloadStr, sig);
  if (!ok) return null;

  let payload: SessionPayload;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadStr));
    payload = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
};
