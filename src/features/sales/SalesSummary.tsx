import { Metric } from '@/components/ui/Metric';
import type { SalesDay, MonthlySales } from './types';

function currency(value: number): string {
  return `$${value.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function SalesSummary({
  daily,
  monthly,
}: {
  daily?: SalesDay;
  monthly?: MonthlySales | null;
}) {
  const source = monthly
    ? {
        revenue: monthly.totalSales,
        tickets: monthly.totalTransactions,
        average: monthly.avgTransaction,
        label: 'Selected month',
      }
    : daily
      ? {
          revenue: daily.today.sales,
          tickets: daily.today.tickets,
          average: daily.today.avgTransaction,
          label: daily.dayName,
        }
      : null;

  if (!source) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Metric label="Revenue" value={currency(source.revenue)} detail={source.label} />
      <Metric label="Tickets" value={source.tickets.toLocaleString('en-CA')} detail="Recorded transactions" />
      <Metric label="Average transaction" value={currency(source.average)} detail="Per ticket" />
    </div>
  );
}
