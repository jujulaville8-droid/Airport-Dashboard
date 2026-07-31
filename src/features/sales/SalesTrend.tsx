import type { SalesDay, MonthlySales } from './types';

function currency(value: number): string {
  return `$${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
}

export function SalesTrend({ daily, monthly }: { daily?: SalesDay; monthly?: MonthlySales | null }) {
  const points = monthly
    ? monthly.dailyData.filter((day) => day.hasData !== false).map((day) => ({
        date: day.date,
        value: day.totalSales,
      }))
    : daily?.trend.filter((day) => day.hasData !== false).map((day) => ({
        date: day.date,
        value: day.sales,
      })) ?? [];
  const max = Math.max(1, ...points.map((point) => point.value));

  if (points.length === 0) {
    return <p className="text-sm text-muted">No comparable sales trend is available yet.</p>;
  }

  return (
    <div className="flex h-48 min-w-[32rem] items-end gap-2" aria-label="Sales trend">
      {points.map((point) => (
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={point.date}>
          <span className="font-mono text-[0.625rem] text-muted">{currency(point.value)}</span>
          <div
            aria-label={`${point.date}: ${currency(point.value)}`}
            className="w-full rounded-t bg-positive/75"
            style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
          />
          <span className="font-mono text-[0.625rem] text-muted">{point.date.slice(-2)}</span>
        </div>
      ))}
    </div>
  );
}
