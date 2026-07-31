'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/DataState';
import { PageHeader } from '@/components/ui/PageHeader';
import { deriveFreshness } from '@/lib/ui/data-state';
import { ActionCard } from './ActionCard';
import { deriveActions } from './derive-actions';
import { ImportHealthPanel } from './ImportHealthPanel';
import { InventoryActionPanel } from './InventoryActionPanel';
import { formatOverviewDate } from './panel-shared';
import { SalesPacePanel } from './SalesPacePanel';
import { StaffCoveragePanel } from './StaffCoveragePanel';
import { TrafficWindow } from './TrafficWindow';
import type { DomainResult, OverviewResponse } from './types';
import { UpcomingTrafficPanel } from './UpcomingTrafficPanel';

const STALE_AFTER_MINUTES = 24 * 60;

function retainDomain<T>(
  previous: DomainResult<T>,
  incoming: DomainResult<T>,
): DomainResult<T> {
  if (incoming.status === 'ready' || previous.data === null) return incoming;
  return { ...incoming, data: previous.data, updatedAt: previous.updatedAt };
}

function mergeOverview(
  previous: OverviewResponse,
  incoming: OverviewResponse,
): OverviewResponse {
  const sameDay = previous.date === incoming.date;
  const sameMonth = previous.date.slice(0, 7) === incoming.date.slice(0, 7);
  return {
    generatedAt: incoming.generatedAt,
    date: incoming.date,
    sales: sameDay ? retainDomain(previous.sales, incoming.sales) : incoming.sales,
    inventory: retainDomain(previous.inventory, incoming.inventory),
    flights: sameDay ? retainDomain(previous.flights, incoming.flights) : incoming.flights,
    schedule: sameDay ? retainDomain(previous.schedule, incoming.schedule) : incoming.schedule,
    concession: sameMonth ? retainDomain(previous.concession, incoming.concession) : incoming.concession,
    connections: retainDomain(previous.connections, incoming.connections),
  };
}

function antiguaGreeting(now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat('en-CA', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: 'America/Antigua',
    }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function availabilitySummary(overview: OverviewResponse, now: Date) {
  const domains = [
    overview.sales,
    overview.inventory,
    overview.flights,
    overview.schedule,
    overview.concession,
    overview.connections,
  ];
  let current = 0;
  let stale = 0;
  let unavailable = 0;
  let unknown = 0;
  for (const domain of domains) {
    if (domain.status === 'error') {
      unavailable += 1;
    } else if (!domain.updatedAt) {
      unknown += 1;
    } else if (
      deriveFreshness(domain.updatedAt, now, STALE_AFTER_MINUTES).kind ===
      'stale'
    ) {
      stale += 1;
    } else {
      current += 1;
    }
  }
  return [
    `${current} current`,
    `${stale} stale`,
    ...(unknown ? [`${unknown} time unknown`] : []),
    `${unavailable} unavailable`,
  ].join(' · ');
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
          message={requestError ?? 'The daily brief is unavailable. Retry to load operational data.'}
          onAction={() => void loadOverview()}
          title="Overview unavailable"
        />
      </div>
    );
  }

  const now = new Date();
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <Button aria-label="Refresh brief" aria-busy={loading} onClick={() => void loadOverview()} variant="secondary">
            {loading ? 'Refreshing…' : 'Refresh brief'}
          </Button>
        }
        description="The three highest-priority decisions for airport retail operations today."
        eyebrow={antiguaGreeting(now)}
        metadata={
          <>
            <span>{formatOverviewDate(overview.date, true)}</span>
            <span aria-hidden="true">·</span>
            <span>{availabilitySummary(overview, now)}</span>
          </>
        }
        title="Today’s action brief"
      />

      {requestError ? <section className="rounded-lg border-l-4 border-danger bg-surface p-4 text-sm leading-6 text-ink" role="alert">{requestError}</section> : null}

      <TrafficWindow flights={overview.flights} sales={overview.sales} schedule={overview.schedule} />

      <section aria-labelledby="priority-actions-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">Decision queue</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl" id="priority-actions-title">Priority actions</h2>
          </div>
          <p className="text-sm text-muted">Highest impact first · maximum 3</p>
        </div>
        {actions.length ? (
          <ul aria-label="Priority actions" className="grid gap-4 lg:grid-cols-3">
            {actions.map((action) => <ActionCard action={action} key={action.id} />)}
          </ul>
        ) : (
          <div className="rounded-lg border border-line bg-surface p-5 text-sm leading-6 text-muted">
            No priority action can be derived from the currently available domains. Review unavailable sources before treating the day as clear.
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <SalesPacePanel date={overview.date} result={overview.sales} />
        <UpcomingTrafficPanel date={overview.date} result={overview.flights} />
        <StaffCoveragePanel date={overview.date} result={overview.schedule} />
        <InventoryActionPanel result={overview.inventory} />
      </div>
      <ImportHealthPanel result={overview.connections} />
    </div>
  );
}
