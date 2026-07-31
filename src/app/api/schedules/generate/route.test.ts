// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const deleteQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  deleteQuery.delete = vi.fn(() => deleteQuery);
  deleteQuery.gte = vi.fn(() => deleteQuery);
  deleteQuery.lte = vi.fn(async () => ({ error: null }));
  return {
    deleteQuery,
    ensureDepartureDataFresh: vi.fn(),
    getFlightData: vi.fn(),
    storeSchedule: vi.fn(),
  };
});

vi.mock('@/lib/flight-sync', () => ({
  ensureDepartureDataFresh: mocks.ensureDepartureDataFresh,
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
    vi.clearAllMocks();
    mocks.ensureDepartureDataFresh.mockResolvedValue({ status: 'fresh' });
    mocks.getFlightData.mockResolvedValue([]);
  });

  it('refreshes departures before reading demand for schedule generation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/schedules/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduleDate: '2026-08-01', scheduleDateEnd: '2026-08-02' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.ensureDepartureDataFresh).toHaveBeenCalledWith({
      mode: 'planning',
      startDate: '2026-08-01',
      days: 2,
    });
    expect(mocks.ensureDepartureDataFresh.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getFlightData.mock.invocationCallOrder[0],
    );
  });

  it('retains stored departures when the provider refresh throws', async () => {
    mocks.ensureDepartureDataFresh.mockRejectedValueOnce(new Error('provider unavailable'));

    const response = await POST(new NextRequest('http://localhost/api/schedules/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduleDate: '2026-08-01' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.getFlightData).toHaveBeenCalledWith('2026-08-01');
  });
});
