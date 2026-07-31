import { Panel } from '@/components/ui/Panel';
import { DomainStatus, ErrorData, PanelLink } from './panel-shared';
import type { DomainResult, FlightsOverview } from './types';

export function UpcomingTrafficPanel({ date, result }: { date: string; result: DomainResult<FlightsOverview> }) {
  return (
    <Panel actions={<PanelLink href={`/dashboard/flights?date=${date}`}>Open flights</PanelLink>} description="Upcoming departures and passenger demand." title="Upcoming traffic">
      <DomainStatus label="Flights" result={result} />
      {result.data?.hasData && result.data.flights.length > 0 ? (
        <ul className="divide-y divide-line">
          {result.data.flights.slice(0, 3).map((flight) => (
            <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0" key={flight.id}>
              <time className="font-mono text-sm font-semibold text-ink" dateTime={flight.scheduledAt}>{flight.scheduledAt}</time>
              <span className="min-w-0"><span className="block font-semibold text-ink">{flight.flightNumber}</span><span className="block text-xs text-muted">{flight.direction}</span></span>
              <span className="font-mono text-sm text-muted">{flight.estimatedPassengers.toLocaleString('en-CA')} pax</span>
            </li>
          ))}
        </ul>
      ) : result.status === 'error' ? (
        <ErrorData result={result} />
      ) : result.data?.hasData ? (
        <p className="text-sm leading-6 text-muted">Today&apos;s remaining flight window is clear.</p>
      ) : (
        <p className="text-sm leading-6 text-muted">No flight schedule is available for today.</p>
      )}
    </Panel>
  );
}
