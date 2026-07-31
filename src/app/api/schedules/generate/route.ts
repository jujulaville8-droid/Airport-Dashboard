import { optimizeSchedule, planWeek, DEFAULT_STAFF } from '@/lib/schedule';
import type { StaffMember, FlightRecord } from '@/lib/schedule';
import { getFlightData, storeSchedule } from '@/lib/db';
import { NextRequest } from 'next/server';
import type { TablesInsert } from '@/lib/database.types';
import { ensureDeparturePlanningHorizonFresh } from '@/lib/flight-sync';

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function todayInAntigua(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Antigua',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scheduleDate, scheduleDateEnd, staff } = body;

    if (!scheduleDate) {
      return Response.json({ error: 'scheduleDate is required (YYYY-MM-DD)' }, { status: 400 });
    }

    const staffMembers: StaffMember[] = staff || DEFAULT_STAFF;
    const startDate = parseIsoDate(scheduleDate);
    const endDate = parseIsoDate(scheduleDateEnd ?? scheduleDate);
    if (!startDate || !endDate || endDate < startDate) {
      return Response.json({ error: 'Invalid schedule date range' }, { status: 400 });
    }

    const requestedDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    if (requestedDays > 14) {
      return Response.json({ error: 'Schedule range cannot exceed 14 days' }, { status: 400 });
    }
    const today = todayInAntigua();
    const planningEnd = new Date(`${today}T00:00:00.000Z`);
    planningEnd.setUTCDate(planningEnd.getUTCDate() + 13);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    if (startDate < todayDate || endDate > planningEnd) {
      return Response.json(
        { error: 'Schedules must stay within the upcoming 14-day flight window' },
        { status: 400 },
      );
    }
    try {
      let syncResult = await ensureDeparturePlanningHorizonFresh(today);
      for (let attempt = 0; syncResult.status === 'in-progress' && attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        syncResult = await ensureDeparturePlanningHorizonFresh(today);
      }
      if (syncResult.status === 'in-progress') {
        return Response.json(
          { error: 'Departure refresh is still running. Please retry shortly.' },
          { status: 409 },
        );
      }
    } catch {
      console.error('[api/schedules/generate] provider refresh failed; using stored data');
    }

    interface FlightDetailOut {
      flight_num: string;
      airline_code: string;
      scheduled_time: string;
      flight_type: string;
      estimated_passengers: number;
    }

    // Gather all flights for the date range first
    const dailyFlightData: { date: string; flights: FlightRecord[]; details: FlightDetailOut[] }[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const dateStr = current.toISOString().split('T')[0];
      const rawFlights = await getFlightData(dateStr);
      const flightRecords: FlightRecord[] = rawFlights.map((f: Record<string, unknown>) => ({
        scheduled_time: f.scheduled_time as string,
        flight_type: f.flight_type as 'arrival' | 'departure',
        estimated_passengers: f.estimated_passengers as number,
      }));
      const flightDetails = rawFlights.map((f: Record<string, unknown>) => ({
        flight_num: f.flight_num as string,
        airline_code: f.airline_code as string,
        scheduled_time: f.scheduled_time as string,
        flight_type: f.flight_type as string,
        estimated_passengers: f.estimated_passengers as number,
      }));
      dailyFlightData.push({ date: dateStr, flights: flightRecords, details: flightDetails });
      current.setDate(current.getDate() + 1);
    }

    // Plan week by week: pick Biliana's 2 days per 7-day block
    const weekPlans: { date: string; isBilianaDay: boolean; needsTwoStaff: boolean; needsOverlap: boolean; demandScore: number }[] = [];
    for (let i = 0; i < dailyFlightData.length; i += 7) {
      const weekSlice = dailyFlightData.slice(i, i + 7);
      const plan = planWeek(weekSlice);
      weekPlans.push(...plan);
    }

    // Generate schedule for each day
    const allSchedules: {
      date: string;
      shifts: { staffName: string; start: string; end: string; hours: number; coversPeaks: string[] }[];
      coverageScore: number;
      flightCount: number;
      staffOnDuty: string;
      dayOff: string;
      flights: FlightDetailOut[];
    }[] = [];
    const allRecords: TablesInsert<'staff_schedules'>[] = [];

    for (let i = 0; i < dailyFlightData.length; i++) {
      const { date, flights } = dailyFlightData[i];
      const weekPlan = weekPlans.find(w => w.date === date);
      const isBilianaDay = weekPlan?.isBilianaDay ?? false;
      const needsOverlap = weekPlan?.needsOverlap ?? false;

      const schedule = optimizeSchedule(staffMembers, flights, i, isBilianaDay, needsOverlap);

      const scheduleRecords = schedule.shifts.map((shift) => ({
        schedule_date: date,
        staff_name: shift.staffName,
        shift_start: shift.start,
        shift_end: shift.end,
        shift_hours: shift.hours,
        generated_by: 'ai',
        ai_confidence: schedule.coverageScore / 100,
        status: 'pending',
      }));

      allSchedules.push({
        date,
        shifts: schedule.shifts,
        coverageScore: schedule.coverageScore,
        flightCount: flights.length,
        staffOnDuty: isBilianaDay ? 'Biliana' : 'Nichelle',
        dayOff: isBilianaDay ? 'Nichelle' : 'Biliana',
        flights: dailyFlightData[i].details,
      });
      allRecords.push(...scheduleRecords);
    }

    // Clear old schedules for this date range before storing new ones.
    // Abort if delete fails — otherwise the insert below would duplicate shifts.
    const { supabase } = await import('@/lib/db');
    const { error: delError } = await supabase
      .from('staff_schedules')
      .delete()
      .gte('schedule_date', scheduleDate)
      .lte('schedule_date', endDate.toISOString().split('T')[0]);

    if (delError) {
      throw new Error(`Failed to clear prior schedules: ${delError.message}`);
    }

    // Store all schedules
    if (allRecords.length > 0) {
      await storeSchedule(allRecords);
    }

    // Schedule summary (no API call — pure code)
    const bilianaDays = allSchedules.filter(s => s.staffOnDuty === 'Biliana');
    const nichelleDays = allSchedules.filter(s => s.staffOnDuty === 'Nichelle');
    const briefing = '';

    // Calculate per-staff total hours
    const staffHours: Record<string, { totalHours: number; daysWorked: number }> = {};
    for (const day of allSchedules) {
      for (const shift of day.shifts) {
        if (!staffHours[shift.staffName]) staffHours[shift.staffName] = { totalHours: 0, daysWorked: 0 };
        staffHours[shift.staffName].totalHours += shift.hours;
        staffHours[shift.staffName].daysWorked += 1;
      }
    }

    // Round hours
    for (const name of Object.keys(staffHours)) {
      staffHours[name].totalHours = Math.round(staffHours[name].totalHours * 10) / 10;
    }

    // Check Nichelle's hours — she needs exactly 40 per week
    const totalWeeks = Math.ceil(allSchedules.length / 7);
    const nichelleTarget = totalWeeks * 40;
    const nichelleActual = staffHours['Nichelle']?.totalHours || 0;
    const nichelleOnTarget = Math.abs(nichelleActual - nichelleTarget) <= 2; // within 2 hours tolerance

    // Always return multi-day format for bi-weekly
    return Response.json({
      success: true,
      scheduleDate,
      scheduleDateEnd: endDate.toISOString().split('T')[0],
      totalDays: allSchedules.length,
      schedules: allSchedules,
      averageCoverage: (() => {
        // Only average days that have flights (don't inflate with 100% empty days)
        const daysWithFlights = allSchedules.filter(s => s.flightCount > 0);
        if (daysWithFlights.length === 0) return 100;
        return Math.round(daysWithFlights.reduce((sum, s) => sum + s.coverageScore, 0) / daysWithFlights.length);
      })(),
      nichelleDays: nichelleDays.length,
      bilianaDays: bilianaDays.length,
      staffHours,
      nichelleTarget,
      nichelleOnTarget,
      briefing,
    });
  } catch (error) {
    console.error('[api/schedules/generate] error:', error);
    return Response.json(
      { error: 'Failed to generate schedule' },
      { status: 500 }
    );
  }
}
