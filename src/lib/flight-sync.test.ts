import { describe, expect, it, vi } from 'vitest';
import type { AeroDataBoxDeparture, DepartureWindow } from './aerodatabox';
import {
  ensureDepartureDataFresh,
  ensureDeparturePlanningHorizonFresh,
  type ExistingFlight,
  type FlightSyncDependencies,
} from './flight-sync';

const providerDeparture: AeroDataBoxDeparture = {
  number: 'AA 1136',
  status: 'Expected',
  codeshareStatus: 'IsOperator',
  isCargo: false,
  departure: {
    airport: { name: 'V.C. Bird International', iata: 'ANU', icao: 'TAPA' },
    scheduledTime: {
      utc: '2026-08-03T16:21:00Z',
      local: '2026-08-03T12:21:00-04:00',
    },
    quality: ['Basic'],
  },
  arrival: {
    airport: { name: 'John F Kennedy International', iata: 'JFK', icao: 'KJFK' },
    quality: ['Basic'],
  },
  airline: { name: 'American Airlines', iata: 'AA', icao: 'AAL' },
};

function makeDependencies(options?: {
  apiKey?: string | undefined;
  claimed?: boolean;
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  leaseUntil?: string | null;
  existing?: ExistingFlight[];
  providerRows?: AeroDataBoxDeparture[];
}) {
  const upserted: ExistingFlight[][] = [];
  const records: Array<{ success: boolean; records: number; message: string | null }> = [];
  const dependencies: FlightSyncDependencies = {
    apiKey: options && 'apiKey' in options ? options.apiKey : 'server-secret',
    getState: vi.fn(async () => ({
      lastSuccessAt: options?.lastSuccessAt ?? null,
      lastAttemptAt: options?.lastAttemptAt ?? options?.lastSuccessAt ?? null,
      leaseUntil: options?.leaseUntil ?? null,
    })),
    claim: vi.fn(async () => options?.claimed ?? true),
    complete: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    fetchWindow: vi.fn(async (_window: DepartureWindow) =>
      options?.providerRows ?? [providerDeparture]),
    loadExisting: vi.fn(async () => options?.existing ?? []),
    upsert: vi.fn(async (rows) => {
      upserted.push(rows);
    }),
    record: vi.fn(async (result) => {
      records.push({
        success: result.success,
        records: result.records,
        message: result.message,
      });
    }),
    wait: vi.fn(async () => undefined),
  };
  return { dependencies, upserted, records };
}

describe('ensureDepartureDataFresh', () => {
  it('uses a successful live sync for six hours without consuming provider quota', async () => {
    const { dependencies } = makeDependencies({
      lastSuccessAt: '2026-08-03T08:00:00.000Z',
    });

    const result = await ensureDepartureDataFresh(
      {
        mode: 'live',
        startDate: '2026-08-03',
        now: new Date('2026-08-03T12:00:00.000Z'),
      },
      dependencies,
    );

    expect(result).toEqual({
      status: 'fresh',
      records: 0,
      lastSuccessAt: '2026-08-03T08:00:00.000Z',
      message: null,
    });
    expect(dependencies.fetchWindow).not.toHaveBeenCalled();
  });

  it('returns in-progress when another server holds the sync lease', async () => {
    const { dependencies } = makeDependencies({
      leaseUntil: '2099-08-03T12:05:00.000Z',
    });

    const result = await ensureDepartureDataFresh(
      { mode: 'live', startDate: '2026-08-03' },
      dependencies,
    );

    expect(result.status).toBe('in-progress');
    expect(dependencies.fetchWindow).not.toHaveBeenCalled();
  });

  it('keys planning freshness to the exact requested coverage', async () => {
    const { dependencies } = makeDependencies();

    await ensureDepartureDataFresh(
      { mode: 'planning', startDate: '2026-08-03', days: 2 },
      dependencies,
    );

    expect(dependencies.getState).toHaveBeenCalledWith(
      'aerodatabox:planning:2026-08-03:2026-08-04',
    );
    expect(dependencies.claim).toHaveBeenCalledWith(
      'aerodatabox:planning:2026-08-03:2026-08-04',
      expect.any(Date),
      900,
    );
  });

  it('uses stable weekly buckets for the rolling 14-day planning horizon', async () => {
    const { dependencies } = makeDependencies();

    await ensureDeparturePlanningHorizonFresh('2026-08-03', dependencies);

    expect(dependencies.getState).toHaveBeenNthCalledWith(
      1,
      'aerodatabox:planning:2026-08-03:2026-08-09',
    );
    expect(dependencies.getState).toHaveBeenNthCalledWith(
      2,
      'aerodatabox:planning:2026-08-10:2026-08-16',
    );
    expect(dependencies.getState).toHaveBeenCalledTimes(2);
  });

  it('backs off after a recent failed attempt without consuming provider quota', async () => {
    const { dependencies } = makeDependencies({
      lastAttemptAt: '2026-08-03T11:55:00.000Z',
    });

    const result = await ensureDepartureDataFresh(
      {
        mode: 'planning',
        startDate: '2026-08-03',
        days: 14,
        now: new Date('2026-08-03T12:00:00.000Z'),
      },
      dependencies,
    );

    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/retry cooldown/i);
    expect(dependencies.claim).not.toHaveBeenCalled();
    expect(dependencies.fetchWindow).not.toHaveBeenCalled();
  });

  it('preserves existing passenger enrichment when provider fields are refreshed', async () => {
    const existing: ExistingFlight = {
      flight_date: '2026-08-03',
      flight_num: 'AA1136',
      flight_type: 'departure',
      scheduled_time: '2026-08-03T12:15:00',
      estimated_passengers: 172,
      actual_passengers: 151,
      actual_passengers_source: 'carrier-summary',
      actual_passengers_updated_at: '2026-08-04T01:00:00.000Z',
      aircraft_type: 'Manual capacity profile',
    };
    const { dependencies, upserted } = makeDependencies({ existing: [existing] });

    const result = await ensureDepartureDataFresh(
      { mode: 'live', startDate: '2026-08-03' },
      dependencies,
    );

    expect(result.status).toBe('updated');
    expect(upserted[0]).toEqual([
      expect.objectContaining({
        flight_num: 'AA1136',
        scheduled_time: '2026-08-03T12:21:00',
        estimated_passengers: 172,
        actual_passengers: 151,
        actual_passengers_source: 'carrier-summary',
        actual_passengers_updated_at: '2026-08-04T01:00:00.000Z',
        aircraft_type: 'Manual capacity profile',
      }),
    ]);
  });

  it('paces multi-window planning requests and completes only after persistence', async () => {
    const { dependencies } = makeDependencies();

    const result = await ensureDepartureDataFresh(
      { mode: 'planning', startDate: '2026-08-03', days: 1 },
      dependencies,
    );

    expect(result.status).toBe('updated');
    expect(dependencies.fetchWindow).toHaveBeenCalledTimes(2);
    expect(dependencies.wait).toHaveBeenCalledTimes(1);
    expect(dependencies.wait).toHaveBeenCalledWith(1_000);
    expect(dependencies.complete).toHaveBeenCalledTimes(1);
  });

  it('keeps existing data and records a safe failure when the provider fails', async () => {
    const { dependencies, upserted, records } = makeDependencies();
    dependencies.fetchWindow = vi.fn(async () => {
      throw new Error('upstream response contained sensitive diagnostics');
    });

    const result = await ensureDepartureDataFresh(
      { mode: 'live', startDate: '2026-08-03' },
      dependencies,
    );

    expect(result).toEqual({
      status: 'failed',
      records: 0,
      lastSuccessAt: null,
      message: 'Departure refresh failed; retained existing flight data.',
    });
    expect(upserted).toEqual([]);
    expect(records).toEqual([{
      success: false,
      records: 0,
      message: 'Departure refresh failed; retained existing flight data.',
    }]);
    expect(dependencies.release).toHaveBeenCalledTimes(1);
  });

  it('releases the lease even when failure logging also fails', async () => {
    const { dependencies } = makeDependencies();
    dependencies.fetchWindow = vi.fn(async () => {
      throw new Error('provider unavailable');
    });
    dependencies.record = vi.fn(async () => {
      throw new Error('logging unavailable');
    });

    const result = await ensureDepartureDataFresh(
      { mode: 'live', startDate: '2026-08-03' },
      dependencies,
    );

    expect(result.status).toBe('failed');
    expect(dependencies.release).toHaveBeenCalledTimes(1);
  });

  it('reports missing configuration without calling or logging the provider', async () => {
    const { dependencies, records } = makeDependencies({ apiKey: undefined });

    const result = await ensureDepartureDataFresh(
      { mode: 'live', startDate: '2026-08-03' },
      dependencies,
    );

    expect(result.status).toBe('not-configured');
    expect(result.message).toBe('AeroDataBox is not configured.');
    expect(dependencies.claim).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });
});
