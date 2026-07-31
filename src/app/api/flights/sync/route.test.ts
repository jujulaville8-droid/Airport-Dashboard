// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ensureDepartureDataFresh = vi.hoisted(() => vi.fn());
const ensureDeparturePlanningHorizonFresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/flight-sync', () => ({
  ensureDepartureDataFresh,
  ensureDeparturePlanningHorizonFresh,
}));

import { POST } from './route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/flights/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/flights/sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    ensureDepartureDataFresh.mockReset();
    ensureDeparturePlanningHorizonFresh.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('rejects invalid sync inputs before calling the provider', async () => {
    const response = await POST(request({ mode: 'all', startDate: 'July 31' }));

    expect(response.status).toBe(400);
    expect(ensureDepartureDataFresh).not.toHaveBeenCalled();
  });

  it('returns the quota-safe synchronizer result', async () => {
    ensureDeparturePlanningHorizonFresh.mockResolvedValue({
      status: 'updated',
      records: 12,
      lastSuccessAt: '2026-07-31T12:00:00.000Z',
      message: null,
    });

    const response = await POST(request({
      mode: 'planning',
      startDate: '2026-07-31',
      days: 14,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'updated', records: 12 });
    expect(ensureDeparturePlanningHorizonFresh).toHaveBeenCalledWith('2026-07-31');
  });

  it('does not expose provider errors or credentials', async () => {
    ensureDepartureDataFresh.mockImplementationOnce(() => {
      throw new Error('bad key secret-provider-value');
    });

    const response = await POST(request({ mode: 'live', startDate: '2026-07-31' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Departure sync failed' });
    expect(JSON.stringify(body)).not.toContain('secret-provider-value');
  });
});
