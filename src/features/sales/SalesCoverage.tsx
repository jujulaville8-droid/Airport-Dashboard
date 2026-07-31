import { Badge } from '@/components/ui/Badge';
import type { SalesDay, SalesMeta } from './types';

export function SalesCoverage({ daily, meta }: { daily: SalesDay; meta: SalesMeta | null }) {
  const comparison = daily.comparison;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-md border border-line bg-app-bg p-4">
        <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">Week over week</p>
        <p className="mt-2 font-display text-3xl font-semibold text-ink">
          {comparison.pctVsLastWeek === null ? 'No baseline' : `${comparison.pctVsLastWeek > 0 ? '+' : ''}${comparison.pctVsLastWeek}%`}
        </p>
        <p className="mt-1 text-sm text-muted">Compared with {comparison.lastWeek.date}</p>
      </div>
      <div className="rounded-md border border-line bg-app-bg p-4">
        <p className="font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">Import freshness</p>
        <div className="mt-2"><Badge tone={meta?.updatedAt ? 'positive' : 'warning'}>{meta?.updatedAt ? 'Latest report received' : 'Awaiting report'}</Badge></div>
        <p className="mt-2 text-sm text-muted">{meta?.updatedAt ? `Updated ${new Date(meta.updatedAt).toLocaleString('en-CA')}` : 'Connect Gmail to receive sales reports automatically.'}</p>
      </div>
    </div>
  );
}
