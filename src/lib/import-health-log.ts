import { logImport } from './db';
import type { ImportSource } from './import-health';

type RoutableImportSource = Exclude<ImportSource, 'passenger_summary'>;

export interface AuthoritativeImportResult {
  source: RoutableImportSource;
  fileName: string;
  success: boolean;
  records: number;
  message: string | null;
}

export async function recordImportHealthResult(
  result: AuthoritativeImportResult,
): Promise<void> {
  const records = Number.isFinite(result.records)
    ? Math.max(0, Math.floor(result.records))
    : 0;
  const message = result.success
    ? result.message
    : result.message ?? 'Import failed';
  const sourceType =
    result.source === 'flight_schedule' ? 'flight_schedule' : 'counterpoint';

  await logImport({
    source_type: sourceType,
    file_name: result.fileName,
    total_records: records,
    successful_records: result.success ? records : 0,
    failed_records: result.success ? 0 : records,
    error_messages:
      result.success ? null : { errors: [message] },
    reconciliation_status: result.success ? 'complete' : 'failed',
    source: result.source,
    status: result.success ? 'success' : 'failed',
    message,
    attempted_at: new Date().toISOString(),
  });
}
