import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return Response.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    // Single query for the whole range
    const { data, error } = await supabase
      .from('sales_transactions')
      .select('tkt_dt, tot_amt, disc_amt, tax_amt, cust_no')
      .gte('tkt_dt', startDate)
      .lte('tkt_dt', endDate)
      .order('tkt_dt', { ascending: true });

    if (error) throw error;

    // Group by date
    const byDate: Record<string, { sales: number; tickets: number; discount: number; tax: number }> = {};
    for (const row of (data || [])) {
      const d = (row.tkt_dt as string).substring(0, 10);
      if (!byDate[d]) byDate[d] = { sales: 0, tickets: 0, discount: 0, tax: 0 };
      byDate[d].sales += Number(row.tot_amt);
      byDate[d].tickets += parseInt(row.cust_no as string) || 0;
      byDate[d].discount += Number(row.disc_amt);
      byDate[d].tax += Number(row.tax_amt);
    }

    // Fill in all days in range
    const start = new Date(startDate.substring(0, 10));
    const end = new Date(endDate.substring(0, 10));
    const dailyData: { date: string; totalSales: number; totalTransactions: number; avgTransaction: number; totalDiscount: number; totalTax: number }[] = [];
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().substring(0, 10);
      const d = byDate[dateStr] || { sales: 0, tickets: 0, discount: 0, tax: 0 };
      dailyData.push({
        date: dateStr,
        totalSales: Math.round(d.sales * 100) / 100,
        totalTransactions: d.tickets,
        avgTransaction: d.tickets > 0 ? Math.round((d.sales / d.tickets) * 100) / 100 : 0,
        totalDiscount: Math.round(d.discount * 100) / 100,
        totalTax: Math.round(d.tax * 100) / 100,
      });
      current.setDate(current.getDate() + 1);
    }

    const totalSales = dailyData.reduce((sum, d) => sum + d.totalSales, 0);
    const totalTransactions = dailyData.reduce((sum, d) => sum + d.totalTransactions, 0);

    return Response.json({
      startDate,
      endDate,
      totalSales: Math.round(totalSales * 100) / 100,
      totalTransactions,
      avgTransaction: totalTransactions > 0 ? Math.round((totalSales / totalTransactions) * 100) / 100 : 0,
      dailyData,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
