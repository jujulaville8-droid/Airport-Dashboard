'use client';

import { useId, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { ImportSource, ImportSourceHealth } from '@/lib/import-health';
import { RecoveryUpload } from './RecoveryUpload';
import type { RecoveryImportSource } from './types';

const SOURCE_DETAILS: Record<
  ImportSource,
  { label: string; description: string; cadence: string }
> = {
  sales: {
    label: 'Sales totals',
    description: 'Daily and monthly Counterpoint sales reports.',
    cadence: 'Expected daily',
  },
  item_sales: {
    label: 'Item sales',
    description: 'SKU-level Counterpoint sales activity.',
    cadence: 'Expected daily',
  },
  inventory: {
    label: 'Inventory snapshot',
    description: 'Current quantity and inventory value by SKU.',
    cadence: 'Expected daily',
  },
  flight_schedule: {
    label: 'Flight schedule',
    description: 'Airport schedule PDF used for passenger traffic planning.',
    cadence: 'Expected monthly',
  },
  passenger_summary: {
    label: 'Passenger summary',
    description: 'Actual carrier passenger counts matched to scheduled flights.',
    cadence: 'Expected by email',
  },
};

const STATUS_PRESENTATION: Record<
  ImportSourceHealth['status'],
  { label: string; tone: BadgeTone }
> = {
  healthy: { label: 'Connected', tone: 'positive' },
  stale: { label: 'Stale', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  never: { label: 'Not received', tone: 'neutral' },
};

function formatTimestamp(value: string | null): string {
  if (!value) return 'No successful import yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Timestamp unavailable';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function isRecoverySource(
  source: ImportSource,
): source is RecoveryImportSource {
  return source !== 'passenger_summary';
}

export function SourceCard({
  health,
  onRecovered,
}: {
  health: ImportSourceHealth;
  onRecovered?: () => void | Promise<void>;
}) {
  const recoveryId = useId();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const detail = SOURCE_DETAILS[health.source];
  const status = STATUS_PRESENTATION[health.status];
  const needsRecovery = health.status !== 'healthy';

  return (
    <article
      aria-label={detail.label}
      className={[
        'relative overflow-hidden rounded-lg border bg-surface p-5 shadow-sm sm:p-6',
        health.status === 'failed'
          ? 'border-danger'
          : health.status === 'stale'
            ? 'border-accent'
            : 'border-line',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'absolute inset-y-0 left-0 w-1',
          health.status === 'healthy'
            ? 'bg-positive'
            : health.status === 'failed'
              ? 'bg-danger'
              : health.status === 'stale'
                ? 'bg-accent'
                : 'bg-line',
        ].join(' ')}
      />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.06em] text-muted uppercase">
              {detail.cadence}
            </p>
            <h3 className="mt-1 font-display text-2xl font-semibold leading-tight text-ink">
              {detail.label}
            </h3>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <p className="text-sm leading-6 text-muted">{detail.description}</p>

        <dl className="grid gap-3 border-y border-line py-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
              Last success
            </dt>
            <dd className="mt-1 text-ink">
              {health.lastSuccessAt ? (
                <time dateTime={health.lastSuccessAt}>
                  {formatTimestamp(health.lastSuccessAt)}
                </time>
              ) : (
                'No successful import yet'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">
              Last attempt
            </dt>
            <dd className="mt-1 text-ink">
              {health.lastAttemptAt ? (
                <time dateTime={health.lastAttemptAt}>
                  {formatTimestamp(health.lastAttemptAt)}
                </time>
              ) : (
                'No attempt recorded'
              )}
            </dd>
          </div>
        </dl>

        {health.message ? (
          <p
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm leading-5 text-ink"
            role={health.status === 'failed' ? 'alert' : undefined}
          >
            <span className="font-semibold">Import detail:</span>{' '}
            {health.message}
          </p>
        ) : null}

        {needsRecovery ? (
          <>
            <Button
              aria-controls={recoveryId}
              aria-expanded={recoveryOpen}
              className="w-full sm:w-fit"
              onClick={() => setRecoveryOpen((open) => !open)}
              variant="secondary"
            >
              {recoveryOpen ? 'Close recovery' : 'Open recovery'}
            </Button>
            {recoveryOpen ? (
              <div id={recoveryId}>
                {isRecoverySource(health.source) ? (
                  <RecoveryUpload
                    onRecovered={onRecovered}
                    source={health.source}
                  />
                ) : (
                  <div className="border-t border-line pt-4">
                    <p className="text-sm leading-6 text-ink">
                      Passenger summaries are email-only. Correct the message
                      or parser issue, then remove the{' '}
                      <span className="font-mono text-xs font-semibold">
                        TailorsDaughter/Failed
                      </span>{' '}
                      label in Gmail. The next hourly scan will retry the
                      message automatically.
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}
