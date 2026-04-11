import { supabase } from '@/lib/db';
import { NextRequest } from 'next/server';

const MAG_ECD = 4198;           // Monthly MAG in ECD (exclusive of ABST, as billed)
const THRESHOLD_USD = 22248;    // Net sales threshold in USD
const PERCENTAGE_RATE = 0.10;   // 10% of net sales
const EC_RATE = 2.7;            // USD to ECD conversion
const CC_COMMISSION = 0.04;     // 4% credit card commission

interface ConcessionResult {
  month: string;
  year: number;
  grossSalesUSD: number;
  grossSalesECD: number;
  ccSalesUSD: number;
  ccCommissionECD: number;
  netCCSalesECD: number;
  cashSalesUSD: number;
  cashSalesECD: number;
  totalNetSalesUSD: number;
  totalNetSalesECD: number;
  rentPercentageECD: number;
  magECD: number;
  exceedsThreshold: boolean;
  concessionPayableECD: number;
  concessionPayableUSD: number;
  dailyBreakdown: { date: string; sales: number; tickets: number }[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const month = searchParams.get('month'); // YYYY-MM

    // Parse optional numeric overrides — distinguish "0" (explicit) from "missing" using null.
    const parseOptionalNonNegative = (v: string | null): number | null => {
      if (v === null) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return NaN;
      return n;
    };
    const ccSalesUSDRaw = parseOptionalNonNegative(searchParams.get('ccSales'));
    const cashSalesUSDRaw = parseOptionalNonNegative(searchParams.get('cashSales'));

    if (Number.isNaN(ccSalesUSDRaw) || Number.isNaN(cashSalesUSDRaw)) {
      return Response.json(
        { error: 'ccSales and cashSales must be non-negative numbers' },
        { status: 400 }
      );
    }

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'month param required (YYYY-MM)' }, { status: 400 });
    }

    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr);
    const monthNum = parseInt(monthStr);

    // Get sales data for the month
    const monthStart = `${month}-01T00:00:00`;
    // Calculate last day of month
    const lastDay = new Date(year, monthNum, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59`;

    const { data: sales, error } = await supabase
      .from('sales_transactions')
      .select('tkt_dt, tot_amt, disc_amt')
      .gte('tkt_dt', monthStart)
      .lte('tkt_dt', monthEnd)
      .order('tkt_dt', { ascending: true });

    if (error) throw error;
    if (!sales) {
      // Null data with no error is an unexpected Supabase state — fail loudly
      // rather than silently reporting $0 sales and driving a bad MAG-vs-percent decision.
      throw new Error('Concession query returned null sales data');
    }

    // Calculate totals
    const grossSalesUSD = sales.reduce((sum, s) => sum + Number(s.tot_amt), 0);

    const dailyBreakdown = sales.map(s => ({
      date: (s.tkt_dt as string).substring(0, 10),
      sales: Number(s.tot_amt),
      tickets: 1, // Each row is a day in our import
    }));

    // If CC breakdown not provided, assume all cash (no CC commission).
    // Explicit 0 is respected (distinguished from missing via null).
    const actualCCSalesUSD = ccSalesUSDRaw ?? 0;
    const actualCashSalesUSD = cashSalesUSDRaw ?? (grossSalesUSD - actualCCSalesUSD);

    // Calculations in ECD
    const grossSalesECD = grossSalesUSD * EC_RATE;
    const ccSalesECD = actualCCSalesUSD * EC_RATE;
    const ccCommissionECD = -(ccSalesECD * CC_COMMISSION);
    const netCCSalesECD = ccSalesECD + ccCommissionECD;
    const cashSalesECD = actualCashSalesUSD * EC_RATE;
    const totalNetSalesECD = netCCSalesECD + cashSalesECD;
    const totalNetSalesUSD = totalNetSalesECD / EC_RATE;

    // Concession payable = MAX(0, percentage rent − MAG inclusive of ABST).
    // MAG is prepaid, so what the shop actually owes this period is the
    // amount by which 10% of net sales exceeds MAG. In low-sales months
    // percentage rent is below MAG and the "additional payable" is $0.
    // (Same logic as the airport authority's concession calculator export —
    // see src/app/api/concession/export/route.ts.)
    const rentPercentageECD = totalNetSalesECD * PERCENTAGE_RATE;
    const exceedsThreshold = rentPercentageECD > MAG_ECD;
    const concessionPayableECD = Math.max(0, rentPercentageECD - MAG_ECD);

    const result: ConcessionResult = {
      month,
      year,
      grossSalesUSD: Math.round(grossSalesUSD * 100) / 100,
      grossSalesECD: Math.round(grossSalesECD * 100) / 100,
      ccSalesUSD: Math.round(actualCCSalesUSD * 100) / 100,
      ccCommissionECD: Math.round(ccCommissionECD * 100) / 100,
      netCCSalesECD: Math.round(netCCSalesECD * 100) / 100,
      cashSalesUSD: Math.round(actualCashSalesUSD * 100) / 100,
      cashSalesECD: Math.round(cashSalesECD * 100) / 100,
      totalNetSalesUSD: Math.round(totalNetSalesUSD * 100) / 100,
      totalNetSalesECD: Math.round(totalNetSalesECD * 100) / 100,
      rentPercentageECD: Math.round(rentPercentageECD * 100) / 100,
      magECD: MAG_ECD,
      exceedsThreshold,
      concessionPayableECD: Math.round(concessionPayableECD * 100) / 100,
      concessionPayableUSD: Math.round((concessionPayableECD / EC_RATE) * 100) / 100,
      dailyBreakdown,
    };

    return Response.json(result);
  } catch (error) {
    console.error('[api/concession] error:', error);
    return Response.json({ error: 'Failed to compute concession' }, { status: 500 });
  }
}
