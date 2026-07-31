import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('sales_transactions')
      .select('tkt_dt, tot_amt, ticket_count')
      .order('tkt_dt', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) {
      return Response.json({ months: [], latestMonth: null, summaries: [] });
    }

    // Group by month in a single pass
    const byMonth: Record<string, { totalSales: number; totalTickets: number; totalDays: number }> = {};
    for (const row of data) {
      const m = (row.tkt_dt as string).substring(0, 7);
      if (!byMonth[m]) byMonth[m] = { totalSales: 0, totalTickets: 0, totalDays: 0 };
      byMonth[m].totalSales += Number(row.tot_amt);
      byMonth[m].totalTickets += row.ticket_count ?? 0;
      byMonth[m].totalDays += 1;
    }

    const summaries = Object.entries(byMonth)
      .map(([month, s]) => ({
        month,
        totalSales: Math.round(s.totalSales * 100) / 100,
        totalTickets: s.totalTickets,
        totalDays: s.totalDays,
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const months = summaries.map(s => s.month);

    return Response.json({
      months,
      latestMonth: months[0] || null,
      summaries,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

// DELETE all sales data for a specific month
export async function DELETE(request: NextRequest) {
  try {
    const { month } = await request.json();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'month (YYYY-MM) required' }, { status: 400 });
    }

    const [year, monthStr] = month.split('-');
    const lastDay = new Date(parseInt(year), parseInt(monthStr), 0).getDate();
    const monthStart = `${month}-01T00:00:00`;
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59`;

    const { error } = await supabase
      .from('sales_transactions')
      .delete()
      .gte('tkt_dt', monthStart)
      .lte('tkt_dt', monthEnd);

    if (error) throw error;
    return Response.json({ success: true, deleted: month });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
