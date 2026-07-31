import { supabase } from '@/lib/db';
import type { TablesInsert, TablesUpdate } from '@/lib/database.types';
import { NextRequest } from 'next/server';

/**
 * Reorder rules CRUD.
 *
 * GET  /api/inventory/rules           — list all rules
 * PUT  /api/inventory/rules           — upsert a single rule by item_no
 *
 * Field allow-list pattern (from staff/route.ts) prevents mass-assignment.
 */

function parseRuleUpdates(
  body: Record<string, unknown>,
): { value: TablesUpdate<'reorder_rules'> } | { error: string } {
  const value: TablesUpdate<'reorder_rules'> = {};

  for (const key of ['min_stock', 'reorder_point', 'max_stock', 'lead_time_days'] as const) {
    if (!(key in body)) continue;
    const field = body[key];
    if (field === null || field === '') {
      value[key] = null;
      continue;
    }
    if (typeof field !== 'number' && typeof field !== 'string') {
      return { error: `${key} must be a non-negative number` };
    }
    const number = Number(field);
    if (!Number.isFinite(number) || number < 0) {
      return { error: `${key} must be a non-negative number` };
    }
    value[key] = Math.floor(number);
  }

  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return { error: 'notes must be a string or null' };
    }
    value.notes = body.notes;
  }

  return { value };
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('reorder_rules')
      .select('*')
      .order('item_no', { ascending: true });
    if (error) throw error;
    return Response.json({ rules: data ?? [] });
  } catch (error) {
    console.error('[api/inventory/rules GET] error:', error);
    return Response.json({ error: 'Failed to load reorder rules' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const itemNo = body.item_no;

    if (typeof itemNo !== 'string' || !itemNo) {
      return Response.json({ error: 'item_no required' }, { status: 400 });
    }

    const parsed = parseRuleUpdates(body);
    if ('error' in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    const updates = parsed.value;

    // Confirm the item exists in item_master (FK would catch it but we prefer a clean 404)
    const { data: master, error: masterErr } = await supabase
      .from('item_master')
      .select('item_no')
      .eq('item_no', itemNo)
      .maybeSingle();
    if (masterErr) throw masterErr;
    if (!master) {
      return Response.json({ error: 'Item not found in catalog' }, { status: 404 });
    }

    const rule: TablesInsert<'reorder_rules'> = {
      item_no: itemNo,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('reorder_rules')
      .upsert(rule, { onConflict: 'item_no' })
      .select()
      .single();

    if (error) throw error;
    return Response.json({ rule: data });
  } catch (error) {
    console.error('[api/inventory/rules PUT] error:', error);
    return Response.json({ error: 'Failed to save reorder rule' }, { status: 500 });
  }
}
