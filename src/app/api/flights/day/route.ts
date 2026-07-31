import { supabase } from '@/lib/db';
import { ensureDepartureDataFresh, type FlightSyncResult } from '@/lib/flight-sync';
import { NextRequest } from 'next/server';

function todayInAntigua(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Antigua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const date = searchParams.get('date');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
    }

    const today = todayInAntigua();
    const offset = daysBetween(today, date);
    let source: FlightSyncResult = {
      status: 'fresh',
      records: 0,
      lastSuccessAt: null,
      message: 'Showing stored departure data.',
    };
    if (offset >= 0 && offset <= 13) {
      try {
        source = await ensureDepartureDataFresh({
          mode: offset === 0 ? 'live' : 'planning',
          startDate: offset === 0 ? date : today,
          ...(offset === 0 ? {} : { days: 14 }),
        });
      } catch {
        source = {
          status: 'failed',
          records: 0,
          lastSuccessAt: null,
          message: 'Departure refresh failed; showing stored data.',
        };
      }
    }

    const { data, error } = await supabase
      .from('flight_data')
      .select('id, flight_num, airline_code, scheduled_time, flight_type, estimated_passengers, actual_passengers, origin_destination, status, gate')
      .eq('flight_date', date)
      .eq('flight_type', 'departure')
      .order('scheduled_time', { ascending: true });

    if (error) throw error;

    return Response.json({
      date,
      source: { provider: 'AeroDataBox', ...source },
      flights: data || [],
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
