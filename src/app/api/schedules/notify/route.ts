import { supabase } from '@/lib/db';
import { sendScheduleEmail } from '@/lib/email';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { startDate, endDate, recipientEmail } = await request.json();

    if (!startDate || !endDate) {
      return Response.json({ error: 'startDate and endDate are required' }, { status: 400 });
    }

    if (!recipientEmail) {
      return Response.json({ error: 'recipientEmail is required' }, { status: 400 });
    }

    // Get all schedules for the date range
    const { data: scheduleRows, error } = await supabase
      .from('staff_schedules')
      .select('*')
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate)
      .order('schedule_date', { ascending: true })
      .order('shift_start', { ascending: true });

    if (error) throw error;
    if (!scheduleRows || scheduleRows.length === 0) {
      return Response.json({ error: 'No schedule found for this date range' }, { status: 404 });
    }

    // Group by date
    const byDate: Record<string, { staffName: string; start: string; end: string; hours: number; coversPeaks: string[] }[]> = {};
    for (const row of scheduleRows) {
      const d = row.schedule_date as string;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({
        staffName: row.staff_name as string,
        start: (row.shift_start as string).substring(0, 5),
        end: (row.shift_end as string).substring(0, 5),
        hours: Number(row.shift_hours),
        coversPeaks: [],
      });
    }

    // Build days array sorted by date
    const allDays = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, shifts]) => ({ date, shifts }));

    // Fill in missing days (days where nobody works)
    const filledDays: typeof allDays = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const existing = allDays.find(d => d.date === dateStr);
      filledDays.push(existing || { date: dateStr, shifts: [] });
      current.setDate(current.getDate() + 1);
    }

    // Calculate staff hours
    const staffHours: Record<string, { totalHours: number; daysWorked: number }> = {};
    for (const day of filledDays) {
      for (const shift of day.shifts) {
        if (!staffHours[shift.staffName]) staffHours[shift.staffName] = { totalHours: 0, daysWorked: 0 };
        staffHours[shift.staffName].totalHours += shift.hours;
        staffHours[shift.staffName].daysWorked += 1;
      }
    }
    for (const name of Object.keys(staffHours)) {
      staffHours[name].totalHours = Math.round(staffHours[name].totalHours * 10) / 10;
    }

    const sent = await sendScheduleEmail(recipientEmail, startDate, endDate, filledDays, staffHours);

    if (!sent) {
      // Return a non-2xx so callers checking res.ok don't treat this as success
      return Response.json(
        { success: false, error: 'Gmail not configured' },
        { status: 503 }
      );
    }

    return Response.json({
      success: true,
      message: `Schedule emailed to ${recipientEmail}`,
    });
  } catch (error) {
    console.error('[api/schedules/notify] error:', error);
    return Response.json(
      { error: 'Failed to send schedule email' },
      { status: 500 }
    );
  }
}
