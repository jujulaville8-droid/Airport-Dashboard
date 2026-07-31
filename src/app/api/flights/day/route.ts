import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const date = searchParams.get('date');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('flight_data')
      .select('id, flight_num, airline_code, scheduled_time, flight_type, estimated_passengers, actual_passengers')
      .eq('flight_date', date)
      .order('scheduled_time', { ascending: true });

    if (error) throw error;

    return Response.json({ date, flights: data || [] });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
