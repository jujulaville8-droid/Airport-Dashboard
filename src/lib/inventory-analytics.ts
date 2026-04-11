import { supabase } from './db';
import { addDays, todayYmd } from './date-utils';

/**
 * Inventory intelligence — velocity, days-of-cover, and risk classification.
 *
 * Design notes:
 * - Pure functions over Supabase queries, so they're easy to unit test and
 *   can be moved to a Postgres view/RPC later if they get slow.
 * - Every query is bounded (no unlimited scans) — follows audit H2/H4.
 * - All error paths throw; callers decide whether to 500 or degrade.
 */

export type RiskClass = 'CRITICAL' | 'AT_RISK' | 'HEALTHY' | 'DEAD_STOCK' | 'OVERSTOCKED';

export interface ItemRisk {
  itemNo: string;
  descr: string;
  category: string | null;
  qtyOnHand: number;
  unitCost: number;
  totalValue: number;
  velocityPerDay: number;
  daysOfCover: number | null;  // null = infinite (zero velocity)
  lastSaleDate: string | null;  // YYYY-MM-DD, or null if never sold
  risk: RiskClass;
  reorder: {
    min: number | null;
    reorderPoint: number | null;
    max: number | null;
    leadTimeDays: number;
  };
}

export interface RiskSummary {
  asOf: string;
  critical: ItemRisk[];
  atRisk: ItemRisk[];
  healthy: ItemRisk[];
  deadStock: ItemRisk[];
  overstocked: ItemRisk[];
  summary: {
    criticalCount: number;
    atRiskCount: number;
    deadStockCount: number;
    deadStockValue: number;
    overstockedCount: number;
    totalSkusTracked: number;
    totalInventoryValue: number;
    snapshotDate: string | null;
  };
}

// Velocity is averaged over this many days by default. Short enough to react
// to recent demand changes, long enough to smooth out daily noise.
const DEFAULT_VELOCITY_WINDOW_DAYS = 14;

// Dead-stock threshold: zero sales in this many days AND stock > 0.
const DEAD_STOCK_DAYS = 30;

// Default lead time when a SKU has no reorder_rules row.
const DEFAULT_LEAD_TIME_DAYS = 14;

/**
 * Pull the most recent snapshot date from inventory_snapshots. Returns null
 * if no snapshots have been uploaded yet.
 */
export async function getLatestSnapshotDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from('inventory_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.snapshot_date ?? null;
}

/**
 * Compute stock-at-risk across all SKUs. Single call, single set of DB
 * queries (no N+1). Returns a fully-grouped risk summary.
 *
 * Strategy:
 *  1. Load the latest snapshot_date.
 *  2. Fetch all rows from that snapshot joined with item_master and reorder_rules.
 *  3. Fetch sales_line_items for a 30-day window (enough for both velocity
 *     and dead-stock detection).
 *  4. Aggregate sales per item in JS; compute velocity + days-of-cover + risk.
 */
export async function computeRiskSummary(
  velocityWindowDays: number = DEFAULT_VELOCITY_WINDOW_DAYS
): Promise<RiskSummary> {
  const asOf = todayYmd();
  const snapshotDate = await getLatestSnapshotDate();

  if (!snapshotDate) {
    return emptySummary(asOf);
  }

  // 1. Latest snapshot rows with catalog data
  const { data: snapshotRows, error: snapErr } = await supabase
    .from('inventory_snapshots')
    .select('item_no, qty_on_hand, unit_cost, total_value')
    .eq('snapshot_date', snapshotDate);
  if (snapErr) throw snapErr;
  if (!snapshotRows || snapshotRows.length === 0) {
    return emptySummary(asOf);
  }

  // 2. Item master for descr/category
  const itemNos = snapshotRows.map((r) => r.item_no as string);
  const { data: masterRows, error: masterErr } = await supabase
    .from('item_master')
    .select('item_no, descr, categ_cod')
    .in('item_no', itemNos);
  if (masterErr) throw masterErr;
  const masterByItem = new Map<string, { descr: string; categ_cod: string | null }>();
  for (const m of masterRows ?? []) {
    masterByItem.set(m.item_no as string, {
      descr: (m.descr as string) ?? (m.item_no as string),
      categ_cod: (m.categ_cod as string | null) ?? null,
    });
  }

  // 3. Reorder rules (may not exist for every item)
  const { data: ruleRows, error: rulesErr } = await supabase
    .from('reorder_rules')
    .select('item_no, min_stock, reorder_point, max_stock, lead_time_days')
    .in('item_no', itemNos);
  if (rulesErr) throw rulesErr;
  const rulesByItem = new Map<string, {
    min: number | null;
    reorderPoint: number | null;
    max: number | null;
    leadTimeDays: number;
  }>();
  for (const r of ruleRows ?? []) {
    rulesByItem.set(r.item_no as string, {
      min: (r.min_stock as number | null) ?? null,
      reorderPoint: (r.reorder_point as number | null) ?? null,
      max: (r.max_stock as number | null) ?? null,
      leadTimeDays: (r.lead_time_days as number | null) ?? DEFAULT_LEAD_TIME_DAYS,
    });
  }

  // 4. Sales history — pull enough days to cover both velocity window and
  //    dead-stock detection. Use the larger of the two.
  const windowDays = Math.max(velocityWindowDays, DEAD_STOCK_DAYS);
  const windowStart = addDays(asOf, -windowDays);
  const { data: salesRows, error: salesErr } = await supabase
    .from('sales_line_items')
    .select('item_no, qty_sold, tkt_no, sales_transactions!inner(tkt_dt)')
    .in('item_no', itemNos)
    .gte('sales_transactions.tkt_dt', windowStart + 'T00:00:00')
    .lte('sales_transactions.tkt_dt', asOf + 'T23:59:59');
  if (salesErr) throw salesErr;

  // Bucket sales per item. Track: total qty in velocity window, last sale date.
  interface SalesBucket {
    qtyInVelocityWindow: number;
    qtyInDeadStockWindow: number;
    lastSaleDate: string | null;
  }
  const salesByItem = new Map<string, SalesBucket>();
  const velocityStart = addDays(asOf, -velocityWindowDays);
  const deadStockStart = addDays(asOf, -DEAD_STOCK_DAYS);

  for (const row of salesRows ?? []) {
    const itemNo = row.item_no as string;
    const qty = Number(row.qty_sold) || 0;
    // Supabase embedded select returns nested object; narrow safely.
    const txRaw = (row as { sales_transactions?: { tkt_dt?: string } | { tkt_dt?: string }[] })
      .sales_transactions;
    const tx = Array.isArray(txRaw) ? txRaw[0] : txRaw;
    const tktDt = tx?.tkt_dt;
    if (!tktDt) continue;
    const ymd = String(tktDt).substring(0, 10);

    const bucket = salesByItem.get(itemNo) ?? {
      qtyInVelocityWindow: 0,
      qtyInDeadStockWindow: 0,
      lastSaleDate: null,
    };

    if (ymd >= velocityStart) bucket.qtyInVelocityWindow += qty;
    if (ymd >= deadStockStart) bucket.qtyInDeadStockWindow += qty;
    if (!bucket.lastSaleDate || ymd > bucket.lastSaleDate) {
      bucket.lastSaleDate = ymd;
    }

    salesByItem.set(itemNo, bucket);
  }

  // 5. Build per-item risk records
  const items: ItemRisk[] = [];
  let totalInventoryValue = 0;

  for (const snap of snapshotRows) {
    const itemNo = snap.item_no as string;
    const qtyOnHand = Number(snap.qty_on_hand) || 0;
    const unitCost = Number(snap.unit_cost) || 0;
    const totalValue = Number(snap.total_value) || 0;
    totalInventoryValue += totalValue;

    const master = masterByItem.get(itemNo);
    const reorder = rulesByItem.get(itemNo) ?? {
      min: null,
      reorderPoint: null,
      max: null,
      leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
    };

    const sales = salesByItem.get(itemNo) ?? {
      qtyInVelocityWindow: 0,
      qtyInDeadStockWindow: 0,
      lastSaleDate: null,
    };

    const velocityPerDay = sales.qtyInVelocityWindow / velocityWindowDays;
    const daysOfCover = velocityPerDay > 0
      ? qtyOnHand / velocityPerDay
      : null;

    const risk = classifyRisk({
      qtyOnHand,
      velocityPerDay,
      daysOfCover,
      qtyInDeadStockWindow: sales.qtyInDeadStockWindow,
      reorder,
    });

    items.push({
      itemNo,
      descr: master?.descr ?? itemNo,
      category: master?.categ_cod ?? null,
      qtyOnHand,
      unitCost,
      totalValue,
      velocityPerDay: Math.round(velocityPerDay * 100) / 100,
      daysOfCover: daysOfCover === null ? null : Math.round(daysOfCover * 10) / 10,
      lastSaleDate: sales.lastSaleDate,
      risk,
      reorder,
    });
  }

  // 6. Group and build summary
  const critical = items.filter((i) => i.risk === 'CRITICAL');
  const atRisk = items.filter((i) => i.risk === 'AT_RISK');
  const healthy = items.filter((i) => i.risk === 'HEALTHY');
  const deadStock = items.filter((i) => i.risk === 'DEAD_STOCK');
  const overstocked = items.filter((i) => i.risk === 'OVERSTOCKED');

  // Sort each group so the most urgent appears first.
  critical.sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity));
  atRisk.sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity));
  deadStock.sort((a, b) => b.totalValue - a.totalValue);
  overstocked.sort((a, b) => b.qtyOnHand - a.qtyOnHand);

  const deadStockValue = deadStock.reduce((s, i) => s + i.totalValue, 0);

  return {
    asOf,
    critical,
    atRisk,
    healthy,
    deadStock,
    overstocked,
    summary: {
      criticalCount: critical.length,
      atRiskCount: atRisk.length,
      deadStockCount: deadStock.length,
      deadStockValue: Math.round(deadStockValue * 100) / 100,
      overstockedCount: overstocked.length,
      totalSkusTracked: items.length,
      totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
      snapshotDate,
    },
  };
}

interface ClassifyInput {
  qtyOnHand: number;
  velocityPerDay: number;
  daysOfCover: number | null;
  qtyInDeadStockWindow: number;
  reorder: {
    min: number | null;
    reorderPoint: number | null;
    max: number | null;
    leadTimeDays: number;
  };
}

/**
 * Classification rules (in priority order):
 *   DEAD_STOCK   : zero sales in last 30 days AND stock > 0
 *   CRITICAL     : stock ≤ min_stock, OR days-of-cover < lead_time/2
 *   AT_RISK      : stock ≤ reorder_point, OR days-of-cover < lead_time
 *   OVERSTOCKED  : stock > max_stock (if max_stock is set)
 *   HEALTHY      : default
 *
 * If the SKU has no reorder rules, we fall back to velocity-only rules:
 *   CRITICAL if days-of-cover < lead_time/2
 *   AT_RISK  if days-of-cover < lead_time
 */
function classifyRisk(input: ClassifyInput): RiskClass {
  const { qtyOnHand, velocityPerDay, daysOfCover, qtyInDeadStockWindow, reorder } = input;

  // Dead stock wins: it's a distinct kind of problem from stockouts.
  if (qtyOnHand > 0 && qtyInDeadStockWindow === 0) {
    return 'DEAD_STOCK';
  }

  const leadTime = reorder.leadTimeDays || DEFAULT_LEAD_TIME_DAYS;
  const halfLead = leadTime / 2;

  // Check explicit reorder levels first (if configured).
  if (reorder.min !== null && qtyOnHand <= reorder.min) return 'CRITICAL';
  if (daysOfCover !== null && daysOfCover < halfLead && velocityPerDay > 0) {
    return 'CRITICAL';
  }

  if (reorder.reorderPoint !== null && qtyOnHand <= reorder.reorderPoint) return 'AT_RISK';
  if (daysOfCover !== null && daysOfCover < leadTime && velocityPerDay > 0) {
    return 'AT_RISK';
  }

  if (reorder.max !== null && qtyOnHand > reorder.max) return 'OVERSTOCKED';

  return 'HEALTHY';
}

function emptySummary(asOf: string): RiskSummary {
  return {
    asOf,
    critical: [],
    atRisk: [],
    healthy: [],
    deadStock: [],
    overstocked: [],
    summary: {
      criticalCount: 0,
      atRiskCount: 0,
      deadStockCount: 0,
      deadStockValue: 0,
      overstockedCount: 0,
      totalSkusTracked: 0,
      totalInventoryValue: 0,
      snapshotDate: null,
    },
  };
}

/**
 * Fetch the recent sales history for a single SKU (for the detail drawer).
 * Returns an array of { date, qty } sorted chronologically.
 */
export async function getItemSalesHistory(
  itemNo: string,
  days: number = 90
): Promise<{ date: string; qty: number; revenue: number }[]> {
  const asOf = todayYmd();
  const windowStart = addDays(asOf, -days);

  const { data, error } = await supabase
    .from('sales_line_items')
    .select('qty_sold, ext_prc, sales_transactions!inner(tkt_dt)')
    .eq('item_no', itemNo)
    .gte('sales_transactions.tkt_dt', windowStart + 'T00:00:00')
    .lte('sales_transactions.tkt_dt', asOf + 'T23:59:59');

  if (error) throw error;

  const byDate = new Map<string, { qty: number; revenue: number }>();
  for (const row of data ?? []) {
    const txRaw = (row as { sales_transactions?: { tkt_dt?: string } | { tkt_dt?: string }[] })
      .sales_transactions;
    const tx = Array.isArray(txRaw) ? txRaw[0] : txRaw;
    const tktDt = tx?.tkt_dt;
    if (!tktDt) continue;
    const ymd = String(tktDt).substring(0, 10);
    const bucket = byDate.get(ymd) ?? { qty: 0, revenue: 0 };
    bucket.qty += Number(row.qty_sold) || 0;
    bucket.revenue += Number(row.ext_prc) || 0;
    byDate.set(ymd, bucket);
  }

  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, qty: v.qty, revenue: Math.round(v.revenue * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
