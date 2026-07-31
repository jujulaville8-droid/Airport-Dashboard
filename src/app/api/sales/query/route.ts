import { supabase } from '@/lib/db';
import { addDays } from '@/lib/date-utils';
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
    console.error('[api/sales/query] import metadata failed:', error);
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
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return Response.json({ error: 'startDate and endDate required' }, { status: 400 });
    }
    const startYmd = startDate.substring(0, 10);
    const endYmd = endDate.substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd) || startYmd > endYmd || addDays(startYmd, 370) < endYmd) {
      return Response.json({ error: 'Date range must be valid and no longer than 370 days' }, { status: 400 });
    }

    const data = await fetchAllSalesPages((from, to) => supabase
      .from('sales_transactions')
      .select('tkt_dt, tot_amt, disc_amt, tax_amt, ticket_count')
      .gte('tkt_dt', `${startYmd}T00:00:00`)
      .lt('tkt_dt', `${addDays(endYmd, 1)}T00:00:00`)
      .order('tkt_dt', { ascending: true })
      .range(from, to));

    // Group by date
    const byDate: Record<string, { sales: number; tickets: number; discount: number; tax: number }> = {};
    for (const row of data) {
      const d = (row.tkt_dt as string).substring(0, 10);
      if (!byDate[d]) byDate[d] = { sales: 0, tickets: 0, discount: 0, tax: 0 };
      byDate[d].sales += Number(row.tot_amt);
      byDate[d].tickets += row.ticket_count ?? 0;
      byDate[d].discount += Number(row.disc_amt);
      byDate[d].tax += Number(row.tax_amt);
    }

    // Fill in all days in range
    const dailyData: { date: string; totalSales: number; totalTransactions: number; avgTransaction: number; totalDiscount: number; totalTax: number; hasData: boolean }[] = [];
    for (let dateStr = startYmd; dateStr <= endYmd; dateStr = addDays(dateStr, 1)) {
      const d = byDate[dateStr] || { sales: 0, tickets: 0, discount: 0, tax: 0 };
      dailyData.push({
        date: dateStr,
        totalSales: Math.round(d.sales * 100) / 100,
        totalTransactions: d.tickets,
        avgTransaction: d.tickets > 0 ? Math.round((d.sales / d.tickets) * 100) / 100 : 0,
        totalDiscount: Math.round(d.discount * 100) / 100,
        totalTax: Math.round(d.tax * 100) / 100,
        hasData: Boolean(byDate[dateStr]),
      });
    }

    const totalSales = dailyData.reduce((sum, d) => sum + d.totalSales, 0);
    const totalTransactions = dailyData.reduce((sum, d) => sum + d.totalTransactions, 0);

    const payload = {
      startDate,
      endDate,
      totalSales: Math.round(totalSales * 100) / 100,
      totalTransactions,
      avgTransaction: totalTransactions > 0 ? Math.round((totalSales / totalTransactions) * 100) / 100 : 0,
      dailyData,
    };
    return Response.json({ ...payload, data: payload, meta: await salesMeta() });
  } catch (error) {
    console.error('[api/sales/query] error:', error);
    return Response.json({ error: 'Failed to load sales range' }, { status: 500 });
  }
}
