'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import anime from 'animejs';
import {
  Receipt,
  WarningCircle,
  CheckCircle,
  CircleNotch,
  DownloadSimple,
} from '@phosphor-icons/react';

interface ConcessionData {
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

export default function ConcessionPage() {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [selectedMonth, setSelectedMonth] = useState('');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [ccSales, setCCSales] = useState('');
  const [cashSales, setCashSales] = useState('');
  const [data, setData] = useState<ConcessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [noSalesData, setNoSalesData] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // On mount, load available months and pick latest
  useEffect(() => {
    async function loadMonths() {
      try {
        const res = await fetch('/api/sales/months');
        if (res.ok) {
          const data = await res.json();
          setAvailableMonths(data.months || []);
          if (data.latestMonth) {
            setSelectedMonth(data.latestMonth);
          } else {
            // Fallback: current month
            const d = new Date();
            setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
          }
        }
      } catch {
        const d = new Date();
        setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    }
    loadMonths();
  }, []);

  const fetchConcession = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);
    setNoSalesData(false);
    try {
      const params = new URLSearchParams({ month: selectedMonth });
      if (ccSales) params.set('ccSales', ccSales);
      if (cashSales) params.set('cashSales', cashSales);

      const res = await fetch(`/api/concession?${params}`);
      if (res.ok) {
        const result = await res.json();
        if (result.grossSalesUSD === 0) {
          setNoSalesData(true);
          setData(null);
        } else {
          setData(result);
        }
      }
    } catch (e) {
      console.error('Concession fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, ccSales, cashSales]);

  useEffect(() => {
    fetchConcession();
  }, [fetchConcession]);

  // Download the airport's concession calculator spreadsheet with this month's
  // numbers populated. Only offered when we're actually paying percentage rent;
  // the sheet's formulas assume net sales >= threshold.
  const handleExport = async () => {
    if (!selectedMonth || !data) return;
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams({ month: selectedMonth });
      if (ccSales) params.set('ccSales', ccSales);
      if (cashSales) params.set('cashSales', cashSales);

      const res = await fetch(`/api/concession/export?${params}`);
      if (!res.ok) {
        let msg = `Export failed (HTTP ${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* non-JSON body */ }
        console.error('[concession] export failed:', msg);
        setExportError(msg);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tailors-Daughter-Concession-${selectedMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[concession] export network error:', e);
      setExportError('Network error generating export');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    anime({ targets: headerRef.current, translateY: [-20, 0], opacity: [0, 1], easing: 'easeOutExpo', duration: 800 });
  }, []);

  const animatedRef = useRef(false);
  useEffect(() => {
    if (animatedRef.current || !data || !contentRef.current) return;
    animatedRef.current = true;
    anime({
      targets: contentRef.current.querySelectorAll('.anime-section'),
      translateY: [30, 0], opacity: [0, 1],
      delay: anime.stagger(150),
      easing: 'easeOutExpo', duration: 800,
    });
  }, [data]);

  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-');
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Gross USD at which 10% of net sales (in ECD) equals the tax-inclusive MAG.
  // Derived: MAG_incl / (PERCENTAGE_RATE * EC_RATE) = 4743.74 / (0.10 * 2.7)
  // ≈ 17,569. Above this line we owe additional rent on top of the already-
  // prepaid MAG; below it we just pay MAG and nothing extra. Keep in sync
  // with the MAG/ABST constants in src/app/api/concession/route.ts.
  const threshold = 17569;
  const progressPct = data ? Math.min((data.grossSalesUSD / threshold) * 100, 100) : 0;

  return (
    <div className="px-6 md:px-10 lg:px-14">
      <div ref={headerRef} className="opacity-0 flex flex-col sm:flex-row sm:items-end justify-between pt-10 md:pt-14 pb-8 md:pb-12 gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-[32px] md:text-[40px] leading-tight text-brand-black tracking-tight">Concession Calculator</h2>
          <p className="text-sm font-medium text-brand-wood/80">ABAA rent calculation — MAG vs percentage</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <CircleNotch size={16} className="animate-spin text-brand-gold" />}
          {availableMonths.length > 0 ? (
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold cursor-pointer"
            >
              {availableMonths.map(m => (
                <option key={m} value={m}>{formatMonth(m)}</option>
              ))}
            </select>
          ) : (
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold" />
          )}
        </div>
      </div>

      <div ref={contentRef} className="flex flex-col gap-8 lg:gap-10 max-w-[1200px] mx-auto pb-10">

        {noSalesData && (
          <div className="bg-white rounded-[20px] border border-brand-wood/15 p-12 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex flex-col items-center text-center gap-4">
            <Receipt size={48} className="text-brand-wood/30" />
            <p className="text-brand-wood/60 text-sm max-w-md">
              No sales data for {formatMonth(selectedMonth)}. Upload a Counterpoint sales report on the Sales page first.
            </p>
          </div>
        )}

        {data && (
          <>
            {/* Threshold Progress */}
            <div className="anime-section opacity-0 bg-white rounded-[20px] border border-brand-wood/15 p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-[22px] text-brand-black tracking-tight">{formatMonth(selectedMonth)}</h3>
                <div className="flex items-center gap-2">
                  {data.exceedsThreshold ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-3 py-1 rounded-full border border-red-200">
                      <WarningCircle size={14} /> Percentage rent exceeds MAG — additional due
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full border border-green-200">
                      <CheckCircle size={14} /> Percentage rent below MAG — $0 additional
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar to threshold */}
              <div className="mb-2 flex items-center justify-between text-xs text-brand-wood/60">
                <span>$0</span>
                <span className="font-medium text-brand-black">MAG break-even: ${threshold.toLocaleString()} USD</span>
              </div>
              <div className="w-full h-4 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(71,85,105,0.1)' }}>
                <div className="h-full rounded-full transition-all duration-1000" style={{
                  width: `${progressPct}%`,
                  backgroundColor: data.exceedsThreshold ? 'rgba(220,38,38,0.6)' : 'rgba(200,169,110,0.5)',
                }} />
              </div>
              <div className="mt-2 text-sm text-brand-wood/70">
                Net sales: <span className="font-semibold text-brand-black">${fmt(data.grossSalesUSD)} USD</span>
                {!data.exceedsThreshold && <span> — ${fmt(threshold - data.grossSalesUSD)} below MAG break-even</span>}
              </div>
            </div>

            {/* You Owe */}
            <div className="anime-section opacity-0 bg-gradient-to-br from-white to-brand-gold/[0.03] rounded-[20px] border border-brand-wood/15 border-l-[4px] border-l-brand-gold p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1">
                  <p className="text-[11px] font-medium text-brand-wood/70 uppercase tracking-wide mb-2">Additional Payable — {formatMonth(selectedMonth)}</p>
                  <div className="flex items-baseline gap-4">
                    <h3 className="font-serif text-4xl md:text-5xl text-brand-black">${fmt(data.concessionPayableECD)}</h3>
                    <span className="text-lg text-brand-wood/60">ECD</span>
                  </div>
                  <p className="text-sm text-brand-wood/60 mt-2">${fmt(data.concessionPayableUSD)} USD</p>
                  <p className="text-xs text-brand-wood/50 mt-1">
                    {data.exceedsThreshold
                      ? `10% of net sales ($${fmt(data.rentPercentageECD)} ECD) − MAG ($${fmt(data.magECD)} ECD, incl. 13% ABST)`
                      : `MAG ($${fmt(data.magECD)} ECD) exceeds 10% of net sales ($${fmt(data.rentPercentageECD)} ECD) — nothing owed on top of MAG this period`
                    }
                  </p>
                </div>
                {data.exceedsThreshold && (
                  <div className="flex flex-col items-end gap-2">
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="flex items-center gap-2 px-4 py-2.5 bg-brand-gold text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-brand-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {exporting
                        ? <CircleNotch size={16} className="animate-spin" />
                        : <DownloadSimple size={16} weight="bold" />}
                      {exporting ? 'Generating…' : 'Export ABAA Calculator'}
                    </button>
                    <p className="text-[10px] text-brand-wood/50 text-right max-w-[200px]">
                      Official airport authority spreadsheet with your numbers filled in
                    </p>
                  </div>
                )}
              </div>
              {exportError && (
                <div className="mt-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between">
                  <span>{exportError}</span>
                  <button
                    onClick={() => setExportError(null)}
                    className="text-red-600 hover:text-red-800 font-medium ml-4"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            {/* CC / Cash Breakdown */}
            <div className="anime-section opacity-0 flex flex-col gap-4">
              <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Credit Card / Cash Split</h3>
              <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                <p className="text-xs text-brand-wood/50 mb-4">Enter CC and cash amounts to calculate net sales after 4% CC commission. Leave blank to use gross total as cash.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Credit Card Sales (USD)</label>
                    <input type="number" value={ccSales} onChange={e => setCCSales(e.target.value)}
                      placeholder="0.00"
                      className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-brand-gold w-full mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] text-brand-wood/60 uppercase font-medium">Cash Sales (USD)</label>
                    <input type="number" value={cashSales} onChange={e => setCashSales(e.target.value)}
                      placeholder="0.00"
                      className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-brand-gold w-full mt-1" />
                  </div>
                </div>
              </div>
            </div>

            {/* Calculation Breakdown */}
            <div className="anime-section opacity-0 flex flex-col gap-4">
              <h3 className="font-serif text-[22px] text-brand-black tracking-tight">Calculation Breakdown</h3>
              <div className="bg-white rounded-[20px] border border-brand-wood/15 p-6 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-brand-wood/10">
                      <td className="py-3 text-brand-wood/70">Total Gross Sales</td>
                      <td className="py-3 text-right font-medium">${fmt(data.grossSalesUSD)} USD</td>
                      <td className="py-3 text-right text-brand-wood/60">${fmt(data.grossSalesECD)} ECD</td>
                    </tr>
                    {data.ccSalesUSD > 0 && (
                      <>
                        <tr className="border-b border-brand-wood/10">
                          <td className="py-3 text-brand-wood/70">Credit Card Sales</td>
                          <td className="py-3 text-right">${fmt(data.ccSalesUSD)} USD</td>
                          <td className="py-3 text-right text-brand-wood/60">${fmt(data.ccSalesUSD * 2.7)} ECD</td>
                        </tr>
                        <tr className="border-b border-brand-wood/10">
                          <td className="py-3 text-brand-wood/70 pl-4">Less: 4% CC commission</td>
                          <td className="py-3 text-right text-red-500">{fmt(data.ccCommissionECD / 2.7)} USD</td>
                          <td className="py-3 text-right text-red-500">{fmt(data.ccCommissionECD)} ECD</td>
                        </tr>
                      </>
                    )}
                    <tr className="border-b border-brand-wood/10">
                      <td className="py-3 text-brand-wood/70">Cash Sales</td>
                      <td className="py-3 text-right">${fmt(data.cashSalesUSD)} USD</td>
                      <td className="py-3 text-right text-brand-wood/60">${fmt(data.cashSalesECD)} ECD</td>
                    </tr>
                    <tr className="border-b-2 border-brand-wood/20">
                      <td className="py-3 font-semibold text-brand-black">Total Net Sales</td>
                      <td className="py-3 text-right font-semibold">${fmt(data.totalNetSalesUSD)} USD</td>
                      <td className="py-3 text-right font-semibold">${fmt(data.totalNetSalesECD)} ECD</td>
                    </tr>
                    <tr className="border-b border-brand-wood/10">
                      <td className="py-3 text-brand-wood/70">Rent @ 10%</td>
                      <td className="py-3 text-right"></td>
                      <td className="py-3 text-right text-brand-wood/60">${fmt(data.rentPercentageECD)} ECD</td>
                    </tr>
                    <tr className="border-b border-brand-wood/10">
                      <td className="py-3 text-brand-wood/70">Less: MAG (incl. 13% ABST)</td>
                      <td className="py-3 text-right"></td>
                      <td className="py-3 text-right text-brand-wood/60">−${fmt(data.magECD)} ECD</td>
                    </tr>
                    <tr>
                      <td className="py-4 font-bold text-brand-black text-base">Additional Payable</td>
                      <td className="py-4 text-right font-bold text-base">${fmt(data.concessionPayableUSD)} USD</td>
                      <td className="py-4 text-right font-bold text-base">${fmt(data.concessionPayableECD)} ECD</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
