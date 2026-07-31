export interface SalesDay {
  date: string;
  dayName: string;
  today: {
    sales: number;
    tickets: number;
    discount: number;
    avgTransaction: number;
    hourly: unknown;
    hasData: boolean;
  };
  comparison: {
    lastWeek: { date: string; sales: number; tickets: number; hasData: boolean };
    pctVsLastWeek: number | null;
    dowAvg: number;
    pctVsDowAvg: number | null;
    dowCount: number;
  };
  trend: Array<{ date: string; sales: number; tickets: number; hasData?: boolean }>;
}

export interface MonthSummary {
  month: string;
  totalSales: number;
  totalTickets: number;
  totalDays: number;
}

export interface MonthlySales {
  startDate: string;
  endDate: string;
  totalSales: number;
  totalTransactions: number;
  avgTransaction: number;
  dailyData: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    avgTransaction: number;
    totalDiscount: number;
    totalTax: number;
    hasData?: boolean;
  }>;
}

export interface SalesData {
  daily: SalesDay;
  months: MonthSummary[];
  selectedMonth: MonthlySales | null;
  dailyMeta?: SalesMeta;
  monthlyMeta?: SalesMeta;
}

export type SalesScreenState =
  | { kind: 'loading'; date: string }
  | { kind: 'empty'; date: string }
  | { kind: 'error'; date: string; message: string }
  | { kind: 'ready'; data: SalesData }
  | { kind: 'stale'; data: SalesData; message: string };

export interface SalesMeta {
  updatedAt: string | null;
  source: 'automatic-gmail' | 'not-received';
}

export interface SalesApiResponse<T> {
  data: T;
  meta: SalesMeta;
}
