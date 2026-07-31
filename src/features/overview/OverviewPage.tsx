'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  ErrorState,
  FreshnessIndicator,
  LoadingState,
} from '@/components/ui/DataState';
import { Metric } from '@/components/ui/Metric';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { deriveFreshness } from '@/lib/ui/data-state';
import { ActionCard } from './ActionCard';
import { deriveActions } from './derive-actions';
import { TrafficWindow } from './TrafficWindow';
import type {
  ConnectionsOverview,
  DomainResult,
  ErrorDomainResult,
  OverviewResponse,
} from './types';

const STALE_AFTER_MINUTES = 24 * 60;

function formatCurrency(value: number, currency: 'USD' | 'ECD' = 'USD') {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function retainDomain<T>(
  previous: DomainResult<T>,
  incoming: DomainResult<T>,
): DomainResult<T> {
  if (incoming.status === 'ready' || previous.data === null) return incoming;
  return {
    ...incoming,
    data: previous.data,
    updatedAt: previous.updatedAt,
  };
}

function mergeOverview(
  previous: OverviewResponse,
  incoming: OverviewResponse,
): OverviewResponse {
  return {
    generatedAt: incoming.generatedAt,
    date: incoming.date,
    sales: retainDomain(previous.sales, incoming.sales),
    inventory: retainDomain(previous.inventory, incoming.inventory),
    flights: retainDomain(previous.flights, incoming.flights),
    schedule: retainDomain(previous.schedule, incoming.schedule),
    concession: retainDomain(previous.concession, incoming.concession),
    connections: retainDomain(previous.connections, incoming.connections),
  };
}

function DomainStatus<T>({
  label,
  result,
}: {
  label: string;
  result: DomainResult<T>;
}) {
  if (result.status === 'error') {
    if (result.data !== null) {
      return (
        <div
          className="mb-5 rounded-md border-l-4 border-accent bg-app-bg px-4 py-3 text-sm leading-6 text-ink"
          role="alert"
        >
          <p>
            {result.message}. Showing last valid data.
          </p>
          {result.updatedAt ? (
            <p className="mt-1 text-xs text-muted">
              Last valid update{' '}
              <time dateTime={result.updatedAt}>
                {formatTimestamp(result.updatedAt)}
              </time>
            </p>
          ) : null}
        </div>
      );
    }
    return (
      <div
        className="mb-5 rounded-md border-l-4 border-danger bg-app-bg px-4 py-3 text-sm leading-6 text-ink"
        role="alert"
      >
        <p className="font-semibold">{result.message}</p>
        <p className="mt-1 text-muted">
          {label} could not be included in this brief. Refresh or open the
          relevant detail page.
        </p>
      </div>
    );
  }

  if (!result.updatedAt) {
    return (
      <p className="mb-5 font-mono text-xs text-muted">
        Update time unavailable
      </p>
    );
  }
  return (
    <div className="mb-5">
      <FreshnessIndicator
        freshness={deriveFreshness(
          result.updatedAt,
          new Date(),
          STALE_AFTER_MINUTES,
        )}
      />
    </div>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      className="terminal-focus inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3.5 text-xs font-semibold text-ink transition-colors duration-150 hover:border-muted hover:bg-app-bg"
      href={href}
    >
      {children}
    </Link>
  );
}

function ErrorData({
  result,
}: {
  result: ErrorDomainResult<unknown>;
}) {
  if (result.data !== null) return null;
  return <p className="text-sm leading-6 text-muted">No last-valid result is available.</p>;
}

function ImportSummary({ data }: { data: ConnectionsOverview }) {
  if (data.overall === 'healthy') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="positive">Automatic imports healthy</Badge>
        <p className="text-sm text-muted">All configured sources are current.</p>
      </div>
    );
  }
  const tone: BadgeTone =
    data.overall === 'not-configured' ? 'danger' : 'warning';
  return (
    <div>
      <Badge tone={tone}>
        {data.overall === 'not-configured'
          ? 'Configuration required'
          : 'Imports need attention'}
      </Badge>
      <ul className="mt-4 space-y-3">
        {data.unhealthySources.map((source) => (
          <li
            className="border-l-2 border-accent pl-3 text-sm leading-6 text-ink"
            key={source.source}
          >
            <span className="font-semibold">
              {source.source.replaceAll('_', ' ')}
            </span>{' '}
            · {source.status}
            {source.lastSuccessAt ? (
              <>
                {' '}
                · last valid{' '}
                <time dateTime={source.lastSuccessAt}>
                  {formatTimestamp(source.lastSuccessAt)}
                </time>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OverviewPage({
  initialResponse,
}: {
  initialResponse?: OverviewResponse;
}) {
  const [overview, setOverview] = useState<OverviewResponse | null>(
    initialResponse ?? null,
  );
  const [loading, setLoading] = useState(!initialResponse);
  const [requestError, setRequestError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const overviewRef = useRef(overview);
  overviewRef.current = overview;

  const loadOverview = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setRequestError(null);
    try {
      const response = await fetch('/api/overview', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Overview request failed (HTTP ${response.status})`);
      }
      const incoming = (await response.json()) as OverviewResponse;
      if (generation !== requestGeneration.current) return;
      setOverview((previous) =>
        previous ? mergeOverview(previous, incoming) : incoming,
      );
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      console.error('[overview] refresh failed:', error);
      setRequestError(
        overviewRef.current
          ? 'The brief could not be refreshed. Last-valid domain results remain visible.'
          : 'The daily brief is unavailable. Retry to load operational data.',
      );
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialResponse) void loadOverview();
    return () => {
      requestGeneration.current += 1;
    };
  }, [initialResponse, loadOverview]);

  const actions = useMemo(
    () => (overview ? deriveActions(overview) : []),
    [overview],
  );

  if (loading && !overview) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <LoadingState label="Loading today’s action brief" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <ErrorState
          actionLabel="Retry brief"
          message={
            requestError ??
            'The daily brief is unavailable. Retry to load operational data.'
          }
          onAction={() => void loadOverview()}
          title="Overview unavailable"
        />
      </div>
    );
  }

  const readyDomains = [
    overview.sales,
    overview.inventory,
    overview.flights,
    overview.schedule,
    overview.concession,
    overview.connections,
  ].filter((domain) => domain.status === 'ready').length;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Button
            aria-label="Refresh brief"
            aria-busy={loading}
            onClick={() => void loadOverview()}
            variant="secondary"
          >
            {loading ? 'Refreshing…' : 'Refresh brief'}
          </Button>
        }
        description="The three highest-priority decisions for airport retail operations today."
        eyebrow="Daily manager brief"
        metadata={
          <>
            <span>{formatDate(overview.date)}</span>
            <span aria-hidden="true">·</span>
            <span>{readyDomains} of 6 domains available</span>
          </>
        }
        title="Today’s action brief"
      />

      {requestError ? (
        <section
          className="rounded-lg border-l-4 border-danger bg-surface p-4 text-sm leading-6 text-ink"
          role="alert"
        >
          {requestError}
        </section>
      ) : null}

      <TrafficWindow
        flights={overview.flights}
        sales={overview.sales}
        schedule={overview.schedule}
      />

      <section aria-labelledby="priority-actions-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Decision queue
            </p>
            <h2
              className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl"
              id="priority-actions-title"
            >
              Priority actions
            </h2>
          </div>
          <p className="text-sm text-muted">Highest impact first · maximum 3</p>
        </div>
        {actions.length ? (
          <ul
            aria-label="Priority actions"
            className="grid gap-4 lg:grid-cols-3"
          >
            {actions.map((action) => (
              <ActionCard action={action} key={action.id} />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-line bg-surface p-5 text-sm leading-6 text-muted">
            No priority action can be derived from the currently available
            domains. Review unavailable sources before treating the day as
            clear.
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          actions={<PanelLink href={`/dashboard/sales?date=${overview.date}`}>Open sales</PanelLink>}
          description="Reported performance and comparison pace."
          title="Sales pace"
        >
          <DomainStatus label="Sales" result={overview.sales} />
          {overview.sales.data?.hasData &&
          overview.sales.data.revenue !== null ? (
            <div className="grid gap-5 sm:grid-cols-3">
              <Metric
                detail="Reported today"
                label="Revenue"
                tone={
                  (overview.sales.data.comparisonPercent ?? 0) > 0
                    ? 'positive'
                    : 'default'
                }
                value={formatCurrency(overview.sales.data.revenue)}
              />
              <Metric
                detail="Reported tickets"
                label="Transactions"
                value={overview.sales.data.tickets?.toLocaleString('en-CA') ?? '—'}
              />
              <Metric
                detail="Per transaction"
                label="Average"
                value={
                  overview.sales.data.averageTransaction === null
                    ? '—'
                    : formatCurrency(overview.sales.data.averageTransaction)
                }
              />
            </div>
          ) : overview.sales.status === 'error' ? (
            <ErrorData result={overview.sales} />
          ) : (
            <p className="text-sm leading-6 text-muted">
              No sales report has arrived for today. Automatic imports remain
              the default source.
            </p>
          )}
        </Panel>

        <Panel
          actions={<PanelLink href={`/dashboard/flights?date=${overview.date}`}>Open flights</PanelLink>}
          description="Upcoming departures and passenger demand."
          title="Upcoming traffic"
        >
          <DomainStatus label="Flights" result={overview.flights} />
          {overview.flights.data?.hasData &&
          overview.flights.data.flights.length > 0 ? (
            <ul className="divide-y divide-line">
              {overview.flights.data.flights.slice(0, 3).map((flight) => (
                <li
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0"
                  key={flight.id}
                >
                  <time
                    className="font-mono text-sm font-semibold text-ink"
                    dateTime={flight.scheduledAt}
                  >
                    {flight.scheduledAt}
                  </time>
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      {flight.flightNumber}
                    </span>
                    <span className="block text-xs text-muted">
                      {flight.direction}
                    </span>
                  </span>
                  <span className="font-mono text-sm text-muted">
                    {flight.estimatedPassengers.toLocaleString('en-CA')} pax
                  </span>
                </li>
              ))}
            </ul>
          ) : overview.flights.status === 'error' ? (
            <ErrorData result={overview.flights} />
          ) : overview.flights.data?.hasData ? (
            <p className="text-sm leading-6 text-muted">
              Today&apos;s remaining flight window is clear.
            </p>
          ) : (
            <p className="text-sm leading-6 text-muted">
              No flight schedule is available for today.
            </p>
          )}
        </Panel>

        <Panel
          actions={<PanelLink href={`/dashboard/schedules?date=${overview.date}`}>Open schedule</PanelLink>}
          description="People scheduled against high-value departures."
          title="Staff coverage"
        >
          <DomainStatus label="Staff coverage" result={overview.schedule} />
          {overview.schedule.data?.hasData ? (
            <div className="grid gap-5 sm:grid-cols-3">
              <Metric
                detail="High-value departures"
                label="Coverage"
                tone={
                  (overview.schedule.data.coverageScore ?? 0) < 75
                    ? 'danger'
                    : (overview.schedule.data.coverageScore ?? 0) < 90
                      ? 'warning'
                      : 'positive'
                }
                value={
                  overview.schedule.data.coverageScore === null
                    ? '—'
                    : `${overview.schedule.data.coverageScore}%`
                }
              />
              <Metric
                detail="Scheduled today"
                label="Staff"
                value={overview.schedule.data.staffOnDuty ?? '—'}
              />
              <Metric
                detail="High-value windows"
                label="Gaps"
                tone={overview.schedule.data.gaps.length ? 'danger' : 'positive'}
                value={overview.schedule.data.gaps.length}
              />
            </div>
          ) : overview.schedule.status === 'error' ? (
            <ErrorData result={overview.schedule} />
          ) : (
            <p className="text-sm leading-6 text-muted">
              No current staff schedule is available. Review the scheduling
              workspace before the next passenger peak.
            </p>
          )}
        </Panel>

        <Panel
          actions={<PanelLink href="/dashboard/inventory">Open inventory</PanelLink>}
          description="Stockout exposure and capital tied up in slow movers."
          title="Inventory actions"
        >
          <DomainStatus label="Inventory" result={overview.inventory} />
          {overview.inventory.data?.hasData ? (
            <div className="grid gap-5 sm:grid-cols-3">
              <Metric
                detail="Reorder now"
                label="Critical"
                tone={
                  overview.inventory.data.criticalCount ? 'danger' : 'positive'
                }
                value={overview.inventory.data.criticalCount ?? '—'}
              />
              <Metric
                detail="Monitor closely"
                label="At risk"
                tone={
                  overview.inventory.data.atRiskCount ? 'warning' : 'positive'
                }
                value={overview.inventory.data.atRiskCount ?? '—'}
              />
              <Metric
                detail="Slow-moving value"
                label="Dead stock"
                value={
                  overview.inventory.data.deadStockValue === null
                    ? '—'
                    : formatCurrency(overview.inventory.data.deadStockValue)
                }
              />
            </div>
          ) : overview.inventory.status === 'error' ? (
            <ErrorData result={overview.inventory} />
          ) : (
            <p className="text-sm leading-6 text-muted">
              No inventory snapshot has been received. Open Data Connections
              for the automatic source and recovery path.
            </p>
          )}
        </Panel>
      </div>

      <Panel
        actions={<PanelLink href="/dashboard/connections">Open Data Connections</PanelLink>}
        description="Hourly ingestion remains the default; manual upload is recovery only."
        title="Automatic import health"
      >
        <DomainStatus
          label="Automatic imports"
          result={overview.connections}
        />
        {overview.connections.data ? (
          <ImportSummary data={overview.connections.data} />
        ) : overview.connections.status === 'error' ? (
          <ErrorData result={overview.connections} />
        ) : null}
      </Panel>
    </div>
  );
}
