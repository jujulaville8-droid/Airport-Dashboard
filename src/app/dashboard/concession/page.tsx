'use client';

import { useEffect, useState, useCallback } from 'react';
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

  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-');
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Gross USD at which 10% of net sales (in ECD) equals MAG. Derived:
  // MAG / (PERCENTAGE_RATE * EC_RATE) = 4198 / (0.10 * 2.7) ≈ 15,548.
  // Above this line we owe additional rent on top of the already-prepaid
  // MAG; below it we just pay MAG and nothing extra.
  const threshold = 15548;
  const progressPct = data ? Math.min((data.grossSalesUSD / threshold) * 100, 100) : 0;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Airport tenancy · ABAA</p>
          <h1 className="font-serif text-3xl leading-tight text-ink sm:text-4xl">Concession rent</h1>
          <p className="max-w-xl text-sm text-muted">A clear monthly position against the minimum annual guarantee, ready for the airport calculator.</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <CircleNotch size={16} className="animate-spin text-brand-gold" />}
          {availableMonths.length > 0 ? (
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              aria-label="Reporting month"
              className="min-h-10 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink shadow-sm"
            >
              {availableMonths.map(m => (
                <option key={m} value={m}>{formatMonth(m)}</option>
              ))}
            </select>
          ) : (
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              aria-label="Reporting month"
              className="min-h-10 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink shadow-sm" />
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-6 pb-8">

        {noSalesData && (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line bg-surface p-12 text-center">
            <Receipt size={40} className="text-muted" />
            <p className="max-w-md text-sm text-muted">
              No sales data for {formatMonth(selectedMonth)}. Upload a Counterpoint sales report on the Sales page first.
            </p>
          </div>
        )}

        {data && (
          <>
            {/* Threshold Progress */}
            <div className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6">
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Rental position</p><h2 className="mt-1 text-lg font-semibold text-ink">{formatMonth(selectedMonth)}</h2></div>
                <div className="flex items-center gap-2">
                  {data.exceedsThreshold ? (
                    <span className="flex items-center gap-1 rounded-full border border-danger/25 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger">
                      <WarningCircle size={14} /> Percentage rent exceeds MAG — additional due
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full border border-positive/25 bg-positive/10 px-3 py-1.5 text-xs font-semibold text-positive">
                      <CheckCircle size={14} /> Percentage rent below MAG — $0 additional
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar to threshold */}
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>$0</span>
                <span className="font-medium text-ink">MAG break-even: ${threshold.toLocaleString()} USD</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-app-bg">
                <div className="h-full rounded-full transition-all duration-1000" style={{
                  width: `${progressPct}%`,
                  backgroundColor: data.exceedsThreshold ? 'rgba(220,38,38,0.6)' : 'rgba(200,169,110,0.5)',
                }} />
              </div>
              <div className="mt-3 text-sm text-muted">
                Net sales: <span className="font-semibold text-ink">${fmt(data.grossSalesUSD)} USD</span>
                {!data.exceedsThreshold && <span> — ${fmt(threshold - data.grossSalesUSD)} below MAG break-even</span>}
              </div>
            </div>

            {/* You Owe */}
            <div className="rounded-lg border border-accent/40 bg-[linear-gradient(110deg,rgba(244,180,31,0.16),rgba(255,255,255,0.92)_55%)] p-5 shadow-sm sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1">
                  <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Additional payment due · {formatMonth(selectedMonth)}</p>
                  <div className="flex items-baseline gap-4">
                    <h2 className="font-mono text-4xl font-semibold tracking-tight text-ink md:text-5xl">${fmt(data.concessionPayableECD)}</h2>
                    <span className="text-lg text-muted">ECD</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">${fmt(data.concessionPayableUSD)} USD</p>
                  <p className="mt-1 text-xs text-muted">
                    {data.exceedsThreshold
                      ? `10% of net sales ($${fmt(data.rentPercentageECD)} ECD) − MAG ($${fmt(data.magECD)} ECD)`
                      : `MAG ($${fmt(data.magECD)} ECD) exceeds 10% of net sales ($${fmt(data.rentPercentageECD)} ECD) — nothing owed on top of MAG this period`
                    }
                  </p>
                </div>
                {data.exceedsThreshold && (
                  <div className="flex flex-col items-end gap-2">
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="flex min-h-10 items-center gap-2 rounded-md bg-nav px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {exporting
                        ? <CircleNotch size={16} className="animate-spin" />
                        : <DownloadSimple size={16} weight="bold" />}
                      {exporting ? 'Generating…' : 'Export airport calculator'}
                    </button>
                    <p className="max-w-[220px] text-right text-[11px] text-muted">
                      Official airport authority spreadsheet with your numbers filled in
                    </p>
                  </div>
                )}
              </div>
              {exportError && (
                <div className="mt-4 flex items-center justify-between rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
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
            <div className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-ink">Enter payment mix</h2>
              <p className="mt-1 text-sm text-muted">Optional. Card sales deduct the 4% processing commission. Leave both blank to treat the imported gross total as cash.</p>
              <div className="mt-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Credit Card Sales (USD)</label>
                    <input type="number" value={ccSales} onChange={e => setCCSales(e.target.value)}
                      placeholder="0.00"
                      className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink" />
                  </div>
                  <div>
                    <label className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Cash Sales (USD)</label>
                    <input type="number" value={cashSales} onChange={e => setCashSales(e.target.value)}
                      placeholder="0.00"
                      className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink" />
                  </div>
                </div>
              </div>
            </div>

            {/* Calculation Breakdown */}
            <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
              <div className="border-b border-line px-5 py-4 sm:px-6"><h2 className="text-lg font-semibold text-ink">Calculation ledger</h2><p className="mt-1 text-sm text-muted">The values used to prepare the rent position.</p></div>
              <div className="overflow-x-auto px-5 sm:px-6"><table className="w-full min-w-[560px] text-sm">
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
                      <td className="py-3 text-brand-wood/70">Less: MAG</td>
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
