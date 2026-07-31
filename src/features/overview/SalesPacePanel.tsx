import { Metric } from '@/components/ui/Metric';
import { Panel } from '@/components/ui/Panel';
import { DomainStatus, ErrorData, formatCurrency, PanelLink } from './panel-shared';
import type { DomainResult, SalesOverview } from './types';

export function SalesPacePanel({
  date,
  result,
}: {
  date: string;
  result: DomainResult<SalesOverview>;
}) {
  return (
    <Panel
      actions={<PanelLink href={`/dashboard/sales?date=${date}`}>Open sales</PanelLink>}
      description="Reported performance and comparison pace."
      title="Sales pace"
    >
      <DomainStatus label="Sales" result={result} />
      {result.data?.hasData && result.data.revenue !== null ? (
        <div className="grid gap-5 sm:grid-cols-3">
          <Metric detail="Reported today" label="Revenue" tone={(result.data.comparisonPercent ?? 0) > 0 ? 'positive' : 'default'} value={formatCurrency(result.data.revenue)} />
          <Metric detail="Reported tickets" label="Transactions" value={result.data.tickets?.toLocaleString('en-CA') ?? '—'} />
          <Metric detail="Per transaction" label="Average" value={result.data.averageTransaction === null ? '—' : formatCurrency(result.data.averageTransaction)} />
        </div>
      ) : result.status === 'error' ? (
        <ErrorData result={result} />
      ) : (
        <p className="text-sm leading-6 text-muted">
          No sales report has arrived for today. Automatic imports remain the default source.
        </p>
      )}
    </Panel>
  );
}
