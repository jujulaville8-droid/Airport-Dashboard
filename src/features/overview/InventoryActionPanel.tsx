import { Metric } from '@/components/ui/Metric';
import { Panel } from '@/components/ui/Panel';
import { DomainStatus, ErrorData, formatCurrency, formatOverviewDate, PanelLink } from './panel-shared';
import type { DomainResult, InventoryOverview } from './types';

export function InventoryActionPanel({ result }: { result: DomainResult<InventoryOverview> }) {
  return (
    <Panel actions={<PanelLink href="/dashboard/inventory">Open inventory</PanelLink>} description="Stockout exposure and capital tied up in slow movers." title="Inventory actions">
      <DomainStatus label="Inventory" result={result} />
      {result.data?.snapshotDate ? (
        <p className="-mt-2 mb-5 text-xs text-muted">Snapshot dated {formatOverviewDate(result.data.snapshotDate)}</p>
      ) : null}
      {result.data?.hasData ? (
        <div className="grid gap-5 sm:grid-cols-3">
          <Metric detail="Reorder now" label="Critical" tone={result.data.criticalCount ? 'danger' : 'positive'} value={result.data.criticalCount ?? '—'} />
          <Metric detail="Monitor closely" label="At risk" tone={result.data.atRiskCount ? 'warning' : 'positive'} value={result.data.atRiskCount ?? '—'} />
          <Metric detail="Slow-moving value" label="Dead stock" value={result.data.deadStockValue === null ? '—' : formatCurrency(result.data.deadStockValue)} />
        </div>
      ) : result.status === 'error' ? (
        <ErrorData result={result} />
      ) : (
        <p className="text-sm leading-6 text-muted">No inventory snapshot has been received. Open Data Connections for the automatic source and recovery path.</p>
      )}
    </Panel>
  );
}
