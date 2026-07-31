// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const deleteQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  deleteQuery.delete = vi.fn(() => deleteQuery);
  deleteQuery.gte = vi.fn(() => deleteQuery);
  deleteQuery.lte = vi.fn(async () => ({ error: null }));
  return {
    deleteQuery,
    ensureDeparturePlanningHorizonFresh: vi.fn(),
    getFlightData: vi.fn(),
    storeSchedule: vi.fn(),
  };
});

vi.mock('@/lib/flight-sync', () => ({
  ensureDeparturePlanningHorizonFresh: mocks.ensureDeparturePlanningHorizonFresh,
}));

vi.mock('@/lib/db', () => ({
  getFlightData: mocks.getFlightData,
  storeSchedule: mocks.storeSchedule,
  supabase: { from: vi.fn(() => mocks.deleteQuery) },
}));

vi.mock('@/lib/schedule', () => ({
  DEFAULT_STAFF: [],
  optimizeSchedule: vi.fn(() => ({ shifts: [], coverageScore: 100 })),
  planWeek: vi.fn((days: Array<{ date: string }>) => days.map((day) => ({
    date: day.date,
    isBilianaDay: false,
    needsTwoStaff: false,
    needsOverlap: false,
    demandScore: 0,
  }))),
}));

import { POST } from './route';

describe('POST /api/schedules/generate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    vi.clearAllMocks();
    mocks.ensureDeparturePlanningHorizonFresh.mockResolvedValue({ status: 'fresh' });
    mocks.getFlightData.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('refreshes departures before reading demand for schedule generation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/schedules/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduleDate: '2026-08-01', scheduleDateEnd: '2026-08-02' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.ensureDeparturePlanningHorizonFresh).toHaveBeenCalledWith('2026-07-31');
    expect(mocks.ensureDeparturePlanningHorizonFresh.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getFlightData.mock.invocationCallOrder[0],
    );
  });

  it('retains stored departures when the provider refresh throws', async () => {
    mocks.ensureDeparturePlanningHorizonFresh.mockRejectedValueOnce(new Error('provider unavailable'));

    const response = await POST(new NextRequest('http://localhost/api/schedules/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduleDate: '2026-08-01' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.getFlightData).toHaveBeenCalledWith('2026-08-01');
  });
});
