import { supabase } from '@/lib/db';
import type { TablesInsert } from '@/lib/database.types';
import { NextRequest } from 'next/server';

/**
 * Reorder rules CRUD.
 *
 * GET  /api/inventory/rules           — list all rules
 * PUT  /api/inventory/rules           — upsert a single rule by item_no
 *
 * Field allow-list pattern (from staff/route.ts) prevents mass-assignment.
 */

const MUTABLE_FIELDS = [
  'min_stock',
  'reorder_point',
  'max_stock',
  'lead_time_days',
  'notes',
] as const;
type MutableField = typeof MUTABLE_FIELDS[number];

function pickAllowed(body: Record<string, unknown>): Partial<Record<MutableField, unknown>> {
  const out: Partial<Record<MutableField, unknown>> = {};
  for (const key of MUTABLE_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  return out;
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

    const updates = pickAllowed(body);
    // Coerce and validate numeric fields
    for (const key of ['min_stock', 'reorder_point', 'max_stock', 'lead_time_days'] as const) {
      if (key in updates) {
        const v = updates[key];
        if (v === null || v === '') {
          updates[key] = null;
        } else {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) {
            return Response.json({ error: `${key} must be a non-negative number` }, { status: 400 });
          }
          updates[key] = Math.floor(n);
        }
      }
    }

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

    const rule = {
      item_no: itemNo,
      ...updates,
      updated_at: new Date().toISOString(),
    } as TablesInsert<'reorder_rules'>;

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
