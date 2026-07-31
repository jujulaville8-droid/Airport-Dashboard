// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ensureDepartureDataFresh = vi.hoisted(() => vi.fn());

vi.mock('@/lib/flight-sync', () => ({ ensureDepartureDataFresh }));

import { GET } from './route';

function request(secret = 'cron-secret') {
  return new NextRequest('http://localhost/api/cron/flights', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('GET /api/cron/flights', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T13:00:00.000Z'));
    process.env.FLIGHT_CRON_SECRET = 'cron-secret';
    ensureDepartureDataFresh.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.FLIGHT_CRON_SECRET;
  });

  it('rejects requests without the configured bearer secret', async () => {
    const response = await GET(request('wrong-secret'));

    expect(response.status).toBe(401);
    expect(ensureDepartureDataFresh).not.toHaveBeenCalled();
  });

  it('refreshes today in Antigua and returns only safe sync metadata', async () => {
    ensureDepartureDataFresh.mockResolvedValue({
      status: 'updated',
      records: 11,
      lastSuccessAt: '2026-08-03T13:00:00.000Z',
      message: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: 'updated',
      records: 11,
      lastSuccessAt: '2026-08-03T13:00:00.000Z',
    });
    expect(ensureDepartureDataFresh).toHaveBeenCalledWith({
      mode: 'live',
      startDate: '2026-08-03',
      now: new Date('2026-08-03T13:00:00.000Z'),
    });
  });

  it('returns a generic error when the refresh throws', async () => {
    ensureDepartureDataFresh.mockRejectedValue(
      new Error('provider secret appeared in upstream diagnostics'),
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'Flight refresh failed' });
    expect(JSON.stringify(body)).not.toContain('provider secret');
  });

  it('fails the scheduler run when the provider refresh reports failure', async () => {
    ensureDepartureDataFresh.mockResolvedValue({
      status: 'failed',
      records: 0,
      lastSuccessAt: null,
      message: 'private provider detail',
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      status: 'failed',
      records: 0,
      lastSuccessAt: null,
    });
  });
});
