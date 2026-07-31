import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, TablesInsert } from './database.types';

/**
 * Service-role Supabase client for server-side operations (bypasses RLS).
 *
 * Lazily instantiated on first property access so that importing this module
 * is safe even when env vars aren't yet available — e.g., during Vercel's
 * build step before env vars are injected, or during a fresh `next build`
 * without an `.env.local`. The top-level `createClient()` call would
 * otherwise throw "supabaseUrl is required" and fail the build.
 *
 * Every route handler that reads `supabase.from(...)` runs at request time
 * on the Node server, where env vars ARE present, so this proxy is
 * transparent to consumers.
 */
let _client: SupabaseClient<Database> | null = null;

function getClient(): SupabaseClient<Database> {
  if (_client) return _client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Supabase env vars missing at runtime. Expected NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  _client = createClient<Database>(supabaseUrl, supabaseServiceKey);
  return _client;
}

// Proxy forwards every property access to the lazily-constructed client.
// Consumers keep using `supabase.from('...')` exactly as before.
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// --- Sales ---

export async function getSalesData(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('sales_transactions')
    .select(`
      *,
      line_items:sales_line_items(*)
    `)
    .gte('tkt_dt', startDate)
    .lte('tkt_dt', endDate)
    .order('tkt_dt', { ascending: false });

  if (error) throw error;
  return data;
}

export async function getDailySalesSummary(date: string) {
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const { data, error } = await supabase
    .from('sales_transactions')
    .select('tot_amt, disc_amt, tax_amt, pmt_cod, ticket_count')
    .gte('tkt_dt', startOfDay)
    .lte('tkt_dt', endOfDay);

  if (error) throw error;

  const totalSales = data.reduce((sum, t) => sum + Number(t.tot_amt), 0);
  const totalTransactions = data.reduce((sum, row) => sum + (row.ticket_count ?? 0), 0);
  const avgTransaction = totalTransactions > 0 ? totalSales / totalTransactions : 0;

  return {
    date,
    totalSales: Math.round(totalSales * 100) / 100,
    totalTransactions,
    avgTransaction: Math.round(avgTransaction * 100) / 100,
    totalDiscount: data.reduce((sum, t) => sum + Number(t.disc_amt), 0),
    totalTax: data.reduce((sum, t) => sum + Number(t.tax_amt), 0),
  };
}

// --- Flights ---

export async function getFlightData(date: string) {
  const { data, error } = await supabase
    .from('flight_data')
    .select('*')
    .eq('flight_date', date)
    .order('scheduled_time', { ascending: true });

  if (error) throw error;
  return data;
}

export async function getFlightDataForWeek(weekStart: string) {
  const { data, error } = await supabase
    .from('flight_data')
    .select('*')
    .eq('schedule_week_start', weekStart)
    .order('scheduled_time', { ascending: true });

  if (error) throw error;
  return data;
}

export async function getFlightDataForMonth(scheduleMonth: string) {
  const { data, error } = await supabase
    .from('flight_data')
    .select('*')
    .eq('schedule_month', scheduleMonth)
    .order('flight_date', { ascending: true })
    .order('scheduled_time', { ascending: true });

  if (error) throw error;
  return data;
}

export async function storeFlightData(flights: TablesInsert<'flight_data'>[]) {
  const { error } = await supabase
    .from('flight_data')
    .upsert(flights, { onConflict: 'flight_num,flight_date,flight_type' });

  if (error) throw error;
}

export async function getUploadedMonths() {
  const { data, error } = await supabase
    .from('flight_data')
    .select('schedule_month')
    .not('schedule_month', 'is', null)
    .order('schedule_month', { ascending: false });

  if (error) throw error;

  // Get unique months with counts
  const monthCounts: Record<string, { total: number; departures: number }> = {};
  for (const row of data) {
    const m = row.schedule_month as string;
    if (!monthCounts[m]) monthCounts[m] = { total: 0, departures: 0 };
    monthCounts[m].total++;
  }

  // Get departure counts separately
  const { data: depData, error: depError } = await supabase
    .from('flight_data')
    .select('schedule_month')
    .not('schedule_month', 'is', null)
    .eq('flight_type', 'departure');

  if (depError) throw depError;

  for (const row of depData ?? []) {
    const m = row.schedule_month as string;
    if (monthCounts[m]) monthCounts[m].departures++;
  }

  // Check which months have a stored source PDF. Older months imported
  // before PDF persistence was added won't have a file on record and
  // their "View PDF" button will be disabled.
  const { data: fileRows, error: fileErr } = await supabase
    .from('flight_schedule_files')
    .select('schedule_month');
  if (fileErr) throw fileErr;
  const monthsWithPdf = new Set<string>(
    (fileRows ?? []).map((r) => r.schedule_month as string)
  );

  return Object.entries(monthCounts).map(([month, counts]) => ({
    month,
    totalFlights: counts.total,
    departures: counts.departures,
    hasPDF: monthsWithPdf.has(month),
  }));
}

// --- Flight schedule file storage ---
//
// The PDFs uploaded to /api/flights/upload-pdf are persisted to a private
// Supabase Storage bucket (`flight-schedules`) so the flights page can
// display them inline on demand. Metadata (path, size, uploaded_at) is
// tracked in the `flight_schedule_files` table for fast lookup.
//
// Bucket setup: see supabase/migrations/002_flight_schedule_files.sql

const FLIGHT_PDF_BUCKET = 'flight-schedules';

export async function storeFlightSchedulePDF(
  scheduleMonth: string,
  buffer: Buffer,
  fileName: string
): Promise<void> {
  const storagePath = `${scheduleMonth}.pdf`;

  // Upload with upsert so re-uploading the same month replaces the prior file
  const { error: uploadErr } = await supabase.storage
    .from(FLIGHT_PDF_BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (uploadErr) throw new Error(`Flight PDF upload failed: ${uploadErr.message}`);

  // Upsert metadata row
  const { error: metaErr } = await supabase
    .from('flight_schedule_files')
    .upsert(
      {
        schedule_month: scheduleMonth,
        storage_path: storagePath,
        file_name: fileName,
        file_size: buffer.byteLength,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: 'schedule_month' }
    );
  if (metaErr) throw new Error(`Flight PDF metadata write failed: ${metaErr.message}`);
}

export async function getFlightSchedulePDFMeta(scheduleMonth: string): Promise<{
  storagePath: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
} | null> {
  const { data, error } = await supabase
    .from('flight_schedule_files')
    .select('storage_path, file_name, file_size, uploaded_at')
    .eq('schedule_month', scheduleMonth)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    storagePath: data.storage_path as string,
    fileName: data.file_name as string,
    fileSize: data.file_size as number,
    uploadedAt: data.uploaded_at as string,
  };
}

/**
 * Get a short-lived signed URL for a stored flight schedule PDF.
 * Returns null if no file is on record for the month.
 *
 * The URL is single-use by Supabase convention and expires after the
 * specified number of seconds (default: 5 minutes — long enough to open
 * in an embed, not long enough to share).
 */
export async function getFlightSchedulePDFSignedUrl(
  scheduleMonth: string,
  expiresInSeconds = 300
): Promise<string | null> {
  const meta = await getFlightSchedulePDFMeta(scheduleMonth);
  if (!meta) return null;
  const { data, error } = await supabase.storage
    .from(FLIGHT_PDF_BUCKET)
    .createSignedUrl(meta.storagePath, expiresInSeconds);
  if (error) throw new Error(`Signed URL creation failed: ${error.message}`);
  return data?.signedUrl ?? null;
}

/**
 * Delete the stored PDF and metadata for a schedule month. Called by the
 * flights DELETE route when a user removes a month's flight data.
 * Silently succeeds if no file is on record.
 */
export async function deleteFlightSchedulePDF(scheduleMonth: string): Promise<void> {
  const meta = await getFlightSchedulePDFMeta(scheduleMonth);
  if (!meta) return;
  await supabase.storage.from(FLIGHT_PDF_BUCKET).remove([meta.storagePath]);
  await supabase.from('flight_schedule_files').delete().eq('schedule_month', scheduleMonth);
}

export async function deleteFlightMonth(scheduleMonth: string) {
  const { error } = await supabase
    .from('flight_data')
    .delete()
    .eq('schedule_month', scheduleMonth);

  if (error) throw error;
}

// --- Schedules ---

export async function storeSchedule(scheduleRecords: TablesInsert<'staff_schedules'>[]) {
  const { error } = await supabase
    .from('staff_schedules')
    .insert(scheduleRecords);

  if (error) throw error;
}

export async function getSchedule(date: string) {
  const { data, error } = await supabase
    .from('staff_schedules')
    .select('*')
    .eq('schedule_date', date)
    .order('shift_start', { ascending: true });

  if (error) throw error;
  return data;
}

// --- AI Analysis ---

export async function storeAIAnalysis(analysis: TablesInsert<'ai_analysis_results'>) {
  const { error } = await supabase
    .from('ai_analysis_results')
    .insert(analysis);

  if (error) throw error;
}

export async function getLatestAnalysis(type: string) {
  const { data, error } = await supabase
    .from('ai_analysis_results')
    .select('*')
    .eq('analysis_type', type)
    .order('analysis_date', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// --- Import Logs ---

export async function logImport(log: TablesInsert<'import_logs'>) {
  const { error } = await supabase
    .from('import_logs')
    .insert(log);

  if (error) throw error;
}
