import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

const STAFF_ROLES = ['full-time', 'part-time', 'backup'] as const;
type StaffRole = typeof STAFF_ROLES[number];

// Fields callers are allowed to set via POST/PUT. is_active is managed via PUT only
// (and still gated by allow-list); all other columns (id, created_at, etc.) are server-owned.
const MUTABLE_FIELDS = [
  'name',
  'full_name',
  'role',
  'max_hours_per_day',
  'min_hours_per_day',
  'weekly_hour_target',
  'days_off_per_week',
  'available_start',
  'available_end',
  'is_active',
] as const;
type MutableField = typeof MUTABLE_FIELDS[number];

function pickAllowed(body: Record<string, unknown>): Partial<Record<MutableField, unknown>> {
  const out: Partial<Record<MutableField, unknown>> = {};
  for (const key of MUTABLE_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
}

// GET all staff
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('staff_members')
      .select('*')
      .order('role', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    return Response.json({ staff: data });
  } catch (error) {
    console.error('[api/staff GET] error:', error);
    return Response.json({ error: 'Failed to load staff' }, { status: 500 });
  }
}

// POST - create new staff member
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const fields = pickAllowed(body);

    if (!fields.name || !fields.full_name || !fields.role) {
      return Response.json({ error: 'name, full_name, and role are required' }, { status: 400 });
    }
    if (!isStaffRole(fields.role)) {
      return Response.json(
        { error: `role must be one of: ${STAFF_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('staff_members')
      .insert({
        name: fields.name,
        full_name: fields.full_name,
        role: fields.role,
        max_hours_per_day: fields.max_hours_per_day ?? 8,
        min_hours_per_day: fields.min_hours_per_day ?? 5,
        weekly_hour_target: fields.weekly_hour_target ?? null,
        days_off_per_week: fields.days_off_per_week ?? null,
        available_start: fields.available_start ?? '09:00',
        available_end: fields.available_end ?? '20:00',
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return Response.json({ staff: data });
  } catch (error) {
    console.error('[api/staff POST] error:', error);
    return Response.json({ error: 'Failed to create staff member' }, { status: 500 });
  }
}

// PUT - update staff member
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = body.id;

    if (!id || typeof id !== 'string') {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    const updates = pickAllowed(body);
    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'no updatable fields provided' }, { status: 400 });
    }

    if ('role' in updates && !isStaffRole(updates.role)) {
      return Response.json(
        { error: `role must be one of: ${STAFF_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('staff_members')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return Response.json({ staff: data });
  } catch (error) {
    console.error('[api/staff PUT] error:', error);
    return Response.json({ error: 'Failed to update staff member' }, { status: 500 });
  }
}

// DELETE - remove staff member
export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();

    if (!id || typeof id !== 'string') {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('staff_members')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    console.error('[api/staff DELETE] error:', error);
    return Response.json({ error: 'Failed to delete staff member' }, { status: 500 });
  }
}
