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

// Parse the NCR Counterpoint "Sales Analysis by Month/day" report
function parseCounterpointXLS(buffer: Buffer): { days: DailySales[]; month: string; year: number } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Find the period/year from the header rows
  let year: number | null = null;
  let monthName = '';

  // Look for period dates in the header
  outer: for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    for (const cell of row) {
      if (typeof cell === 'string') {
        // Look for date like "2/1/2026"
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

  // Extract daily data
  // Pattern: row with sales number in column M (index 12), description in next row column A
  const days: DailySales[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    // Check if column M (index 12) has a finite numeric sales value
    const salesVal = row[12];
    if (typeof salesVal !== 'number' || !Number.isFinite(salesVal)) continue;

    // Get description from next row
    const nextRow = data[i + 1];
    const desc = nextRow ? String(nextRow[0] || '') : '';

    // Skip report totals and non-day rows
    if (!desc || desc.includes('Report totals') || desc.includes('groups')) continue;

    // Parse month name and day from description like "February  1" or "February 28"
    const dayMatch = desc.match(/(\w+)\s+(\d+)/);
    if (!dayMatch) continue;

    monthName = dayMatch[1];
    const dayNum = parseInt(dayMatch[2]);
    const monthNum = MONTHS[monthName];
    if (!monthNum) continue;

    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;

    days.push({
      date: dateStr,
      description: desc.trim(),
      sales: salesVal,
      tickets: typeof row[15] === 'number' ? row[15] : 0,
      discounts: typeof row[19] === 'number' ? row[19] : 0,
      returns: typeof row[25] === 'number' ? row[25] : 0,
    });
  }

  return { days, month: monthName, year };
}

export async function importSalesReport(buffer: Buffer, fileName: string): Promise<ImportResult> {
  const batchId = `import_${Date.now()}`;
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const errors: string[] = [];

  try {
    const { days, month, year } = parseCounterpointXLS(buffer);

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
    const { days } = parseCounterpointXLS(buffer);

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
