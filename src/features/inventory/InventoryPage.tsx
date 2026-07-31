'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { DetailDrawer } from '@/components/ui/DetailDrawer';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/DataState';
import { Metric } from '@/components/ui/Metric';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { ReorderRuleForm } from './ReorderRuleForm';
import type { InventoryItem, InventoryRisk, RiskClass } from './types';

const usd = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const risks: RiskClass[] = ['CRITICAL', 'AT_RISK', 'DEAD_STOCK', 'OVERSTOCKED', 'HEALTHY'];

export function InventoryPage({ initialRisk }: { initialRisk?: InventoryRisk }) {
  const params = useSearchParams();
  const paramRisk = params?.get('risk');
  const [data, setData] = useState<InventoryRisk | undefined>(initialRisk);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState<RiskClass | 'ALL'>(risks.includes(paramRisk as RiskClass) ? paramRisk as RiskClass : 'ALL');
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailHistory, setDetailHistory] = useState<{ date: string; qty: number; revenue: number }[]>([]);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const refresh = async () => { const response = await fetch('/api/inventory/risk', { cache: 'no-store' }); if (!response.ok) throw new Error('Inventory risk could not be refreshed.'); setData(await response.json()); };
  useEffect(() => { setRisk(risks.includes(paramRisk as RiskClass) ? paramRisk as RiskClass : 'ALL'); }, [paramRisk]);
  useEffect(() => { if (!initialRisk) void refresh().catch(() => setError('Inventory risk could not be refreshed.')); }, [initialRisk]);
  useEffect(() => { if (!selected) return; setDetailHistory([]); setRecommendation(null); void fetch(`/api/inventory/item?itemNo=${encodeURIComponent(selected.itemNo)}`).then(async (response) => response.ok ? response.json() : null).then((detail) => setDetailHistory(detail?.history ?? [])).catch(() => setDetailHistory([])); }, [selected]);
  const items = useMemo(() => data ? [...data.critical, ...data.atRisk, ...data.healthy, ...data.deadStock, ...data.overstocked]
    .filter((item) => (risk === 'ALL' || item.risk === risk) && `${item.itemNo} ${item.descr} ${item.category ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.risk.localeCompare(b.risk) || (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity)) : [], [data, query, risk]);
  const saveRule = async (value: { minStock: number; reorderPoint: number; maxStock: number; leadTimeDays: number }) => {
    if (!selected) return;
    setSaving(true); setError(null);
    try { const response = await fetch('/api/inventory/rules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item_no: selected.itemNo, min_stock: value.minStock, reorder_point: value.reorderPoint, max_stock: value.maxStock, lead_time_days: value.leadTimeDays }) }); if (!response.ok) throw new Error(); await refresh(); setSelected((item) => item ? { ...item, reorder: { min: value.minStock, reorderPoint: value.reorderPoint, max: value.maxStock, leadTimeDays: value.leadTimeDays } } : null); } catch { setError('Reorder rule could not be saved.'); } finally { setSaving(false); }
  };
  const runRecommendation = async () => { setAnalyzing(true); setAnalysisError(null); try { const response = await fetch('/api/ai/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analysisType: 'restock_briefing' }) }); if (!response.ok) throw new Error(); const result = await response.json(); setRecommendation(result.analysis); } catch { setAnalysisError('Recommendation could not be generated.'); } finally { setAnalyzing(false); } };
  if (error && !data) return <ErrorState title="Inventory unavailable" message={error} />;
  if (!data) return <LoadingState label="Loading inventory risk" />;
  return <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <PageHeader eyebrow="Stock control" title="Inventory action center" description={`Snapshot ${data.snapshotDate ?? 'not received'} · ${data.salesWindow}-day sales velocity.`} />
    {error ? <ErrorState title="Action needs attention" message={error} /> : null}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Critical" tone="danger" value={data.summary.criticalCount} /><Metric label="At risk" tone="warning" value={data.summary.atRiskCount} /><Metric label="Dead stock" value={usd(data.summary.deadStockValue)} /><Metric label="Tracked SKUs" value={data.summary.totalSkusTracked} /></section>
    <Panel title="Prioritized stock"><div className="mb-4 flex flex-wrap gap-3"><input aria-label="Search inventory" className="min-h-11 rounded-md border border-line px-3" onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU or item" value={query} /><select aria-label="Risk filter" className="min-h-11 rounded-md border border-line px-3" onChange={(event) => setRisk(event.target.value as RiskClass | 'ALL')} value={risk}><option value="ALL">All risks</option>{risks.map((value) => <option key={value}>{value}</option>)}</select></div>{items.length ? <div className="divide-y divide-line">{items.map((item) => <button aria-label={`Open ${item.itemNo}`} className="terminal-focus flex w-full items-center justify-between gap-4 py-4 text-left" key={item.itemNo} onClick={() => setSelected(item)}><span><strong>{item.itemNo}</strong><span className="ml-3 text-muted">{item.descr}</span></span><span className="font-mono text-sm">{item.risk} · {item.daysOfCover ?? '∞'} days</span></button>)}</div> : <EmptyState title="No items match this view" message="Try another search or risk filter." />}</Panel>
    <DetailDrawer onClose={() => setSelected(null)} open={Boolean(selected)} title={`${selected?.itemNo ?? ''} inventory details`} description={selected?.descr}>{selected ? <div className="space-y-6"><dl className="grid grid-cols-2 gap-4 text-sm"><div><dt>On hand</dt><dd>{selected.qtyOnHand}</dd></div><div><dt>Velocity</dt><dd>{selected.velocityPerDay}/day</dd></div><div><dt>Days of cover</dt><dd>{selected.daysOfCover ?? 'Infinite'}</dd></div><div><dt>Value</dt><dd>{usd(selected.totalValue)}</dd></div><div><dt>Last sale</dt><dd>{selected.lastSaleDate ?? 'No recent sale'}</dd></div><div><dt>Recommendation evidence</dt><dd>Based on {data.salesWindow}-day velocity and the latest stock snapshot.</dd></div></dl><Panel title="Sales history" description="Last 90 days of recorded movement.">{detailHistory.length ? <ul className="space-y-2 text-sm">{detailHistory.slice(0, 8).map((row) => <li key={row.date}>{row.date}: {row.qty} units · {usd(row.revenue)}</li>)}</ul> : <p className="text-sm text-muted">No recorded sales history.</p>}</Panel><Panel title="AI restock recommendation" description="Generated only on request from current stock, sales, and flight evidence."><Button onClick={() => void runRecommendation()} variant="secondary">{analyzing ? 'Generating recommendation…' : 'Run restock recommendation'}</Button>{analysisError ? <p className="mt-3 text-sm text-danger" role="alert">{analysisError}</p> : null}{recommendation ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">{recommendation}</p> : null}</Panel><Panel title="Reorder rule" description="Save a complete rule to keep ordering thresholds valid."><ReorderRuleForm onSave={saveRule} value={{ minStock: selected.reorder.min ?? 0, reorderPoint: selected.reorder.reorderPoint ?? 0, maxStock: selected.reorder.max ?? 0, leadTimeDays: selected.reorder.leadTimeDays }} />{saving ? <p className="mt-3 text-sm text-muted">Saving rule…</p> : null}</Panel></div> : null}</DetailDrawer>
  </main>;
}
