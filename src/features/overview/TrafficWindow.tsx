import type {
  DomainResult,
  FlightsOverview,
  SalesOverview,
  ScheduleOverview,
} from './types';

function usable<T>(result: DomainResult<T>): T | null {
  return result.data;
}

function Signal({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <div className="min-w-0 px-5 py-5 sm:px-6 sm:py-6">
      <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-accent uppercase">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-[-0.03em] text-surface tabular-nums sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-surface/70">{detail}</p>
    </div>
  );
}

export function TrafficWindow({
  flights,
  schedule,
  sales,
}: {
  flights: DomainResult<FlightsOverview>;
  schedule: DomainResult<ScheduleOverview>;
  sales: DomainResult<SalesOverview>;
}) {
  const flightData = usable(flights);
  const scheduleData = usable(schedule);
  const salesData = usable(sales);

  const peak =
    flightData?.hasData &&
    flightData.nextPeakAt &&
    flightData.peakPassengers !== null
      ? {
          time: flightData.nextPeakAt,
          passengers: `${flightData.peakPassengers.toLocaleString('en-CA')} passengers`,
        }
      : null;
  const coverage =
    scheduleData?.hasData && scheduleData.coverageScore !== null
      ? `${scheduleData.coverageScore}%`
      : null;
  const pace =
    salesData?.hasData && salesData.comparisonPercent !== null
      ? `${salesData.comparisonPercent > 0 ? '+' : ''}${salesData.comparisonPercent}%`
      : null;

  return (
    <section
      aria-label="Traffic window"
      className="overflow-hidden rounded-lg border border-nav bg-nav shadow-sm"
    >
      <div className="border-b border-surface/15 px-5 py-3 sm:px-6">
        <p className="font-display text-lg font-semibold text-surface">
          Traffic window
        </p>
        <p className="mt-0.5 text-xs leading-5 text-surface/70">
          Passenger demand, floor coverage, and today&apos;s selling pace in
          one operational line.
        </p>
      </div>
      <div className="grid divide-y divide-surface/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Signal
          detail={peak?.passengers ?? 'No upcoming departure peak reported'}
          label="Next passenger peak"
          value={
            peak ? <time dateTime={peak.time}>{peak.time}</time> : '—'
          }
        />
        <Signal
          detail={
            scheduleData?.hasData
              ? `${scheduleData.staffOnDuty ?? '—'} staff scheduled`
              : 'No current schedule is available'
          }
          label="High-value coverage"
          value={coverage ?? '—'}
        />
        <Signal
          detail={
            salesData?.hasData
              ? 'Compared with the same day last week'
              : 'No sales report has arrived for today'
          }
          label="Sales pace"
          value={pace ?? '—'}
        />
      </div>
    </section>
  );
}
