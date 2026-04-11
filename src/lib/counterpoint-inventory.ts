import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { supabase, logImport } from './db';
import { todayYmd } from './date-utils';

/**
 * Counterpoint "Inventory Valuation" / "Stock On Hand" importer.
 *
 * Writes a point-in-time snapshot of stock levels into inventory_snapshots,
 * keyed on (snapshot_date, item_no). Also upserts item_master with the
 * latest unit_cost observed.
 *
 * Like counterpoint-items.ts, detects columns by HEADER NAME (not magic
 * indices) for forward-compat.
 */

interface InventoryRow {
  item_no: string;
  descr: string;
  categ_cod: string | null;
  qty_on_hand: number;
  unit_cost: number;
  total_value: number;
}

interface InventorySnapshotResult {
  success: boolean;
  batchId: string;
  snapshotDate: string;
  rowsParsed: number;
  uniqueSkus: number;
  totalValue: number;
  errors: string[];
  fileHash: string;
}

const HEADER_ALIASES: Record<string, string[]> = {
  item_no:      ['itemno', 'itemnumber', 'item', 'sku', 'itm'],
  descr:        ['description', 'descr', 'itemdescription', 'name'],
  categ_cod:    ['category', 'categorycode', 'categ', 'cat', 'categcod', 'dept', 'department'],
  qty_on_hand:  ['qtyonhand', 'onhand', 'stock', 'stockonhand', 'qoh', 'quantityonhand', 'qty', 'quantity'],
  unit_cost:    ['unitcost', 'avgcost', 'cost', 'averagecost', 'unitcst'],
  total_value:  ['extcost', 'extcst', 'extendedcost', 'totalcost', 'totalvalue', 'value', 'extvalue'],
};

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./]+/g, '');
}

function cellString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

function cellNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function detectColumns(
  rows: (string | number | boolean | Date | null | undefined)[][]
): { headerRowIdx: number; cols: Record<string, number> } {
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const cols: Record<string, number> = {};
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell !== 'string') continue;
      const normalized = normalizeHeader(cell);
      for (const [logical, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.includes(normalized) && !(logical in cols)) {
          cols[logical] = c;
        }
      }
    }
    // Minimum required: item_no, qty_on_hand. descr is recoverable from item_master.
    if ('item_no' in cols && 'qty_on_hand' in cols) {
      return { headerRowIdx: i, cols };
    }
  }
  throw new Error(
    'Could not find a recognizable header row. Expected at minimum: Item No, Qty On Hand.'
  );
}

function parseInventoryXLS(buffer: Buffer): InventoryRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: (string | number | boolean | Date | null | undefined)[][] =
    XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const { headerRowIdx, cols } = detectColumns(data);
  const items: InventoryRow[] = [];

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const itemNo = cellString(row[cols.item_no]);
    if (!itemNo) continue;
    if (/^total/i.test(itemNo) || /^grand/i.test(itemNo)) continue;

    const qty = cellNumber(row[cols.qty_on_hand]);
    // Include zero-stock rows — we want to track "this item exists and is out".
    // Only skip rows where there's genuinely no data.
    const unitCost = 'unit_cost' in cols ? cellNumber(row[cols.unit_cost]) : 0;
    const totalValue = 'total_value' in cols
      ? cellNumber(row[cols.total_value])
      : qty * unitCost;

    items.push({
      item_no: itemNo,
      descr: cellString(row[cols.descr]) ?? itemNo,
      categ_cod: 'categ_cod' in cols ? cellString(row[cols.categ_cod]) : null,
      qty_on_hand: Math.floor(qty),
      unit_cost: unitCost,
      total_value: totalValue,
    });
  }

  return items;
}

/**
 * Entry point. Parses an inventory valuation export and writes a snapshot.
 *
 * `snapshotDate` defaults to today; pass an explicit date when backfilling.
 */
export async function importInventorySnapshot(
  buffer: Buffer,
  fileName: string,
  snapshotDate?: string
): Promise<InventorySnapshotResult> {
  const batchId = `inv_${Date.now()}`;
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const errors: string[] = [];
  const date = snapshotDate ?? todayYmd();

  try {
    const items = parseInventoryXLS(buffer);

    if (items.length === 0) {
      errors.push('No inventory rows found in file');
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: 0,
        successful_records: 0,
        failed_records: 0,
        error_messages: { errors, context: 'inventory' },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, snapshotDate: date,
        rowsParsed: 0, uniqueSkus: 0, totalValue: 0, errors, fileHash,
      };
    }

    // 1. Upsert item_master with latest cost info. This also satisfies the
    //    FK constraint on inventory_snapshots.item_no.
    const masterRows = items.map((it) => ({
      item_no: it.item_no,
      descr: it.descr,
      categ_cod: it.categ_cod,
      unit_cost: it.unit_cost,
      first_seen_at: date,
      last_seen_at: date,
      is_active: true,
    }));

    const { error: masterErr } = await supabase
      .from('item_master')
      .upsert(masterRows, { onConflict: 'item_no', ignoreDuplicates: false });

    if (masterErr) {
      errors.push(`item_master upsert failed, aborting: ${masterErr.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: items.length,
        successful_records: 0,
        failed_records: items.length,
        error_messages: { errors, context: 'inventory' },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, snapshotDate: date,
        rowsParsed: items.length, uniqueSkus: items.length,
        totalValue: 0, errors, fileHash,
      };
    }

    // 2. Delete any prior snapshot for this exact date (idempotent re-upload)
    const { error: delErr } = await supabase
      .from('inventory_snapshots')
      .delete()
      .eq('snapshot_date', date);

    if (delErr) {
      errors.push(`prior snapshot delete failed, aborting: ${delErr.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: items.length,
        successful_records: 0,
        failed_records: items.length,
        error_messages: { errors, context: 'inventory' },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, snapshotDate: date,
        rowsParsed: items.length, uniqueSkus: items.length,
        totalValue: 0, errors, fileHash,
      };
    }

    // 3. Insert fresh snapshot rows
    const snapshotRows = items.map((it) => ({
      snapshot_date: date,
      item_no: it.item_no,
      qty_on_hand: it.qty_on_hand,
      unit_cost: it.unit_cost,
      total_value: it.total_value,
      source_batch_id: batchId,
    }));

    const { error: insErr } = await supabase
      .from('inventory_snapshots')
      .insert(snapshotRows);

    if (insErr) {
      errors.push(`inventory_snapshots insert failed: ${insErr.message}`);
    }

    const totalValue = items.reduce((s, it) => s + it.total_value, 0);

    await logImport({
      source_type: 'counterpoint',
      file_name: fileName,
      total_records: items.length,
      successful_records: insErr ? 0 : items.length,
      failed_records: insErr ? items.length : 0,
      error_messages: errors.length > 0 ? { errors, fileHash, context: 'inventory' } : null,
      reconciliation_status: insErr ? 'failed' : 'complete',
    });

    return {
      success: errors.length === 0,
      batchId,
      snapshotDate: date,
      rowsParsed: items.length,
      uniqueSkus: items.length,
      totalValue: Math.round(totalValue * 100) / 100,
      errors,
      fileHash,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    await logImport({
      source_type: 'counterpoint',
      file_name: fileName,
      total_records: 0,
      successful_records: 0,
      failed_records: 0,
      error_messages: { errors, context: 'inventory' },
      reconciliation_status: 'failed',
    });
    return {
      success: false, batchId, snapshotDate: date,
      rowsParsed: 0, uniqueSkus: 0, totalValue: 0,
      errors, fileHash: '',
    };
  }
}
