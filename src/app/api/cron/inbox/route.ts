import { NextRequest } from 'next/server';
import { scanInbox } from '@/lib/gmail-inbox';
import { logImport } from '@/lib/db';

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
    return Response.json({
      ok: true,
      scanned: result.scanned,
      imported: result.imported,
      failed: result.failed,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error('[api/cron/inbox] scan failed:', err);
    const detail = err instanceof Error ? err.message : String(err);

    // scanInbox owns normal scan telemetry. This fallback runs only when the
    // scan escapes before it can finish, so a successful/partial scan is not
    // logged twice.
    try {
      await logImport({
        source_type: 'manual',
        file_name: 'gmail-inbox-scan',
        total_records: 1,
        successful_records: 0,
        failed_records: 1,
        error_messages: { errors: [detail] },
        reconciliation_status: 'failed',
        source: 'gmail_inbox',
        status: 'failed',
        message: detail,
        attempted_at: new Date().toISOString(),
      });
    } catch (logError) {
      console.error(
        '[api/cron/inbox] failed to persist scan failure:',
        logError,
      );
    }

    return Response.json(
      { ok: false, error: 'Inbox scan failed' },
      { status: 500 },
    );
  }
}
