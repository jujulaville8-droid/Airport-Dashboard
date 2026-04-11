import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { supabase, logImport } from './db';
import { todayYmd } from './date-utils';

/**
 * Counterpoint "Item Sales Analysis" importer.
 *
 * This reads a SKU-level Counterpoint export and populates two tables:
 *   1. sales_line_items — one row per (ticket, item) sold
 *   2. item_master      — upserted catalog entry per unique SKU
 *
 * KEY DIFFERENCE from counterpoint.ts:
 *   - counterpoint.ts uses hardcoded column INDICES (row[12], row[15], ...)
 *     which the audit flagged as brittle.
 *   - This parser detects columns by HEADER NAME so the layout can shift
 *     without silently breaking.
 *
 * Report format expectations (NCR Counterpoint Item Sales Analysis):
 *   Headers typically include:
 *     - "Item No"       or "Item Number"  or "Item"
 *     - "Description"
 *     - "Category"      or "Category Code" or "Categ"
 *     - "Subcategory"   or "Sub Category"  or "Subcat"
 *     - "Qty Sold"      or "Quantity"      or "Qty"
 *     - "Price"         or "Unit Price"
 *     - "Ext Price"     or "Extended"      or "Ext Amt"
 *     - "Ticket"        or "Ticket No"     or "Tkt No"  (optional — if absent, we bucket by date)
 *     - "Date"          or "Sale Date"     or "Tkt Dt"
 */

interface ItemSaleRow {
  tkt_no: string;          // may be a real ticket id, or a synthetic "date-batch" key
  tkt_dt: string;           // ISO date (YYYY-MM-DD)
  item_no: string;
  descr: string;
  categ_cod: string | null;
  subcat_cod: string | null;
  qty_sold: number;
  prc: number;
  ext_prc: number;
  disc_amt: number;
}

interface ItemImportResult {
  success: boolean;
  batchId: string;
  rowsParsed: number;
  uniqueSkus: number;
  ticketsWritten: number;
  lineItemsWritten: number;
  errors: string[];
  fileHash: string;
}

// All acceptable header-name variants for each logical column.
// Match is case-insensitive and space-insensitive (we normalize).
const HEADER_ALIASES: Record<string, string[]> = {
  item_no:     ['itemno', 'itemnumber', 'item', 'sku', 'itm'],
  descr:       ['description', 'descr', 'itemdescription', 'name'],
  categ_cod:   ['category', 'categorycode', 'categ', 'cat', 'categcod', 'dept', 'department'],
  subcat_cod:  ['subcategory', 'subcat', 'subcategorycode', 'subcatcod'],
  qty_sold:    ['qtysold', 'quantity', 'qty', 'qtysld', 'units'],
  prc:         ['price', 'unitprice', 'prc', 'salesprice'],
  ext_prc:     ['extprice', 'extended', 'extamt', 'extendedprice', 'extamount', 'extprc'],
  disc_amt:    ['discount', 'discamt', 'discountamount'],
  tkt_no:      ['ticket', 'ticketno', 'tktno', 'tkt', 'ticketnumber'],
  tkt_dt:      ['date', 'saledate', 'tktdt', 'transdate', 'transactiondate'],
};

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./]+/g, '');
}

/**
 * Given the parsed sheet rows, find the header row and return a map of
 * logical column name → array index. Throws if required columns are missing.
 */
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
    // Require at minimum: item_no, descr, qty_sold, ext_prc. Price is derivable.
    if ('item_no' in cols && 'descr' in cols && 'qty_sold' in cols && 'ext_prc' in cols) {
      return { headerRowIdx: i, cols };
    }
  }
  throw new Error(
    'Could not find a recognizable header row. Expected columns: Item No, Description, Qty Sold, Ext Price (at minimum).'
  );
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

function parseItemSalesXLS(buffer: Buffer, defaultDate: string): {
  items: ItemSaleRow[];
  uniqueSkus: Set<string>;
} {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: (string | number | boolean | Date | null | undefined)[][] =
    XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const { headerRowIdx, cols } = detectColumns(data);

  const items: ItemSaleRow[] = [];
  const uniqueSkus = new Set<string>();

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const itemNo = cellString(row[cols.item_no]);
    if (!itemNo) continue;

    // Totals/footer rows often have item_no blank or "Total"
    if (/^total/i.test(itemNo) || /^grand/i.test(itemNo)) continue;

    const qty = cellNumber(row[cols.qty_sold]);
    const extPrc = cellNumber(row[cols.ext_prc]);
    // Skip rows where both are zero — likely blank/noise
    if (qty === 0 && extPrc === 0) continue;

    const descr = cellString(row[cols.descr]) ?? itemNo;
    const price = 'prc' in cols
      ? cellNumber(row[cols.prc])
      : (qty > 0 ? extPrc / qty : 0);

    // Ticket identity: use real ticket column if present, otherwise synthesize
    // from the date so sales_line_items has a valid foreign key into a
    // daily-aggregate sales_transactions row if one exists for that date.
    const tktDateRaw = 'tkt_dt' in cols ? row[cols.tkt_dt] : null;
    let tktDt = defaultDate;
    if (tktDateRaw instanceof Date) {
      tktDt = tktDateRaw.toISOString().substring(0, 10);
    } else if (typeof tktDateRaw === 'string') {
      // Accept YYYY-MM-DD or MM/DD/YYYY
      const iso = tktDateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const us = tktDateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (iso) {
        tktDt = `${iso[1]}-${iso[2]}-${iso[3]}`;
      } else if (us) {
        tktDt = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
      }
    }

    const tktNoRaw = 'tkt_no' in cols ? cellString(row[cols.tkt_no]) : null;
    const tktNo = tktNoRaw ?? `items-${tktDt}`;

    items.push({
      tkt_no: tktNo,
      tkt_dt: tktDt,
      item_no: itemNo,
      descr,
      categ_cod: 'categ_cod' in cols ? cellString(row[cols.categ_cod]) : null,
      subcat_cod: 'subcat_cod' in cols ? cellString(row[cols.subcat_cod]) : null,
      qty_sold: qty,
      prc: price,
      ext_prc: extPrc,
      disc_amt: 'disc_amt' in cols ? cellNumber(row[cols.disc_amt]) : 0,
    });
    uniqueSkus.add(itemNo);
  }

  return { items, uniqueSkus };
}

/**
 * Main entry point. Parses a Counterpoint Item Sales Analysis XLS and writes
 * to sales_line_items + item_master.
 *
 * Idempotency: deletes any existing line items whose synthetic tkt_no matches
 * `items-<date>` for the dates in this import before inserting. This makes
 * re-uploading the same file safe.
 *
 * Transactionality: aborts on delete error to avoid duplicate inserts, per
 * the hardened pattern in counterpoint.ts.
 */
export async function importItemSales(
  buffer: Buffer,
  fileName: string,
  defaultDate?: string
): Promise<ItemImportResult> {
  const batchId = `items_${Date.now()}`;
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const errors: string[] = [];
  const reportDate = defaultDate ?? todayYmd();

  try {
    const { items, uniqueSkus } = parseItemSalesXLS(buffer, reportDate);

    if (items.length === 0) {
      errors.push('No item sales rows found in file');
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: 0,
        successful_records: 0,
        failed_records: 0,
        error_messages: { errors, context: 'item_sales' },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, rowsParsed: 0, uniqueSkus: 0,
        ticketsWritten: 0, lineItemsWritten: 0, errors, fileHash,
      };
    }

    // 1. Ensure every unique SKU has an item_master row. Upsert in batches.
    const today = todayYmd();
    const masterRows = Array.from(uniqueSkus).map((itemNo) => {
      // Representative row for catalog fields
      const sample = items.find((r) => r.item_no === itemNo)!;
      return {
        item_no: itemNo,
        descr: sample.descr,
        categ_cod: sample.categ_cod,
        subcat_cod: sample.subcat_cod,
        unit_price: sample.prc,
        first_seen_at: today,
        last_seen_at: today,
        is_active: true,
      };
    });

    const { error: masterErr } = await supabase
      .from('item_master')
      .upsert(masterRows, { onConflict: 'item_no', ignoreDuplicates: false });

    if (masterErr) {
      // Abort: without item_master rows, the foreign key on
      // inventory_snapshots.item_no would break later.
      errors.push(`item_master upsert failed, aborting: ${masterErr.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: items.length,
        successful_records: 0,
        failed_records: items.length,
        error_messages: { errors, context: 'item_sales' },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId,
        rowsParsed: items.length, uniqueSkus: uniqueSkus.size,
        ticketsWritten: 0, lineItemsWritten: 0, errors, fileHash,
      };
    }

    // 2. Ensure a sales_transactions row exists for each date we're about to
    //    reference. sales_line_items has a FK into sales_transactions.tkt_no,
    //    so any synthetic ticket we create needs a parent row. We upsert a
    //    minimal stub (the monthly import will overwrite real aggregates).
    const uniqueTktIds = new Map<string, string>(); // tkt_no -> tkt_dt
    for (const it of items) {
      if (!uniqueTktIds.has(it.tkt_no)) uniqueTktIds.set(it.tkt_no, it.tkt_dt);
    }

    const stubTransactions = Array.from(uniqueTktIds.entries()).map(([tktNo, tktDt]) => ({
      tkt_no: tktNo,
      tkt_dt: new Date(tktDt + 'T12:00:00').toISOString(),
      str_id: 'AIRPORT',
      import_batch_id: batchId,
    }));

    const { error: txErr } = await supabase
      .from('sales_transactions')
      .upsert(stubTransactions, { onConflict: 'tkt_no', ignoreDuplicates: true });

    if (txErr) {
      errors.push(`sales_transactions stub upsert failed, aborting: ${txErr.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: items.length,
        successful_records: 0,
        failed_records: items.length,
        error_messages: { errors, context: 'item_sales' },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId,
        rowsParsed: items.length, uniqueSkus: uniqueSkus.size,
        ticketsWritten: 0, lineItemsWritten: 0, errors, fileHash,
      };
    }

    // 3. Delete existing line items for these tickets (idempotent re-upload)
    const tktNos = Array.from(uniqueTktIds.keys());
    const { error: delErr } = await supabase
      .from('sales_line_items')
      .delete()
      .in('tkt_no', tktNos);

    if (delErr) {
      errors.push(`sales_line_items delete failed, aborting: ${delErr.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: items.length,
        successful_records: 0,
        failed_records: items.length,
        error_messages: { errors, context: 'item_sales' },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId,
        rowsParsed: items.length, uniqueSkus: uniqueSkus.size,
        ticketsWritten: 0, lineItemsWritten: 0, errors, fileHash,
      };
    }

    // 4. Insert line items
    const { error: insErr } = await supabase
      .from('sales_line_items')
      .insert(items);

    if (insErr) {
      errors.push(`sales_line_items insert failed: ${insErr.message}`);
    }

    await logImport({
      source_type: 'counterpoint',
      file_name: fileName,
      total_records: items.length,
      successful_records: insErr ? 0 : items.length,
      failed_records: insErr ? items.length : 0,
      error_messages: errors.length > 0 ? { errors, fileHash, context: 'item_sales' } : null,
      reconciliation_status: insErr ? 'failed' : 'complete',
    });

    return {
      success: errors.length === 0,
      batchId,
      rowsParsed: items.length,
      uniqueSkus: uniqueSkus.size,
      ticketsWritten: insErr ? 0 : uniqueTktIds.size,
      lineItemsWritten: insErr ? 0 : items.length,
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
      error_messages: { errors, context: 'item_sales' },
      reconciliation_status: 'failed',
    });
    return {
      success: false, batchId,
      rowsParsed: 0, uniqueSkus: 0,
      ticketsWritten: 0, lineItemsWritten: 0,
      errors, fileHash: '',
    };
  }
}
