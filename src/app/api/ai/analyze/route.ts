import { runAnalysis, type AnalysisType } from '@/lib/claude';
import { getSalesData, getDailySalesSummary, getFlightData, getSchedule } from '@/lib/db';
import { computeRiskSummary } from '@/lib/inventory-analytics';
import { supabase } from '@/lib/db';
import { addDays, todayYmd } from '@/lib/date-utils';
import { NextRequest } from 'next/server';

const VALID_TYPES: AnalysisType[] = [
  'daily_summary',
  'bundle_recommendations',
  'pricing_strategy',
  'weekly_performance',
  'staff_briefing',
  'restock_briefing',
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { analysisType, date, startDate, endDate } = body;

    if (!analysisType || !VALID_TYPES.includes(analysisType)) {
      return Response.json(
        { error: `analysisType must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Gather context data based on analysis type
    let inputData: Record<string, unknown> = {};

    switch (analysisType) {
      case 'daily_summary': {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const summary = await getDailySalesSummary(targetDate);
        const flights = await getFlightData(targetDate);
        inputData = { summary, flights, date: targetDate };
        break;
      }
      case 'bundle_recommendations':
      case 'pricing_strategy': {
        const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const end = endDate || new Date().toISOString().split('T')[0];
        const sales = await getSalesData(start, end);
        inputData = { sales: sales.slice(0, 200), dateRange: { start, end }, totalTransactions: sales.length };
        break;
      }
      case 'weekly_performance': {
        const weekEnd = endDate || new Date().toISOString().split('T')[0];
        const weekStart = startDate || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
        const sales = await getSalesData(weekStart, weekEnd);
        inputData = { sales: sales.slice(0, 200), dateRange: { start: weekStart, end: weekEnd }, totalTransactions: sales.length };
        break;
      }
      case 'staff_briefing': {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const flights = await getFlightData(targetDate);
        const schedule = await getSchedule(targetDate);
        inputData = { flights, schedule, date: targetDate };
        break;
      }
      case 'restock_briefing': {
        // Pull the full risk summary, trim each list to what matters, and
        // add the next 7 days of flight traffic as demand context.
        const risk = await computeRiskSummary(14);

        // Trim items down to the fields the model actually needs — the full
        // reorder-rules object and unit_cost are noise for this prompt.
        const trimItem = (i: typeof risk.critical[number]) => ({
          itemNo: i.itemNo,
          descr: i.descr,
          category: i.category,
          qtyOnHand: i.qtyOnHand,
          velocityPerDay: i.velocityPerDay,
          daysOfCover: i.daysOfCover,
          lastSaleDate: i.lastSaleDate,
          value: i.totalValue,
          leadTimeDays: i.reorder.leadTimeDays,
        });

        // Next 7 days of flight departures (the ones that drive shop traffic)
        const today = todayYmd();
        const in7 = addDays(today, 7);
        const { data: upcomingFlights, error: flightsErr } = await supabase
          .from('flight_data')
          .select('flight_date, flight_num, airline_code, scheduled_time, estimated_passengers, flight_type')
          .eq('flight_type', 'departure')
          .gte('flight_date', today)
          .lte('flight_date', in7)
          .order('flight_date', { ascending: true })
          .order('scheduled_time', { ascending: true });
        if (flightsErr) throw flightsErr;

        // Aggregate by date: count + total estimated pax
        const byDate = new Map<string, { flights: number; pax: number }>();
        for (const f of upcomingFlights ?? []) {
          const d = f.flight_date as string;
          const bucket = byDate.get(d) ?? { flights: 0, pax: 0 };
          bucket.flights += 1;
          bucket.pax += Number(f.estimated_passengers) || 0;
          byDate.set(d, bucket);
        }
        const flightOutlook = Array.from(byDate.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({ date, flights: v.flights, estimatedPassengers: v.pax }));

        inputData = {
          snapshotDate: risk.summary.snapshotDate,
          summary: risk.summary,
          critical: risk.critical.slice(0, 25).map(trimItem),
          atRisk: risk.atRisk.slice(0, 25).map(trimItem),
          deadStock: risk.deadStock.slice(0, 15).map(trimItem),
          flightOutlook,
        };
        break;
      }
    }

    const result = await runAnalysis(analysisType, inputData);

    return Response.json({
      analysisType,
      analysis: result.analysis,
      confidenceLevel: result.confidenceLevel,
      model: result.model,
      tokenUsage: result.usage,
    });
  } catch (error) {
    console.error('[api/ai/analyze] error:', error);
    return Response.json(
      { error: 'Failed to run analysis' },
      { status: 500 }
    );
  }
}
