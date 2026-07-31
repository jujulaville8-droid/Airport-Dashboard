import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesPage } from './SalesPage';
import type { SalesScreenState } from './types';

afterEach(cleanup);

const monthlyFixture: SalesScreenState = {
  kind: 'stale',
  message: 'Latest sync failed',
  data: {
    daily: {
      date: '2026-07-30',
      dayName: 'Thursday',
      today: {
        hasData: true,
        sales: 8420,
        tickets: 42,
        discount: 0,
        avgTransaction: 200.48,
        hourly: null,
      },
      comparison: {
        lastWeek: { date: '2026-07-23', sales: 7200, tickets: 38, hasData: true },
        pctVsLastWeek: 17,
        dowAvg: 7600,
        pctVsDowAvg: 11,
        dowCount: 8,
      },
      trend: [],
    },
    months: [{ month: '2026-07', totalSales: 8420, totalTickets: 42, totalDays: 1 }],
    selectedMonth: {
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      totalSales: 8420,
      totalTransactions: 42,
      avgTransaction: 200.48,
      dailyData: [],
    },
  },
};

describe('SalesPage', () => {
  it('labels a missing day instead of presenting zero revenue', () => {
    render(<SalesPage initialState={{ kind: 'empty', date: '2026-07-30' }} />);

    expect(screen.getByText('No sales report has arrived for this day')).toBeVisible();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /data connections/i })).toHaveAttribute(
      'href',
      '/dashboard/connections',
    );
  });

  it('keeps monthly results visible when refresh fails', () => {
    render(<SalesPage initialState={monthlyFixture} />);

    expect(screen.getByText(/Latest sync failed/)).toBeVisible();
    expect(screen.getByText('$8,420.00')).toBeVisible();
  });

  it('keeps monthly history available when today has not arrived yet', () => {
    const data = {
      ...monthlyFixture.data,
      daily: {
        ...monthlyFixture.data.daily,
        today: { ...monthlyFixture.data.daily.today, hasData: false, sales: 0, tickets: 0 },
      },
    };
    render(<SalesPage initialState={{ kind: 'ready', data }} />);

    expect(screen.getByText('No sales report has arrived for this day')).toBeVisible();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Monthly' })).toBeVisible();
  });

  it('keeps AI analysis an explicit monthly action', async () => {
    render(<SalesPage initialState={monthlyFixture} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Monthly' }));

    expect(screen.getByRole('button', { name: /run ai analysis/i })).toBeVisible();
  });

  it('retains a previous monthly drill-down when its refresh fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const apiResponse = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
    const daily = monthlyFixture.data.daily;
    const months = { summaries: monthlyFixture.data.months, latestMonth: '2026-07' };
    const responses = [
      apiResponse(daily), apiResponse(months), apiResponse(monthlyFixture.data.selectedMonth),
      apiResponse(daily), apiResponse(months), apiResponse({ error: 'Unavailable' }, false),
    ];
    fetchMock.mockImplementation(async () => responses.shift() ?? apiResponse({ error: 'Unavailable' }, false));

    render(<SalesPage />);
    await screen.findByText('Sales reporting');
    await screen.findByText('$8,420.00');

    await userEvent.click(screen.getByRole('button', { name: 'Refresh reports' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Showing the last successful sales results'));
    await userEvent.click(screen.getByRole('tab', { name: 'Monthly' }));

    expect(screen.getByText('Monthly revenue trend')).toBeVisible();
    fetchMock.mockRestore();
  });
});
