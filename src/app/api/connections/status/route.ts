import { supabase } from '@/lib/db';
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
    const flightProviderConfigured = [
      process.env.AERODATABOX_RAPIDAPI_KEY,
      process.env.FLIGHT_CRON_SECRET,
    ].every(configured);
    const overall = !cronConfigured || !gmailConfigured || !flightProviderConfigured
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
      flightProvider: {
        provider: 'AeroDataBox',
        configured: flightProviderConfigured,
        airport: 'ANU',
        direction: 'departure',
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
