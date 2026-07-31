import { supabase } from '@/lib/db';
import { addDays, todayYmd } from '@/lib/date-utils';
import { fetchAllSalesPages } from '@/lib/sales-rows';
import { NextRequest } from 'next/server';

async function salesMeta() {
  const { data, error } = await supabase
    .from('import_logs')
    .select('attempted_at')
    .eq('source', 'sales')
    .eq('status', 'success')
    .order('attempted_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[api/sales/daily] import metadata failed:', error);
    return { updatedAt: null, source: 'not-received' as const };
  }
  return {
    updatedAt: data?.[0]?.attempted_at ?? null,
    source: data?.[0]?.attempted_at ? 'automatic-gmail' as const : 'not-received' as const,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const date = searchParams.get('date') || todayYmd();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    const lastWeekStr = addDays(date, -7);
    const windowStart = lastWeekStr;
    const windowEnd = date;

    const windowRows = await fetchAllSalesPages((from, to) => supabase
      .from('sales_transactions')
      .select('tkt_dt, tot_amt, ticket_count, disc_amt, hourly_breakdown')
      .gte('tkt_dt', windowStart + 'T00:00:00')
      .lte('tkt_dt', windowEnd + 'T23:59:59')
      .order('tkt_dt', { ascending: true })
      .range(from, to));

    // Bucket by YYYY-MM-DD
    const byDate = new Map<string, { sales: number; tickets: number; discount: number; hourly: unknown }>();
    for (const row of windowRows) {
      const ymd = (row.tkt_dt as string).substring(0, 10);
      const bucket = byDate.get(ymd) ?? { sales: 0, tickets: 0, discount: 0, hourly: null };
      bucket.sales += Number(row.tot_amt);
      bucket.tickets += row.ticket_count ?? 0;
      bucket.discount += Number(row.disc_amt);
      if (row.hourly_breakdown) bucket.hourly = row.hourly_breakdown;
      byDate.set(ymd, bucket);
    }

    const dayFrom = (ymd: string) => {
      const b = byDate.get(ymd);
      if (!b) return { sales: 0, tickets: 0, discount: 0, hourly: null, hasData: false };
      return {
        sales: Math.round(b.sales * 100) / 100,
        tickets: b.tickets,
        discount: Math.round(b.discount * 100) / 100,
        hourly: b.hourly,
        hasData: true,
      };
    };

    const today = dayFrom(date);
    const lastWeek = dayFrom(lastWeekStr);

    const trendDays: { date: string; sales: number; tickets: number; hasData: boolean }[] = [];
    for (let i = 7; i >= 1; i--) {
      const dStr = addDays(date, -i);
      const d = dayFrom(dStr);
      trendDays.push({ date: dStr, sales: d.sales, tickets: d.tickets, hasData: d.hasData });
    }

    // Day of week average — scope to last 90 days to avoid unbounded scan + silent 1000-row truncation.
    // (Previously fetched entire table; Supabase default limit clipped at 1000 rows silently.)
    const selectedDow = new Date(date + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
    const dowStart = addDays(date, -90);
    const dowRows = await fetchAllSalesPages((from, to) => supabase
      .from('sales_transactions')
      .select('tkt_dt, tot_amt')
      .gte('tkt_dt', dowStart + 'T00:00:00')
      .lt('tkt_dt', date + 'T00:00:00')
      .order('tkt_dt', { ascending: true })
      .range(from, to));

    let dowTotal = 0;
    let dowCount = 0;
    for (const row of dowRows) {
      const rowDate = (row.tkt_dt as string).substring(0, 10);
      const dow = new Date(rowDate + 'T12:00:00Z').getUTCDay();
      if (dow === selectedDow) {
        dowTotal += Number(row.tot_amt);
        dowCount += 1;
      }
    }
    const dowAvg = dowCount > 0 ? Math.round((dowTotal / dowCount) * 100) / 100 : 0;

    // Calculate percentage changes
    const pctVsLastWeek = lastWeek.sales > 0
      ? Math.round(((today.sales - lastWeek.sales) / lastWeek.sales) * 100)
      : null;
    const pctVsDowAvg = dowAvg > 0
      ? Math.round(((today.sales - dowAvg) / dowAvg) * 100)
      : null;

    const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

    const data = {
      date,
      dayName,
      today: {
        sales: today.sales,
        tickets: today.tickets,
        discount: today.discount,
        avgTransaction: today.tickets > 0 ? Math.round((today.sales / today.tickets) * 100) / 100 : 0,
        hourly: today.hourly,
        hasData: today.hasData,
      },
      comparison: {
        lastWeek: {
          date: lastWeekStr,
          sales: lastWeek.sales,
          tickets: lastWeek.tickets,
          hasData: lastWeek.hasData,
        },
        pctVsLastWeek,
        dowAvg,
        pctVsDowAvg,
        dowCount,
      },
      trend: trendDays,
    };
    return Response.json({ ...data, data, meta: await salesMeta() });
  } catch (error) {
    console.error('[api/sales/daily] error:', error);
    return Response.json({ error: 'Failed to load daily sales' }, { status: 500 });
  }
}
