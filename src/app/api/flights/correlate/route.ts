import { getSalesData, getFlightData } from '@/lib/db';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const date = searchParams.get('date');

    if (!date) {
      return Response.json({ error: 'date query param required (YYYY-MM-DD)' }, { status: 400 });
    }

    const startOfDay = `${date}T00:00:00`;
    const endOfDay = `${date}T23:59:59`;

    const [sales, flights] = await Promise.all([
      getSalesData(startOfDay, endOfDay),
      getFlightData(date),
    ]);

    const arrivals = flights.filter((f: Record<string, unknown>) => f.flight_type === 'arrival');
    const departures = flights.filter((f: Record<string, unknown>) => f.flight_type === 'departure');
    const totalPassengers = flights.reduce((sum: number, f: Record<string, unknown>) => sum + (Number(f.estimated_passengers) || 0), 0);
    const totalSales = sales.reduce((sum: number, t: Record<string, unknown>) => sum + Number(t.tot_amt), 0);

    return Response.json({
      date,
      flights: { total: flights.length, arrivals: arrivals.length, departures: departures.length, totalPassengers },
      sales: { totalTransactions: sales.length, totalRevenue: Math.round(totalSales * 100) / 100 },
      revenuePerPassenger: totalPassengers > 0 ? Math.round((totalSales / totalPassengers) * 100) / 100 : 0,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
