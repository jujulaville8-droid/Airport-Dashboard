import {
  act,
  cleanup,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getOverview } from '@/app/api/overview/route';
import { deriveActions } from './derive-actions';
import { OverviewPage } from './OverviewPage';
import type {
  OverviewResponse,
  ReadyDomainResult,
} from './types';

afterEach(cleanup);

function ready<T>(
  data: T,
  updatedAt: string | null = '2026-07-30T19:55:00.000Z',
): ReadyDomainResult<T> {
  return { status: 'ready', data, updatedAt };
}

function overviewFixture(
  overrides: Partial<OverviewResponse> = {},
): OverviewResponse {
  return {
    generatedAt: '2026-07-30T20:00:00.000Z',
    date: '2026-07-30',
    sales: ready({
      hasData: true,
      revenue: 8_420,
      tickets: 42,
      averageTransaction: 200.48,
      comparisonPercent: 12,
    }),
    inventory: ready({
      hasData: true,
      criticalCount: 2,
      atRiskCount: 4,
      deadStockValue: 1_200,
      snapshotDate: '2026-07-30',
    }),
    flights: ready({
      hasData: true,
      flights: [
        {
          id: 1,
          flightNumber: 'BA2157',
          airline: 'BA',
          scheduledAt: '20:05',
          direction: 'departure',
          estimatedPassengers: 184,
        },
      ],
      nextPeakAt: '20:05',
      peakPassengers: 184,
    }),
    schedule: ready({
      hasData: true,
      coverageScore: 68,
      staffOnDuty: 1,
      shifts: [
        {
          staffName: 'Nichelle',
          start: '09:00',
          end: '17:00',
          hours: 8,
        },
      ],
      gaps: [
        {
          airline: 'BA',
          flightNumber: 'BA2157',
          passengers: 184,
          scheduledAt: '20:05',
        },
      ],
    }),
    concession: ready({
      hasData: true,
      month: '2026-07',
      grossSalesUsd: 38_420,
      payableEcd: 5_120,
      exceedsThreshold: true,
    }),
    connections: ready({
      overall: 'healthy',
      unhealthySources: [],
      sources: [],
    }),
    ...overrides,
  };
}

function rawDomainResponses() {
  return {
    '/api/sales/daily': {
      date: '2026-07-30',
      today: {
        sales: 8_420,
        tickets: 42,
        avgTransaction: 200.48,
        hasData: true,
      },
      comparison: { pctVsLastWeek: 12 },
    },
    '/api/inventory/risk': {
      summary: {
        criticalCount: 2,
        atRiskCount: 4,
        deadStockValue: 1_200,
        snapshotDate: '2026-07-30',
      },
    },
    '/api/flights/day': {
      date: '2026-07-30',
      flights: [
        {
          id: 1,
          flight_num: 'BA2157',
          airline_code: 'BA',
          scheduled_time: '2026-07-30T20:05:00',
          flight_type: 'departure',
          estimated_passengers: 184,
        },
      ],
    },
    '/api/schedules/latest': {
      exists: true,
      schedules: [
        {
          date: '2026-07-30',
          coverageScore: 68,
          shifts: [
            {
              staffName: 'Nichelle',
              start: '09:00',
              end: '17:00',
              hours: 8,
            },
          ],
        },
      ],
    },
    '/api/concession': {
      month: '2026-07',
      grossSalesUSD: 38_420,
      concessionPayableECD: 5_120,
      exceedsThreshold: true,
      dailyBreakdown: [{ date: '2026-07-30', sales: 8_420, tickets: 42 }],
    },
    '/api/connections/status': {
      overall: 'attention',
      cron: { configured: true, schedule: 'hourly' },
      sources: [
        {
          source: 'sales',
          status: 'healthy',
          lastAttemptAt: '2026-07-30T19:55:00.000Z',
          lastSuccessAt: '2026-07-30T19:55:00.000Z',
          message: null,
        },
        {
          source: 'item_sales',
          status: 'failed',
          lastAttemptAt: '2026-07-30T19:50:00.000Z',
          lastSuccessAt: '2026-07-29T19:50:00.000Z',
          message: 'Workbook could not be parsed',
        },
        {
          source: 'inventory',
          status: 'healthy',
          lastAttemptAt: '2026-07-30T19:45:00.000Z',
          lastSuccessAt: '2026-07-30T19:45:00.000Z',
          message: null,
        },
        {
          source: 'flight_schedule',
          status: 'healthy',
          lastAttemptAt: '2026-07-30T19:40:00.000Z',
          lastSuccessAt: '2026-07-30T19:40:00.000Z',
          message: null,
        },
        {
          source: 'passenger_summary',
          status: 'healthy',
          lastAttemptAt: '2026-07-30T19:35:00.000Z',
          lastSuccessAt: '2026-07-30T19:35:00.000Z',
          message: null,
        },
      ],
      recentImports: [],
    },
  };
}

describe('GET /api/overview', () => {
  it('aborts a hung domain after eight seconds while returning the other domains', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    vi.useFakeTimers();
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname !== '/api/inventory/risk') {
        return Promise.resolve(
          Response.json(payloads[pathname as keyof typeof payloads]),
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason ?? new Error('aborted')),
          { once: true },
        );
      });
    }) as typeof fetch;

    try {
      const overviewPromise = getOverview(
        new Request('http://localhost/api/overview?date=2026-07-30'),
      );
      const guarded = Promise.race([
        overviewPromise,
        new Promise<'still-pending'>((resolve) => {
          setTimeout(() => resolve('still-pending'), 8_001);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(8_001);
      const result = await guarded;

      expect(result).not.toBe('still-pending');
      const body = await (result as Response).json();
      expect(body.inventory.status).toBe('error');
      expect(body.sales).toMatchObject({
        status: 'ready',
        data: { revenue: 8_420 },
      });
    } finally {
      global.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('keeps the abort budget active while a response body stalls', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    vi.useFakeTimers();
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname !== '/api/inventory/risk') {
        return Promise.resolve(
          Response.json(payloads[pathname as keyof typeof payloads]),
        );
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(init.signal?.reason ?? new Error('aborted')),
              { once: true },
            );
          }),
      } as Response);
    }) as typeof fetch;

    try {
      const overviewPromise = getOverview(
        new Request('http://localhost/api/overview?date=2026-07-30'),
      );
      const guarded = Promise.race([
        overviewPromise,
        new Promise<'still-pending'>((resolve) => {
          setTimeout(() => resolve('still-pending'), 8_001);
        }),
      ]);
      await vi.advanceTimersByTimeAsync(8_001);
      const result = await guarded;

      expect(result).not.toBe('still-pending');
      const body = await (result as Response).json();
      expect(body.inventory.status).toBe('error');
      expect(body.sales.status).toBe('ready');
    } finally {
      global.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('starts all six domain requests together and keeps one failed domain isolated', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    const pending = new Map<
      string,
      { resolve: (response: Response) => void; promise: Promise<Response> }
    >();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      let resolve!: (response: Response) => void;
      const promise = new Promise<Response>((resolvePromise) => {
        resolve = resolvePromise;
      });
      pending.set(url.pathname, { resolve, promise });
      return promise;
    });
    global.fetch = fetchMock as typeof fetch;

    try {
      const overviewPromise = getOverview(
        new Request('http://localhost/api/overview?date=2026-07-30', {
          headers: { cookie: 'airport_session=signed' },
        }),
      );

      expect(fetchMock).toHaveBeenCalledTimes(6);

      for (const [pathname, deferred] of pending) {
        if (pathname === '/api/inventory/risk') {
          deferred.resolve(
            Response.json(
              { error: 'Failed to compute inventory risk' },
              { status: 500 },
            ),
          );
        } else {
          deferred.resolve(
            Response.json(payloads[pathname as keyof typeof payloads]),
          );
        }
      }

      const response = await overviewPromise;
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.inventory).toEqual({
        status: 'error',
        data: null,
        updatedAt: null,
        message: 'Inventory data unavailable',
      });
      expect(body.sales).toMatchObject({
        status: 'ready',
        data: { hasData: true, revenue: 8_420 },
      });
      expect(body.flights).toMatchObject({
        status: 'ready',
        data: { hasData: true },
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('marks a missing sales report as absent instead of returning a successful zero', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    payloads['/api/sales/daily'].today = {
      sales: 0,
      tickets: 0,
      avgTransaction: 0,
      hasData: false,
    };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const response = await getOverview(
        new Request('http://localhost/api/overview?date=2026-07-30'),
      );
      const body = await response.json();

      expect(body.sales).toMatchObject({
        status: 'ready',
        data: {
          hasData: false,
          revenue: null,
          tickets: null,
          averageTransaction: null,
        },
      });
      expect(JSON.stringify(body.sales.data)).not.toContain('"revenue":0');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('isolates malformed connection freshness without blanking healthy domains', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    const firstSource = payloads['/api/connections/status'].sources[0] as {
      lastSuccessAt: unknown;
    };
    firstSource.lastSuccessAt = 42;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const response = await getOverview(
        new Request('http://localhost/api/overview?date=2026-07-30'),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.connections).toEqual({
        status: 'error',
        data: null,
        updatedAt: null,
        message: 'Automatic import health unavailable',
      });
      expect(body.sales).toMatchObject({
        status: 'ready',
        data: { revenue: 8_420 },
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it.each([
    {
      name: 'a missing canonical source',
      mutate: (sources: unknown[]) => sources.slice(0, 4),
    },
    {
      name: 'a duplicate canonical source',
      mutate: (sources: unknown[]) => [
        ...sources.slice(0, 4),
        sources[0],
      ],
    },
    {
      name: 'an invalid source timestamp',
      mutate: (sources: unknown[]) => sources.map((source, index) => (
        index === 0
          ? { ...(source as object), lastSuccessAt: 'not-an-instant' }
          : source
      )),
    },
  ])('rejects connections with $name without blanking sales', async ({ mutate }) => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    payloads['/api/connections/status'].sources = mutate(
      payloads['/api/connections/status'].sources,
    ) as typeof payloads['/api/connections/status']['sources'];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.connections.status).toBe('error');
      expect(body.sales.status).toBe('ready');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('rejects an overall healthy connection result with an unhealthy source', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    payloads['/api/connections/status'].overall = 'healthy';
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.connections.status).toBe('error');
      expect(body.sales.status).toBe('ready');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it.each([
    {
      name: 'healthy without success timestamps',
      overall: 'healthy',
      mutate: (source: Record<string, unknown>) => ({
        ...source,
        status: 'healthy',
        lastAttemptAt: null,
        lastSuccessAt: null,
      }),
    },
    {
      name: 'never with historical timestamps',
      overall: 'attention',
      mutate: (source: Record<string, unknown>) => ({
        ...source,
        status: 'never',
      }),
    },
    {
      name: 'failed without an attempt timestamp',
      overall: 'attention',
      mutate: (source: Record<string, unknown>) => ({
        ...source,
        status: 'failed',
        lastAttemptAt: null,
      }),
    },
    {
      name: 'healthy after a later unsuccessful attempt',
      overall: 'attention',
      mutate: (source: Record<string, unknown>) => ({
        ...source,
        status: 'healthy',
        lastAttemptAt: '2026-07-30T20:00:00.000Z',
        lastSuccessAt: '2026-07-30T19:55:00.000Z',
      }),
    },
  ])('rejects connection source status $name', async ({ mutate, overall }) => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    payloads['/api/connections/status'].overall =
      overall as typeof payloads['/api/connections/status']['overall'];
    payloads['/api/connections/status'].sources[0] = mutate(
      payloads['/api/connections/status'].sources[0],
    ) as typeof payloads['/api/connections/status']['sources'][number];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.connections.status).toBe('error');
      expect(body.sales.status).toBe('ready');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('rejects attention when all five sources are healthy', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    payloads['/api/connections/status'].sources =
      payloads['/api/connections/status'].sources.map((source) => ({
        ...source,
        status: 'healthy',
        message: null,
      }));
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.connections.status).toBe('error');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('accepts not-configured connection status alongside historical source health', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    payloads['/api/connections/status'].overall = 'not-configured';
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.connections).toMatchObject({
        status: 'ready',
        data: { overall: 'not-configured' },
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('accepts PostgreSQL microsecond timestamps as real instants', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    const sales = payloads['/api/connections/status'].sources[0];
    sales.lastAttemptAt = '2026-07-30T19:55:00.123456+00:00';
    sales.lastSuccessAt = '2026-07-30T19:55:00.123456+00:00';
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.connections.status).toBe('ready');
      expect(body.sales.updatedAt).toBe(
        '2026-07-30T19:55:00.123456+00:00',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('derives coverage gaps from schedule flight evidence when the flight domain fails', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    Object.assign(payloads['/api/schedules/latest'].schedules[0], {
      flights: payloads['/api/flights/day'].flights.map(
        ({ id: _id, ...flight }) => flight,
      ),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T23:00:00.000Z'));
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/api/flights/day') {
        return Response.json({ error: 'failed' }, { status: 500 });
      }
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = (await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json()) as OverviewResponse;
      expect(body.flights.status).toBe('error');
      expect(body.schedule).toMatchObject({
        status: 'ready',
        data: { gaps: [{ flightNumber: 'BA2157', passengers: 184 }] },
      });
      expect(deriveActions(body)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'uncovered-flight' }),
        ]),
      );
    } finally {
      global.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it('marks coverage gaps unknown when neither flight domain supplies evidence', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/api/flights/day') {
        return Response.json({ error: 'failed' }, { status: 500 });
      }
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.schedule).toMatchObject({
        status: 'ready',
        data: { gaps: null },
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not use the inventory snapshot date as an import-success timestamp', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    const inventory = payloads['/api/connections/status'].sources.find(
      (source) => source.source === 'inventory',
    ) as {
      status: 'healthy' | 'stale' | 'failed' | 'never';
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
    } | undefined;
    if (inventory) {
      inventory.status = 'never';
      inventory.lastAttemptAt = null;
      inventory.lastSuccessAt = null;
    }
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const body = await (
        await getOverview(
          new Request('http://localhost/api/overview?date=2026-07-30'),
        )
      ).json();
      expect(body.inventory).toMatchObject({
        status: 'ready',
        updatedAt: null,
        data: { snapshotDate: '2026-07-30' },
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not call a departed high-value flight an uncovered action', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    payloads['/api/flights/day'].flights[0].scheduled_time =
      '2026-07-30T00:01:00';
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const response = await getOverview(
        new Request('http://localhost/api/overview?date=2026-07-30'),
      );
      const body = (await response.json()) as OverviewResponse;

      expect(
        deriveActions(body).some(
          (action) => action.kind === 'uncovered-flight',
        ),
      ).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('uses the Antigua operating day and clock across the UTC date boundary', async () => {
    const originalFetch = global.fetch;
    const payloads = rawDomainResponses();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T00:00:00.000Z'));
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return Response.json(payloads[pathname as keyof typeof payloads]);
    }) as typeof fetch;

    try {
      const response = await getOverview(
        new Request('http://localhost/api/overview'),
      );
      const body = (await response.json()) as OverviewResponse;

      expect(body.date).toBe('2026-07-30');
      expect(body.flights).toMatchObject({
        status: 'ready',
        data: {
          nextPeakAt: '20:05',
          peakPassengers: 184,
        },
      });
    } finally {
      global.fetch = originalFetch;
      vi.useRealTimers();
    }
  });
});

describe('daily action brief', () => {
  it('shows an Antigua-local greeting and aggregate availability summary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T00:00:00.000Z'));
    try {
      render(
        <OverviewPage
          initialResponse={overviewFixture({
            sales: ready({
              hasData: true,
              revenue: 8_420,
              tickets: 42,
              averageTransaction: 200.48,
              comparisonPercent: 12,
            }, '2026-07-29T00:00:00.000Z'),
            connections: {
              status: 'error',
              data: null,
              updatedAt: null,
              message: 'Automatic import health unavailable',
            },
          })}
        />,
      );
      expect(screen.getByText('Good evening')).toBeInTheDocument();
      expect(screen.getByText('4 current · 1 stale · 1 unavailable')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders linked priority actions and the operational traffic window', () => {
    render(<OverviewPage initialResponse={overviewFixture()} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Today’s action brief' }),
    ).toBeInTheDocument();
    const actionList = screen.getByRole('list', { name: 'Priority actions' });
    expect(within(actionList).getAllByRole('link')).toHaveLength(3);
    expect(
      within(actionList).getByRole('link', {
        name: /2 critical inventory items/i,
      }),
    ).toHaveAttribute('href', '/dashboard/inventory?risk=CRITICAL');
    expect(
      within(actionList).getByRole('link', {
        name: /BA2157 is outside staff coverage/i,
      }),
    ).toHaveAttribute(
      'href',
      '/dashboard/flights?date=2026-07-30&type=departure&airline=BA',
    );
    expect(
      screen.getByRole('region', { name: 'Traffic window' }),
    ).toHaveTextContent('20:05');
  });

  it('retains last successful domain data and timestamp when refresh returns an error', async () => {
    const originalFetch = global.fetch;
    const nextResponse = overviewFixture({
      sales: {
        status: 'error',
        data: null,
        updatedAt: null,
        message: 'Sales data unavailable',
      },
    });
    global.fetch = vi.fn().mockResolvedValue(Response.json(nextResponse));
    const user = userEvent.setup();

    try {
      render(<OverviewPage initialResponse={overviewFixture()} />);
      await user.click(screen.getByRole('button', { name: 'Refresh brief' }));

      const panel = screen.getByRole('region', { name: 'Sales pace' });
      expect(panel).toHaveTextContent('$8,420');
      expect(panel).toHaveTextContent('Showing last valid data');
      expect(
        within(panel).getByText('Last valid update').closest('p'),
      ).toContainElement(
        panel.querySelector(
          'time[datetime="2026-07-30T19:55:00.000Z"]',
        ),
      );
      expect(panel).not.toHaveTextContent('$0');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not retain date-bound data across an operating-day and month change', async () => {
    const originalFetch = global.fetch;
    const previous = overviewFixture({
      date: '2026-07-31',
      concession: ready({
        hasData: true,
        month: '2026-07',
        grossSalesUsd: 38_420,
        payableEcd: 5_120,
        exceedsThreshold: true,
      }),
    });
    const unavailable = (message: string) => ({
      status: 'error' as const,
      data: null,
      updatedAt: null,
      message,
    });
    const incoming = overviewFixture({
      date: '2026-08-01',
      sales: unavailable('Sales data unavailable'),
      flights: unavailable('Flight data unavailable'),
      schedule: unavailable('Staff coverage unavailable'),
      concession: unavailable('Concession data unavailable'),
      inventory: unavailable('Inventory data unavailable'),
      connections: unavailable('Automatic import health unavailable'),
    });
    global.fetch = vi.fn().mockResolvedValue(Response.json(incoming));
    const user = userEvent.setup();

    try {
      render(<OverviewPage initialResponse={previous} />);
      await user.click(screen.getByRole('button', { name: 'Refresh brief' }));

      expect(screen.getByRole('region', { name: 'Sales pace' })).not.toHaveTextContent('$8,420');
      expect(screen.getByRole('region', { name: 'Upcoming traffic' })).not.toHaveTextContent('BA2157');
      expect(screen.getByRole('region', { name: 'Staff coverage' })).not.toHaveTextContent('68%');
      expect(screen.queryByText('EC$5,120')).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Inventory actions' })).toHaveTextContent('Showing last valid data');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('shows inventory snapshot date separately when update time is unavailable', () => {
    render(
      <OverviewPage
        initialResponse={overviewFixture({
          inventory: ready({
            hasData: true,
            criticalCount: 2,
            atRiskCount: 4,
            deadStockValue: 1_200,
            snapshotDate: '2026-07-30',
          }, null),
        })}
      />,
    );

    const panel = screen.getByRole('region', { name: 'Inventory actions' });
    expect(panel).toHaveTextContent('Update time unavailable');
    expect(panel).toHaveTextContent('Snapshot dated July 30, 2026');
  });

  it('renders unknown schedule gaps without a positive zero', () => {
    render(
      <OverviewPage
        initialResponse={overviewFixture({
          schedule: ready({
            hasData: true,
            coverageScore: 68,
            staffOnDuty: 1,
            shifts: [],
            gaps: null,
          }),
        })}
      />,
    );

    const panel = screen.getByRole('region', { name: 'Staff coverage' });
    expect(panel).toHaveTextContent('Coverage gaps unknown');
    expect(panel).not.toHaveTextContent('High-value windows0');
  });

  it('renders malformed retained timestamps defensively', () => {
    render(
      <OverviewPage
        initialResponse={overviewFixture({
          connections: {
            status: 'error',
            message: 'Automatic import health unavailable',
            updatedAt: 'not-an-instant',
            data: {
              overall: 'attention',
              sources: [],
              unhealthySources: [
                {
                  source: 'sales',
                  status: 'stale',
                  lastSuccessAt: 'also-not-an-instant',
                  message: null,
                },
              ],
            },
          },
        })}
      />,
    );

    const panel = screen.getByRole('region', {
      name: 'Automatic import health',
    });
    expect(panel).toHaveTextContent('Time unavailable');
  });

  it('does not let an older refresh replace a newer result', async () => {
    const originalFetch = global.fetch;
    let resolveOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const newer = overviewFixture({
      sales: ready({
        hasData: true,
        revenue: 9_100,
        tickets: 45,
        averageTransaction: 202.22,
        comparisonPercent: 15,
      }, '2026-07-30T20:10:00.000Z'),
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(Response.json(newer));
    global.fetch = fetchMock as typeof fetch;

    try {
      render(<OverviewPage initialResponse={overviewFixture()} />);
      const refresh = screen.getByRole('button', { name: 'Refresh brief' });

      act(() => {
        refresh.click();
        refresh.click();
      });

      expect(await screen.findByText(/\$9,100/)).toBeInTheDocument();

      await act(async () => {
        resolveOld(
          Response.json(
            overviewFixture({
              sales: ready({
                hasData: true,
                revenue: 100,
                tickets: 1,
                averageTransaction: 100,
                comparisonPercent: -90,
              }),
            }),
          ),
        );
        await oldResponse;
      });

      expect(screen.getByText(/\$9,100/)).toBeInTheDocument();
      expect(screen.queryByText(/^(?:US)?\$100$/)).not.toBeInTheDocument();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('shows unavailable domains without formatting missing values as zero', () => {
    render(
      <OverviewPage
        initialResponse={overviewFixture({
          inventory: {
            status: 'error',
            data: null,
            updatedAt: null,
            message: 'Inventory data unavailable',
          },
          sales: ready({
            hasData: false,
            revenue: null,
            tickets: null,
            averageTransaction: null,
            comparisonPercent: null,
          }),
        })}
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Inventory actions' }),
    ).toHaveTextContent('Inventory data unavailable');
    const sales = screen.getByRole('region', { name: 'Sales pace' });
    expect(sales).toHaveTextContent('No sales report has arrived for today');
    expect(sales).not.toHaveTextContent('$0');
  });
});
