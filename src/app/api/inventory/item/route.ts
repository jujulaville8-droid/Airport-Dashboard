import { supabase } from '@/lib/db';
import { getItemSalesHistory } from '@/lib/inventory-analytics';

/**
 * GET /api/inventory/item?itemNo=...
 *
 * Detail view for a single SKU. Returns catalog data, latest snapshot,
 * reorder rules, and 90-day sales history.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const itemNo = url.searchParams.get('itemNo');
    if (!itemNo) {
      return Response.json({ error: 'itemNo required' }, { status: 400 });
    }

    const [masterRes, snapshotRes, ruleRes, history] = await Promise.all([
      supabase.from('item_master').select('*').eq('item_no', itemNo).maybeSingle(),
      supabase
        .from('inventory_snapshots')
        .select('snapshot_date, qty_on_hand, unit_cost, total_value')
        .eq('item_no', itemNo)
        .order('snapshot_date', { ascending: false })
        .limit(5),
      supabase.from('reorder_rules').select('*').eq('item_no', itemNo).maybeSingle(),
      getItemSalesHistory(itemNo, 90),
    ]);

    if (masterRes.error) throw masterRes.error;
    if (snapshotRes.error) throw snapshotRes.error;
    if (ruleRes.error) throw ruleRes.error;

    if (!masterRes.data) {
      return Response.json({ error: 'Item not found' }, { status: 404 });
    }

    return Response.json({
      master: masterRes.data,
      snapshots: snapshotRes.data ?? [],
      rule: ruleRes.data ?? null,
      history,
    });
  } catch (error) {
    console.error('[api/inventory/item] error:', error);
    return Response.json({ error: 'Failed to load item detail' }, { status: 500 });
  }
}
