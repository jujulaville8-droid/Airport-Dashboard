import { deriveFreshness } from './ui/data-state';

export const IMPORT_SOURCES = ['sales', 'item_sales', 'inventory', 'flight_schedule', 'passenger_summary'] as const;
export type ImportSource = typeof IMPORT_SOURCES[number];
export type ImportLogSummary = {
  source: ImportSource;
  attemptedAt: string;
  status: 'success' | 'failed';
  message: string | null;
};
export type ImportSourceHealth = {
  source: ImportSource;
  status: 'healthy' | 'stale' | 'failed' | 'never';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  message: string | null;
};

export function summarizeImportHealth(
  logs: ImportLogSummary[],
  now = new Date(),
): Record<ImportSource, ImportSourceHealth> {
  return Object.fromEntries(IMPORT_SOURCES.map((source) => {
    const sourceLogs = logs.filter((log) => log.source === source)
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
    const latest = sourceLogs[0];
    const lastSuccessAt = sourceLogs.find((log) => log.status === 'success')?.attemptedAt ?? null;
    const freshness = deriveFreshness(lastSuccessAt, now, 24 * 60);
    return [source, {
      source,
      status: !latest ? 'never' : latest.status === 'failed' ? 'failed' : freshness.kind === 'stale' ? 'stale' : 'healthy',
      lastAttemptAt: latest?.attemptedAt ?? null,
      lastSuccessAt,
      message: latest?.message ?? null,
    }];
  })) as Record<ImportSource, ImportSourceHealth>;
}
