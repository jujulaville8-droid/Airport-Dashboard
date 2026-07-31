import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlightsPage } from './FlightsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FlightsPage', () => {
  it('presents AeroDataBox departures and their refresh state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/flights/day')) {
        return new Response(JSON.stringify({
          date: '2026-07-31',
          source: {
            provider: 'AeroDataBox',
            status: 'updated',
            records: 1,
            lastSuccessAt: '2026-07-31T12:00:00.000Z',
            message: null,
          },
          flights: [{
            id: 'flight-1',
            flight_num: 'AC1832',
            airline_code: 'AC',
            scheduled_time: '2026-07-31T15:10:00-04:00',
            flight_type: 'departure',
            estimated_passengers: 130,
            actual_passengers: null,
            origin_destination: 'YYZ',
            status: 'scheduled',
            gate: '3',
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        totalDepartures: 1,
        totalPassengers: 130,
        avgDailyPax: 130,
        busiestDay: null,
        dayOfWeekAvg: [],
      }), { status: 200 });
    });

    render(<FlightsPage />);

    expect(await screen.findByText(/AeroDataBox departures/i)).toBeInTheDocument();
    expect(screen.getByText('YYZ')).toBeInTheDocument();
    expect(screen.getByText('scheduled', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /arrivals/i })).not.toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  });
});
