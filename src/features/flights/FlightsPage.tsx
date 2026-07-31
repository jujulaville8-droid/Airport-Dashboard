'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, LoadingState } from '@/components/ui/DataState';
import { Metric } from '@/components/ui/Metric';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';

type Flight = {
  id: string;
  flight_num: string;
  airline_code: string | null;
  scheduled_time: string;
  flight_type: string;
  estimated_passengers: number | null;
  actual_passengers: number | null;
  origin_destination: string | null;
  status: string | null;
  gate: string | null;
};

type FlightSource = {
  provider: 'AeroDataBox';
  status: 'fresh' | 'updated' | 'in-progress' | 'failed' | 'not-configured';
  records: number;
  lastSuccessAt: string | null;
  message: string | null;
};

type Analytics = {
  totalDepartures: number;
  totalPassengers: number;
  avgDailyPax: number;
  busiestDay: { date: string; dayOfWeek: string; passengers: number } | null;
  dayOfWeekAvg: { day: string; avgPassengers: number }[];
};

function formatRefresh(source: FlightSource | null): string {
  if (!source) return 'Refresh state unavailable';
  if (source.status === 'updated') return `Refreshed now · ${source.records} departures`;
  if (source.status === 'in-progress') return 'Refresh in progress · showing stored data';
  if (source.status === 'not-configured') return 'Provider setup required';
  if (source.status === 'failed') return source.message ?? 'Refresh failed · showing stored data';
  if (!source.lastSuccessAt) return source.message ?? 'Showing stored data';
  const date = new Date(source.lastSuccessAt);
  return Number.isNaN(date.getTime())
    ? 'Showing recently refreshed data'
    : `Last refreshed ${new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
}

export function FlightsPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [flights, setFlights] = useState<Flight[] | null>(null);
  const [source, setSource] = useState<FlightSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [airline, setAirline] = useState('all');
  const [pdf, setPdf] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    fetch(`/api/flights/day?date=${date}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = (await response.json()) as { flights: Flight[]; source: FlightSource };
        if (current === generation.current) {
          setFlights(payload.flights);
          setSource(payload.source);
          setError(null);
        }
      })
      .catch(() => {
        if (current === generation.current) {
          setFlights([]);
          setError('Flight board could not be refreshed.');
        }
      });
  }, [date]);

  useEffect(() => {
    fetch(`/api/flights/analytics?month=${date.slice(0, 7)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setAnalytics(await response.json());
      })
      .catch(() => setAnalytics(null));
  }, [date]);

  const shown = useMemo(
    () => (flights ?? []).filter((flight) =>
      airline === 'all' || flight.airline_code === airline),
    [flights, airline],
  );
  const airlines = [...new Set((flights ?? []).map((flight) => flight.airline_code).filter(Boolean))] as string[];
  const estimate = shown.reduce((sum, flight) => sum + (flight.estimated_passengers ?? 0), 0);
  const actual = shown.reduce((sum, flight) => sum + (flight.actual_passengers ?? 0), 0);

  const viewPdf = async () => {
    const response = await fetch(`/api/flights/file?month=${date.slice(0, 7)}`);
    if (!response.ok) {
      setError('No legacy source PDF is available for this month.');
      return;
    }
    setPdf((await response.json()).signedUrl);
  };

  if (!flights) {
    return <main className="mx-auto max-w-[1440px] p-6"><LoadingState label="Refreshing departures" /></main>;
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        actions={(
          <>
            <Button onClick={() => void viewPdf()} variant="secondary">View legacy PDF</Button>
            <Link className="terminal-focus inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-semibold" href="/dashboard/connections">Data Connections</Link>
          </>
        )}
        description="Live and forward-looking ANU departures for staffing and passenger planning."
        eyebrow="Airside intelligence"
        metadata={(
          <>
            <Badge tone={source?.status === 'failed' || source?.status === 'not-configured' ? 'warning' : 'positive'}>
              AeroDataBox departures
            </Badge>
            <span>{formatRefresh(source)}</span>
          </>
        )}
        title="Departure board"
      />

      <div className="flex flex-wrap gap-3">
        <input aria-label="Board date" className="min-h-11 rounded-md border border-line px-3" type="date" value={date} onChange={(event) => { setFlights(null); setDate(event.target.value); }} />
        <select aria-label="Airline" className="min-h-11 rounded-md border border-line px-3" value={airline} onChange={(event) => setAirline(event.target.value)}>
          <option value="all">All airlines</option>
          {airlines.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>

      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Departures" value={shown.length} />
        <Metric label="Estimated passengers" value={estimate.toLocaleString()} />
        <Metric label="Actual passengers" tone="positive" value={actual ? actual.toLocaleString() : 'Awaiting carrier data'} />
      </section>

      {analytics ? (
        <Panel title="Monthly traffic forecast" description="Month-wide demand patterns support staffing and replenishment planning.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Average daily passengers" value={analytics.avgDailyPax.toLocaleString()} />
            <Metric label="Monthly departures" value={analytics.totalDepartures} />
            <Metric label="Busiest day" tone="warning" value={analytics.busiestDay ? `${analytics.busiestDay.dayOfWeek} · ${analytics.busiestDay.passengers.toLocaleString()}` : 'No data'} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {analytics.dayOfWeekAvg.map((day) => (
              <div className="border-l-2 border-accent pl-3" key={day.day}>
                <strong>{day.day.slice(0, 3)}</strong>
                <p className="font-mono text-muted">{day.avgPassengers.toLocaleString()} pax</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="Operations board" description="Scheduled ANU departures, destinations, and operational status.">
        {shown.length ? (
          <div className="divide-y divide-line">
            {shown.map((flight) => (
              <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={flight.id}>
                <div>
                  <strong>{flight.scheduled_time.slice(11, 16)} · {flight.flight_num}</strong>
                  <span className="ml-3 text-sm text-muted">{flight.airline_code ?? 'Airline pending'}</span>
                  <p className="mt-1 text-sm text-muted">Destination <span className="font-mono font-semibold text-ink">{flight.origin_destination ?? 'TBD'}</span>{flight.gate ? ` · Gate ${flight.gate}` : ''}</p>
                </div>
                <div className="text-left sm:text-right">
                  <Badge tone={flight.status === 'cancelled' ? 'danger' : flight.status === 'delayed' ? 'warning' : 'neutral'}>{flight.status ?? 'scheduled'}</Badge>
                  <p className="mt-2 font-mono text-xs text-muted">est {flight.estimated_passengers ?? 0} · actual {flight.actual_passengers ?? '—'}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No departures found" message="Try another date or check the provider status in Data Connections." />
        )}
      </Panel>

      {pdf ? <Panel title="Legacy source schedule PDF"><iframe className="h-[38rem] w-full" src={pdf} title="Flight schedule source PDF" /></Panel> : null}
    </main>
  );
}
