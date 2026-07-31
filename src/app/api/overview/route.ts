import type {
  ConcessionOverview,
  ConnectionsOverview,
  DomainResult,
  FlightsOverview,
  InventoryOverview,
  OverviewFlight,
  OverviewResponse,
  OverviewShift,
  SalesOverview,
  ScheduleOverview,
} from '@/features/overview/types';
import type { ImportSource, ImportSourceHealth } from '@/lib/import-health';

export const dynamic = 'force-dynamic';

type DomainName =
  | 'sales'
  | 'inventory'
  | 'flights'
  | 'schedule'
  | 'concession'
  | 'connections';

interface AirportClock {
  date: string;
  minutes: number;
}

const DOMAIN_MESSAGES: Record<DomainName, string> = {
  sales: 'Sales data unavailable',
  inventory: 'Inventory data unavailable',
  flights: 'Flight data unavailable',
  schedule: 'Staff coverage unavailable',
  concession: 'Concession data unavailable',
  connections: 'Automatic import health unavailable',
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function timeOfDay(value: unknown): string | null {
  const text = stringValue(value);
  const match = text?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function getAirportClock(now: Date): AirportClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Antigua',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

async function fetchJson(
  request: Request,
  pathname: string,
): Promise<unknown> {
  const url = new URL(pathname, request.url);
  const cookie = request.headers.get('cookie');
  const response = await fetch(url, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  });
  if (!response.ok) {
    throw new Error(`${url.pathname} returned HTTP ${response.status}`);
  }
  return response.json();
}

function failed<T>(name: DomainName, reason: unknown): DomainResult<T> {
  console.error(`[api/overview] ${name} request failed:`, reason);
  return {
    status: 'error',
    data: null,
    updatedAt: null,
    message: DOMAIN_MESSAGES[name],
  };
}

function normalize<T>(
  name: DomainName,
  result: PromiseSettledResult<unknown>,
  transform: (value: unknown) => T,
): DomainResult<T> {
  if (result.status === 'rejected') return failed<T>(name, result.reason);
  try {
    return {
      status: 'ready',
      data: transform(result.value),
      updatedAt: null,
    };
  } catch (error) {
    return failed<T>(name, error);
  }
}

function normalizeSales(value: unknown): SalesOverview {
  const root = record(value);
  const today = record(root?.today);
  if (!root || !today || typeof today.hasData !== 'boolean') {
    throw new Error('Daily sales response is malformed');
  }
  if (!today.hasData) {
    return {
      hasData: false,
      revenue: null,
      tickets: null,
      averageTransaction: null,
      comparisonPercent: null,
    };
  }

  const revenue = finiteNumber(today.sales);
  const tickets = finiteNumber(today.tickets);
  const averageTransaction = finiteNumber(today.avgTransaction);
  if (revenue === null || tickets === null || averageTransaction === null) {
    throw new Error('Daily sales response is missing reported totals');
  }
  return {
    hasData: true,
    revenue,
    tickets,
    averageTransaction,
    comparisonPercent:
      finiteNumber(record(root.comparison)?.pctVsLastWeek) ??
      finiteNumber(record(root.comparison)?.pctVsDowAvg),
  };
}

function normalizeInventory(value: unknown): InventoryOverview {
  const summary = record(record(value)?.summary);
  if (!summary) throw new Error('Inventory response is malformed');
  const snapshotDate = stringValue(summary.snapshotDate);
  if (!snapshotDate) {
    return {
      hasData: false,
      criticalCount: null,
      atRiskCount: null,
      deadStockValue: null,
      snapshotDate: null,
    };
  }

  const criticalCount = finiteNumber(summary.criticalCount);
  const atRiskCount = finiteNumber(summary.atRiskCount);
  const deadStockValue = finiteNumber(summary.deadStockValue);
  if (
    criticalCount === null ||
    atRiskCount === null ||
    deadStockValue === null
  ) {
    throw new Error('Inventory response is missing risk totals');
  }
  return {
    hasData: true,
    criticalCount,
    atRiskCount,
    deadStockValue,
    snapshotDate,
  };
}

function normalizeFlights(
  value: unknown,
  date: string,
  airportClock: AirportClock,
): FlightsOverview {
  const rows = record(value)?.flights;
  if (!Array.isArray(rows)) throw new Error('Flight response is malformed');

  const flights = rows.flatMap((entry): OverviewFlight[] => {
    const row = record(entry);
    const id = row?.id;
    const flightNumber = stringValue(row?.flight_num);
    const airline = stringValue(row?.airline_code);
    const scheduledAt = timeOfDay(row?.scheduled_time);
    const direction = row?.flight_type;
    const estimatedPassengers = finiteNumber(row?.estimated_passengers);
    if (
      (typeof id !== 'number' && typeof id !== 'string') ||
      !flightNumber ||
      !airline ||
      !scheduledAt ||
      (direction !== 'arrival' && direction !== 'departure') ||
      estimatedPassengers === null
    ) {
      return [];
    }
    return [{
      id,
      flightNumber,
      airline,
      scheduledAt,
      direction,
      estimatedPassengers,
    }];
  });

  const upcomingFlights = flights.filter((flight) => {
    if (date > airportClock.date) return true;
    return (
      date === airportClock.date &&
      minutes(flight.scheduledAt) >= airportClock.minutes
    );
  });
  const upcomingDepartures = upcomingFlights
    .filter((flight) => {
      return flight.direction === 'departure';
    })
    .sort(
      (a, b) =>
        b.estimatedPassengers - a.estimatedPassengers ||
        a.scheduledAt.localeCompare(b.scheduledAt),
    );
  const peak = upcomingDepartures[0] ?? null;

  return {
    hasData: flights.length > 0,
    flights: upcomingFlights,
    nextPeakAt: peak?.scheduledAt ?? null,
    peakPassengers: peak?.estimatedPassengers ?? null,
  };
}

function normalizeShift(value: unknown): OverviewShift | null {
  const row = record(value);
  const staffName = stringValue(row?.staffName);
  const start = timeOfDay(row?.start);
  const end = timeOfDay(row?.end);
  const hours = finiteNumber(row?.hours);
  if (!staffName || !start || !end || hours === null) return null;
  return { staffName, start, end, hours };
}

function normalizeSchedule(
  value: unknown,
  flights: FlightsOverview | null,
): ScheduleOverview {
  const root = record(value);
  if (!root || typeof root.exists !== 'boolean') {
    throw new Error('Schedule response is malformed');
  }
  if (!root.exists) {
    return {
      hasData: false,
      coverageScore: null,
      staffOnDuty: null,
      shifts: [],
      gaps: (flights?.flights ?? [])
        .filter(
          (flight) =>
            flight.direction === 'departure' &&
            flight.estimatedPassengers >= 100,
        )
        .map((flight) => ({
          airline: flight.airline,
          flightNumber: flight.flightNumber,
          passengers: flight.estimatedPassengers,
          scheduledAt: flight.scheduledAt,
        })),
    };
  }

  const day = Array.isArray(root.schedules)
    ? record(root.schedules[0])
    : null;
  if (!day || !Array.isArray(day.shifts)) {
    throw new Error('Schedule response is missing today');
  }
  const shifts = day.shifts
    .map(normalizeShift)
    .filter((shift): shift is OverviewShift => shift !== null);
  const coverageScore = finiteNumber(day.coverageScore);
  if (coverageScore === null) {
    throw new Error('Schedule response is missing coverage');
  }

  const gaps = (flights?.flights ?? [])
    .filter(
      (flight) =>
        flight.direction === 'departure' &&
        flight.estimatedPassengers >= 100,
    )
    .filter((flight) => {
      const opportunityMinute = minutes(flight.scheduledAt) - 30;
      return !shifts.some(
        (shift) =>
          opportunityMinute >= minutes(shift.start) &&
          opportunityMinute < minutes(shift.end),
      );
    })
    .map((flight) => ({
      airline: flight.airline,
      flightNumber: flight.flightNumber,
      passengers: flight.estimatedPassengers,
      scheduledAt: flight.scheduledAt,
    }))
    .sort(
      (a, b) =>
        b.passengers - a.passengers ||
        a.scheduledAt.localeCompare(b.scheduledAt),
    );

  return {
    hasData: true,
    coverageScore,
    staffOnDuty: shifts.length,
    shifts,
    gaps,
  };
}

function normalizeConcession(value: unknown, month: string): ConcessionOverview {
  const root = record(value);
  if (!root) throw new Error('Concession response is malformed');
  const rows = root.dailyBreakdown;
  const hasData = Array.isArray(rows) && rows.length > 0;
  if (!hasData) {
    return {
      hasData: false,
      month,
      grossSalesUsd: null,
      payableEcd: null,
      exceedsThreshold: null,
    };
  }
  const grossSalesUsd = finiteNumber(root.grossSalesUSD);
  const payableEcd = finiteNumber(root.concessionPayableECD);
  if (
    grossSalesUsd === null ||
    payableEcd === null ||
    typeof root.exceedsThreshold !== 'boolean'
  ) {
    throw new Error('Concession response is missing reported totals');
  }
  return {
    hasData: true,
    month: stringValue(root.month) ?? month,
    grossSalesUsd,
    payableEcd,
    exceedsThreshold: root.exceedsThreshold,
  };
}

function isImportSource(value: unknown): value is ImportSource {
  return [
    'sales',
    'item_sales',
    'inventory',
    'flight_schedule',
    'passenger_summary',
  ].includes(String(value));
}

function normalizeConnections(value: unknown): ConnectionsOverview {
  const root = record(value);
  const overall = root?.overall;
  if (
    !root ||
    (overall !== 'healthy' &&
      overall !== 'attention' &&
      overall !== 'not-configured') ||
    !Array.isArray(root.sources)
  ) {
    throw new Error('Connections response is malformed');
  }
  const sources = root.sources.map((value): ImportSourceHealth => {
    const source = record(value);
    const status = source?.status;
    const lastAttemptAt = source?.lastAttemptAt;
    const lastSuccessAt = source?.lastSuccessAt;
    const message = source?.message;
    if (
      !source ||
      !isImportSource(source.source) ||
      (status !== 'healthy' &&
        status !== 'stale' &&
        status !== 'failed' &&
        status !== 'never') ||
      (lastAttemptAt !== null && typeof lastAttemptAt !== 'string') ||
      (lastSuccessAt !== null && typeof lastSuccessAt !== 'string') ||
      (message !== null && typeof message !== 'string')
    ) {
      throw new Error('Connections source response is malformed');
    }
    return {
      source: source.source,
      status,
      lastAttemptAt,
      lastSuccessAt,
      message,
    };
  });
  return {
    overall,
    sources,
    unhealthySources: sources
      .filter((source) => source.status !== 'healthy')
      .map((source) => ({
        source: source.source,
        status: source.status as 'failed' | 'stale' | 'never',
        lastSuccessAt: source.lastSuccessAt,
        message: source.message,
      })),
  };
}

function sourceUpdatedAt(
  connections: ConnectionsOverview | null,
  source: ImportSource,
): string | null {
  return connections?.sources.find((item) => item.source === source)
    ?.lastSuccessAt ?? null;
}

function latestTimestamp(values: Array<string | null>): string | null {
  return values.filter((value): value is string => typeof value === 'string')
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
}

function withUpdatedAt<T>(
  result: DomainResult<T>,
  updatedAt: string | null,
): DomainResult<T> {
  return result.status === 'ready' ? { ...result, updatedAt } : result;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const now = new Date();
  const airportClock = getAirportClock(now);
  const date =
    requestUrl.searchParams.get('date') ??
    airportClock.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: 'date must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  const month = date.slice(0, 7);

  const requests = [
    fetchJson(request, `/api/sales/daily?date=${date}`),
    fetchJson(request, '/api/inventory/risk'),
    fetchJson(request, `/api/flights/day?date=${date}`),
    fetchJson(
      request,
      `/api/schedules/latest?startDate=${date}&endDate=${date}`,
    ),
    fetchJson(request, `/api/concession?month=${month}`),
    fetchJson(request, '/api/connections/status'),
  ];
  const [salesRaw, inventoryRaw, flightsRaw, scheduleRaw, concessionRaw, connectionsRaw] =
    await Promise.allSettled(requests);

  const connections = normalize<ConnectionsOverview>(
    'connections',
    connectionsRaw,
    normalizeConnections,
  );
  const connectionData = connections.data;
  const flights = normalize<FlightsOverview>(
    'flights',
    flightsRaw,
    (value) => normalizeFlights(value, date, airportClock),
  );
  const sales = normalize<SalesOverview>('sales', salesRaw, normalizeSales);
  const inventory = normalize<InventoryOverview>(
    'inventory',
    inventoryRaw,
    normalizeInventory,
  );
  const schedule = normalize<ScheduleOverview>(
    'schedule',
    scheduleRaw,
    (value) => normalizeSchedule(value, flights.data),
  );
  const concession = normalize<ConcessionOverview>(
    'concession',
    concessionRaw,
    (value) => normalizeConcession(value, month),
  );

  const response: OverviewResponse = {
    generatedAt: now.toISOString(),
    date,
    sales: withUpdatedAt(
      sales,
      sourceUpdatedAt(connectionData, 'sales'),
    ),
    inventory: withUpdatedAt(
      inventory,
      sourceUpdatedAt(connectionData, 'inventory') ??
        inventory.data?.snapshotDate ??
        null,
    ),
    flights: withUpdatedAt(
      flights,
      latestTimestamp([
        sourceUpdatedAt(connectionData, 'flight_schedule'),
        sourceUpdatedAt(connectionData, 'passenger_summary'),
      ]),
    ),
    schedule,
    concession: withUpdatedAt(
      concession,
      sourceUpdatedAt(connectionData, 'sales'),
    ),
    connections: withUpdatedAt(
      connections,
      latestTimestamp(
        connectionData?.sources.map((source) => source.lastSuccessAt) ?? [],
      ),
    ),
  };

  return Response.json(response, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
