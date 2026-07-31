import { describe, expect, it } from 'vitest';
import { deriveActions } from './derive-actions';
import type {
  OverviewResponse,
  ReadyDomainResult,
} from './types';

function ready<T>(data: T, updatedAt = '2026-07-30T19:55:00.000Z'): ReadyDomainResult<T> {
  return { status: 'ready', data, updatedAt };
}

function responseFixture(
  overrides: Partial<OverviewResponse> = {},
): OverviewResponse {
  return {
    generatedAt: '2026-07-30T20:00:00.000Z',
    date: '2026-07-30',
    sales: ready({
      hasData: false,
      revenue: null,
      tickets: null,
      averageTransaction: null,
      comparisonPercent: null,
    }),
    inventory: ready({
      hasData: false,
      criticalCount: null,
      atRiskCount: null,
      deadStockValue: null,
      snapshotDate: null,
    }),
    flights: ready({
      hasData: false,
      flights: [],
      nextPeakAt: null,
      peakPassengers: null,
    }),
    schedule: ready({
      hasData: false,
      coverageScore: null,
      staffOnDuty: null,
      shifts: [],
      gaps: [],
    }),
    concession: ready({
      hasData: false,
      month: '2026-07',
      grossSalesUsd: null,
      payableEcd: null,
      exceedsThreshold: null,
    }),
    connections: ready({
      overall: 'healthy',
      unhealthySources: [],
      sources: [],
    }),
    ...overrides,
  };
}

describe('deriveActions', () => {
  it('uses the exact priority order and limits a busy day to three actions', () => {
    const response = responseFixture({
      inventory: ready({
        hasData: true,
        criticalCount: 2,
        atRiskCount: 4,
        deadStockValue: 1_200,
        snapshotDate: '2026-07-30',
      }),
      schedule: ready({
        hasData: true,
        coverageScore: 68,
        staffOnDuty: 1,
        shifts: [],
        gaps: [
          {
            airline: 'BA',
            flightNumber: 'BA2157',
            passengers: 184,
            scheduledAt: '20:05',
          },
        ],
      }),
      connections: ready({
        overall: 'attention',
        unhealthySources: [
          {
            source: 'item_sales',
            status: 'failed',
            lastSuccessAt: '2026-07-29T19:00:00.000Z',
            message: 'Workbook could not be parsed',
          },
        ],
        sources: [],
      }),
      concession: ready({
        hasData: true,
        month: '2026-07',
        grossSalesUsd: 38_420,
        payableEcd: 5_120,
        exceedsThreshold: true,
      }),
      flights: ready({
        hasData: true,
        flights: [],
        nextPeakAt: '20:05',
        peakPassengers: 302,
      }),
      sales: ready({
        hasData: true,
        revenue: 8_420,
        tickets: 42,
        averageTransaction: 200.48,
        comparisonPercent: 12,
      }),
    });

    const actions = deriveActions(response);

    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.kind)).toEqual([
      'critical-inventory',
      'uncovered-flight',
      'import-health',
    ]);
    expect(actions.map((action) => action.href)).toEqual([
      '/dashboard/inventory?risk=CRITICAL',
      '/dashboard/flights?date=2026-07-30&type=departure&airline=BA',
      '/dashboard/connections',
    ]);
    expect(actions.filter((action) => action.level === 'on-track')).toHaveLength(0);
  });

  it('orders concession, at-risk inventory, and passenger peak after higher priorities', () => {
    const response = responseFixture({
      inventory: ready({
        hasData: true,
        criticalCount: 0,
        atRiskCount: 4,
        deadStockValue: 0,
        snapshotDate: '2026-07-30',
      }),
      concession: ready({
        hasData: true,
        month: '2026-07',
        grossSalesUsd: 38_420,
        payableEcd: 5_120,
        exceedsThreshold: true,
      }),
      flights: ready({
        hasData: true,
        flights: [],
        nextPeakAt: '20:05',
        peakPassengers: 302,
      }),
    });

    expect(deriveActions(response).map((action) => ({
      kind: action.kind,
      href: action.href,
    }))).toEqual([
      {
        kind: 'concession-threshold',
        href: '/dashboard/concession?month=2026-07',
      },
      {
        kind: 'at-risk-inventory',
        href: '/dashboard/inventory?risk=AT_RISK',
      },
      {
        kind: 'passenger-peak',
        href: '/dashboard/flights?date=2026-07-30&type=departure',
      },
    ]);
  });

  it('returns one on-track sales action when no intervention outranks it', () => {
    const response = responseFixture({
      sales: ready({
        hasData: true,
        revenue: 8_420,
        tickets: 42,
        averageTransaction: 200.48,
        comparisonPercent: 12,
      }),
    });

    expect(deriveActions(response)).toEqual([
      expect.objectContaining({
        kind: 'positive-sales',
        level: 'on-track',
        href: '/dashboard/sales?date=2026-07-30',
      }),
    ]);
    expect(
      deriveActions(response).filter((action) => action.level === 'on-track'),
    ).toHaveLength(1);
  });

  it('does not derive healthy-looking actions from failed or missing data', () => {
    const response = responseFixture({
      sales: {
        status: 'error',
        data: null,
        updatedAt: null,
        message: 'Sales data unavailable',
      },
      inventory: ready({
        hasData: false,
        criticalCount: null,
        atRiskCount: null,
        deadStockValue: null,
        snapshotDate: null,
      }),
    });

    expect(deriveActions(response)).toEqual([]);
  });

  it('does not promote a never-seen source into the failed-or-stale import priority', () => {
    const response = responseFixture({
      connections: ready({
        overall: 'not-configured',
        unhealthySources: [
          {
            source: 'passenger_summary',
            status: 'never',
            lastSuccessAt: null,
            message: null,
          },
        ],
        sources: [],
      }),
    });

    expect(deriveActions(response)).toEqual([]);
  });
});
