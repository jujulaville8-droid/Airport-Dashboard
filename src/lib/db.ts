import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Supabase env vars missing at runtime. Expected NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  _client = createClient(supabaseUrl, supabaseServiceKey);
  return _client;
}

// Proxy forwards every property access to the lazily-constructed client.
// Consumers keep using `supabase.from('...')` exactly as before.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
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
    .select('tot_amt, disc_amt, tax_amt, pmt_cod, cust_no')
    .gte('tkt_dt', startOfDay)
    .lte('tkt_dt', endOfDay);

  if (error) throw error;

  const totalSales = data.reduce((sum, t) => sum + Number(t.tot_amt), 0);
  // cust_no field stores the ticket count for the day (per import format)
  const totalTransactions = data.reduce((sum, t) => sum + (parseInt(t.cust_no as string) || 0), 0);
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

export async function storeFlightData(flights: Record<string, unknown>[]) {
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

  return Object.entries(monthCounts).map(([month, counts]) => ({
    month,
    totalFlights: counts.total,
    departures: counts.departures,
  }));
}

export async function deleteFlightMonth(scheduleMonth: string) {
  const { error } = await supabase
    .from('flight_data')
    .delete()
    .eq('schedule_month', scheduleMonth);

  if (error) throw error;
}

// --- Schedules ---

export async function storeSchedule(scheduleRecords: Record<string, unknown>[]) {
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

export async function storeAIAnalysis(analysis: Record<string, unknown>) {
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

export async function logImport(log: Record<string, unknown>) {
  const { error } = await supabase
    .from('import_logs')
    .insert(log);

  if (error) throw error;
}
