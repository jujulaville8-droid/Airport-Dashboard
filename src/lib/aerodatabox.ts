export type DepartureWindow = {
  fromLocal: string;
  toLocal: string;
};

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AeroDataBoxClientOptions = {
  apiKey: string;
  fetcher?: FetchLike;
  signal?: AbortSignal;
};

type ProviderDateTime = {
  local?: unknown;
  utc?: unknown;
};

type ProviderAirport = {
  name?: unknown;
  iata?: unknown;
  icao?: unknown;
};

type ProviderMovement = {
  airport?: ProviderAirport;
  scheduledTime?: ProviderDateTime;
  terminal?: unknown;
  gate?: unknown;
  quality?: unknown;
};

export type AeroDataBoxDeparture = {
  number?: unknown;
  status?: unknown;
  codeshareStatus?: unknown;
  isCargo?: unknown;
  movement?: ProviderMovement;
  departure?: ProviderMovement;
  arrival?: ProviderMovement;
  aircraft?: { model?: unknown; reg?: unknown; modeS?: unknown };
  airline?: { name?: unknown; iata?: unknown; icao?: unknown };
  [key: string]: unknown;
};

export type NormalizedDeparture = TablesInsert<'flight_data'>;

export class AeroDataBoxError extends Error {
  constructor(
    public readonly kind:
      | 'configuration'
      | 'rate-limit'
      | 'upstream'
      | 'malformed'
      | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'AeroDataBoxError';
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

function parseDate(date: string): Date {
  if (!DATE_PATTERN.test(date)) {
    throw new Error('startDate must use YYYY-MM-DD');
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('startDate must use YYYY-MM-DD');
  }
  return parsed;
}

function formatLocal(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function validateWindow(window: DepartureWindow): void {
  if (
    !LOCAL_TIME_PATTERN.test(window.fromLocal) ||
    !LOCAL_TIME_PATTERN.test(window.toLocal)
  ) {
    throw new Error('departure window must use YYYY-MM-DDTHH:mm');
  }

  const from = new Date(`${window.fromLocal}:00.000Z`).getTime();
  const to = new Date(`${window.toLocal}:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > HALF_DAY_MS) {
    throw new Error('departure window must be positive and no longer than 12 hours');
  }
}

export function buildDepartureWindows(
  startDate: string,
  days: number,
): DepartureWindow[] {
  const start = parseDate(startDate);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('days must be a positive integer');
  }

  const windows: DepartureWindow[] = [];
  for (let index = 0; index < days * 2; index += 1) {
    const from = new Date(start.getTime() + index * HALF_DAY_MS);
    const to = new Date(from.getTime() + HALF_DAY_MS);
    windows.push({ fromLocal: formatLocal(from), toLocal: formatLocal(to) });
  }
  return windows;
}

export async function fetchAirportDepartures(
  window: DepartureWindow,
  options: AeroDataBoxClientOptions,
): Promise<AeroDataBoxDeparture[]> {
  validateWindow(window);
  if (!options.apiKey.trim()) {
    throw new AeroDataBoxError(
      'configuration',
      'AeroDataBox API key is required',
    );
  }

  const query = new URLSearchParams({
    direction: 'Departure',
    withLeg: 'true',
    withCancelled: 'true',
    withCodeshared: 'false',
    withCargo: 'false',
    withPrivate: 'false',
    withLocation: 'false',
  });
  const url =
    'https://aerodatabox.p.rapidapi.com/flights/airports/iata/ANU/' +
    `${encodeURIComponent(window.fromLocal)}/${encodeURIComponent(window.toLocal)}?${query}`;
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      headers: {
        'X-RapidAPI-Key': options.apiKey,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
      signal: options.signal,
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === 'AbortError';
    throw new AeroDataBoxError(
      timedOut ? 'timeout' : 'upstream',
      timedOut ? 'AeroDataBox request timed out' : 'AeroDataBox request failed',
    );
  }

  if (!response.ok) {
    throw new AeroDataBoxError(
      response.status === 429 ? 'rate-limit' : 'upstream',
      `AeroDataBox request failed with status ${response.status}`,
    );
  }
  if (response.status === 204) {
    return [];
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AeroDataBoxError(
      'malformed',
      'AeroDataBox response was not valid JSON',
    );
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { departures?: unknown }).departures)
  ) {
    throw new AeroDataBoxError(
      'malformed',
      'AeroDataBox response did not contain departures',
    );
  }
  return (payload as { departures: AeroDataBoxDeparture[] }).departures;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function normalizeFlightNumber(value: unknown): string | undefined {
  const flightNumber = stringValue(value)?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return flightNumber || undefined;
}

function normalizeLocalTimestamp(value: unknown): string | undefined {
  const timestamp = stringValue(value);
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timestamp)) {
    return undefined;
  }
  const localMinute = timestamp.slice(0, 16);
  const parsed = new Date(`${localMinute}:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${localMinute}:00`;
}

function mondayFor(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const weekday = parsed.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

function normalizedStatus(value: unknown): string {
  switch (stringValue(value)) {
    case 'CheckIn':
      return 'check-in';
    case 'Boarding':
      return 'boarding';
    case 'GateClosed':
      return 'gate-closed';
    case 'Departed':
      return 'departed';
    case 'Delayed':
      return 'delayed';
    case 'EnRoute':
    case 'Approaching':
      return 'active';
    case 'Arrived':
      return 'arrived';
    case 'Canceled':
    case 'CanceledUncertain':
      return 'cancelled';
    case 'Diverted':
      return 'diverted';
    default:
      return 'scheduled';
  }
}

function airportName(airport: ProviderAirport | undefined): string | undefined {
  return (
    stringValue(airport?.name) ??
    stringValue(airport?.iata) ??
    stringValue(airport?.icao)
  );
}

export function normalizeDepartures(
  rows: AeroDataBoxDeparture[],
): NormalizedDeparture[] {
  const normalized: NormalizedDeparture[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.isCargo === true || row.codeshareStatus === 'IsCodeshared') {
      continue;
    }

    const flightNumber = normalizeFlightNumber(row.number);
    const departureMovement = row.departure ?? row.movement;
    const scheduledTime = normalizeLocalTimestamp(
      departureMovement?.scheduledTime?.local,
    );
    if (!flightNumber || !scheduledTime) continue;

    const flightDate = scheduledTime.slice(0, 10);
    const uniquenessKey = `${flightNumber}:${flightDate}:departure`;
    if (seen.has(uniquenessKey)) continue;
    seen.add(uniquenessKey);

    const item: NormalizedDeparture = {
      flight_date: flightDate,
      flight_num: flightNumber,
      scheduled_time: scheduledTime,
      flight_type: 'departure',
      status: normalizedStatus(row.status),
      schedule_week_start: mondayFor(flightDate),
      schedule_month: flightDate.slice(0, 7),
    };

    const airlineCode =
      stringValue(row.airline?.iata) ??
      stringValue(row.airline?.icao) ??
      stringValue(row.airline?.name);
    const aircraftType = stringValue(row.aircraft?.model);
    const destination = airportName(
      row.arrival?.airport ?? row.movement?.airport,
    );
    const terminal = stringValue(departureMovement?.terminal);
    const gate = stringValue(departureMovement?.gate);

    if (airlineCode) item.airline_code = airlineCode;
    if (aircraftType) item.aircraft_type = aircraftType;
    if (destination) item.origin_destination = destination;
    if (terminal) item.terminal = terminal;
    if (gate) item.gate = gate;
    normalized.push(item);
  }

  return normalized;
}
import type { TablesInsert } from './database.types';
