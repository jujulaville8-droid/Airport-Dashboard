import { NextRequest } from 'next/server';
import { scanInbox } from '@/lib/gmail-inbox';

/**
 * Vercel Cron entry point for the Gmail inbox watcher.
 *
 * Schedule is defined in vercel.json (`/api/cron/inbox` every hour).
 *
 * Auth: Vercel Cron automatically attaches `Authorization: Bearer $CRON_SECRET`
 * to every cron invocation. We verify that header against the env var so that
 * nobody on the open internet can trigger imports by hitting this URL. The
 * route is also listed as a public path in src/proxy.ts so the session-cookie
 * gate doesn't block Vercel's cron invoker (which carries no cookies).
 *
 * This endpoint may also be invoked manually (`curl -H 'Authorization: Bearer $SECRET' ...`)
 * for on-demand scans.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[api/cron/inbox] CRON_SECRET not set');
    return Response.json({ error: 'Server not configured' }, { status: 500 });
  }

  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await scanInbox();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/cron/inbox] scan failed:', err);
    const message = err instanceof Error ? err.message : 'Inbox scan failed';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
