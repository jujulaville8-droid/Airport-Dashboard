'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import anime from 'animejs';
import {
  Upload,
  AirplaneTakeoff,
  CircleNotch,
  CheckCircle,
  WarningCircle,
  Trash,
  CalendarBlank,
} from '@phosphor-icons/react';

interface UploadedMonth {
  month: string;
  totalFlights: number;
  departures: number;
}

interface DayAnalytics {
  date: string;
  dayOfWeek: string;
  totalFlights: number;
  departures: number;
  hvDepartures: number;
  totalPassengers: number;
  hvPassengers: number;
  firstHVDeparture: string | null;
  lastHVDeparture: string | null;
  peakHour: string | null;
  airlines: string[];
}

interface MonthAnalytics {
  month: string;
  totalFlights: number;
  totalDepartures: number;
  totalHVDepartures: number;
  totalPassengers: number;
  avgDailyPax: number;
  busiestDay: { date: string; dayOfWeek: string; passengers: number } | null;
  quietestDay: { date: string; dayOfWeek: string; passengers: number } | null;
  dayOfWeekAvg: { day: string; avgPassengers: number; avgHVDepartures: number }[];
  airlines: string[];
  days: DayAnalytics[];
}

export default function FlightsPage() {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; totalFlights: number; arrivals: number; departures: number; error?: string; errors?: string[]; scheduleMonth?: string } | null>(null);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [uploadedMonths, setUploadedMonths] = useState<UploadedMonth[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<MonthAnalytics | null>(null);
  const [viewMonth, setViewMonth] = useState(selectedMonth);

  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchUploadedMonths = useCallback(async () => {
    try {
      const res = await fetch('/api/flights/upload-pdf');
      if (!res.ok) {
        console.error('[flights] list months failed:', res.status);
        setLoadError('Failed to load uploaded months.');
        return;
      }
      const data = await res.json();
      setUploadedMonths(data.months || []);
      setLoadError(null);
    } catch (e) {
      console.error('[flights] list months network error:', e);
      setLoadError('Network error loading months.');
    }
  }, []);

  const fetchAnalytics = useCallback(async (month: string) => {
    try {
      const res = await fetch(`/api/flights/analytics?month=${month}`);
      if (!res.ok) {
        console.error('[flights] analytics failed:', res.status);
        setLoadError('Failed to load flight analytics.');
        return;
      }
      const data = await res.json();
      if (data.totalFlights > 0) setAnalytics(data);
      else setAnalytics(null);
      setLoadError(null);
    } catch (e) {
      console.error('[flights] analytics network error:', e);
      setLoadError('Network error loading analytics.');
    }
  }, []);

  useEffect(() => {
    fetchUploadedMonths();
  }, [fetchUploadedMonths]);

  useEffect(() => {
    if (uploadedMonths.length > 0) {
      const latestMonth = uploadedMonths[0].month;
      setViewMonth(latestMonth);
      fetchAnalytics(latestMonth);
    }
  }, [uploadedMonths, fetchAnalytics]);

  const animatedRef = useRef(false);
  useEffect(() => {
    anime({ targets: headerRef.current, translateY: [-20, 0], opacity: [0, 1], easing: 'easeOutExpo', duration: 800 });
  }, []);

  // Animate sections in once after first data load — not on every data change
  useEffect(() => {
    if (animatedRef.current) return;
    if (!contentRef.current) return;
    if (!analytics && uploadedMonths.length === 0) return;
    animatedRef.current = true;
    const sections = contentRef.current.querySelectorAll('.anime-section');
    if (sections.length > 0) {
      anime({
        targets: sections,
        translateY: [30, 0], opacity: [0, 1],
        delay: anime.stagger(150),
        easing: 'easeOutExpo', duration: 800,
      });
    }
  }, [analytics, uploadedMonths]);

  const handleUpload = async (file: File) => {
    if (!file.name.endsWith('.pdf')) return;
    setUploading(true);
    setUploadResult(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('scheduleMonth', selectedMonth);
    try {
      const res = await fetch('/api/flights/upload-pdf', { method: 'POST', body: formData });
      let result: { success?: boolean; totalFlights?: number; arrivals?: number; departures?: number; error?: string } = {};
      try {
        result = await res.json();
      } catch { /* non-JSON body */ }
      if (!res.ok) {
        const msg = result.error || `Upload failed (HTTP ${res.status})`;
        console.error('[flights] upload failed:', msg);
        setUploadResult({ success: false, totalFlights: 0, arrivals: 0, departures: 0, error: msg });
        return;
      }
      setUploadResult({
        success: true,
        totalFlights: result.totalFlights ?? 0,
        arrivals: result.arrivals ?? 0,
        departures: result.departures ?? 0,
      });
      if (result.success) {
        await fetchUploadedMonths();
        setViewMonth(selectedMonth);
        await fetchAnalytics(selectedMonth);
      }
    } catch (e) {
      console.error('[flights] upload network error:', e);
      setUploadResult({ success: false, totalFlights: 0, arrivals: 0, departures: 0, error: 'Network error during upload' });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); const file = e.dataTransfer.files[0]; if (file) handleUpload(file); };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) handleUpload(file); };

  const handleDeleteMonth = async (month: string) => {
    if (!confirm(`Delete all flight data for ${formatMonth(month)}?`)) return;
    setDeleting(month);
    try {
      const res = await fetch('/api/flights/upload-pdf', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleMonth: month }),
      });
      if (!res.ok) {
        console.error('[flights] delete month failed:', res.status);
        setLoadError(`Failed to delete ${formatMonth(month)}.`);
        return;
      }
      await fetchUploadedMonths();
      if (viewMonth === month) setAnalytics(null);
    } catch (e) {
      console.error('[flights] delete month network error:', e);
      setLoadError(`Network error deleting ${formatMonth(month)}.`);
    } finally {
      setDeleting(null);
    }
  };

  const formatMonth = (m: string) => {
    const [year, month] = m.split('-');
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const maxDailyPax = analytics ? Math.max(...analytics.days.map(d => d.totalPassengers), 1) : 1;
  const maxDowPax = analytics ? Math.max(...analytics.dayOfWeekAvg.map(d => d.avgPassengers), 1) : 1;

  return (
    <div className="px-6 md:px-10 lg:px-14">
      <div ref={headerRef} className="opacity-0 flex flex-col sm:flex-row sm:items-end justify-between pt-10 md:pt-14 pb-8 md:pb-12 gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-[32px] md:text-[40px] leading-tight text-brand-black tracking-tight">Flight Schedule</h2>
          <p className="text-sm font-medium text-brand-wood/80">Monthly carrier movements &amp; passenger analytics</p>
        </div>
        {uploadedMonths.length > 1 && (
          <select value={viewMonth} onChange={e => { setViewMonth(e.target.value); fetchAnalytics(e.target.value); }}
            className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold">
            {uploadedMonths.map(m => <option key={m.month} value={m.month}>{formatMonth(m.month)}</option>)}
          </select>
        )}
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

      <div ref={contentRef} className="flex flex-col gap-8 lg:gap-10 max-w-[1600px] mx-auto pb-10">

        {/* Uploaded Months */}
        {uploadedMonths.length > 0 && (
          <div className="anime-section opacity-0 flex flex-col gap-4">
            <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Uploaded Schedules</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {uploadedMonths.map(m => (
                <div key={m.month} className="bg-white rounded-[16px] border border-brand-wood/15 p-5 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex items-center justify-between">
                  <div>
                    <h4 className="font-serif text-lg text-brand-black">{formatMonth(m.month)}</h4>
                    <p className="text-xs text-brand-wood/60 mt-1">{m.totalFlights} flights &middot; {m.departures} departures</p>
                  </div>
                  <button onClick={() => handleDeleteMonth(m.month)} disabled={deleting === m.month}
                    className="p-2 rounded-lg hover:bg-red-50 text-brand-wood/40 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50">
                    {deleting === m.month ? <CircleNotch size={18} className="animate-spin" /> : <Trash size={18} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Monthly Summary Metrics */}
        {analytics && (
          <div className="anime-section opacity-0 grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Total Departures</p>
              <h3 className="font-serif text-3xl text-brand-black">{analytics.totalDepartures}</h3>
              <p className="text-xs text-brand-wood/50 mt-1">{analytics.totalHVDepartures} are 100+ pax</p>
            </div>
            <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Est. Monthly Passengers</p>
              <h3 className="font-serif text-3xl text-brand-black">{analytics.totalPassengers.toLocaleString()}</h3>
              <p className="text-xs text-brand-wood/50 mt-1">~{analytics.avgDailyPax}/day departing</p>
            </div>
            <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Busiest Day</p>
              <h3 className="font-serif text-2xl text-brand-black">{analytics.busiestDay?.dayOfWeek}</h3>
              <p className="text-xs text-brand-wood/50 mt-1">{analytics.busiestDay?.passengers.toLocaleString()} pax</p>
            </div>
            <div className="bg-white rounded-[20px] p-6 border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Airlines</p>
              <h3 className="font-serif text-3xl text-brand-black">{analytics.airlines.length}</h3>
              <p className="text-xs text-brand-wood/50 mt-1 truncate">{analytics.airlines.slice(0, 5).join(', ')}</p>
            </div>
          </div>
        )}

        {/* Day of Week Averages */}
        {analytics && analytics.dayOfWeekAvg.length > 0 && (
          <div className="anime-section opacity-0 flex flex-col gap-4">
            <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Average by Day of Week</h3>
            <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              <div className="flex items-end gap-4" style={{ height: '200px' }}>
                {analytics.dayOfWeekAvg.map(d => {
                  const pct = Math.max((d.avgPassengers / maxDowPax) * 100, 4);
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full group cursor-default">
                      <div className="text-[10px] font-semibold text-brand-wood/70 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {d.avgPassengers}
                      </div>
                      <div className="w-full max-w-[48px] rounded-t-lg"
                        style={{ height: `${pct}%`, backgroundColor: 'rgba(200, 169, 110, 0.3)' }} />
                      <div className="text-[11px] text-brand-wood/70 font-medium mt-2">{d.day.substring(0, 3)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Daily Passenger Chart */}
        {analytics && analytics.days.length > 0 && (
          <div className="anime-section opacity-0 flex flex-col gap-4">
            <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Daily Foot Traffic (Departing Passengers)</h3>
            <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] overflow-x-auto">
              <div className="flex items-end gap-1 min-w-[600px]" style={{ height: '200px' }}>
                {analytics.days.map(d => {
                  const pct = Math.max((d.totalPassengers / maxDailyPax) * 100, 3);
                  const dayNum = d.date.substring(8, 10);
                  const isWeekend = d.dayOfWeek === 'Saturday' || d.dayOfWeek === 'Sunday';
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group cursor-default">
                      <div className="text-[7px] font-semibold text-brand-wood/70 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {d.totalPassengers}
                      </div>
                      <div className="w-full max-w-[18px] rounded-t transition-all duration-300"
                        style={{
                          height: `${pct}%`,
                          backgroundColor: isWeekend ? 'rgba(91, 138, 138, 0.4)' : 'rgba(200, 169, 110, 0.3)',
                        }} />
                      <div className={`text-[7px] font-medium mt-1 ${isWeekend ? 'text-brand-teal' : 'text-brand-wood/50'}`}>{dayNum}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-4 text-[10px] text-brand-wood/50">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(200, 169, 110, 0.3)' }} /> Weekday</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(91, 138, 138, 0.4)' }} /> Weekend</span>
              </div>
            </div>
          </div>
        )}

        {/* Daily Detail Table */}
        {analytics && analytics.days.length > 0 && (
          <div className="anime-section opacity-0 flex flex-col gap-4">
            <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Daily Breakdown</h3>
            <div className="bg-white rounded-[20px] border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-6 py-4 bg-brand-cream/50 border-b border-brand-wood/10 text-[10px] font-semibold text-brand-wood/60 uppercase tracking-wide">
                <div className="col-span-2">Date</div>
                <div className="col-span-1 text-center">Deps</div>
                <div className="col-span-1 text-center">100+</div>
                <div className="col-span-2 text-center">Est. Pax</div>
                <div className="col-span-2 text-center">First HV</div>
                <div className="col-span-2 text-center">Last HV</div>
                <div className="col-span-2 text-center">Peak Hour</div>
              </div>
              <div className="flex flex-col divide-y divide-brand-wood/5 max-h-[500px] overflow-y-auto">
                {analytics.days.map(d => {
                  const isWeekend = d.dayOfWeek === 'Saturday' || d.dayOfWeek === 'Sunday';
                  return (
                    <div key={d.date} className={`grid grid-cols-12 gap-2 px-6 py-3 items-center hover:bg-brand-cream/30 transition-colors ${isWeekend ? 'bg-brand-teal/[0.02]' : ''}`}>
                      <div className="col-span-2">
                        <span className="text-sm font-semibold text-brand-black">{d.dayOfWeek.substring(0, 3)} {d.date.substring(8)}</span>
                      </div>
                      <div className="col-span-1 text-center text-sm text-brand-wood/80">{d.departures}</div>
                      <div className="col-span-1 text-center">
                        <span className={`text-sm font-semibold ${d.hvDepartures > 5 ? 'text-brand-gold' : 'text-brand-wood/70'}`}>{d.hvDepartures}</span>
                      </div>
                      <div className="col-span-2 text-center text-sm font-medium text-brand-black">{d.totalPassengers.toLocaleString()}</div>
                      <div className="col-span-2 text-center text-xs text-brand-wood/70">{d.firstHVDeparture || '—'}</div>
                      <div className="col-span-2 text-center text-xs text-brand-wood/70">{d.lastHVDeparture || '—'}</div>
                      <div className="col-span-2 text-center text-xs text-brand-wood/70">{d.peakHour || '—'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Upload Section */}
        <div className="anime-section opacity-0">
          <h3 className="font-serif text-[22px] text-brand-black tracking-tight mb-4">Upload New Schedule</h3>
          <div className="flex items-center gap-4 mb-4">
            <CalendarBlank size={18} className="text-brand-wood/60" />
            <label className="text-sm font-medium text-brand-black">Month:</label>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold" />
          </div>

          <div onDragOver={e => { e.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative bg-white rounded-[20px] border-2 border-dashed p-8 md:p-10 text-center cursor-pointer transition-all duration-300 ${
              dragActive ? 'border-brand-gold bg-brand-gold/5 scale-[1.01]' : 'border-brand-wood/20 hover:border-brand-gold/50'
            }`}>
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileSelect} className="hidden" />
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <CircleNotch size={36} className="text-brand-gold animate-spin" />
                <p className="text-sm font-medium text-brand-wood/80">Parsing schedule... ~30 seconds</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={36} className="text-brand-wood/40" />
                <p className="text-sm font-medium text-brand-black">Drop ABAA Carrier Movements PDF</p>
                <p className="text-xs text-brand-wood/60">for {formatMonth(selectedMonth)}</p>
              </div>
            )}
          </div>

          {uploadResult && (
            <div className={`mt-4 p-4 rounded-xl border flex items-center gap-3 ${uploadResult.success ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              {uploadResult.success ? <CheckCircle size={20} className="text-green-600" /> : <WarningCircle size={20} className="text-amber-600" />}
              <div className="text-sm">
                {uploadResult.success ? (
                  <><span className="font-semibold">{uploadResult.totalFlights} flights</span> extracted — <span className="text-brand-gold font-medium">{uploadResult.departures} departures</span></>
                ) : (
                  <span className="text-amber-700">{uploadResult.error || 'Failed to parse schedule.'}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Empty state */}
        {!analytics && uploadedMonths.length === 0 && !uploading && (
          <div className="anime-section opacity-0 bg-white rounded-[20px] border border-brand-wood/15 p-12 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex flex-col items-center text-center gap-4">
            <AirplaneTakeoff size={48} className="text-brand-wood/30" />
            <p className="text-brand-wood/60 text-sm max-w-md">Upload the ABAA Carrier Movements PDF to see flight analytics, passenger estimates, and daily foot traffic.</p>
          </div>
        )}
      </div>
    </div>
  );
}
