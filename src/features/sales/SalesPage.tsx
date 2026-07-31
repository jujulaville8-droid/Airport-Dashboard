'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/DataState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { lastDayOfMonth, todayYmd } from '@/lib/date-utils';
import { SalesAnalysis } from './SalesAnalysis';
import { SalesCoverage } from './SalesCoverage';
import { SalesSummary } from './SalesSummary';
import { SalesTrend } from './SalesTrend';
import type { MonthlySales, SalesApiResponse, SalesData, SalesDay, SalesMeta, SalesScreenState } from './types';

function unwrap<T>(payload: T | SalesApiResponse<T>): { data: T; meta: SalesMeta | null } {
  if (payload && typeof payload === 'object' && 'data' in payload && 'meta' in payload) {
    const response = payload as SalesApiResponse<T>;
    return { data: response.data, meta: response.meta };
  }
  return { data: payload as T, meta: null };
}

function monthRange(month: string): { startDate: string; endDate: string } {
  return { startDate: `${month}-01`, endDate: `${month}-${lastDayOfMonth(month)}` };
}

export function SalesPage({ initialState }: { initialState?: SalesScreenState }) {
  const [date, setDate] = useState(() => initialState?.kind === 'empty' || initialState?.kind === 'error' || initialState?.kind === 'loading' ? initialState.date : initialState?.data.daily.date ?? todayYmd());
  const [state, setState] = useState<SalesScreenState>(initialState ?? { kind: 'loading', date: todayYmd() });
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const requestGeneration = useRef(0);

  const load = useCallback(async (nextDate: string) => {
    const generation = ++requestGeneration.current;
    const existing = state.kind === 'ready' || state.kind === 'stale' ? state.data : null;
    if (!existing) setState({ kind: 'loading', date: nextDate });
    try {
      const dailyResponse = await fetch(`/api/sales/daily?date=${nextDate}`, { cache: 'no-store' });
      if (!dailyResponse.ok) throw new Error('Sales reports could not be refreshed.');
      const dailyPayload = unwrap(await dailyResponse.json() as SalesDay | SalesApiResponse<SalesDay>);
      const monthsResponse = await fetch('/api/sales/months', { cache: 'no-store' });
      if (!monthsResponse.ok) throw new Error('Monthly sales reports could not be refreshed.');
      const monthsPayload = unwrap(await monthsResponse.json() as { summaries: SalesData['months']; latestMonth: string | null } | SalesApiResponse<{ summaries: SalesData['months']; latestMonth: string | null }>);
      const selected = monthsPayload.data.latestMonth;
      let selectedMonth: MonthlySales | null = null;
      let monthlyMeta: SalesMeta | undefined = monthsPayload.meta ?? undefined;
      let monthlyError: string | null = null;
      if (selected) {
        const range = monthRange(selected);
        const queryResponse = await fetch(`/api/sales/query?startDate=${range.startDate}&endDate=${range.endDate}`, { cache: 'no-store' });
        if (queryResponse.ok) {
          const queryPayload = unwrap(await queryResponse.json() as MonthlySales | SalesApiResponse<MonthlySales>);
          selectedMonth = queryPayload.data;
          monthlyMeta = queryPayload.meta ?? monthlyMeta;
        } else {
          monthlyError = 'Monthly sales results could not be refreshed.';
          selectedMonth = existing?.selectedMonth ?? null;
          monthlyMeta = existing?.monthlyMeta ?? monthlyMeta;
        }
      }
      if (generation !== requestGeneration.current) return;
      const data: SalesData = {
        daily: dailyPayload.data,
        months: monthsPayload.data.summaries ?? [],
        selectedMonth,
        dailyMeta: dailyPayload.meta ?? undefined,
        monthlyMeta,
      };
      setState(monthlyError ? { kind: 'stale', data, message: monthlyError } : { kind: 'ready', data });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      const message = error instanceof Error ? error.message : 'Sales reports could not be refreshed.';
      setState(existing ? { kind: 'stale', data: existing, message } : { kind: 'error', date: nextDate, message });
    }
  }, [state]);

  useEffect(() => {
    if (!initialState) void load(date);
  // The fetch only belongs to the uncontrolled mode; `load` intentionally reads the current state for stale retention.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, initialState]);

  const data = state.kind === 'ready' || state.kind === 'stale' ? state.data : null;
  const selectedMonth = data?.selectedMonth ?? null;
  const activeDaily = data?.daily ?? null;
  const monthlyLabel = useMemo(() => selectedMonth?.startDate.slice(0, 7) ?? null, [selectedMonth]);

  const header = (
    <PageHeader
      eyebrow="Commerce"
      title="Sales reporting"
      description="Automatic Counterpoint reports are the source of record. Review exceptions here; recover an import only in Data Connections."
      actions={<><Button onClick={() => void load(date)} variant="secondary">Refresh reports</Button><Link className="terminal-focus inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-app-bg" href="/dashboard/connections">Data Connections</Link></>}
    />
  );

  if (state.kind === 'loading') return <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10"><LoadingState label="Loading sales reports" /></div>;
  if (state.kind === 'error') return <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 space-y-6">{header}<ErrorState title="Sales reports unavailable" message={state.message} actionLabel="Retry reports" onAction={() => void load(date)} /></div>;
  if (state.kind === 'empty') return <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 space-y-6">{header}<EmptyState title="No sales report has arrived for this day" message="Automatic Gmail imports check every hour. If the report needs recovery, use Data Connections." actionLabel="Open connections" onAction={() => { window.location.assign('/dashboard/connections'); }} /></div>;

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      {header}
      {state.kind === 'stale' ? <section className="rounded-md border-l-4 border-danger bg-surface p-4 text-sm text-ink" role="alert">{state.message} Showing the last successful sales results.</section> : null}
      <div className="flex flex-wrap items-center gap-2 border-b border-line" role="tablist" aria-label="Sales report view">
        <Button aria-selected={tab === 'daily'} onClick={() => setTab('daily')} role="tab" variant={tab === 'daily' ? 'primary' : 'ghost'}>Daily</Button>
        <Button aria-selected={tab === 'monthly'} onClick={() => setTab('monthly')} role="tab" variant={tab === 'monthly' ? 'primary' : 'ghost'}>Monthly</Button>
      </div>
      {tab === 'daily' && activeDaily ? <>
        <div className="flex flex-wrap items-center gap-3"><label className="text-sm font-semibold text-ink" htmlFor="sales-date">Report date</label><input className="terminal-focus min-h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink" id="sales-date" onChange={(event) => { setDate(event.target.value); if (!initialState) void load(event.target.value); }} type="date" value={date} /><span className="text-sm text-muted">{activeDaily.dayName}</span></div>
        {activeDaily.today.hasData ? <><SalesSummary daily={activeDaily} /><div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"><Panel title="Seven-day sales pace" description="Received reports only."><div className="overflow-x-auto"><SalesTrend daily={activeDaily} /></div></Panel><Panel title="Daily comparison" description="Same weekday and last week."><SalesCoverage daily={activeDaily} meta={data?.dailyMeta ?? null} /></Panel></div></> : <EmptyState title="No sales report has arrived for this day" message="Automatic Gmail imports check every hour. Monthly history remains available above." actionLabel="Open connections" onAction={() => { window.location.assign('/dashboard/connections'); }} />}
      </> : null}
      {tab === 'monthly' ? <>
        {!selectedMonth ? <EmptyState title="No monthly sales reports yet" message="Monthly reporting will appear after automatic imports arrive." actionLabel="Open connections" onAction={() => { window.location.assign('/dashboard/connections'); }} /> : <>
          <SalesSummary monthly={selectedMonth} />
          <Panel title="Monthly revenue trend" description={monthlyLabel ? `Daily reports for ${monthlyLabel}.` : undefined}><div className="overflow-x-auto"><SalesTrend monthly={selectedMonth} /></div></Panel>
          <Panel title="Analysis" description="Run analysis only when you need a written review of the selected month."><SalesAnalysis month={monthlyLabel} /></Panel>
        </>}
      </> : null}
    </main>
  );
}
