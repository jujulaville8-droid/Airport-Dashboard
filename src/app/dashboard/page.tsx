'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import anime from 'animejs';
import {
  CurrencyDollar,
  Scan,
  ChartLineUp,
  Users,
  Bell,
  Receipt,
  CalendarPlus,
  Sparkle,
  AirplaneLanding,
  AirplaneTakeoff,
  ArrowClockwise,
} from '@phosphor-icons/react';
import MetricCard from '@/components/MetricCard';

interface FlightRow {
  id: number;
  flight_num: string;
  airline_code: string;
  scheduled_time: string;
  flight_type: 'arrival' | 'departure';
  estimated_passengers: number;
}

interface ScheduleRow {
  staff_name: string;
  shift_start: string;
  shift_end: string;
  shift_hours: number;
}

export default function OverviewPage() {
  const router = useRouter();
  const headerRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().split('T')[0];
  const [todayStr] = useState(() =>
    new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  );

  const [metrics, setMetrics] = useState({ revenue: 0, transactions: 0, avgTransaction: 0, staffOnDuty: 0 });
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [concessionData, setConcessionData] = useState<{ concessionPayableECD: number; concessionPayableUSD: number; grossSalesUSD: number; exceedsThreshold: boolean } | null>(null);
  const [inventoryAlerts, setInventoryAlerts] = useState<{ criticalCount: number; atRiskCount: number; deadStockValue: number; snapshotDate: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Current month in YYYY-MM
      const currentMonth = today.substring(0, 7);

      const [dailyRes, scheduleRes, concessionRes] = await Promise.allSettled([
        // Daily sales with comparisons
        fetch(`/api/sales/daily?date=${today}`),
        // Today's schedule
        fetch(`/api/schedules/latest?startDate=${today}&endDate=${today}`),
        // Current month concession
        fetch(`/api/concession?month=${currentMonth}`),
      ]);

      // Sales metrics from daily endpoint
      if (dailyRes.status === 'fulfilled' && dailyRes.value.ok) {
        const data = await dailyRes.value.json();
        if (data.today?.hasData) {
          setMetrics(prev => ({
            ...prev,
            revenue: data.today.sales,
            transactions: data.today.tickets,
            avgTransaction: data.today.avgTransaction,
          }));
        }
      }

      // Schedule
      if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
        const data = await scheduleRes.value.json();
        if (data.exists && data.schedules && data.schedules.length > 0) {
          const todayShifts = data.schedules[0].shifts || [];
          setSchedule(todayShifts.map((s: { staffName: string; start: string; end: string; hours: number }) => ({
            staff_name: s.staffName,
            shift_start: s.start,
            shift_end: s.end,
            shift_hours: s.hours,
          })));
          setMetrics(prev => ({ ...prev, staffOnDuty: todayShifts.length }));
        }
      }

      // Concession
      if (concessionRes.status === 'fulfilled' && concessionRes.value.ok) {
        const data = await concessionRes.value.json();
        if (data.grossSalesUSD > 0) {
          setConcessionData({
            concessionPayableECD: data.concessionPayableECD,
            concessionPayableUSD: data.concessionPayableUSD,
            grossSalesUSD: data.grossSalesUSD,
            exceedsThreshold: data.exceedsThreshold,
          });
        }
      }

      // Inventory risk summary (cheap — just counts)
      try {
        const invRes = await fetch('/api/inventory/risk');
        if (invRes.ok) {
          const invData = await invRes.json();
          if (invData?.summary?.snapshotDate) {
            setInventoryAlerts({
              criticalCount: invData.summary.criticalCount,
              atRiskCount: invData.summary.atRiskCount,
              deadStockValue: invData.summary.deadStockValue,
              snapshotDate: invData.summary.snapshotDate,
            });
          } else {
            setInventoryAlerts(null);
          }
        }
      } catch (e) {
        console.error('[overview] inventory risk fetch failed:', e);
      }

      // Fetch today's flights for the upcoming-flights table
      const flightsRes = await fetch(`/api/flights/day?date=${today}`);
      if (flightsRes.ok) {
        const flightData = await flightsRes.json();
        if (Array.isArray(flightData.flights)) {
          // Filter to upcoming only (scheduled_time >= now)
          const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
          const upcoming = flightData.flights.filter((f: FlightRow) => {
            if (!f.scheduled_time) return false;
            const [h, m] = f.scheduled_time.split(':').map(Number);
            return (h * 60 + m) >= nowMins;
          });
          setFlights(upcoming);
        }
      }

      setLastRefresh(new Date());
    } catch (err) {
      console.error('Overview fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const animatedRef = useRef(false);
  useEffect(() => {
    if (animatedRef.current || loading) return;
    animatedRef.current = true;
    anime({ targets: headerRef.current, translateY: [-20, 0], opacity: [0, 1], easing: 'easeOutExpo', duration: 800 });
    if (sectionsRef.current) {
      anime({
        targets: sectionsRef.current.querySelectorAll('.anime-section'),
        translateY: [30, 0], opacity: [0, 1],
        delay: anime.stagger(200, { start: 600 }),
        easing: 'easeOutExpo', duration: 800,
      });
    }
  }, [loading]);

  const btnEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    anime.remove(e.currentTarget);
    anime({ targets: e.currentTarget, scale: 1.02, translateY: -2, duration: 400, easing: 'easeOutElastic(1, .5)' });
  };
  const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    anime.remove(e.currentTarget);
    anime({ targets: e.currentTarget, scale: 1, translateY: 0, duration: 400, easing: 'easeOutExpo' });
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '--:--';
    // Handles both "HH:MM" and "HH:MM:SS" from the DB
    return timeStr.substring(0, 5);
  };

  return (
    <div className="px-6 md:px-10 lg:px-14">
      {/* Header */}
      <div ref={headerRef} className="opacity-0 flex flex-col sm:flex-row sm:items-end justify-between pt-10 md:pt-14 pb-8 md:pb-12 gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-[32px] md:text-[40px] leading-tight text-brand-black tracking-tight">Overview</h2>
          <p className="text-sm font-medium text-brand-wood/80 flex items-center gap-2">
            <span className="inline-flex"><CalendarPlus size={16} /></span>
            {todayStr}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-brand-wood/60 hidden md:inline">
            Updated {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            onClick={fetchData}
            disabled={loading}
            className="relative p-2.5 rounded-full bg-white/60 backdrop-blur-sm border border-brand-wood/15 text-brand-black hover:border-brand-gold transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            title="Refresh data"
          >
            <ArrowClockwise size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="relative p-2.5 rounded-full bg-white/60 backdrop-blur-sm border border-brand-wood/15 text-brand-black hover:border-brand-gold transition-colors shadow-sm cursor-pointer">
            <Bell size={20} />
          </button>
        </div>
      </div>

      <div ref={sectionsRef} className="flex flex-col gap-8 lg:gap-10 max-w-[1600px] mx-auto">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 lg:gap-8">
          <MetricCard label="Today's Revenue" value={metrics.revenue} prefix="$" decimals={2}
            subtitle={metrics.revenue > 0 ? 'Live from Counterpoint' : 'Upload CSV to see data'}
            icon={CurrencyDollar} iconColorClass="text-brand-gold" iconBgClass="bg-brand-gold/10" delay={200} />
          <MetricCard label="Transactions" value={metrics.transactions}
            subtitle={metrics.transactions > 0 ? 'Today so far' : 'No data yet'}
            icon={Scan} iconColorClass="text-brand-teal" iconBgClass="bg-brand-teal/10" delay={350} />
          <MetricCard label="Avg Transaction" value={metrics.avgTransaction} prefix="$" decimals={2}
            subtitle="Target: $185.00"
            icon={ChartLineUp} iconColorClass="text-brand-wood/80" iconBgClass="bg-brand-wood/5" delay={500} />
          <MetricCard label="Staff on Duty" value={metrics.staffOnDuty} suffix="/3"
            subtitle={schedule.length > 0 ? 'Schedule active' : 'Generate a schedule'}
            icon={Users} iconColorClass="text-brand-black/80" iconBgClass="bg-brand-black/5" delay={650} />
        </div>

        {/* Quick Actions */}
        <div className="anime-section opacity-0 flex flex-col sm:flex-row gap-4">
          <button onClick={() => router.push('/dashboard/sales')} onMouseEnter={btnEnter} onMouseLeave={btnLeave}
            className="flex items-center justify-center sm:justify-start gap-2.5 px-6 py-3.5 bg-brand-gold text-white rounded-xl font-medium text-sm shadow-md cursor-pointer transition-colors hover:bg-brand-gold/90">
            <Receipt size={18} /> Upload Sales CSV
          </button>
          <button onClick={() => router.push('/dashboard/schedules')} onMouseEnter={btnEnter} onMouseLeave={btnLeave}
            className="flex items-center justify-center sm:justify-start gap-2.5 px-6 py-3.5 bg-white border border-brand-wood/20 text-brand-black rounded-xl font-medium text-sm shadow-sm cursor-pointer transition-colors hover:border-brand-wood/40 hover:bg-brand-cream/50">
            <CalendarPlus size={18} className="text-brand-wood/80" /> Generate Schedule
          </button>
          <button onClick={() => router.push('/dashboard/sales')} onMouseEnter={btnEnter} onMouseLeave={btnLeave}
            className="flex items-center justify-center sm:justify-start gap-2.5 px-6 py-3.5 bg-white border border-brand-wood/20 text-brand-black rounded-xl font-medium text-sm shadow-sm cursor-pointer transition-colors hover:border-brand-wood/40 hover:bg-brand-cream/50">
            <Sparkle size={18} weight="fill" className="text-brand-gold" /> Run AI Analysis
          </button>
        </div>

        {/* Today's Schedule */}
        <div className="anime-section opacity-0 flex flex-col gap-4">
          <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Today&apos;s Schedule</h3>
          <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
            {schedule.length > 0 ? (
              <div className="flex flex-col gap-3">
                {schedule.map((s, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-brand-cream/50">
                    <div className="w-8 h-8 rounded-full bg-brand-gold/10 flex items-center justify-center text-[10px] font-bold text-brand-wood">
                      {s.staff_name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-brand-black">{s.staff_name}</span>
                    </div>
                    <span className="text-sm font-medium text-brand-wood/80">
                      {s.shift_start.substring(0, 5)} – {s.shift_end.substring(0, 5)}
                    </span>
                    <span className="text-xs text-brand-wood/60">{s.shift_hours}h</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 text-brand-wood/50 text-sm">
                <p>No schedule generated yet. Click &quot;Generate Schedule&quot; to create one.</p>
              </div>
            )}
          </div>
        </div>

        {/* Inventory alerts — only shown if a snapshot has been uploaded */}
        {inventoryAlerts && (inventoryAlerts.criticalCount > 0 || inventoryAlerts.atRiskCount > 0 || inventoryAlerts.deadStockValue > 0) && (
          <div className="anime-section opacity-0 flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Inventory Alerts</h3>
              <button
                onClick={() => router.push('/dashboard/inventory')}
                className="text-xs font-medium text-brand-wood/60 hover:text-brand-gold transition-colors pb-1 cursor-pointer"
              >
                View Inventory →
              </button>
            </div>
            <button
              onClick={() => router.push('/dashboard/inventory')}
              className="text-left grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] hover:shadow-[0_16px_48px_-12px_rgba(15,23,42,0.10)] transition-shadow cursor-pointer"
            >
              <div className="flex flex-col gap-1 border-l-[3px] border-l-red-500 pl-4">
                <span className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">Critical</span>
                <span className="font-serif text-[32px] text-brand-black leading-none">{inventoryAlerts.criticalCount}</span>
                <span className="text-[11px] text-brand-wood/60">order now</span>
              </div>
              <div className="flex flex-col gap-1 border-l-[3px] border-l-amber-500 pl-4">
                <span className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">At risk</span>
                <span className="font-serif text-[32px] text-brand-black leading-none">{inventoryAlerts.atRiskCount}</span>
                <span className="text-[11px] text-brand-wood/60">monitor closely</span>
              </div>
              <div className="flex flex-col gap-1 border-l-[3px] border-l-brand-wood/30 pl-4">
                <span className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">Dead stock</span>
                <span className="font-serif text-[32px] text-brand-black leading-none">
                  ${inventoryAlerts.deadStockValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-[11px] text-brand-wood/60">tied up in slow movers</span>
              </div>
            </button>
          </div>
        )}

        {/* Flights & AI Insight */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 pb-10">
          {/* Upcoming Flights */}
          <div className="anime-section opacity-0 lg:col-span-2 flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Upcoming Flights</h3>
              <button onClick={() => router.push('/dashboard/flights')} className="text-xs font-medium text-brand-wood/60 hover:text-brand-gold transition-colors pb-1 cursor-pointer">View Full Board</button>
            </div>
            <div className="bg-white rounded-[20px] border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] overflow-hidden">
              <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-brand-cream/50 border-b border-brand-wood/10 text-[11px] font-semibold text-brand-wood/60 uppercase tracking-wide">
                <div className="col-span-2">Time</div>
                <div className="col-span-4">Flight</div>
                <div className="col-span-3">Status</div>
                <div className="col-span-3 text-right">Est. Pax</div>
              </div>
              {flights.length > 0 ? (
                <div className="flex flex-col divide-y divide-brand-wood/5">
                  {flights.slice(0, 5).map((f) => (
                    <div key={f.id} className="grid grid-cols-12 gap-4 px-6 py-5 items-center hover:bg-brand-cream/30 transition-colors">
                      <div className="col-span-2 text-sm font-semibold text-brand-black">{formatTime(f.scheduled_time)}</div>
                      <div className="col-span-4 flex flex-col">
                        <span className="text-sm font-bold text-brand-black">{f.flight_num}</span>
                        <span className="text-[11px] font-medium text-brand-wood/70">{f.airline_code}</span>
                      </div>
                      <div className="col-span-3">
                        {f.flight_type === 'arrival' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand-teal/10 border border-brand-teal/20 text-brand-teal text-[10px] font-bold uppercase tracking-wider">
                            <AirplaneLanding size={12} weight="bold" /> Arr
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand-gold/10 border border-brand-gold/20 text-brand-gold text-[10px] font-bold uppercase tracking-wider">
                            <AirplaneTakeoff size={12} weight="bold" /> Dep
                          </span>
                        )}
                      </div>
                      <div className="col-span-3 text-right text-sm font-medium text-brand-wood/80">~{f.estimated_passengers}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-brand-wood/50 text-sm">
                  <p>Upload a flight schedule PDF to see upcoming flights.</p>
                </div>
              )}
            </div>
          </div>

          {/* Concession Widget */}
          <div className="anime-section opacity-0 lg:col-span-1 flex flex-col gap-4">
            <h3 className="font-serif text-[22px] text-transparent select-none hidden lg:block">Concession</h3>
            <button
              onClick={() => router.push('/dashboard/concession')}
              className="text-left bg-gradient-to-br from-white to-brand-gold/[0.02] rounded-[20px] border border-brand-wood/15 border-l-[3px] border-l-brand-gold p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] h-full relative overflow-hidden group cursor-pointer flex flex-col justify-center hover:shadow-[0_16px_48px_-12px_rgba(15,23,42,0.10)] transition-shadow"
            >
              <CurrencyDollar size={96} weight="fill" className="absolute -right-4 -top-4 text-brand-gold opacity-5 rotate-12 transition-transform duration-700 group-hover:rotate-45" />
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-center gap-2 mb-2">
                  <CurrencyDollar size={20} weight="fill" className="text-brand-gold" />
                  <h4 className="font-serif text-lg text-brand-black tracking-tight">Concession (This Month)</h4>
                </div>
                {concessionData ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <p className="text-[11px] font-medium text-brand-wood/60 uppercase tracking-wide">Payable to ABAA</p>
                      <p className="font-serif text-[32px] text-brand-black leading-none">
                        ${concessionData.concessionPayableECD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <span className="text-sm font-medium text-brand-wood/60 ml-1">ECD</span>
                      </p>
                      <p className="text-[13px] font-medium text-brand-wood/70">
                        ≈ ${concessionData.concessionPayableUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                      </p>
                    </div>
                    <div className="mt-2 w-full h-[1px] bg-gradient-to-r from-brand-gold/30 to-transparent" />
                    <p className="text-[11px] text-brand-wood/60 font-medium">
                      {concessionData.exceedsThreshold
                        ? '10% of net sales (above $22,248 threshold)'
                        : 'MAG flat rate (below $22,248 threshold)'}
                    </p>
                    <p className="text-[10px] text-brand-wood/50 font-medium uppercase tracking-widest">Gross Sales: ${concessionData.grossSalesUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD</p>
                  </>
                ) : (
                  <>
                    <p className="text-[15px] leading-relaxed text-brand-black/80 font-medium">
                      Upload sales data for the current month to calculate rent payable to ABAA.
                    </p>
                    <div className="mt-4 w-full h-[1px] bg-gradient-to-r from-brand-gold/30 to-transparent" />
                    <p className="text-[11px] text-brand-wood/50 font-medium uppercase tracking-widest mt-1">View Calculator →</p>
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
