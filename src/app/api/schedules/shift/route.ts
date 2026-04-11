import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

/**
 * Shift CRUD for the draggable schedule UI.
 *
 *   PATCH  — update a shift's start/end times (drag to resize/move)
 *   POST   — add a new shift for a staff member on a specific day
 *   DELETE — remove a staff member's shift from a specific day
 *
 * These endpoints exist because the schedules page is a client component and
 * CAN NOT talk to the service-role Supabase client directly (server-only
 * key). The previous implementation tried to `import('@/lib/db')` in the
 * browser, which created a Supabase client with `undefined` for the key,
 * causing every update to fail silently and the drag bar to snap back.
 *
 * All bodies: { date, staffName, ... }
 * All routes sit behind the existing proxy auth gate.
 */

function validateCommon(body: Record<string, unknown>): { date: string; staffName: string } | { error: string } {
  const { date, staffName } = body;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date must be YYYY-MM-DD' };
  }
  if (typeof staffName !== 'string' || !staffName.trim()) {
    return { error: 'staffName required' };
  }
  return { date, staffName: staffName.trim() };
}

function validateTime(v: unknown, field: string): string | { error: string } {
  if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) {
    return { error: `${field} must be HH:MM` };
  }
  return v;
}

function hoursBetween(start: string, end: string): number {
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  const minutes = (h2 * 60 + m2) - (h1 * 60 + m1);
  return Math.round((minutes / 60) * 100) / 100;
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const common = validateCommon(body);
    if ('error' in common) return Response.json(common, { status: 400 });

    const start = validateTime(body.start, 'start');
    if (typeof start !== 'string') return Response.json(start, { status: 400 });
    const end = validateTime(body.end, 'end');
    if (typeof end !== 'string') return Response.json(end, { status: 400 });

    const shiftHours = hoursBetween(start, end);
    if (shiftHours <= 0) {
      return Response.json({ error: 'end must be after start' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('staff_schedules')
      .update({
        shift_start: start,
        shift_end: end,
        shift_hours: shiftHours,
        updated_at: new Date().toISOString(),
      })
      .eq('schedule_date', common.date)
      .eq('staff_name', common.staffName)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return Response.json(
        { error: 'No matching shift found for that date and staff member' },
        { status: 404 }
      );
    }

    return Response.json({ success: true, shift: data });
  } catch (error) {
    console.error('[api/schedules/shift PATCH] error:', error);
    return Response.json({ error: 'Failed to update shift' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const common = validateCommon(body);
    if ('error' in common) return Response.json(common, { status: 400 });

    const start = typeof body.start === 'string' && /^\d{2}:\d{2}$/.test(body.start) ? body.start : '10:00';
    const end = typeof body.end === 'string' && /^\d{2}:\d{2}$/.test(body.end) ? body.end : '15:00';
    const shiftHours = hoursBetween(start, end);
    if (shiftHours <= 0) {
      return Response.json({ error: 'end must be after start' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('staff_schedules')
      .insert({
        schedule_date: common.date,
        staff_name: common.staffName,
        shift_start: start,
        shift_end: end,
        shift_hours: shiftHours,
        generated_by: 'manual',
        ai_confidence: 0,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return Response.json({ success: true, shift: data });
  } catch (error) {
    console.error('[api/schedules/shift POST] error:', error);
    return Response.json({ error: 'Failed to add shift' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const common = validateCommon(body);
    if ('error' in common) return Response.json(common, { status: 400 });

    const { error } = await supabase
      .from('staff_schedules')
      .delete()
      .eq('schedule_date', common.date)
      .eq('staff_name', common.staffName);

    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    console.error('[api/schedules/shift DELETE] error:', error);
    return Response.json({ error: 'Failed to remove shift' }, { status: 500 });
  }
}
