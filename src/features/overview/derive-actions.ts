import type {
  DomainResult,
  OverviewAction,
  OverviewResponse,
} from './types';

function dataFrom<T>(result: DomainResult<T>): T | null {
  return result.data;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function formatCurrency(value: number, currency: 'USD' | 'ECD' = 'USD') {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function importSourceLabel(source: string) {
  return source.replaceAll('_', ' ');
}

export function deriveActions(response: OverviewResponse): OverviewAction[] {
  const candidates: OverviewAction[] = [];
  const inventory = dataFrom(response.inventory);
  const schedule = dataFrom(response.schedule);
  const connections = dataFrom(response.connections);
  const concession = dataFrom(response.concession);
  const flights = dataFrom(response.flights);
  const sales = dataFrom(response.sales);

  if (
    inventory?.hasData &&
    inventory.criticalCount !== null &&
    inventory.criticalCount > 0
  ) {
    candidates.push({
      id: 'critical-inventory',
      kind: 'critical-inventory',
      level: 'act-now',
      title: `${inventory.criticalCount} critical inventory ${plural(inventory.criticalCount, 'item')}`,
      detail: 'Stock is below its safe operating range. Review the critical list before the next traffic window.',
      href: '/dashboard/inventory?risk=CRITICAL',
    });
  }

  const uncoveredFlight = schedule?.gaps
    .filter((gap) => gap.passengers >= 100)
    .sort(
      (a, b) =>
        b.passengers - a.passengers ||
        a.scheduledAt.localeCompare(b.scheduledAt),
    )[0];
  if (uncoveredFlight) {
    const search = new URLSearchParams({
      date: response.date,
      type: 'departure',
      airline: uncoveredFlight.airline,
    });
    candidates.push({
      id: `uncovered-flight-${uncoveredFlight.flightNumber}`,
      kind: 'uncovered-flight',
      level: 'act-now',
      title: `${uncoveredFlight.flightNumber} is outside staff coverage`,
      detail: `${uncoveredFlight.passengers.toLocaleString('en-CA')} estimated passengers depart at ${uncoveredFlight.scheduledAt}.`,
      href: `/dashboard/flights?${search.toString()}`,
    });
  }

  const unhealthyImport = connections?.unhealthySources
    .filter((source) => source.status === 'failed' || source.status === 'stale')
    .slice()
    .sort((a, b) => {
      const rank = { failed: 0, stale: 1, never: 2 };
      return rank[a.status] - rank[b.status] ||
        a.source.localeCompare(b.source);
    })[0];
  if (unhealthyImport) {
    const failed = unhealthyImport.status === 'failed';
    candidates.push({
      id: `import-health-${unhealthyImport.source}`,
      kind: 'import-health',
      level: failed ? 'act-now' : 'watch',
      title: `${importSourceLabel(unhealthyImport.source)} import ${failed ? 'failed' : 'is stale'}`,
      detail:
        unhealthyImport.message ??
        'Open Data Connections to review the automatic source and recovery steps.',
      href: '/dashboard/connections',
    });
  }

  if (
    concession?.hasData &&
    concession.exceedsThreshold === true &&
    concession.payableEcd !== null
  ) {
    candidates.push({
      id: 'concession-threshold',
      kind: 'concession-threshold',
      level: 'watch',
      title: 'Concession percentage threshold exceeded',
      detail: `${formatCurrency(concession.payableEcd, 'ECD')} is payable above the monthly MAG.`,
      href: `/dashboard/concession?month=${encodeURIComponent(concession.month)}`,
    });
  }

  if (
    inventory?.hasData &&
    inventory.atRiskCount !== null &&
    inventory.atRiskCount > 0
  ) {
    candidates.push({
      id: 'at-risk-inventory',
      kind: 'at-risk-inventory',
      level: 'watch',
      title: `${inventory.atRiskCount} inventory ${plural(inventory.atRiskCount, 'item')} at risk`,
      detail: 'These items are approaching their reorder point or lead-time coverage.',
      href: '/dashboard/inventory?risk=AT_RISK',
    });
  }

  if (
    flights?.hasData &&
    flights.nextPeakAt &&
    flights.peakPassengers !== null &&
    flights.peakPassengers >= 100
  ) {
    const search = new URLSearchParams({
      date: response.date,
      type: 'departure',
    });
    candidates.push({
      id: 'passenger-peak',
      kind: 'passenger-peak',
      level: 'watch',
      title: `${flights.peakPassengers.toLocaleString('en-CA')} passengers expected at ${flights.nextPeakAt}`,
      detail: 'Use the upcoming departure window to align the floor and selling focus.',
      href: `/dashboard/flights?${search.toString()}`,
    });
  }

  if (
    sales?.hasData &&
    sales.revenue !== null &&
    sales.comparisonPercent !== null &&
    sales.comparisonPercent > 0
  ) {
    candidates.push({
      id: 'positive-sales',
      kind: 'positive-sales',
      level: 'on-track',
      title: `Sales pace is ${sales.comparisonPercent}% ahead`,
      detail: `${formatCurrency(sales.revenue)} reported today. Keep the current selling rhythm.`,
      href: `/dashboard/sales?date=${encodeURIComponent(response.date)}`,
    });
  }

  const selected: OverviewAction[] = [];
  let includedOnTrack = false;
  for (const candidate of candidates) {
    if (candidate.level === 'on-track' && includedOnTrack) continue;
    selected.push(candidate);
    if (candidate.level === 'on-track') includedOnTrack = true;
    if (selected.length === 3) break;
  }
  return selected;
}
