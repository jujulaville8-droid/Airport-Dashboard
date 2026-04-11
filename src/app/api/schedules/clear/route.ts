import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

/**
 * DELETE /api/schedules/clear
 *
 * Clear all shifts within a date range. Used by the "Clear Schedule" button
 * on the schedules page. Server-side because the service-role Supabase
 * client is not available in the browser.
 *
 * Body: { startDate: YYYY-MM-DD, endDate: YYYY-MM-DD }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { startDate?: unknown; endDate?: unknown };
    const { startDate, endDate } = body;

    if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return Response.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 400 });
    }
    if (typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return Response.json({ error: 'endDate must be YYYY-MM-DD' }, { status: 400 });
    }
    if (endDate < startDate) {
      return Response.json({ error: 'endDate must be on or after startDate' }, { status: 400 });
    }

    const { error } = await supabase
      .from('staff_schedules')
      .delete()
      .gte('schedule_date', startDate)
      .lte('schedule_date', endDate);

    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    console.error('[api/schedules/clear] error:', error);
    return Response.json({ error: 'Failed to clear schedule' }, { status: 500 });
  }
}
