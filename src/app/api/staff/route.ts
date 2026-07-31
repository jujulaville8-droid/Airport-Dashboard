import { supabase } from '@/lib/db';
import type { TablesInsert, TablesUpdate } from '@/lib/database.types';
import { NextRequest } from 'next/server';

const STAFF_ROLES = ['full-time', 'part-time', 'backup'] as const;
type StaffRole = typeof STAFF_ROLES[number];

function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
}

function parseStaffUpdates(
  body: Record<string, unknown>,
): { value: TablesUpdate<'staff_members'> } | { error: string } {
  const value: TablesUpdate<'staff_members'> = {};

  for (const key of ['name', 'full_name', 'available_start', 'available_end'] as const) {
    if (!(key in body)) continue;
    const field = body[key];
    if (typeof field !== 'string' || !field.trim()) {
      return { error: `${key} must be a non-empty string` };
    }
    value[key] = field;
  }

  if ('role' in body) {
    if (!isStaffRole(body.role)) {
      return { error: `role must be one of: ${STAFF_ROLES.join(', ')}` };
    }
    value.role = body.role;
  }

  for (const key of ['max_hours_per_day', 'min_hours_per_day'] as const) {
    if (!(key in body)) continue;
    const field = body[key];
    if (typeof field !== 'number' || !Number.isFinite(field)) {
      return { error: `${key} must be a finite number` };
    }
    value[key] = field;
  }

  if ('weekly_hour_target' in body) {
    const field = body.weekly_hour_target;
    if (field !== null && (typeof field !== 'number' || !Number.isFinite(field))) {
      return { error: 'weekly_hour_target must be a finite number or null' };
    }
    value.weekly_hour_target = field;
  }

  if ('days_off_per_week' in body) {
    const field = body.days_off_per_week;
    if (field !== null && (typeof field !== 'number' || !Number.isInteger(field))) {
      return { error: 'days_off_per_week must be an integer or null' };
    }
    value.days_off_per_week = field;
  }

  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') {
      return { error: 'is_active must be a boolean' };
    }
    value.is_active = body.is_active;
  }

  return { value };
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
    const parsed = parseStaffUpdates(body);
    if ('error' in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    const fields = parsed.value;

    if (
      typeof fields.name !== 'string'
      || typeof fields.full_name !== 'string'
      || !isStaffRole(fields.role)
    ) {
      return Response.json({ error: 'name, full_name, and role are required' }, { status: 400 });
    }

    const staffMember: TablesInsert<'staff_members'> = {
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
    };

    const { data, error } = await supabase
      .from('staff_members')
      .insert(staffMember)
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

    const parsed = parseStaffUpdates(body);
    if ('error' in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    const updates = parsed.value;
    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'no updatable fields provided' }, { status: 400 });
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
