import type { TablesInsert } from './database.types';
import {
  buildDepartureWindows,
  fetchAirportDepartures,
  normalizeDepartures,
  type AeroDataBoxDeparture,
  type DepartureWindow,
  type NormalizedDeparture,
} from './aerodatabox';
import { supabase, storeFlightData } from './db';
import {
  recordImportHealthResult,
  type AuthoritativeImportResult,
} from './import-health-log';

export type FlightSyncMode = 'live' | 'planning';

export type FlightSyncRequest = {
  mode: FlightSyncMode;
  startDate: string;
  days?: number;
  now?: Date;
};

export type FlightSyncResult = {
  status: 'fresh' | 'updated' | 'in-progress' | 'failed' | 'not-configured';
  records: number;
  lastSuccessAt: string | null;
  message: string | null;
};

export type ExistingFlight = TablesInsert<'flight_data'>;

export type FlightSyncDependencies = {
  apiKey: string | undefined;
  getState(syncKey: string): Promise<{ lastSuccessAt: string | null }>;
  claim(syncKey: string, now: Date, leaseSeconds: number): Promise<boolean>;
  complete(syncKey: string, at: Date): Promise<void>;
  release(syncKey: string): Promise<void>;
  fetchWindow(window: DepartureWindow): Promise<AeroDataBoxDeparture[]>;
  loadExisting(startDate: string, endDate: string): Promise<ExistingFlight[]>;
  upsert(rows: ExistingFlight[]): Promise<void>;
  record(result: AuthoritativeImportResult): Promise<void>;
  wait(ms: number): Promise<void>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LIVE_FRESH_MS = 6 * 60 * 60 * 1000;
const PLANNING_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_SECONDS = 5 * 60;

function datePlusDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function getAntiguaParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Antigua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function formatMinute(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function buildLiveWindow(startDate: string, now: Date): DepartureWindow {
  const antigua = getAntiguaParts(now);
  const today = `${String(antigua.year).padStart(4, '0')}-${String(antigua.month).padStart(2, '0')}-${String(antigua.day).padStart(2, '0')}`;
  if (today !== startDate) {
    return buildDepartureWindows(startDate, 1)[0];
  }

  const localMinuteAsUtc = Date.UTC(
    antigua.year,
    antigua.month - 1,
    antigua.day,
    antigua.hour,
    antigua.minute,
  );
  const from = new Date(localMinuteAsUtc - 2 * 60 * 60 * 1000);
  const to = new Date(from.getTime() + 12 * 60 * 60 * 1000);
  return { fromLocal: formatMinute(from), toLocal: formatMinute(to) };
}

function isFresh(lastSuccessAt: string | null, now: Date, maxAgeMs: number): boolean {
  if (!lastSuccessAt) return false;
  const timestamp = new Date(lastSuccessAt).getTime();
  return Number.isFinite(timestamp) && now.getTime() - timestamp < maxAgeMs;
}

function flightKey(flight: Pick<ExistingFlight, 'flight_num' | 'flight_date' | 'flight_type'>): string {
  return `${flight.flight_num}:${flight.flight_date}:${flight.flight_type}`;
}

function mergeExisting(
  providerRows: NormalizedDeparture[],
  existingRows: ExistingFlight[],
): ExistingFlight[] {
  const existingByKey = new Map(existingRows.map((row) => [flightKey(row), row]));
  const mergedByKey = new Map<string, ExistingFlight>();

  for (const providerRow of providerRows) {
    const existing = existingByKey.get(flightKey(providerRow));
    mergedByKey.set(flightKey(providerRow), {
      ...(existing ?? {}),
      ...providerRow,
      estimated_passengers:
        providerRow.estimated_passengers ?? existing?.estimated_passengers ?? null,
      actual_passengers:
        providerRow.actual_passengers ?? existing?.actual_passengers ?? null,
      actual_passengers_source:
        providerRow.actual_passengers_source ??
        existing?.actual_passengers_source ??
        null,
      actual_passengers_updated_at:
        providerRow.actual_passengers_updated_at ??
        existing?.actual_passengers_updated_at ??
        null,
      aircraft_type:
        providerRow.aircraft_type ?? existing?.aircraft_type ?? null,
    } as ExistingFlight);
  }
  return [...mergedByKey.values()];
}

function defaultDependencies(apiKey: string | undefined): FlightSyncDependencies {
  return {
    apiKey,
    async getState(syncKey) {
      const { data, error } = await supabase
        .from('external_sync_state')
        .select('last_success_at')
        .eq('sync_key', syncKey)
        .maybeSingle();
      if (error) throw error;
      return { lastSuccessAt: data?.last_success_at ?? null };
    },
    async claim(syncKey, now, leaseSeconds) {
      const { data, error } = await supabase.rpc('claim_external_sync', {
        requested_key: syncKey,
        requested_now: now.toISOString(),
        requested_lease_seconds: leaseSeconds,
      });
      if (error) throw error;
      return data;
    },
    async complete(syncKey, at) {
      const { error } = await supabase
        .from('external_sync_state')
        .update({
          last_success_at: at.toISOString(),
          lease_until: null,
          updated_at: at.toISOString(),
        })
        .eq('sync_key', syncKey);
      if (error) throw error;
    },
    async release(syncKey) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('external_sync_state')
        .update({ lease_until: null, updated_at: now })
        .eq('sync_key', syncKey);
      if (error) console.error('[flight-sync] failed to release sync lease');
    },
    async fetchWindow(window) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        return await fetchAirportDepartures(window, {
          apiKey: apiKey ?? '',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    async loadExisting(startDate, endDate) {
      const { data, error } = await supabase
        .from('flight_data')
        .select('*')
        .eq('flight_type', 'departure')
        .gte('flight_date', startDate)
        .lte('flight_date', endDate);
      if (error) throw error;
      return data;
    },
    async upsert(rows) {
      await storeFlightData(rows);
    },
    record: recordImportHealthResult,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export async function ensureDepartureDataFresh(
  request: FlightSyncRequest,
  dependencies?: FlightSyncDependencies,
): Promise<FlightSyncResult> {
  if (!DATE_PATTERN.test(request.startDate)) {
    throw new Error('startDate must use YYYY-MM-DD');
  }
  const days = request.mode === 'planning' ? request.days ?? 14 : 1;
  if (!Number.isInteger(days) || days <= 0 || days > 14) {
    throw new Error('days must be an integer between 1 and 14');
  }

  const now = request.now ?? new Date();
  const deps = dependencies ?? defaultDependencies(process.env.AERODATABOX_RAPIDAPI_KEY);
  if (!deps.apiKey?.trim()) {
    return {
      status: 'not-configured',
      records: 0,
      lastSuccessAt: null,
      message: 'AeroDataBox is not configured.',
    };
  }

  const syncKey = `aerodatabox:${request.mode}`;
  const state = await deps.getState(syncKey);
  const freshness = request.mode === 'live' ? LIVE_FRESH_MS : PLANNING_FRESH_MS;
  if (isFresh(state.lastSuccessAt, now, freshness)) {
    return {
      status: 'fresh',
      records: 0,
      lastSuccessAt: state.lastSuccessAt,
      message: null,
    };
  }

  const claimed = await deps.claim(syncKey, now, LEASE_SECONDS);
  if (!claimed) {
    return {
      status: 'in-progress',
      records: 0,
      lastSuccessAt: state.lastSuccessAt,
      message: 'A departure refresh is already in progress.',
    };
  }

  const windows = request.mode === 'live'
    ? [buildLiveWindow(request.startDate, now)]
    : buildDepartureWindows(request.startDate, days);
  const providerRows: NormalizedDeparture[] = [];
  const endDate = datePlusDays(request.startDate, days - 1);
  let persistedRecords = 0;

  try {
    for (let index = 0; index < windows.length; index += 1) {
      const responseRows = await deps.fetchWindow(windows[index]);
      providerRows.push(...normalizeDepartures(responseRows));
      if (index < windows.length - 1) await deps.wait(1_000);
    }

    const existingRows = await deps.loadExisting(request.startDate, endDate);
    const mergedRows = mergeExisting(providerRows, existingRows);
    if (mergedRows.length > 0) await deps.upsert(mergedRows);
    persistedRecords = mergedRows.length;
    await deps.record({
      source: 'flight_schedule',
      fileName: `aerodatabox-${request.mode}`,
      success: true,
      records: persistedRecords,
      message: `AeroDataBox ${request.mode} departures refreshed.`,
    });
    await deps.complete(syncKey, now);
    return {
      status: 'updated',
      records: persistedRecords,
      lastSuccessAt: now.toISOString(),
      message: null,
    };
  } catch {
    if (providerRows.length > 0 && persistedRecords === 0) {
      try {
        const existingRows = await deps.loadExisting(request.startDate, endDate);
        const partialRows = mergeExisting(providerRows, existingRows);
        if (partialRows.length > 0) await deps.upsert(partialRows);
        persistedRecords = partialRows.length;
      } catch {
        persistedRecords = 0;
      }
    }

    const message = 'Departure refresh failed; retained existing flight data.';
    await deps.record({
      source: 'flight_schedule',
      fileName: `aerodatabox-${request.mode}`,
      success: false,
      records: persistedRecords,
      message,
    });
    await deps.release(syncKey);
    return {
      status: 'failed',
      records: persistedRecords,
      lastSuccessAt: state.lastSuccessAt,
      message,
    };
  }
}
