import { getFlightDataForMonth } from '@/lib/db';
import { ensureDepartureDataFresh } from '@/lib/flight-sync';
import { NextRequest } from 'next/server';

const HV_THRESHOLD = 100;

interface DayAnalytics {
  date: string;
  dayOfWeek: string;
  totalFlights: number;
  departures: number;
  arrivals: number;
  hvDepartures: number; // 100+ pax
  totalPassengers: number;
  hvPassengers: number;
  // Actual passenger counts from ABAA Carrier Passenger Summary emails.
  // `actualPassengers` sums only the departures with a confirmed number;
  // `actualCoverage` is the fraction of departures on this day that have
  // an actual count (0.0–1.0). Both are zero when no email has been
  // ingested for the day yet.
  actualPassengers: number;
  actualDeparturesWithCount: number;
  actualCoverage: number;
  firstHVDeparture: string | null;
  lastHVDeparture: string | null;
  peakHour: string | null; // hour with most departures
  airlines: string[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const month = searchParams.get('month'); // e.g. "2026-04"

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'month param required (YYYY-MM)' }, { status: 400 });
    }

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Antigua',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (month === today.slice(0, 7)) {
      try {
        await ensureDepartureDataFresh({ mode: 'planning', startDate: today, days: 14 });
      } catch {
        console.error('[api/flights/analytics] provider refresh failed; using stored data');
      }
    }

    const flights = await getFlightDataForMonth(month);

    if (!flights || flights.length === 0) {
      return Response.json({
        month,
        totalFlights: 0,
        totalDepartures: 0,
        totalHVDepartures: 0,
        totalPassengers: 0,
        avgDailyPax: 0,
        busiestDay: null,
        quietestDay: null,
        dayOfWeekAvg: [],
        airlines: [],
        days: [],
      });
    }

    // Group by date
    const byDate: Record<string, typeof flights> = {};
    for (const f of flights) {
      const d = f.flight_date as string;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(f);
    }

    // Build daily analytics
    const days: DayAnalytics[] = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayFlights]) => {
        const departures = dayFlights.filter(f => f.flight_type === 'departure');
        const arrivals = dayFlights.filter(f => f.flight_type === 'arrival');
        const hvDeps = departures.filter(f => (f.estimated_passengers as number) >= HV_THRESHOLD);

        const totalPax = departures.reduce((sum, f) => sum + (f.estimated_passengers as number), 0);
        const hvPax = hvDeps.reduce((sum, f) => sum + (f.estimated_passengers as number), 0);

        // Actual pax totals (departures only, from the carrier capacity emails)
        const actualDepartures = departures.filter(
          (f) => f.actual_passengers !== null && f.actual_passengers !== undefined
        );
        const actualPax = actualDepartures.reduce(
          (sum, f) => sum + (f.actual_passengers as number),
          0
        );
        const actualCoverage = departures.length > 0
          ? actualDepartures.length / departures.length
          : 0;

        // Peak hour
        const hourCounts: Record<string, number> = {};
        for (const f of departures) {
          const hour = (f.scheduled_time as string).substring(11, 13) + ':00';
          hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        }
        const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        // Unique airlines
        const airlines = [...new Set(departures.map(f => f.airline_code as string).filter(Boolean))];

        const d = new Date(date + 'T12:00:00');

        return {
          date,
          dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'long' }),
          totalFlights: dayFlights.length,
          departures: departures.length,
          arrivals: arrivals.length,
          hvDepartures: hvDeps.length,
          totalPassengers: totalPax,
          hvPassengers: hvPax,
          actualPassengers: actualPax,
          actualDeparturesWithCount: actualDepartures.length,
          actualCoverage: Math.round(actualCoverage * 100) / 100,
          firstHVDeparture: hvDeps.length > 0 ? (hvDeps[0].scheduled_time as string).substring(11, 16) : null,
          lastHVDeparture: hvDeps.length > 0 ? (hvDeps[hvDeps.length - 1].scheduled_time as string).substring(11, 16) : null,
          peakHour,
          airlines,
        };
      });

    // Monthly summary
    const totalDepartures = days.reduce((sum, d) => sum + d.departures, 0);
    const totalHVDepartures = days.reduce((sum, d) => sum + d.hvDepartures, 0);
    const totalPassengers = days.reduce((sum, d) => sum + d.totalPassengers, 0);
    const avgDailyPax = days.length > 0 ? Math.round(totalPassengers / days.length) : 0;
    const busiestDay = days.reduce((max, d) => d.totalPassengers > max.totalPassengers ? d : max, days[0]);
    const quietestDay = days.reduce((min, d) => d.totalPassengers < min.totalPassengers ? d : min, days[0]);

    // Day-of-week averages
    const dowTotals: Record<string, { pax: number; count: number; hvDeps: number }> = {};
    for (const d of days) {
      if (!dowTotals[d.dayOfWeek]) dowTotals[d.dayOfWeek] = { pax: 0, count: 0, hvDeps: 0 };
      dowTotals[d.dayOfWeek].pax += d.totalPassengers;
      dowTotals[d.dayOfWeek].count += 1;
      dowTotals[d.dayOfWeek].hvDeps += d.hvDepartures;
    }
    const dayOfWeekAvg = Object.entries(dowTotals).map(([day, t]) => ({
      day,
      avgPassengers: Math.round(t.pax / t.count),
      avgHVDepartures: Math.round((t.hvDeps / t.count) * 10) / 10,
    })).sort((a, b) => {
      const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      return order.indexOf(a.day) - order.indexOf(b.day);
    });

    // Unique airlines across the month
    const allAirlines = [...new Set(days.flatMap(d => d.airlines))].sort();

    return Response.json({
      month,
      totalFlights: flights.length,
      totalDepartures,
      totalHVDepartures,
      totalPassengers,
      avgDailyPax,
      busiestDay: busiestDay ? { date: busiestDay.date, dayOfWeek: busiestDay.dayOfWeek, passengers: busiestDay.totalPassengers } : null,
      quietestDay: quietestDay ? { date: quietestDay.date, dayOfWeek: quietestDay.dayOfWeek, passengers: quietestDay.totalPassengers } : null,
      dayOfWeekAvg,
      airlines: allAirlines,
      days,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
