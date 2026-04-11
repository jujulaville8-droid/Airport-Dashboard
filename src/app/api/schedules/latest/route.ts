import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return Response.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    // Get schedules for the date range
    const { data: schedules, error } = await supabase
      .from('staff_schedules')
      .select('*')
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate)
      .order('schedule_date', { ascending: true })
      .order('shift_start', { ascending: true });

    if (error) throw error;
    if (!schedules || schedules.length === 0) {
      return Response.json({ exists: false });
    }

    // Get flight data for those dates to include in response
    const { data: flights, error: flightsError } = await supabase
      .from('flight_data')
      .select('flight_num, airline_code, scheduled_time, flight_type, estimated_passengers, flight_date')
      .gte('flight_date', startDate)
      .lte('flight_date', endDate)
      .eq('flight_type', 'departure')
      .order('flight_date', { ascending: true })
      .order('scheduled_time', { ascending: true });

    if (flightsError) throw flightsError;

    // Group by date
    const byDate: Record<string, { shifts: typeof schedules; flights: typeof flights }> = {};

    for (const s of schedules) {
      const d = s.schedule_date as string;
      if (!byDate[d]) byDate[d] = { shifts: [], flights: [] };
      byDate[d].shifts.push(s);
    }

    for (const f of (flights || [])) {
      const d = f.flight_date as string;
      if (!byDate[d]) byDate[d] = { shifts: [], flights: [] };
      byDate[d].flights!.push(f);
    }

    // Build response matching the generate endpoint format
    const allSchedules = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { shifts, flights: dayFlights }]) => {
        const shiftData = shifts.map(s => ({
          staffName: s.staff_name as string,
          start: (s.shift_start as string).substring(0, 5),
          end: (s.shift_end as string).substring(0, 5),
          hours: Number(s.shift_hours),
          coversPeaks: [] as string[],
        }));

        const nichelleShift = shiftData.find(s => s.staffName === 'Nichelle');
        const bilianaShift = shiftData.find(s => s.staffName === 'Biliana');
        const isBilianaDay = !nichelleShift && !!bilianaShift;

        // Calculate coverage
        const hvFlights = (dayFlights || []).filter(f => (f.estimated_passengers as number) >= 100);
        let covered = 0;
        for (const f of hvFlights) {
          const time = (f.scheduled_time as string).substring(11, 16);
          const [h, m] = time.split(':').map(Number);
          const shopWindow = h * 60 + m - 30;
          const isCov = shiftData.some(s => {
            const [sh, sm] = s.start.split(':').map(Number);
            const [eh, em] = s.end.split(':').map(Number);
            return shopWindow >= sh * 60 + sm && shopWindow < eh * 60 + em;
          });
          if (isCov) covered++;
        }
        const coverageScore = hvFlights.length > 0 ? Math.round((covered / hvFlights.length) * 100) : 100;

        return {
          date,
          shifts: shiftData,
          coverageScore,
          flightCount: (dayFlights || []).length,
          staffOnDuty: isBilianaDay ? 'Biliana' : 'Nichelle',
          dayOff: isBilianaDay ? 'Nichelle' : (bilianaShift ? undefined : 'Biliana'),
          flights: (dayFlights || []).map(f => ({
            flight_num: f.flight_num as string,
            airline_code: f.airline_code as string,
            scheduled_time: f.scheduled_time as string,
            flight_type: f.flight_type as string,
            estimated_passengers: f.estimated_passengers as number,
          })),
        };
      });

    // Staff hours
    const staffHours: Record<string, { totalHours: number; daysWorked: number }> = {};
    for (const day of allSchedules) {
      for (const shift of day.shifts) {
        if (!staffHours[shift.staffName]) staffHours[shift.staffName] = { totalHours: 0, daysWorked: 0 };
        staffHours[shift.staffName].totalHours += shift.hours;
        staffHours[shift.staffName].daysWorked += 1;
      }
    }
    for (const name of Object.keys(staffHours)) {
      staffHours[name].totalHours = Math.round(staffHours[name].totalHours * 10) / 10;
    }

    const totalWeeks = Math.ceil(allSchedules.length / 7);
    const nichelleTarget = totalWeeks * 40;

    const daysWithFlights = allSchedules.filter(s => s.flightCount > 0);
    const avgCoverage = daysWithFlights.length > 0
      ? Math.round(daysWithFlights.reduce((sum, s) => sum + s.coverageScore, 0) / daysWithFlights.length)
      : 100;

    return Response.json({
      exists: true,
      success: true,
      scheduleDate: startDate,
      scheduleDateEnd: endDate,
      totalDays: allSchedules.length,
      schedules: allSchedules,
      averageCoverage: avgCoverage,
      nichelleDays: allSchedules.filter(s => s.staffOnDuty === 'Nichelle').length,
      bilianaDays: allSchedules.filter(s => s.staffOnDuty === 'Biliana').length,
      staffHours,
      nichelleTarget,
      nichelleOnTarget: Math.abs((staffHours['Nichelle']?.totalHours || 0) - nichelleTarget) <= 2,
      briefing: '',
    });
  } catch (error) {
    console.error('[api/schedules/latest] error:', error);
    return Response.json({ error: 'Failed to load schedule' }, { status: 500 });
  }
}
