import { logImport, supabase } from '@/lib/db';
import {
  IMPORT_SOURCES,
  summarizeImportHealth,
  type ImportLogSummary,
  type ImportSource,
} from '@/lib/import-health';
import type {
  ConnectionsStatusResponse,
  RecentImport,
} from '@/features/connections/types';

export const dynamic = 'force-dynamic';

function isImportSource(source: string | null): source is ImportSource {
  return (
    typeof source === 'string' &&
    (IMPORT_SOURCES as readonly string[]).includes(source)
  );
}

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

const RECOVERY_SOURCES = [
  'sales',
  'item_sales',
  'inventory',
  'flight_schedule',
] as const;

type RecoverySource = (typeof RECOVERY_SOURCES)[number];

function isRecoverySource(source: unknown): source is RecoverySource {
  return (
    typeof source === 'string' &&
    (RECOVERY_SOURCES as readonly string[]).includes(source)
  );
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('import_logs')
      .select(
        'source, attempted_at, status, message, successful_records, failed_records, total_records',
      )
      .in('source', [...IMPORT_SOURCES])
      .not('status', 'is', null)
      .not('attempted_at', 'is', null)
      .order('attempted_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const recentImports: RecentImport[] = (data ?? [])
      .flatMap((row): RecentImport[] => {
        if (
          !isImportSource(row.source) ||
          (row.status !== 'success' && row.status !== 'failed') ||
          typeof row.attempted_at !== 'string'
        ) {
          return [];
        }

        const successfulRecords =
          typeof row.successful_records === 'number'
            ? row.successful_records
            : null;
        const failedRecords =
          typeof row.failed_records === 'number' ? row.failed_records : null;
        const totalRecords =
          typeof row.total_records === 'number' ? row.total_records : null;

        return [
          {
            source: row.source,
            attemptedAt: row.attempted_at,
            status: row.status,
            records:
              row.status === 'success'
                ? (successfulRecords ?? totalRecords ?? 0)
                : (totalRecords ?? failedRecords ?? 0),
            message: typeof row.message === 'string' ? row.message : null,
          },
        ];
      })
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));

    const logs: ImportLogSummary[] = recentImports.map((item) => ({
      source: item.source,
      attemptedAt: item.attemptedAt,
      status: item.status,
      message: item.message,
    }));
    const sourceHealth = summarizeImportHealth(logs);
    const sources = IMPORT_SOURCES.map((source) => sourceHealth[source]);

    const cronConfigured = configured(process.env.CRON_SECRET);
    const gmailConfigured = [
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REFRESH_TOKEN,
    ].every(configured);
    const overall = !cronConfigured || !gmailConfigured
      ? 'not-configured'
      : sources.every((source) => source.status === 'healthy')
        ? 'healthy'
        : 'attention';

    const response: ConnectionsStatusResponse = {
      overall,
      cron: {
        configured: cronConfigured,
        schedule: 'hourly',
      },
      sources,
      recentImports,
    };

    return Response.json(response);
  } catch (error) {
    console.error('[api/connections/status] query failed:', error);
    return Response.json(
      { error: 'Connections status unavailable' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid recovery result' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return Response.json({ error: 'Invalid recovery result' }, { status: 400 });
  }

  const result = payload as Record<string, unknown>;
  const source = result.source;
  const status = result.status;
  const records = result.records;
  const message = result.message;
  const fileName = result.fileName;

  if (
    !isRecoverySource(source) ||
    (status !== 'success' && status !== 'failed') ||
    typeof records !== 'number' ||
    !Number.isFinite(records) ||
    records < 0 ||
    !Number.isInteger(records) ||
    (message !== null && typeof message !== 'string') ||
    (typeof message === 'string' && message.length > 2_000) ||
    typeof fileName !== 'string' ||
    fileName.length < 1 ||
    fileName.length > 255
  ) {
    return Response.json({ error: 'Invalid recovery result' }, { status: 400 });
  }

  const sourceType =
    source === 'flight_schedule' ? 'flight_schedule' : 'counterpoint';

  try {
    await logImport({
      source_type: sourceType,
      file_name: fileName,
      total_records: records,
      successful_records: status === 'success' ? records : 0,
      failed_records: status === 'failed' ? records : 0,
      error_messages:
        status === 'failed'
          ? { errors: [message ?? 'Recovery import failed'] }
          : null,
      reconciliation_status: status === 'success' ? 'complete' : 'failed',
      source,
      status,
      message,
      attempted_at: new Date().toISOString(),
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error('[api/connections/status] recovery log failed:', error);
    return Response.json(
      { error: 'Recovery status unavailable' },
      { status: 500 },
    );
  }
}
