'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import anime from 'animejs';
import {
  Upload,
  Receipt,
  Sparkle,
  TrendUp,
  CheckCircle,
  WarningCircle,
  CircleNotch,
  Trash,
  CalendarBlank,
  ArrowUp,
  ArrowDown,
  Minus,
} from '@phosphor-icons/react';

interface DailySummary {
  date: string;
  totalSales: number;
  totalTransactions: number;
  avgTransaction: number;
  totalDiscount: number;
  totalTax: number;
}

interface SalesData {
  totalSales: number;
  totalTransactions: number;
  avgTransaction: number;
  dailyData: DailySummary[];
}

interface MonthSummary {
  month: string;
  totalSales: number;
  totalTickets: number;
  totalDays: number;
}

interface DayData {
  date: string;
  dayName: string;
  today: {
    sales: number;
    tickets: number;
    discount: number;
    avgTransaction: number;
    hourly: unknown;
    hasData: boolean;
  };
  comparison: {
    lastWeek: { date: string; sales: number; tickets: number; hasData: boolean };
    pctVsLastWeek: number | null;
    dowAvg: number;
    pctVsDowAvg: number | null;
    dowCount: number;
  };
  trend: { date: string; sales: number; tickets: number }[];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function SalesPage() {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const monthlyFileInputRef = useRef<HTMLInputElement>(null);
  const dailyFileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'today' | 'monthly'>('today');

  // ---- DAILY TAB STATE ----
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [dayData, setDayData] = useState<DayData | null>(null);
  const [dailyUploading, setDailyUploading] = useState(false);
  const [dailyDragActive, setDailyDragActive] = useState(false);
  const [dailyUploadResult, setDailyUploadResult] = useState<{ success: boolean; date?: string; sales?: number; tickets?: number; errors?: string[] } | null>(null);

  // ---- MONTHLY TAB STATE ----
  const [monthlyDragActive, setMonthlyDragActive] = useState(false);
  const [monthlyUploading, setMonthlyUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; month?: string; year?: number; totalDays?: number; totalSales?: number; totalTickets?: number; errors?: string[] } | null>(null);
  const [uploadedMonths, setUploadedMonths] = useState<MonthSummary[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [salesData, setSalesData] = useState<SalesData | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{ type: string; text: string; isError?: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-');
    return `${MONTH_NAMES[parseInt(mo) - 1]} ${y}`;
  };

  // ---- DAILY FETCH ----
  const fetchDayData = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales/daily?date=${dailyDate}`);
      if (!res.ok) {
        console.error('[sales] /api/sales/daily failed:', res.status);
        setLoadError('Failed to load daily sales.');
        return;
      }
      const data = await res.json();
      setDayData(data);
      setLoadError(null);
    } catch (e) {
      console.error('[sales] fetchDayData network error:', e);
      setLoadError('Network error loading daily sales.');
    }
  }, [dailyDate]);

  // ---- MONTHLY FETCH ----
  const fetchUploadedMonths = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/months');
      if (!res.ok) {
        console.error('[sales] /api/sales/months failed:', res.status);
        setLoadError('Failed to load uploaded months.');
        return;
      }
      const data = await res.json();
      setUploadedMonths(data.summaries || []);
      if (data.summaries && data.summaries.length > 0) {
        setSelectedMonth(prev => prev || data.summaries[0].month);
      }
      setLoadError(null);
    } catch (e) {
      console.error('[sales] fetchUploadedMonths network error:', e);
      setLoadError('Network error loading months.');
    }
  }, []);

  const fetchSelectedMonthData = useCallback(async () => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-');
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const start = `${selectedMonth}-01`;
    const end = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    try {
      const res = await fetch(`/api/sales/query?startDate=${start}T00:00:00&endDate=${end}T23:59:59&mode=summary`);
      if (!res.ok) {
        console.error('[sales] /api/sales/query failed:', res.status);
        setLoadError('Failed to load month data.');
        return;
      }
      const data = await res.json();
      setSalesData(data);
      setLoadError(null);
    } catch (e) {
      console.error('[sales] fetchSelectedMonthData network error:', e);
      setLoadError('Network error loading month data.');
    }
  }, [selectedMonth]);

  // Effects
  useEffect(() => { fetchDayData(); }, [fetchDayData]);
  useEffect(() => { fetchUploadedMonths(); }, [fetchUploadedMonths]);
  useEffect(() => { fetchSelectedMonthData(); }, [fetchSelectedMonthData]);

  const animatedRef = useRef(false);
  useEffect(() => {
    anime({ targets: headerRef.current, translateY: [-20, 0], opacity: [0, 1], easing: 'easeOutExpo', duration: 800 });
  }, []);

  useEffect(() => {
    if (animatedRef.current) return;
    if (!contentRef.current) return;
    // Wait for first meaningful data before animating sections in
    const hasData = dayData || salesData || uploadedMonths.length > 0;
    if (!hasData) return;
    animatedRef.current = true;
    const sections = contentRef.current.querySelectorAll('.anime-section');
    if (sections.length > 0) {
      anime({
        targets: sections,
        translateY: [30, 0], opacity: [0, 1],
        delay: anime.stagger(100),
        easing: 'easeOutExpo', duration: 600,
      });
    }
  }, [dayData, salesData, uploadedMonths, activeTab]);

  // ---- DAILY UPLOAD ----
  const handleDailyUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xls', 'xlsx', 'csv'].includes(ext || '')) return;
    setDailyUploading(true);
    setDailyUploadResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'daily');

    try {
      const res = await fetch('/api/sales/import', { method: 'POST', body: formData });
      let result: { success?: boolean; date?: string; sales?: number; tickets?: number; errors?: string[]; error?: string } = {};
      try {
        result = await res.json();
      } catch {
        // Non-JSON body (e.g. HTML error page)
      }
      if (!res.ok) {
        const msg = result.error || (result.errors ?? []).join('; ') || `Upload failed (HTTP ${res.status})`;
        console.error('[sales] daily upload failed:', msg);
        setDailyUploadResult({ success: false, errors: [msg] });
        return;
      }
      setDailyUploadResult({ ...result, success: true });
      if (result.success && result.date) {
        setDailyDate(result.date);
      }
      await fetchDayData();
    } catch (e) {
      console.error('[sales] daily upload network error:', e);
      setDailyUploadResult({ success: false, errors: ['Network error during upload'] });
    } finally {
      setDailyUploading(false);
    }
  };

  // ---- MONTHLY UPLOAD ----
  const handleMonthlyUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xls', 'xlsx', 'csv'].includes(ext || '')) return;
    setMonthlyUploading(true);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'monthly');

    try {
      const res = await fetch('/api/sales/import', { method: 'POST', body: formData });
      let result: { success?: boolean; month?: string; year?: number; totalDays?: number; totalSales?: number; totalTickets?: number; errors?: string[]; error?: string } = {};
      try {
        result = await res.json();
      } catch {
        // Non-JSON body (e.g. HTML error page)
      }
      if (!res.ok) {
        const msg = result.error || (result.errors ?? []).join('; ') || `Upload failed (HTTP ${res.status})`;
        console.error('[sales] monthly upload failed:', msg);
        setUploadResult({ success: false, errors: [msg] });
        return;
      }
      setUploadResult({ ...result, success: true });
      if (result.success && result.month && result.year) {
        const monthMap: Record<string, number> = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 };
        const monthNum = monthMap[result.month];
        if (monthNum) {
          const m = `${result.year}-${String(monthNum).padStart(2, '0')}`;
          setSelectedMonth(m);
        }
      }
      await fetchUploadedMonths();
    } catch (e) {
      console.error('[sales] monthly upload network error:', e);
      setUploadResult({ success: false, errors: ['Network error during upload'] });
    } finally {
      setMonthlyUploading(false);
    }
  };

  const handleDeleteMonth = async (month: string) => {
    if (!confirm(`Delete all sales data for ${formatMonth(month)}?`)) return;
    setDeleting(month);
    try {
      const res = await fetch('/api/sales/months', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      if (!res.ok) {
        console.error('[sales] delete month failed:', res.status);
        setLoadError(`Failed to delete ${formatMonth(month)}.`);
        return;
      }
      if (selectedMonth === month) {
        setSelectedMonth(null);
        setSalesData(null);
      }
      await fetchUploadedMonths();
    } catch (e) {
      console.error('[sales] delete month network error:', e);
      setLoadError(`Network error deleting ${formatMonth(month)}.`);
    } finally {
      setDeleting(null);
    }
  };

  const runAnalysis = async (type: 'bundle_recommendations' | 'pricing_strategy' | 'daily_summary') => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-');
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisType: type,
          startDate: `${selectedMonth}-01`,
          endDate: `${selectedMonth}-${String(lastDay).padStart(2, '0')}`,
        }),
      });
      let data: { analysis?: string; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // Non-JSON body
      }
      if (!res.ok) {
        console.error('[sales] runAnalysis failed:', res.status, data.error);
        setAnalysis({ type, text: data.error || `Analysis failed (HTTP ${res.status})`, isError: true });
      } else {
        setAnalysis({ type, text: data.analysis || 'No result returned' });
      }
    } catch (e) {
      console.error('[sales] runAnalysis network error:', e);
      setAnalysis({ type, text: 'Network error. Please try again.', isError: true });
    } finally {
      setAnalyzing(false);
    }
  };

  // Derived data for monthly tab
  const daysWithData = salesData?.dailyData.filter(d => d.totalSales > 0) || [];
  const maxDaily = Math.max(...daysWithData.map(d => d.totalSales), 1);
  const topDays = [...daysWithData].sort((a, b) => b.totalSales - a.totalSales).slice(0, 5);
  const dowMap: Record<string, { total: number; count: number }> = {};
  for (const d of daysWithData) {
    const dow = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    if (!dowMap[dow]) dowMap[dow] = { total: 0, count: 0 };
    dowMap[dow].total += d.totalSales;
    dowMap[dow].count += 1;
  }
  const dowAvgArr = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map(dow => ({ dow, avg: dowMap[dow] ? Math.round(dowMap[dow].total / dowMap[dow].count) : 0 }))
    .filter(d => d.avg > 0);
  const maxDow = Math.max(...dowAvgArr.map(d => d.avg), 1);

  // Derived data for daily tab
  const trendSafe = dayData?.trend ?? [];
  const maxTrend = dayData ? Math.max(...trendSafe.map(t => t.sales), dayData.today?.sales ?? 0, 1) : 1;

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="px-6 md:px-10 lg:px-14">
      <div ref={headerRef} className="opacity-0 flex flex-col sm:flex-row sm:items-end justify-between pt-10 md:pt-14 pb-8 md:pb-12 gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-[32px] md:text-[40px] leading-tight text-brand-black tracking-tight">Sales</h2>
          <p className="text-sm font-medium text-brand-wood/80">
            {activeTab === 'today' ? 'Daily tracking and performance' : 'Monthly analytics and AI insights'}
          </p>
        </div>
      </div>

      {loadError && (
        <div className="max-w-[1600px] mx-auto mb-4 px-4 py-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800 flex items-center justify-between">
          <span>{loadError}</span>
          <button
            onClick={() => setLoadError(null)}
            className="text-red-600 hover:text-red-800 font-medium ml-4"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-[1600px] mx-auto mb-8">
        <div className="flex gap-2 border-b border-brand-wood/10">
          <button
            onClick={() => setActiveTab('today')}
            className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-[2px] cursor-pointer ${
              activeTab === 'today'
                ? 'border-brand-gold text-brand-black'
                : 'border-transparent text-brand-wood/60 hover:text-brand-black'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-[2px] cursor-pointer ${
              activeTab === 'monthly'
                ? 'border-brand-gold text-brand-black'
                : 'border-transparent text-brand-wood/60 hover:text-brand-black'
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      <div ref={contentRef} className="flex flex-col gap-8 lg:gap-10 max-w-[1600px] mx-auto pb-10">

        {/* ============ TODAY TAB ============ */}
        {activeTab === 'today' && (
          <>
            {/* Date picker */}
            <div className="anime-section opacity-0 flex items-center gap-3">
              <CalendarBlank size={18} className="text-brand-wood/60" />
              <label className="text-sm font-medium text-brand-black">Date:</label>
              <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)}
                className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold" />
              {dayData && <span className="text-sm text-brand-wood/60">{dayData.dayName}</span>}
            </div>

            {/* Today's metrics */}
            {dayData?.today.hasData ? (
              <>
                <div className="anime-section opacity-0 grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                  <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                    <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Today&apos;s Revenue</p>
                    <h3 className="font-serif text-3xl text-brand-black">${fmt(dayData.today.sales)}</h3>
                    {dayData.comparison.pctVsLastWeek !== null && (
                      <p className={`text-xs mt-2 flex items-center gap-1 ${dayData.comparison.pctVsLastWeek > 0 ? 'text-green-600' : dayData.comparison.pctVsLastWeek < 0 ? 'text-red-500' : 'text-brand-wood/50'}`}>
                        {dayData.comparison.pctVsLastWeek > 0 ? <ArrowUp size={12} /> : dayData.comparison.pctVsLastWeek < 0 ? <ArrowDown size={12} /> : <Minus size={12} />}
                        {Math.abs(dayData.comparison.pctVsLastWeek)}% vs last {dayData.dayName}
                      </p>
                    )}
                  </div>
                  <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                    <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Tickets</p>
                    <h3 className="font-serif text-3xl text-brand-black">{dayData.today.tickets}</h3>
                    {dayData.comparison.lastWeek.hasData && (
                      <p className="text-xs text-brand-wood/50 mt-2">Last week: {dayData.comparison.lastWeek.tickets}</p>
                    )}
                  </div>
                  <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                    <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Avg Transaction</p>
                    <h3 className="font-serif text-3xl text-brand-black">${fmt(dayData.today.avgTransaction)}</h3>
                    <p className="text-xs text-brand-wood/50 mt-2">Per ticket</p>
                  </div>
                </div>

                {/* Day-of-week comparison */}
                {dayData.comparison.dowAvg > 0 && (
                  <div className="anime-section opacity-0 bg-white rounded-[20px] border border-brand-wood/15 p-6 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div>
                        <p className="text-xs text-brand-wood/60 uppercase tracking-wide">Your average {dayData.dayName}</p>
                        <p className="font-serif text-xl text-brand-black mt-1">${fmt(dayData.comparison.dowAvg)}</p>
                        <p className="text-[10px] text-brand-wood/50 mt-1">Based on {dayData.comparison.dowCount} past {dayData.dayName}s</p>
                      </div>
                      {dayData.comparison.pctVsDowAvg !== null && (
                        <div className={`text-right ${dayData.comparison.pctVsDowAvg > 0 ? 'text-green-600' : dayData.comparison.pctVsDowAvg < 0 ? 'text-red-500' : 'text-brand-wood/50'}`}>
                          <p className="font-serif text-3xl">
                            {dayData.comparison.pctVsDowAvg > 0 ? '+' : ''}{dayData.comparison.pctVsDowAvg}%
                          </p>
                          <p className="text-xs uppercase tracking-wide">vs average</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 7-day trend */}
                <div className="anime-section opacity-0 flex flex-col gap-4">
                  <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Last 7 Days</h3>
                  <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                    <div className="flex items-end gap-3" style={{ height: '180px' }}>
                      {trendSafe.map(t => {
                        const pct = Math.max((t.sales / maxTrend) * 100, 3);
                        const d = new Date(t.date + 'T12:00:00');
                        const label = d.toLocaleDateString('en-US', { weekday: 'short' });
                        return (
                          <div key={t.date} className="flex-1 flex flex-col items-center justify-end h-full group cursor-default">
                            <div className="text-[10px] font-semibold text-brand-wood/70 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              ${t.sales.toLocaleString()}
                            </div>
                            <div className="w-full max-w-[40px] rounded-t-lg"
                              style={{ height: `${pct}%`, backgroundColor: 'rgba(71, 85, 105, 0.25)' }} />
                            <div className="text-[11px] text-brand-wood/70 font-medium mt-2">{label}</div>
                            <div className="text-[9px] text-brand-wood/40">{t.date.substring(8)}</div>
                          </div>
                        );
                      })}
                      {/* Today's bar */}
                      <div className="flex-1 flex flex-col items-center justify-end h-full cursor-default">
                        <div className="text-[10px] font-bold text-brand-gold mb-1">
                          ${dayData.today.sales.toLocaleString()}
                        </div>
                        <div className="w-full max-w-[40px] rounded-t-lg"
                          style={{ height: `${Math.max((dayData.today.sales / maxTrend) * 100, 3)}%`, backgroundColor: 'rgba(200, 169, 110, 0.55)' }} />
                        <div className="text-[11px] text-brand-gold font-bold mt-2">{dayData.dayName.substring(0, 3)}</div>
                        <div className="text-[9px] text-brand-gold font-bold">Today</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="anime-section opacity-0 bg-white rounded-[20px] border border-brand-wood/15 p-12 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex flex-col items-center text-center gap-4">
                <Receipt size={48} className="text-brand-wood/30" />
                <p className="text-brand-wood/60 text-sm max-w-md">
                  No sales data for {dayData?.dayName || 'this day'}. Upload a daily sales report below.
                </p>
              </div>
            )}

            {/* Daily Upload */}
            <div className="anime-section opacity-0">
              <h3 className="font-serif text-[22px] text-brand-black tracking-tight mb-4">Upload Today&apos;s Sales Report</h3>
              <div
                onDragOver={e => { e.preventDefault(); setDailyDragActive(true); }}
                onDragLeave={() => setDailyDragActive(false)}
                onDrop={e => { e.preventDefault(); setDailyDragActive(false); const f = e.dataTransfer.files[0]; if (f) handleDailyUpload(f); }}
                onClick={() => dailyFileInputRef.current?.click()}
                className={`bg-white rounded-[20px] border-2 border-dashed p-8 md:p-10 text-center cursor-pointer transition-all duration-300 ${
                  dailyDragActive ? 'border-brand-gold bg-brand-gold/5' : 'border-brand-wood/20 hover:border-brand-gold/50'
                }`}
              >
                <input ref={dailyFileInputRef} type="file" accept=".xls,.xlsx,.csv"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleDailyUpload(f); }}
                  className="hidden" />
                {dailyUploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <CircleNotch size={36} className="text-brand-gold animate-spin" />
                    <p className="text-sm font-medium text-brand-wood/80">Importing daily data...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={36} className="text-brand-wood/40" />
                    <p className="text-sm font-medium text-brand-black">Drop today&apos;s NCR Counterpoint report</p>
                    <p className="text-xs text-brand-wood/60">.xls, .xlsx, or .csv</p>
                  </div>
                )}
              </div>

              {dailyUploadResult && (
                <div className={`mt-4 p-4 rounded-xl border flex items-center gap-3 ${
                  dailyUploadResult.success ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                }`}>
                  {dailyUploadResult.success ? <CheckCircle size={20} className="text-green-600" /> : <WarningCircle size={20} className="text-amber-600" />}
                  <div className="text-sm">
                    {dailyUploadResult.success ? (
                      <>
                        <span className="font-semibold">{dailyUploadResult.date}</span> imported: <span className="font-semibold">${dailyUploadResult.sales?.toLocaleString()}</span>, <span className="font-semibold">{dailyUploadResult.tickets}</span> tickets
                      </>
                    ) : (
                      <span className="text-amber-700">{dailyUploadResult.errors?.[0] || 'Import failed'}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ============ MONTHLY TAB ============ */}
        {activeTab === 'monthly' && (
          <>
            {uploadedMonths.length > 0 && (
              <div className="anime-section opacity-0 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Uploaded Months</h3>
                  {uploadedMonths.length > 1 && (
                    <select value={selectedMonth || ''} onChange={e => setSelectedMonth(e.target.value)}
                      className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold">
                      {uploadedMonths.map(m => <option key={m.month} value={m.month}>{formatMonth(m.month)}</option>)}
                    </select>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {uploadedMonths.map(m => (
                    <button key={m.month}
                      onClick={() => setSelectedMonth(m.month)}
                      className={`text-left bg-white rounded-[16px] border p-5 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] cursor-pointer transition-all hover:shadow-lg ${
                        selectedMonth === m.month ? 'border-brand-gold border-2' : 'border-brand-wood/15'
                      }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-serif text-lg text-brand-black">{formatMonth(m.month)}</h4>
                          <p className="text-xs text-brand-wood/60 mt-1">
                            ${m.totalSales.toLocaleString()} &middot; {m.totalTickets} tickets &middot; {m.totalDays} days
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteMonth(m.month); }}
                          disabled={deleting === m.month}
                          className="p-2 rounded-lg hover:bg-red-50 text-brand-wood/40 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {deleting === m.month ? <CircleNotch size={18} className="animate-spin" /> : <Trash size={18} />}
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {salesData && selectedMonth && (
              <div className="anime-section opacity-0 grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                  <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Total Revenue</p>
                  <h3 className="font-serif text-3xl text-brand-black">${fmt(salesData.totalSales)}</h3>
                  <p className="text-xs text-brand-wood/50 mt-1">{formatMonth(selectedMonth)}</p>
                </div>
                <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                  <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Total Transactions</p>
                  <h3 className="font-serif text-3xl text-brand-black">{salesData.totalTransactions.toLocaleString()}</h3>
                  <p className="text-xs text-brand-wood/50 mt-1">{daysWithData.length} active days</p>
                </div>
                <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                  <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Avg Transaction</p>
                  <h3 className="font-serif text-3xl text-brand-black">${salesData.avgTransaction.toFixed(2)}</h3>
                  <p className="text-xs text-brand-wood/50 mt-1">Per ticket</p>
                </div>
              </div>
            )}

            {daysWithData.length > 0 && salesData && (
              <div className="anime-section opacity-0 flex flex-col gap-4">
                <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Daily Revenue</h3>
                <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] overflow-x-auto">
                  <div className="flex items-end gap-1 min-w-[600px]" style={{ height: '220px' }}>
                    {salesData.dailyData.map(d => {
                      const pct = maxDaily > 0 ? Math.max((d.totalSales / maxDaily) * 100, 3) : 3;
                      const dayNum = d.date.substring(8, 10);
                      const dow = new Date(d.date + 'T12:00:00').getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group cursor-default">
                          <div className="text-[9px] font-semibold text-brand-wood/70 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            ${d.totalSales.toLocaleString()}
                          </div>
                          <div className="w-full max-w-[24px] rounded-t transition-all duration-300"
                            style={{
                              height: `${pct}%`,
                              backgroundColor: isWeekend ? 'rgba(91, 138, 138, 0.4)' : 'rgba(200, 169, 110, 0.35)',
                            }} />
                          <div className={`text-[9px] font-medium mt-1 ${isWeekend ? 'text-brand-teal' : 'text-brand-wood/60'}`}>{dayNum}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-4 mt-4 text-[10px] text-brand-wood/50">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(200, 169, 110, 0.35)' }} /> Weekday</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(91, 138, 138, 0.4)' }} /> Weekend</span>
                  </div>
                </div>
              </div>
            )}

            {dowAvgArr.length > 0 && (
              <div className="anime-section opacity-0 flex flex-col gap-4">
                <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Average by Day of Week</h3>
                <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                  <div className="flex items-end gap-4" style={{ height: '180px' }}>
                    {dowAvgArr.map(d => {
                      const pct = Math.max((d.avg / maxDow) * 100, 4);
                      return (
                        <div key={d.dow} className="flex-1 flex flex-col items-center justify-end h-full group cursor-default">
                          <div className="text-[10px] font-semibold text-brand-wood/70 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            ${d.avg.toLocaleString()}
                          </div>
                          <div className="w-full max-w-[48px] rounded-t-lg"
                            style={{ height: `${pct}%`, backgroundColor: 'rgba(200, 169, 110, 0.35)' }} />
                          <div className="text-[11px] text-brand-wood/70 font-medium mt-2">{d.dow.substring(0, 3)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {topDays.length > 0 && (
              <div className="anime-section opacity-0 flex flex-col gap-4">
                <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Top 5 Days</h3>
                <div className="bg-white rounded-[20px] border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] overflow-hidden">
                  {topDays.map((d, i) => {
                    const dow = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                    return (
                      <div key={d.date} className="flex items-center justify-between px-6 py-4 border-b border-brand-wood/5 last:border-0 hover:bg-brand-cream/30 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-brand-gold/15 flex items-center justify-center font-serif font-bold text-brand-gold text-sm">
                            {i + 1}
                          </div>
                          <span className="font-medium text-brand-black">{dow}</span>
                        </div>
                        <div className="flex items-center gap-6">
                          <span className="text-xs text-brand-wood/60">{d.totalTransactions} tickets</span>
                          <span className="font-serif text-xl text-brand-black">${d.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedMonth && (
              <div className="anime-section opacity-0 flex flex-col gap-4">
                <h3 className="font-serif text-[22px] text-brand-black tracking-tight">AI Analysis</h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button onClick={() => runAnalysis('daily_summary')} disabled={analyzing}
                    className="flex items-center gap-2 px-5 py-3 bg-white border border-brand-wood/20 rounded-xl text-sm font-medium hover:border-brand-gold transition-colors cursor-pointer disabled:opacity-50">
                    <Receipt size={16} /> Monthly Summary
                  </button>
                  <button onClick={() => runAnalysis('bundle_recommendations')} disabled={analyzing}
                    className="flex items-center gap-2 px-5 py-3 bg-white border border-brand-wood/20 rounded-xl text-sm font-medium hover:border-brand-gold transition-colors cursor-pointer disabled:opacity-50">
                    <Sparkle size={16} weight="fill" className="text-brand-gold" /> Bundle Recommendations
                  </button>
                  <button onClick={() => runAnalysis('pricing_strategy')} disabled={analyzing}
                    className="flex items-center gap-2 px-5 py-3 bg-white border border-brand-wood/20 rounded-xl text-sm font-medium hover:border-brand-gold transition-colors cursor-pointer disabled:opacity-50">
                    <TrendUp size={16} /> Pricing Strategy
                  </button>
                </div>

                {analyzing && (
                  <div className="bg-white rounded-[20px] border border-brand-wood/15 p-8 flex items-center justify-center gap-3">
                    <CircleNotch size={24} className="text-brand-gold animate-spin" />
                    <p className="text-sm text-brand-wood/70">Claude is analyzing your data...</p>
                  </div>
                )}

                {analysis && (
                  <div className="bg-gradient-to-br from-white to-brand-gold/[0.02] rounded-[20px] border border-brand-wood/15 border-l-[3px] border-l-brand-gold p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                    <div className="flex items-center gap-2 mb-4">
                      <Sparkle size={18} weight="fill" className="text-brand-gold" />
                      <h4 className="font-serif text-lg text-brand-black tracking-tight capitalize">{analysis.type.replace(/_/g, ' ')}</h4>
                    </div>
                    <div className="text-sm leading-relaxed text-brand-black/80 whitespace-pre-wrap">{analysis.text}</div>
                    <div className="mt-4 w-full h-[1px] bg-gradient-to-r from-brand-gold/30 to-transparent" />
                    <p className="text-[11px] text-brand-wood/50 font-medium uppercase tracking-widest mt-2">Claude Intelligence</p>
                  </div>
                )}
              </div>
            )}

            {/* Monthly Upload */}
            <div className="anime-section opacity-0">
              <h3 className="font-serif text-[22px] text-brand-black tracking-tight mb-4">Upload Monthly Sales Report</h3>
              <div onDragOver={e => { e.preventDefault(); setMonthlyDragActive(true); }}
                onDragLeave={() => setMonthlyDragActive(false)}
                onDrop={e => { e.preventDefault(); setMonthlyDragActive(false); const f = e.dataTransfer.files[0]; if (f) handleMonthlyUpload(f); }}
                onClick={() => monthlyFileInputRef.current?.click()}
                className={`bg-white rounded-[20px] border-2 border-dashed p-8 md:p-10 text-center cursor-pointer transition-all duration-300 ${
                  monthlyDragActive ? 'border-brand-gold bg-brand-gold/5' : 'border-brand-wood/20 hover:border-brand-gold/50'
                }`}>
                <input ref={monthlyFileInputRef} type="file" accept=".xls,.xlsx,.csv"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleMonthlyUpload(f); }}
                  className="hidden" />
                {monthlyUploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <CircleNotch size={36} className="text-brand-gold animate-spin" />
                    <p className="text-sm font-medium text-brand-wood/80">Importing monthly data...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={36} className="text-brand-wood/40" />
                    <p className="text-sm font-medium text-brand-black">Drop your NCR Counterpoint monthly report</p>
                    <p className="text-xs text-brand-wood/60">.xls, .xlsx, or .csv</p>
                  </div>
                )}
              </div>

              {uploadResult && (
                <div className={`mt-4 p-4 rounded-xl border flex items-center gap-3 ${
                  uploadResult.success ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                }`}>
                  {uploadResult.success ? <CheckCircle size={20} className="text-green-600" /> : <WarningCircle size={20} className="text-amber-600" />}
                  <div className="text-sm">
                    {uploadResult.success ? (
                      <>
                        <span className="font-semibold">{uploadResult.month} {uploadResult.year}</span> — {uploadResult.totalDays} days,{' '}
                        <span className="font-semibold">${uploadResult.totalSales?.toLocaleString()}</span> in sales,{' '}
                        <span className="font-semibold">{uploadResult.totalTickets}</span> tickets.
                      </>
                    ) : (
                      <span className="text-amber-700">{uploadResult.errors?.[0] || 'Import failed'}</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {uploadedMonths.length === 0 && !monthlyUploading && (
              <div className="anime-section opacity-0 bg-white rounded-[20px] border border-brand-wood/15 p-12 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex flex-col items-center text-center gap-4">
                <Receipt size={48} className="text-brand-wood/30" />
                <p className="text-brand-wood/60 text-sm max-w-md">Upload your NCR Counterpoint monthly sales report to see analytics, daily trends, and AI-powered insights.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
