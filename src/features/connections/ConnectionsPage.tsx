'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  ErrorState,
  LoadingState,
} from '@/components/ui/DataState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import type { ImportSource } from '@/lib/import-health';
import { SourceCard } from './SourceCard';
import type {
  ConnectionsStatusResponse,
  RecentImport,
} from './types';

const SOURCE_LABELS: Record<ImportSource, string> = {
  sales: 'Sales totals',
  item_sales: 'Item sales',
  inventory: 'Inventory',
  flight_schedule: 'Flight schedule',
  passenger_summary: 'Passenger summary',
};

const OVERALL_PRESENTATION: Record<
  ConnectionsStatusResponse['overall'],
  { label: string; tone: BadgeTone }
> = {
  healthy: { label: 'Imports healthy', tone: 'positive' },
  attention: { label: 'Imports need attention', tone: 'warning' },
  'not-configured': {
    label: 'Imports not configured',
    tone: 'danger',
  },
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function HistoryItem({ item }: { item: RecentImport }) {
  const failed = item.status === 'failed';
  return (
    <li className="grid gap-3 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">{SOURCE_LABELS[item.source]}</p>
          <Badge tone={failed ? 'danger' : 'positive'}>
            {failed ? 'Failed' : 'Imported'}
          </Badge>
        </div>
        <p className="mt-1 text-sm leading-5 text-muted">
          {failed ? (
            <>
              <span className="font-medium text-ink">Import failed.</span>{' '}
              {item.message ?? 'Review the source and open recovery.'}
            </>
          ) : (
            `${item.records.toLocaleString('en-CA')} records imported`
          )}
        </p>
      </div>
      <time
        className="font-mono text-xs font-medium text-muted"
        dateTime={item.attemptedAt}
      >
        {formatTimestamp(item.attemptedAt)}
      </time>
    </li>
  );
}

export function ConnectionsPage({
  initialStatus,
}: {
  initialStatus?: ConnectionsStatusResponse;
}) {
  const [status, setStatus] = useState<ConnectionsStatusResponse | null>(
    initialStatus ?? null,
  );
  const [loading, setLoading] = useState(!initialStatus);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const loadStatus = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/connections/status', {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Health request failed (HTTP ${response.status})`);
      }
      const nextStatus = (await response.json()) as ConnectionsStatusResponse;
      if (generation === requestGeneration.current) {
        setStatus(nextStatus);
      }
    } catch (requestError) {
      if (generation !== requestGeneration.current) return;
      console.error('[connections] status request failed:', requestError);
      setError(
        'Automatic import status could not be refreshed. Retry to load the latest state.',
      );
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!initialStatus) void loadStatus();
    return () => {
      requestGeneration.current += 1;
    };
  }, [initialStatus, loadStatus]);

  const recentImports = useMemo(
    () =>
      [...(status?.recentImports ?? [])].sort((a, b) =>
        b.attemptedAt.localeCompare(a.attemptedAt),
      ),
    [status?.recentImports],
  );

  if (loading && !status) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <LoadingState label="Loading automatic import health" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <ErrorState
          actionLabel="Retry status"
          message={
            error ??
            'Automatic import status is unavailable. Retry before using a recovery import.'
          }
          onAction={() => void loadStatus()}
          title="Connections status unavailable"
        />
      </div>
    );
  }

  const overall = OVERALL_PRESENTATION[status.overall];
  const healthyCount = status.sources.filter(
    (source) => source.status === 'healthy',
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Button
            disabled={loading}
            onClick={() => void loadStatus()}
            variant="secondary"
          >
            {loading ? 'Refreshing…' : 'Refresh status'}
          </Button>
        }
        description="Automatic imports run every hour. Use recovery only when a source needs attention."
        eyebrow="Automatic ingestion"
        metadata={
          <>
            <Badge tone={overall.tone}>{overall.label}</Badge>
            <span aria-hidden="true">·</span>
            <span>
              {healthyCount} of {status.sources.length} sources current
            </span>
          </>
        }
        title="Data Connections"
      />

      {error ? (
        <section
          className="rounded-lg border-l-4 border-danger bg-surface p-4 text-sm leading-6 text-ink"
          role="alert"
        >
          {error}
        </section>
      ) : null}

      {status.overall === 'not-configured' ? (
        <section
          aria-labelledby="connections-configuration-title"
          className="rounded-lg border border-danger bg-surface p-5 sm:p-6"
        >
          <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-ink uppercase">
            Configuration required
          </p>
          <h2
            className="mt-2 font-display text-2xl font-semibold text-ink"
            id="connections-configuration-title"
          >
            Complete the automatic inbox setup
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Set the cron secret and Gmail OAuth variables in the deployment
            environment, then redeploy. This page reports configuration only
            as ready or not ready; credential values are never returned.
          </p>
          <ul className="mt-4 grid gap-2 font-mono text-xs text-ink sm:grid-cols-2">
            <li className="rounded border border-line bg-app-bg px-3 py-2">
              CRON_SECRET
            </li>
            <li className="rounded border border-line bg-app-bg px-3 py-2">
              GMAIL_CLIENT_ID
            </li>
            <li className="rounded border border-line bg-app-bg px-3 py-2">
              GMAIL_CLIENT_SECRET
            </li>
            <li className="rounded border border-line bg-app-bg px-3 py-2">
              GMAIL_REFRESH_TOKEN
            </li>
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="automatic-path-title">
        <div className="grid overflow-hidden rounded-lg border border-line bg-nav text-surface shadow-sm md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <div className="p-5 sm:p-6">
            <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-accent uppercase">
              01 · Receive
            </p>
            <h2
              className="mt-2 font-display text-2xl font-semibold"
              id="automatic-path-title"
            >
              Gmail inbox
            </h2>
            <p className="mt-1 text-sm leading-5 text-surface/70">
              Approved reports arrive by email.
            </p>
          </div>
          <div
            aria-hidden="true"
            className="hidden w-px bg-surface/15 md:block"
          />
          <div className="border-t border-surface/15 p-5 sm:p-6 md:border-t-0">
            <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-accent uppercase">
              02 · Validate
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold">
              Hourly scan
            </h2>
            <p className="mt-1 text-sm leading-5 text-surface/70">
              {status.cron.configured
                ? 'Schedule configured and protected.'
                : 'Schedule needs deployment configuration.'}
            </p>
          </div>
          <div
            aria-hidden="true"
            className="hidden w-px bg-surface/15 md:block"
          />
          <div className="border-t border-surface/15 p-5 sm:p-6 md:border-t-0">
            <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-accent uppercase">
              03 · Publish
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold">
              Dashboard data
            </h2>
            <p className="mt-1 text-sm leading-5 text-surface/70">
              Valid imports update their source history.
            </p>
          </div>
        </div>
      </section>

      <Panel
        description="Connected sources require no action. Open recovery only for stale, failed, or missing imports."
        title="Source health"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {status.sources.map((source) => (
            <SourceCard
              health={source}
              key={source.source}
              onRecovered={loadStatus}
            />
          ))}
        </div>
      </Panel>

      <Panel
        description="Newest activity first. Failed rows keep their recovery detail and never appear as a zero-value success."
        flush
        title="Import history"
      >
        {recentImports.length > 0 ? (
          <ol aria-label="Import history, newest first">
            {recentImports.map((item, index) => (
              <HistoryItem
                item={item}
                key={`${item.source}-${item.attemptedAt}-${index}`}
              />
            ))}
          </ol>
        ) : (
          <p className="px-5 py-8 text-sm leading-6 text-muted sm:px-6">
            No artifact imports have been recorded yet. Automatic history will
            appear after the first hourly scan processes a supported source.
          </p>
        )}
      </Panel>
    </div>
  );
}
