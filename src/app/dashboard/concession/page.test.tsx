import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConcessionPage from './page';

vi.mock('animejs', () => ({ default: vi.fn(Object.assign(() => undefined, { stagger: () => 0 })) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ConcessionPage', () => {
  it('makes the month rent position and calculator inputs visible together', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sales/months') {
        return { ok: true, json: async () => ({ months: ['2026-07'], latestMonth: '2026-07' }) };
      }
      return {
        ok: true,
        json: async () => ({
          grossSalesUSD: 20_000, grossSalesECD: 54_000, ccSalesUSD: 0, ccCommissionECD: 0,
          cashSalesUSD: 20_000, cashSalesECD: 54_000, totalNetSalesUSD: 20_000,
          totalNetSalesECD: 54_000, rentPercentageECD: 5_400, magECD: 4_198,
          exceedsThreshold: true, concessionPayableECD: 1_202, concessionPayableUSD: 445.19,
          dailyBreakdown: [],
        }),
      };
    }));

    render(<ConcessionPage />);

    expect(await screen.findByText('Rental position')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Enter payment mix' })).toBeVisible();
    expect(screen.getByRole('button', { name: /export airport calculator/i })).toBeVisible();
  });
});
