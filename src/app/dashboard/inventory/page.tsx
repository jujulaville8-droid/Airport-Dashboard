'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import anime from 'animejs';
import {
  Upload,
  Package,
  CircleNotch,
  WarningCircle,
  Warning,
  CheckCircle,
  X,
  Sparkle,
  Tag,
  TrendDown,
  CurrencyDollar,
} from '@phosphor-icons/react';

type RiskClass = 'CRITICAL' | 'AT_RISK' | 'HEALTHY' | 'DEAD_STOCK' | 'OVERSTOCKED';

interface ItemRisk {
  itemNo: string;
  descr: string;
  category: string | null;
  qtyOnHand: number;
  unitCost: number;
  totalValue: number;
  velocityPerDay: number;
  daysOfCover: number | null;
  lastSaleDate: string | null;
  risk: RiskClass;
  reorder: {
    min: number | null;
    reorderPoint: number | null;
    max: number | null;
    leadTimeDays: number;
  };
}

interface RiskSummary {
  asOf: string;
  critical: ItemRisk[];
  atRisk: ItemRisk[];
  healthy: ItemRisk[];
  deadStock: ItemRisk[];
  overstocked: ItemRisk[];
  summary: {
    criticalCount: number;
    atRiskCount: number;
    deadStockCount: number;
    deadStockValue: number;
    overstockedCount: number;
    totalSkusTracked: number;
    totalInventoryValue: number;
    snapshotDate: string | null;
  };
}

interface ItemDetail {
  master: {
    item_no: string;
    descr: string | null;
    categ_cod: string | null;
    subcat_cod: string | null;
    unit_cost: number | null;
    unit_price: number | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
  };
  snapshots: {
    snapshot_date: string;
    qty_on_hand: number;
    unit_cost: number | null;
    total_value: number | null;
  }[];
  rule: {
    item_no: string;
    min_stock: number | null;
    reorder_point: number | null;
    max_stock: number | null;
    lead_time_days: number | null;
    notes: string | null;
  } | null;
  history: { date: string; qty: number; revenue: number }[];
}

type UploadKind = 'items' | 'inventory';

interface UploadResult {
  success: boolean;
  kind: UploadKind;
  message: string;
}

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function InventoryPage() {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animatedRef = useRef(false);
  const itemsFileInput = useRef<HTMLInputElement>(null);
  const snapshotFileInput = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [risk, setRisk] = useState<RiskSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadingKind, setUploadingKind] = useState<UploadKind | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [itemDetail, setItemDetail] = useState<ItemDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Reorder-rule editing state (lives inside the drawer)
  const [editingRule, setEditingRule] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<{
    min_stock: string;
    reorder_point: string;
    max_stock: string;
    lead_time_days: string;
    notes: string;
  }>({ min_stock: '', reorder_point: '', max_stock: '', lead_time_days: '14', notes: '' });
  const [savingRule, setSavingRule] = useState(false);

  // Briefing state
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);

  const fetchRisk = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/risk');
      if (!res.ok) {
        console.error('[inventory] /api/inventory/risk failed:', res.status);
        setLoadError('Failed to load inventory risk summary.');
        return;
      }
      const data: RiskSummary = await res.json();
      setRisk(data);
      setLoadError(null);
    } catch (e) {
      console.error('[inventory] fetch risk network error:', e);
      setLoadError('Network error loading inventory data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRisk();
  }, [fetchRisk]);

  // Entrance animation — run once after first data load
  useEffect(() => {
    anime({
      targets: headerRef.current,
      translateY: [-20, 0],
      opacity: [0, 1],
      easing: 'easeOutExpo',
      duration: 800,
    });
  }, []);

  useEffect(() => {
    if (animatedRef.current || loading || !contentRef.current) return;
    animatedRef.current = true;
    const sections = contentRef.current.querySelectorAll('.anime-section');
    if (sections.length > 0) {
      anime({
        targets: sections,
        translateY: [30, 0],
        opacity: [0, 1],
        delay: anime.stagger(100),
        easing: 'easeOutExpo',
        duration: 600,
      });
    }
  }, [loading]);

  // --- Uploads ---

  const handleFile = async (file: File, kind: UploadKind) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xls', 'xlsx', 'csv'].includes(ext || '')) {
      setUploadResult({ success: false, kind, message: 'File must be .xls, .xlsx, or .csv' });
      return;
    }

    setUploadingKind(kind);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', file);

    const endpoint = kind === 'items' ? '/api/items/import' : '/api/inventory/snapshot';

    try {
      const res = await fetch(endpoint, { method: 'POST', body: formData });
      let data: { success?: boolean; error?: string; errors?: string[]; rowsParsed?: number; uniqueSkus?: number; totalValue?: number } = {};
      try {
        data = await res.json();
      } catch { /* non-JSON body */ }

      if (!res.ok) {
        const msg = data.error || (data.errors ?? []).join('; ') || `Upload failed (HTTP ${res.status})`;
        console.error(`[inventory] ${kind} upload failed:`, msg);
        setUploadResult({ success: false, kind, message: msg });
        return;
      }

      const rows = data.rowsParsed ?? 0;
      const skus = data.uniqueSkus ?? 0;
      const value = data.totalValue;
      const successMsg = kind === 'items'
        ? `Imported ${rows.toLocaleString()} line items across ${skus.toLocaleString()} SKUs`
        : `Snapshot saved: ${rows.toLocaleString()} SKUs${value ? `, ${fmtUSD(value)} total value` : ''}`;

      setUploadResult({ success: true, kind, message: successMsg });
      await fetchRisk();
    } catch (e) {
      console.error(`[inventory] ${kind} upload network error:`, e);
      setUploadResult({ success: false, kind, message: 'Network error during upload' });
    } finally {
      setUploadingKind(null);
    }
  };

  // --- Item detail drawer ---

  const openDetail = async (itemNo: string) => {
    setSelectedItem(itemNo);
    setItemDetail(null);
    setEditingRule(false);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/inventory/item?itemNo=${encodeURIComponent(itemNo)}`);
      if (!res.ok) {
        console.error('[inventory] item detail failed:', res.status);
        setLoadError('Failed to load item detail.');
        setSelectedItem(null);
        return;
      }
      const data: ItemDetail = await res.json();
      setItemDetail(data);
      setRuleDraft({
        min_stock: data.rule?.min_stock?.toString() ?? '',
        reorder_point: data.rule?.reorder_point?.toString() ?? '',
        max_stock: data.rule?.max_stock?.toString() ?? '',
        lead_time_days: data.rule?.lead_time_days?.toString() ?? '14',
        notes: data.rule?.notes ?? '',
      });
    } catch (e) {
      console.error('[inventory] item detail network error:', e);
      setLoadError('Network error loading item.');
      setSelectedItem(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDetail = () => {
    setSelectedItem(null);
    setItemDetail(null);
    setEditingRule(false);
  };

  const saveRule = async () => {
    if (!selectedItem) return;
    setSavingRule(true);
    try {
      const payload: Record<string, unknown> = { item_no: selectedItem };
      if (ruleDraft.min_stock !== '') payload.min_stock = ruleDraft.min_stock;
      if (ruleDraft.reorder_point !== '') payload.reorder_point = ruleDraft.reorder_point;
      if (ruleDraft.max_stock !== '') payload.max_stock = ruleDraft.max_stock;
      if (ruleDraft.lead_time_days !== '') payload.lead_time_days = ruleDraft.lead_time_days;
      if (ruleDraft.notes.trim()) payload.notes = ruleDraft.notes.trim();

      const res = await fetch('/api/inventory/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let errMsg = 'Failed to save reorder rule';
        try {
          const data = await res.json();
          if (data?.error) errMsg = data.error;
        } catch { /* non-JSON */ }
        console.error('[inventory] save rule failed:', res.status, errMsg);
        setLoadError(errMsg);
        return;
      }
      setEditingRule(false);
      // Refresh both detail and overall risk (rule changes can flip classification)
      await Promise.all([openDetail(selectedItem), fetchRisk()]);
    } catch (e) {
      console.error('[inventory] save rule network error:', e);
      setLoadError('Network error saving reorder rule');
    } finally {
      setSavingRule(false);
    }
  };

  // --- AI restock briefing ---

  const runBriefing = async () => {
    setGeneratingBriefing(true);
    setBriefing(null);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisType: 'restock_briefing' }),
      });
      let data: { analysis?: string; error?: string } = {};
      try {
        data = await res.json();
      } catch { /* non-JSON */ }
      if (!res.ok) {
        console.error('[inventory] briefing failed:', res.status, data.error);
        setBriefing(data.error || `Failed to generate briefing (HTTP ${res.status})`);
      } else {
        setBriefing(data.analysis || 'No briefing returned');
      }
    } catch (e) {
      console.error('[inventory] briefing network error:', e);
      setBriefing('Network error generating briefing');
    } finally {
      setGeneratingBriefing(false);
    }
  };

  // --- Render ---

  const s = risk?.summary;
  const hasData = (s?.totalSkusTracked ?? 0) > 0;

  return (
    <div className="px-6 md:px-10 lg:px-14">
      {/* Header */}
      <div
        ref={headerRef}
        className="opacity-0 flex flex-col sm:flex-row sm:items-end justify-between pt-10 md:pt-14 pb-8 md:pb-12 gap-6"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-[32px] md:text-[40px] leading-tight text-brand-black tracking-tight">
            Inventory
          </h2>
          <p className="text-sm font-medium text-brand-wood/80">
            {s?.snapshotDate
              ? `Last snapshot ${fmtDate(s.snapshotDate)} · ${s.totalSkusTracked.toLocaleString()} SKUs tracked`
              : 'Upload a stock snapshot to begin'}
          </p>
        </div>
        <div className="flex gap-3">
          <input
            ref={itemsFileInput}
            type="file"
            accept=".xls,.xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file, 'items');
              e.target.value = '';
            }}
          />
          <input
            ref={snapshotFileInput}
            type="file"
            accept=".xls,.xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file, 'inventory');
              e.target.value = '';
            }}
          />
          <button
            onClick={() => itemsFileInput.current?.click()}
            disabled={uploadingKind !== null}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-brand-wood/20 text-brand-black rounded-lg text-sm font-medium cursor-pointer hover:border-brand-gold transition-colors disabled:opacity-50"
          >
            {uploadingKind === 'items'
              ? <CircleNotch size={16} className="animate-spin" />
              : <Upload size={16} />}
            Upload Item Sales
          </button>
          <button
            onClick={() => snapshotFileInput.current?.click()}
            disabled={uploadingKind !== null}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-gold text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-brand-gold/90 transition-colors disabled:opacity-50"
          >
            {uploadingKind === 'inventory'
              ? <CircleNotch size={16} className="animate-spin" />
              : <Package size={16} weight="fill" />}
            Upload Stock Snapshot
          </button>
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

      {uploadResult && (
        <div
          className={`max-w-[1600px] mx-auto mb-4 px-4 py-3 rounded-md border text-sm flex items-center justify-between ${
            uploadResult.success
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span className="flex items-center gap-2">
            {uploadResult.success
              ? <CheckCircle size={16} weight="fill" />
              : <WarningCircle size={16} weight="fill" />}
            {uploadResult.message}
          </span>
          <button
            onClick={() => setUploadResult(null)}
            className="font-medium ml-4 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div ref={contentRef} className="flex flex-col gap-8 lg:gap-10 max-w-[1600px] mx-auto pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-brand-wood/60 gap-3">
            <CircleNotch size={24} className="animate-spin" />
            <span className="text-sm">Loading inventory…</span>
          </div>
        ) : !hasData ? (
          <div className="anime-section opacity-0 bg-white rounded-[20px] border border-brand-wood/15 p-12 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] flex flex-col items-center text-center gap-4">
            <Package size={40} className="text-brand-wood/40" />
            <h3 className="font-serif text-xl text-brand-black">No inventory data yet</h3>
            <p className="text-sm text-brand-wood/60 max-w-md">
              Upload a Counterpoint Inventory Valuation report to get started. Then upload an Item Sales
              Analysis report to enable velocity and stockout detection.
            </p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="anime-section opacity-0 grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              <SummaryCard
                label="Critical"
                value={s!.criticalCount.toString()}
                sublabel={`${s!.atRiskCount} at risk`}
                tone="danger"
                icon={Warning}
              />
              <SummaryCard
                label="Dead stock"
                value={s!.deadStockCount.toString()}
                sublabel={`${fmtUSD(s!.deadStockValue)} tied up`}
                tone="warning"
                icon={TrendDown}
              />
              <SummaryCard
                label="Overstocked"
                value={s!.overstockedCount.toString()}
                sublabel="above max level"
                tone="neutral"
                icon={Package}
              />
              <SummaryCard
                label="Total value"
                value={fmtUSD(s!.totalInventoryValue)}
                sublabel={`${s!.totalSkusTracked.toLocaleString()} SKUs`}
                tone="accent"
                icon={CurrencyDollar}
              />
            </div>

            {/* AI Briefing */}
            <div className="anime-section opacity-0 flex flex-col gap-4">
              <div className="flex items-end justify-between">
                <h3 className="font-serif text-[22px] text-brand-black tracking-tight">
                  AI Restock Briefing
                </h3>
                <button
                  onClick={runBriefing}
                  disabled={generatingBriefing}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-black text-white rounded-lg text-xs font-medium cursor-pointer hover:bg-brand-black/90 transition-colors disabled:opacity-50"
                >
                  {generatingBriefing
                    ? <CircleNotch size={14} className="animate-spin" />
                    : <Sparkle size={14} weight="fill" className="text-brand-gold" />}
                  {generatingBriefing ? 'Generating…' : 'Generate Weekly Briefing'}
                </button>
              </div>
              <div className="bg-gradient-to-br from-white to-brand-gold/[0.02] rounded-[20px] border border-brand-wood/15 border-l-[3px] border-l-brand-gold p-6 lg:p-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]">
                {briefing ? (
                  <div className="whitespace-pre-wrap text-sm text-brand-black/85 leading-relaxed">
                    {briefing}
                  </div>
                ) : (
                  <p className="text-sm text-brand-wood/60">
                    Click &ldquo;Generate Weekly Briefing&rdquo; to get a Claude-powered restock plan based on
                    current stock, velocity, and upcoming flight traffic.
                  </p>
                )}
              </div>
            </div>

            {/* Critical stockouts */}
            {risk!.critical.length > 0 && (
              <RiskTable
                title="Critical — order now"
                subtitle="At or below minimum stock, or days-of-cover below half lead time"
                items={risk!.critical}
                accent="danger"
                onRowClick={openDetail}
              />
            )}

            {risk!.atRisk.length > 0 && (
              <RiskTable
                title="At risk"
                subtitle="Below reorder point or cover less than lead time"
                items={risk!.atRisk}
                accent="warning"
                onRowClick={openDetail}
              />
            )}

            {/* Dead stock */}
            {risk!.deadStock.length > 0 && (
              <RiskTable
                title="Dead stock"
                subtitle="No sales in 30+ days. Candidates for discount or clearance."
                items={risk!.deadStock}
                accent="neutral"
                showValue
                onRowClick={openDetail}
              />
            )}

            {/* Overstocked */}
            {risk!.overstocked.length > 0 && (
              <RiskTable
                title="Overstocked"
                subtitle="Above configured max_stock. Consider pausing reorders."
                items={risk!.overstocked}
                accent="neutral"
                onRowClick={openDetail}
              />
            )}
          </>
        )}
      </div>

      {/* Item detail drawer */}
      {selectedItem && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm"
            onClick={closeDetail}
            aria-hidden="true"
          />
          <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[540px] bg-brand-cream border-l border-brand-wood/15 shadow-2xl z-50 overflow-y-auto">
            <div className="sticky top-0 bg-brand-cream border-b border-brand-wood/10 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">Item detail</p>
                <p className="font-serif text-lg text-brand-black">{selectedItem}</p>
              </div>
              <button
                onClick={closeDetail}
                className="p-2 rounded-lg text-brand-wood/60 hover:text-brand-black hover:bg-brand-wood/5 cursor-pointer"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {loadingDetail ? (
              <div className="flex items-center justify-center py-20 text-brand-wood/60 gap-3">
                <CircleNotch size={20} className="animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : itemDetail ? (
              <div className="p-6 flex flex-col gap-6">
                <div>
                  <h4 className="font-serif text-xl text-brand-black">{itemDetail.master.descr}</h4>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {itemDetail.master.categ_cod && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-brand-gold/10 text-brand-gold border border-brand-gold/20 uppercase tracking-wider">
                        <Tag size={10} className="inline mr-1" />
                        {itemDetail.master.categ_cod}
                      </span>
                    )}
                    {itemDetail.master.subcat_cod && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-brand-wood/5 text-brand-wood/70 border border-brand-wood/15 uppercase tracking-wider">
                        {itemDetail.master.subcat_cod}
                      </span>
                    )}
                  </div>
                </div>

                {/* Snapshot history */}
                <div>
                  <h5 className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium mb-2">
                    Stock snapshots
                  </h5>
                  {itemDetail.snapshots.length === 0 ? (
                    <p className="text-xs text-brand-wood/60">No snapshots yet</p>
                  ) : (
                    <div className="flex flex-col gap-1.5 text-xs">
                      {itemDetail.snapshots.map((snap) => (
                        <div
                          key={snap.snapshot_date}
                          className="flex items-center justify-between py-2 px-3 bg-white rounded-lg border border-brand-wood/10"
                        >
                          <span className="text-brand-wood/70">{fmtDate(snap.snapshot_date)}</span>
                          <span className="font-mono font-semibold text-brand-black">
                            {snap.qty_on_hand} on hand
                          </span>
                          {snap.total_value != null && (
                            <span className="text-brand-wood/60">{fmtUSD(Number(snap.total_value))}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Sales history */}
                <div>
                  <h5 className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium mb-2">
                    90-day sales
                  </h5>
                  {itemDetail.history.length === 0 ? (
                    <p className="text-xs text-brand-wood/60">No sales in the last 90 days</p>
                  ) : (
                    <div className="text-xs">
                      <div className="grid grid-cols-3 gap-2 text-brand-wood/60 font-medium uppercase tracking-wider text-[9px] pb-2 border-b border-brand-wood/10">
                        <span>Date</span>
                        <span className="text-right">Qty</span>
                        <span className="text-right">Revenue</span>
                      </div>
                      <div className="flex flex-col max-h-64 overflow-y-auto">
                        {[...itemDetail.history].reverse().map((h) => (
                          <div
                            key={h.date}
                            className="grid grid-cols-3 gap-2 py-1.5 border-b border-brand-wood/5 last:border-0"
                          >
                            <span className="text-brand-wood/70">{fmtDate(h.date)}</span>
                            <span className="text-right font-mono">{h.qty}</span>
                            <span className="text-right font-mono text-brand-wood/80">
                              ${h.revenue.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Reorder rule editor */}
                <div className="bg-white rounded-xl border border-brand-wood/10 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">
                      Reorder rules
                    </h5>
                    {!editingRule && (
                      <button
                        onClick={() => setEditingRule(true)}
                        className="text-xs text-brand-gold hover:text-brand-gold/80 font-medium cursor-pointer"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {editingRule ? (
                    <div className="flex flex-col gap-3">
                      <RuleInput
                        label="Min stock (critical)"
                        value={ruleDraft.min_stock}
                        onChange={(v) => setRuleDraft({ ...ruleDraft, min_stock: v })}
                      />
                      <RuleInput
                        label="Reorder point"
                        value={ruleDraft.reorder_point}
                        onChange={(v) => setRuleDraft({ ...ruleDraft, reorder_point: v })}
                      />
                      <RuleInput
                        label="Max stock"
                        value={ruleDraft.max_stock}
                        onChange={(v) => setRuleDraft({ ...ruleDraft, max_stock: v })}
                      />
                      <RuleInput
                        label="Lead time (days)"
                        value={ruleDraft.lead_time_days}
                        onChange={(v) => setRuleDraft({ ...ruleDraft, lead_time_days: v })}
                      />
                      <div className="flex gap-2 mt-1">
                        <button
                          onClick={saveRule}
                          disabled={savingRule}
                          className="flex items-center gap-1 px-3 py-1.5 bg-brand-gold text-white rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50"
                        >
                          {savingRule ? <CircleNotch size={12} className="animate-spin" /> : null}
                          Save
                        </button>
                        <button
                          onClick={() => setEditingRule(false)}
                          className="px-3 py-1.5 bg-white border border-brand-wood/20 rounded-lg text-xs text-brand-wood/70 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <RuleReadout label="Min" value={itemDetail.rule?.min_stock} />
                      <RuleReadout label="Reorder pt" value={itemDetail.rule?.reorder_point} />
                      <RuleReadout label="Max" value={itemDetail.rule?.max_stock} />
                      <RuleReadout
                        label="Lead time"
                        value={itemDetail.rule?.lead_time_days ?? 14}
                        suffix=" days"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// --- Helper components ---

type IconComponent = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill'; className?: string }>;

function SummaryCard({
  label,
  value,
  sublabel,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  sublabel: string;
  tone: 'danger' | 'warning' | 'neutral' | 'accent';
  icon: IconComponent;
}) {
  const toneStyles: Record<string, string> = {
    danger: 'border-l-[3px] border-l-red-500',
    warning: 'border-l-[3px] border-l-amber-500',
    neutral: 'border-l-[3px] border-l-brand-wood/30',
    accent: 'border-l-[3px] border-l-brand-gold',
  };
  const iconStyles: Record<string, string> = {
    danger: 'text-red-500 bg-red-50',
    warning: 'text-amber-600 bg-amber-50',
    neutral: 'text-brand-wood/60 bg-brand-wood/5',
    accent: 'text-brand-gold bg-brand-gold/10',
  };
  return (
    <div
      className={`bg-white rounded-[16px] border border-brand-wood/15 ${toneStyles[tone]} p-5 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)]`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconStyles[tone]}`}>
          <Icon size={16} weight="fill" />
        </div>
      </div>
      <div className="font-serif text-[26px] text-brand-black leading-none">{value}</div>
      <p className="text-[11px] text-brand-wood/60 mt-1.5">{sublabel}</p>
    </div>
  );
}

function RiskTable({
  title,
  subtitle,
  items,
  accent,
  showValue,
  onRowClick,
}: {
  title: string;
  subtitle: string;
  items: ItemRisk[];
  accent: 'danger' | 'warning' | 'neutral';
  showValue?: boolean;
  onRowClick: (itemNo: string) => void;
}) {
  const accentBar: Record<string, string> = {
    danger: 'bg-red-500',
    warning: 'bg-amber-500',
    neutral: 'bg-brand-wood/30',
  };
  return (
    <div className="anime-section opacity-0 flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-1 h-6 rounded-full ${accentBar[accent]}`} />
          <div>
            <h3 className="font-serif text-[22px] text-brand-black tracking-tight">
              {title} <span className="text-brand-wood/50 text-sm font-sans ml-1">({items.length})</span>
            </h3>
            <p className="text-xs text-brand-wood/60">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-[20px] border border-brand-wood/15 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.06)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium border-b border-brand-wood/10">
              <th className="text-left px-6 py-3">Item</th>
              <th className="text-left px-3 py-3 hidden md:table-cell">Category</th>
              <th className="text-right px-3 py-3">On hand</th>
              <th className="text-right px-3 py-3 hidden sm:table-cell">Velocity/day</th>
              <th className="text-right px-3 py-3">
                {showValue ? 'Value' : 'Days cover'}
              </th>
              <th className="text-right px-6 py-3 hidden lg:table-cell">Last sale</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 50).map((item) => (
              <tr
                key={item.itemNo}
                onClick={() => onRowClick(item.itemNo)}
                className="border-b border-brand-wood/5 last:border-0 hover:bg-brand-cream/30 transition-colors cursor-pointer"
              >
                <td className="px-6 py-3">
                  <div className="font-semibold text-brand-black">{item.descr}</div>
                  <div className="text-[11px] text-brand-wood/50 font-mono">{item.itemNo}</div>
                </td>
                <td className="px-3 py-3 hidden md:table-cell text-brand-wood/70 text-xs">
                  {item.category || '—'}
                </td>
                <td className="px-3 py-3 text-right font-mono font-semibold text-brand-black">
                  {item.qtyOnHand}
                </td>
                <td className="px-3 py-3 text-right hidden sm:table-cell font-mono text-brand-wood/80">
                  {item.velocityPerDay.toFixed(1)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-semibold text-brand-black">
                  {showValue
                    ? fmtUSD(item.totalValue)
                    : item.daysOfCover === null
                    ? '∞'
                    : item.daysOfCover.toFixed(1)}
                </td>
                <td className="px-6 py-3 text-right hidden lg:table-cell text-brand-wood/60 text-xs">
                  {fmtDate(item.lastSaleDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length > 50 && (
          <div className="px-6 py-3 text-xs text-brand-wood/50 text-center border-t border-brand-wood/10">
            Showing top 50 of {items.length}
          </div>
        )}
      </div>
    </div>
  );
}

function RuleInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">{label}</label>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="text-sm border border-brand-wood/20 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-brand-gold"
      />
    </div>
  );
}

function RuleReadout({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-brand-wood/60 font-medium">{label}</span>
      <span className="font-mono font-semibold text-brand-black mt-0.5">
        {value === null || value === undefined ? '—' : `${value}${suffix ?? ''}`}
      </span>
    </div>
  );
}
