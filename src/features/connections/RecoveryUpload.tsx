'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import {
  RECOVERY_ENDPOINTS,
  type RecoveryImportSource,
} from './types';

interface RecoveryUploadProps {
  source: RecoveryImportSource;
  onRecovered?: () => void | Promise<void>;
}

const SOURCE_LABELS: Record<RecoveryImportSource, string> = {
  sales: 'sales totals',
  item_sales: 'item sales',
  inventory: 'inventory snapshot',
  flight_schedule: 'flight schedule',
};

function responseMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (Array.isArray(record.errors)) {
    const errors = record.errors.filter(
      (item): item is string => typeof item === 'string',
    );
    if (errors.length > 0) return errors.join('; ');
  }
  return null;
}

function payloadSucceeded(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return true;
  return (payload as Record<string, unknown>).success !== false;
}

function recordCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const record = payload as Record<string, unknown>;
  for (const key of [
    'rowsParsed',
    'totalDays',
    'totalFlights',
    'lineItemsWritten',
  ]) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return typeof record.date === 'string' ? 1 : 0;
}

export function RecoveryUpload({
  source,
  onRecovered,
}: RecoveryUploadProps) {
  const fileId = useId();
  const reportTypeId = useId();
  const dateId = useId();
  const monthId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [reportType, setReportType] = useState<'monthly' | 'daily'>('monthly');
  const [date, setDate] = useState('');
  const [scheduleMonth, setScheduleMonth] = useState('');
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setState({ kind: 'error', message: 'Choose a recovery file first.' });
      return;
    }
    if (source === 'flight_schedule' && !scheduleMonth) {
      setState({
        kind: 'error',
        message: 'Choose the schedule month for this PDF.',
      });
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    if (source === 'sales') formData.append('type', reportType);
    if (source === 'item_sales' && date) formData.append('date', date);
    if (source === 'inventory' && date) {
      formData.append('snapshotDate', date);
    }
    if (source === 'flight_schedule') {
      formData.append('scheduleMonth', scheduleMonth);
    }

    setState({ kind: 'uploading' });
    try {
      let response: Response;
      try {
        response = await fetch(RECOVERY_ENDPOINTS[source], {
          method: 'POST',
          body: formData,
        });
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Recovery importer could not be reached.';
        try {
          await fetch('/api/connections/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source,
              status: 'failed',
              records: 0,
              message,
              fileName: file.name,
            }),
          });
        } catch (logError) {
          console.error(
            '[connections] failed to record recovery request error:',
            logError,
          );
        }
        throw requestError;
      }

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // The status still determines success if an upstream error is not JSON.
      }

      const succeeded = response.ok && payloadSucceeded(payload);
      const importMessage = succeeded
        ? null
        : responseMessage(payload) ??
          `Recovery import failed (HTTP ${response.status}).`;
      const healthResponse = await fetch('/api/connections/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          status: succeeded ? 'success' : 'failed',
          records: recordCount(payload),
          message: importMessage,
          fileName: file.name,
        }),
      });
      if (!healthResponse.ok) {
        throw new Error(
          succeeded
            ? 'Recovery import completed, but its health status could not be recorded. Refresh status before trying again.'
            : `${importMessage} Health status could not be recorded.`,
        );
      }
      if (!succeeded) throw new Error(importMessage ?? 'Recovery import failed.');

      setState({
        kind: 'success',
        message: `${SOURCE_LABELS[source]} recovery import completed.`,
      });
      await onRecovered?.();
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Recovery import failed. Check the file and try again.',
      });
    }
  }

  const accept =
    source === 'flight_schedule' ? '.pdf' : '.xls,.xlsx,.csv';

  return (
    <form
      aria-label={`${SOURCE_LABELS[source]} recovery upload`}
      className="space-y-4 border-t border-line pt-4"
      onSubmit={handleSubmit}
    >
      <div>
        <label
          className="block text-xs font-semibold tracking-[0.04em] text-ink uppercase"
          htmlFor={fileId}
        >
          Recovery file
        </label>
        <input
          accept={accept}
          className="terminal-focus mt-2 block min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:min-h-8 file:rounded file:border-0 file:bg-nav file:px-3 file:text-xs file:font-semibold file:text-surface"
          id={fileId}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setState({ kind: 'idle' });
          }}
          type="file"
        />
        <p className="mt-1.5 text-xs leading-5 text-muted">
          {source === 'flight_schedule'
            ? 'PDF, up to 10 MB.'
            : 'XLS, XLSX, or CSV, up to 10 MB.'}
        </p>
      </div>

      {source === 'sales' ? (
        <div>
          <label
            className="block text-xs font-semibold tracking-[0.04em] text-ink uppercase"
            htmlFor={reportTypeId}
          >
            Sales report type
          </label>
          <select
            className="terminal-focus mt-2 min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
            id={reportTypeId}
            onChange={(event) =>
              setReportType(event.target.value as 'monthly' | 'daily')
            }
            value={reportType}
          >
            <option value="monthly">Monthly report</option>
            <option value="daily">Daily report</option>
          </select>
        </div>
      ) : null}

      {source === 'item_sales' || source === 'inventory' ? (
        <div>
          <label
            className="block text-xs font-semibold tracking-[0.04em] text-ink uppercase"
            htmlFor={dateId}
          >
            {source === 'inventory'
              ? 'Snapshot date (optional)'
              : 'Report date (optional)'}
          </label>
          <input
            className="terminal-focus mt-2 min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
            id={dateId}
            onChange={(event) => setDate(event.target.value)}
            type="date"
            value={date}
          />
        </div>
      ) : null}

      {source === 'flight_schedule' ? (
        <div>
          <label
            className="block text-xs font-semibold tracking-[0.04em] text-ink uppercase"
            htmlFor={monthId}
          >
            Schedule month
          </label>
          <input
            className="terminal-focus mt-2 min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
            id={monthId}
            onChange={(event) => setScheduleMonth(event.target.value)}
            required
            type="month"
            value={scheduleMonth}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={state.kind === 'uploading'} type="submit">
          {state.kind === 'uploading'
            ? 'Uploading recovery…'
            : 'Upload recovery file'}
        </Button>
        {state.kind === 'success' ? (
          <p className="text-sm font-medium text-positive" role="status">
            {state.message}
          </p>
        ) : null}
        {state.kind === 'error' ? (
          <p className="text-sm font-medium text-ink" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
