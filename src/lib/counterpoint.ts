import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import { supabase, logImport } from './db';

interface DailySales {
  date: string;       // YYYY-MM-DD
  description: string; // "February  1"
  sales: number;
  tickets: number;
  discounts: number;
  returns: number;
}

interface ImportResult {
  success: boolean;
  batchId: string;
  month: string;
  year: number;
  totalDays: number;
  totalSales: number;
  totalTickets: number;
  totalDiscounts: number;
  totalReturns: number;
  avgTransaction: number;
  dailyData: DailySales[];
  errors: string[];
  fileHash: string;
}

// Month name to number mapping
const MONTHS: Record<string, number> = {
  'January': 1, 'February': 2, 'March': 3, 'April': 4,
  'May': 5, 'June': 6, 'July': 7, 'August': 8,
  'September': 9, 'October': 10, 'November': 11, 'December': 12,
};

// ============================================================================
// Counterpoint "Sales Analysis by Month/day" parser
// ============================================================================
//
// Originally this parser hardcoded column indices (sales at column M, tickets
// at P, discounts at T, returns at Z). That was a silent-corruption time bomb:
// any layout change in Counterpoint exports would silently feed the wrong
// column into the wrong DB field.
//
// This version uses header-name detection with a hardcoded-fallback safety net,
// and a total-row reconciliation check that refuses the import on mismatch.
// Same pattern as counterpoint-items.ts / counterpoint-inventory.ts.
// ============================================================================

type Row = (string | number | boolean | Date | null | undefined)[];

// Header cells we recognize for each logical column. Matched case-insensitive
// after stripping whitespace/punctuation.
const HEADER_ALIASES: Record<string, string[]> = {
  sales: [
    'sales', 'netsales', 'grosssales', 'totalsales', 'totalgross', 'totalgrosssales',
    'total', 'revenue', 'salesamt', 'salesamount', 'netamount', 'grossamount',
  ],
  tickets: [
    'tickets', 'ticketcount', 'transactions', 'txncount', 'count', 'txn',
    'numberoftickets', 'notickets', 'tktcount',
  ],
  discounts: [
    'discounts', 'discount', 'disc', 'discamt', 'discamount', 'discountamt',
    'discountamount', 'discountstotal',
  ],
  returns: [
    'returns', 'returned', 'refunds', 'refund', 'returntotal', 'returnamt',
    'refundamt', 'refundamount',
  ],
};

// Default fallback column positions (what the original hardcoded parser used).
// Used only if header detection can't find a recognizable header row — and when
// we fall back, we push a warning so the caller knows the file may be drifting.
const FALLBACK_COLS = { sales: 12, tickets: 15, discounts: 19, returns: 25 };

// Tolerance for total reconciliation (floating-point + rounding slop)
const RECONCILE_TOLERANCE = 0.01;

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./()]+/g, '');
}

/**
 * Walk the first 40 rows of the sheet looking for a row that contains header
 * cells for at least `sales` and one other column. Returns a column map if
 * found, null if not. Also returns the header row index so the parser knows
 * where data begins.
 */
function detectHeaderRow(
  data: Row[]
): { headerRowIdx: number; cols: { sales: number; tickets: number; discounts: number; returns: number } } | null {
  for (let i = 0; i < Math.min(40, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    const cols: Partial<Record<'sales' | 'tickets' | 'discounts' | 'returns', number>> = {};
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell !== 'string') continue;
      const normalized = normalizeHeader(cell);
      for (const [logical, aliases] of Object.entries(HEADER_ALIASES) as [
        'sales' | 'tickets' | 'discounts' | 'returns',
        string[],
      ][]) {
        if (aliases.includes(normalized) && cols[logical] === undefined) {
          cols[logical] = c;
        }
      }
    }
    // We require `sales` + at least one other mappable column to accept this
    // row as a header. Single-match rows are usually false positives (e.g. a
    // section title that happens to say "Sales Report").
    const found = Object.keys(cols).length;
    if (cols.sales !== undefined && found >= 2) {
      return {
        headerRowIdx: i,
        cols: {
          sales: cols.sales,
          tickets: cols.tickets ?? FALLBACK_COLS.tickets,
          discounts: cols.discounts ?? FALLBACK_COLS.discounts,
          returns: cols.returns ?? FALLBACK_COLS.returns,
        },
      };
    }
  }
  return null;
}

/**
 * Scan the sheet for a "Report totals" / "Grand total" / "Totals" row. If
 * found, returns the sales total declared by Counterpoint itself. We use this
 * to reconcile against our computed sum and refuse the import on mismatch.
 */
function findDeclaredTotal(data: Row[], cols: { sales: number }): number | null {
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    // Look for a totals marker anywhere in the row's string cells
    let isTotalsRow = false;
    for (const cell of row) {
      if (typeof cell !== 'string') continue;
      const lowered = cell.toLowerCase();
      if (
        lowered.includes('report total') ||
        lowered.includes('grand total') ||
        /^\s*totals?\s*:?\s*$/i.test(cell)
      ) {
        isTotalsRow = true;
        break;
      }
    }
    if (!isTotalsRow) continue;
    // Found one — pull the sales column value
    const val = row[cols.sales];
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
    // Sometimes totals rows put the number in a slightly different column.
    // Try the whole row as a last resort and take the largest positive number.
    const nums = row.filter(
      (c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0
    );
    if (nums.length > 0) {
      return Math.max(...nums);
    }
  }
  return null;
}

/**
 * Parse the NCR Counterpoint "Sales Analysis by Month/day" report.
 *
 * Returns: `days` (one per data row), `month` name, `year`, `warnings` (any
 * non-fatal notes like "fell back to hardcoded column positions"), and
 * `reconcileError` if the totals row didn't match our computed sum.
 *
 * Throws only on hard-failure cases (no year detected, no usable columns).
 */
function parseCounterpointXLS(buffer: Buffer): {
  days: DailySales[];
  month: string;
  year: number;
  warnings: string[];
  reconcileError: string | null;
} {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const warnings: string[] = [];

  // ---------- Find the report year ----------
  let year: number | null = null;
  let monthName = '';

  outer: for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    for (const cell of row) {
      if (typeof cell === 'string') {
        const dateMatch = cell.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (dateMatch) {
          year = parseInt(dateMatch[3], 10);
          break outer;
        }
      }
    }
  }

  if (year === null) {
    throw new Error('Could not determine report year from Counterpoint file header');
  }

  // ---------- Find the column layout ----------
  const detected = detectHeaderRow(data);
  const cols = detected?.cols ?? FALLBACK_COLS;
  if (!detected) {
    warnings.push(
      `Could not find a header row with recognizable column names. ` +
      `Falling back to legacy column positions (sales=M, tickets=P, discounts=T, returns=Z). ` +
      `If totals look wrong, the Counterpoint report layout may have changed.`
    );
  }

  // ---------- Extract daily data ----------
  // Counterpoint's peculiar layout: sales numbers live on one row; the
  // description ("February 1") lives in column A of the *next* row.
  const days: DailySales[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const salesVal = row[cols.sales];
    if (typeof salesVal !== 'number' || !Number.isFinite(salesVal)) continue;

    const nextRow = data[i + 1];
    const desc = nextRow ? String(nextRow[0] || '') : '';

    // Skip totals and non-day rows. Matching the totals-row check here is
    // important — we don't want "Report totals" to be included in the sum.
    if (!desc) continue;
    const lowerDesc = desc.toLowerCase();
    if (
      lowerDesc.includes('report total') ||
      lowerDesc.includes('grand total') ||
      lowerDesc.includes('groups') ||
      /^\s*totals?\s*:?\s*$/i.test(desc)
    ) {
      continue;
    }

    const dayMatch = desc.match(/(\w+)\s+(\d+)/);
    if (!dayMatch) continue;

    monthName = dayMatch[1];
    const dayNum = parseInt(dayMatch[2], 10);
    const monthNum = MONTHS[monthName];
    if (!monthNum) continue;

    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

    const ticketsVal = row[cols.tickets];
    const discountsVal = row[cols.discounts];
    const returnsVal = row[cols.returns];

    days.push({
      date: dateStr,
      description: desc.trim(),
      sales: salesVal,
      tickets: typeof ticketsVal === 'number' && Number.isFinite(ticketsVal) ? ticketsVal : 0,
      discounts: typeof discountsVal === 'number' && Number.isFinite(discountsVal) ? discountsVal : 0,
      returns: typeof returnsVal === 'number' && Number.isFinite(returnsVal) ? returnsVal : 0,
    });
  }

  // ---------- Totals reconciliation ----------
  // If the sheet declares a "Report totals" / "Grand total" row, compare our
  // computed sum to it. A mismatch > 0.01 means we parsed the wrong columns —
  // surface an error the caller can refuse the import on.
  let reconcileError: string | null = null;
  const declaredTotal = findDeclaredTotal(data, cols);
  if (declaredTotal !== null && days.length > 0) {
    const computedTotal = days.reduce((s, d) => s + d.sales, 0);
    const delta = Math.abs(computedTotal - declaredTotal);
    if (delta > RECONCILE_TOLERANCE) {
      reconcileError =
        `Totals mismatch: Counterpoint report declares $${declaredTotal.toFixed(2)} ` +
        `but parser extracted $${computedTotal.toFixed(2)} (delta $${delta.toFixed(2)}). ` +
        `The file's column layout may have changed. Import aborted to prevent corrupt data.`;
    }
  }

  return { days, month: monthName, year, warnings, reconcileError };
}

export async function importSalesReport(buffer: Buffer, fileName: string): Promise<ImportResult> {
  const batchId = `import_${Date.now()}`;
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const errors: string[] = [];

  try {
    const { days, month, year, warnings, reconcileError } = parseCounterpointXLS(buffer);

    // Surface any non-fatal warnings (e.g. header-detection fallback) into
    // the errors list so they show up in both the API response and import_logs
    for (const w of warnings) errors.push(`Warning: ${w}`);

    // Totals mismatch = refuse the import. Better to fail loud than to write
    // corrupt data that'll poison the concession calculator for months.
    if (reconcileError) {
      errors.push(reconcileError);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: days.length,
        successful_records: 0,
        failed_records: days.length,
        error_messages: { errors, fileHash },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, month, year, totalDays: days.length,
        totalSales: 0, totalTickets: 0, totalDiscounts: 0, totalReturns: 0,
        avgTransaction: 0, dailyData: days, errors, fileHash,
      };
    }

    if (days.length === 0) {
      errors.push('No daily sales data found in file');
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: 0,
        successful_records: 0,
        failed_records: 0,
        error_messages: { errors },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, month, year, totalDays: 0,
        totalSales: 0, totalTickets: 0, totalDiscounts: 0, totalReturns: 0,
        avgTransaction: 0, dailyData: [], errors, fileHash,
      };
    }

    const totalSales = days.reduce((sum, d) => sum + d.sales, 0);
    const totalTickets = days.reduce((sum, d) => sum + d.tickets, 0);
    const totalDiscounts = days.reduce((sum, d) => sum + d.discounts, 0);
    const totalReturns = days.reduce((sum, d) => sum + d.returns, 0);

    // Store as sales_transactions (one row per day)
    // Hack: store ticket count in cust_no field (otherwise unused)
    const transactions = days.map(d => ({
      tkt_no: `${month}-${d.date}-${batchId}`,
      tkt_dt: new Date(d.date + 'T12:00:00').toISOString(),
      str_id: 'AIRPORT',
      cust_no: String(d.tickets), // ticket count for the day
      tot_amt: d.sales,
      disc_amt: d.discounts,
      tax_amt: 0,
      pmt_cod: 'MIXED',
      import_batch_id: batchId,
      upload_type: 'monthly',
    }));

    // Delete existing MONTHLY data for this month before inserting
    // (Leave daily uploads intact — they take precedence)
    const monthNum = MONTHS[month];
    const lastDay = new Date(year, monthNum, 0).getDate();
    const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { error: delError } = await supabase
      .from('sales_transactions')
      .delete()
      .eq('upload_type', 'monthly')
      .gte('tkt_dt', monthStart + 'T00:00:00')
      .lte('tkt_dt', monthEnd + 'T23:59:59');

    if (delError) {
      // Abort: inserting on top of a failed delete causes duplicate/mixed rows
      errors.push(`Delete failed, aborting import: ${delError.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: days.length,
        successful_records: 0,
        failed_records: days.length,
        error_messages: { errors, fileHash },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, month, year, totalDays: days.length,
        totalSales: 0, totalTickets: 0, totalDiscounts: 0, totalReturns: 0,
        avgTransaction: 0, dailyData: days, errors, fileHash,
      };
    }

    // Also skip inserting monthly rows for dates that already have daily uploads
    const { data: existingDaily, error: existingErr } = await supabase
      .from('sales_transactions')
      .select('tkt_dt')
      .eq('upload_type', 'daily')
      .gte('tkt_dt', monthStart + 'T00:00:00')
      .lte('tkt_dt', monthEnd + 'T23:59:59');

    if (existingErr) {
      // Abort: if we don't know which daily dates exist, monthly insert could clobber them
      errors.push(`Failed to query existing daily uploads, aborting: ${existingErr.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: days.length,
        successful_records: 0,
        failed_records: days.length,
        error_messages: { errors, fileHash },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, month, year, totalDays: days.length,
        totalSales: 0, totalTickets: 0, totalDiscounts: 0, totalReturns: 0,
        avgTransaction: 0, dailyData: days, errors, fileHash,
      };
    }

    const dailyDates = new Set((existingDaily ?? []).map(r => (r.tkt_dt as string).substring(0, 10)));
    const filteredTransactions = transactions.filter(t => !dailyDates.has(t.tkt_dt.substring(0, 10)));

    // Insert new data (skipping dates that have daily uploads)
    const { error } = await supabase
      .from('sales_transactions')
      .insert(filteredTransactions);

    if (error) {
      errors.push(`Insert failed: ${error.message}`);
    }

    await logImport({
      source_type: 'counterpoint',
      file_name: fileName,
      total_records: days.length,
      successful_records: error ? 0 : days.length,
      failed_records: error ? days.length : 0,
      error_messages: errors.length > 0 ? { errors, fileHash } : null,
      reconciliation_status: error ? 'failed' : 'complete',
    });

    return {
      success: errors.length === 0,
      batchId, month, year,
      totalDays: days.length,
      totalSales: Math.round(totalSales * 100) / 100,
      totalTickets,
      totalDiscounts: Math.round(totalDiscounts * 100) / 100,
      totalReturns: Math.round(totalReturns * 100) / 100,
      avgTransaction: totalTickets > 0 ? Math.round((totalSales / totalTickets) * 100) / 100 : 0,
      dailyData: days,
      errors, fileHash,
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
      error_messages: { errors },
      reconciliation_status: 'failed',
    });

    return {
      success: false, batchId, month: '', year: 0, totalDays: 0,
      totalSales: 0, totalTickets: 0, totalDiscounts: 0, totalReturns: 0,
      avgTransaction: 0, dailyData: [], errors, fileHash: '',
    };
  }
}

// ==========================================
// DAILY IMPORT — for single-day sales reports
// ==========================================

interface DailyImportResult {
  success: boolean;
  batchId: string;
  date: string;
  sales: number;
  tickets: number;
  discounts: number;
  returns: number;
  avgTransaction: number;
  errors: string[];
}

export async function importDailySalesReport(buffer: Buffer, fileName: string): Promise<DailyImportResult> {
  const batchId = `daily_${Date.now()}`;
  const errors: string[] = [];

  try {
    const { days, warnings, reconcileError } = parseCounterpointXLS(buffer);

    // Surface non-fatal header-detection warnings to the caller
    for (const w of warnings) errors.push(`Warning: ${w}`);

    // Totals mismatch = refuse the import
    if (reconcileError) {
      errors.push(reconcileError);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: days.length,
        successful_records: 0,
        failed_records: days.length,
        error_messages: { errors },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, date: '', sales: 0, tickets: 0,
        discounts: 0, returns: 0, avgTransaction: 0, errors,
      };
    }

    if (days.length === 0) {
      errors.push('No daily sales data found in file');
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: 0,
        successful_records: 0,
        failed_records: 0,
        error_messages: { errors },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, date: '', sales: 0, tickets: 0,
        discounts: 0, returns: 0, avgTransaction: 0, errors,
      };
    }

    // For daily imports, use the first day found in the report
    // (User selected the date before uploading; use whichever day the report covers)
    const day = days[0];

    // Upsert a single row for this date
    const transaction = {
      tkt_no: `daily-${day.date}-${batchId}`,
      tkt_dt: new Date(day.date + 'T12:00:00').toISOString(),
      str_id: 'AIRPORT',
      cust_no: String(day.tickets),
      tot_amt: day.sales,
      disc_amt: day.discounts,
      tax_amt: 0,
      pmt_cod: 'MIXED',
      import_batch_id: batchId,
      upload_type: 'daily',
    };

    // Delete any existing row for this date (both daily and monthly — daily wins)
    const dayStart = day.date + 'T00:00:00';
    const dayEnd = day.date + 'T23:59:59';
    const { error: delError } = await supabase
      .from('sales_transactions')
      .delete()
      .gte('tkt_dt', dayStart)
      .lte('tkt_dt', dayEnd);

    if (delError) {
      // Abort: inserting on top of a failed delete would duplicate the day
      errors.push(`Delete failed, aborting import: ${delError.message}`);
      await logImport({
        source_type: 'counterpoint',
        file_name: fileName,
        total_records: 1,
        successful_records: 0,
        failed_records: 1,
        error_messages: { errors },
        reconciliation_status: 'failed',
      });
      return {
        success: false, batchId, date: day.date, sales: 0, tickets: 0,
        discounts: 0, returns: 0, avgTransaction: 0, errors,
      };
    }

    // Insert the new daily row
    const { error: insError } = await supabase
      .from('sales_transactions')
      .insert(transaction);

    if (insError) errors.push(`Insert failed: ${insError.message}`);

    await logImport({
      source_type: 'counterpoint',
      file_name: fileName,
      total_records: 1,
      successful_records: insError ? 0 : 1,
      failed_records: insError ? 1 : 0,
      error_messages: errors.length > 0 ? { errors } : null,
      reconciliation_status: insError ? 'failed' : 'complete',
    });

    return {
      success: errors.length === 0,
      batchId,
      date: day.date,
      sales: Math.round(day.sales * 100) / 100,
      tickets: day.tickets,
      discounts: Math.round(day.discounts * 100) / 100,
      returns: Math.round(day.returns * 100) / 100,
      avgTransaction: day.tickets > 0 ? Math.round((day.sales / day.tickets) * 100) / 100 : 0,
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    return {
      success: false, batchId, date: '', sales: 0, tickets: 0,
      discounts: 0, returns: 0, avgTransaction: 0, errors,
    };
  }
}
