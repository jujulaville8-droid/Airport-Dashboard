import type { ImportSource, ImportSourceHealth } from '@/lib/import-health';

export type ReadyDomainResult<T> = {
  status: 'ready';
  data: T;
  updatedAt: string | null;
};

export type ErrorDomainResult<T> = {
  status: 'error';
  data: T | null;
  updatedAt: string | null;
  message: string;
};

export type DomainResult<T> =
  | ReadyDomainResult<T>
  | ErrorDomainResult<T>;

export interface SalesOverview {
  hasData: boolean;
  revenue: number | null;
  tickets: number | null;
  averageTransaction: number | null;
  comparisonPercent: number | null;
}

export interface InventoryOverview {
  hasData: boolean;
  criticalCount: number | null;
  atRiskCount: number | null;
  deadStockValue: number | null;
  snapshotDate: string | null;
}

export interface OverviewFlight {
  id: number | string;
  flightNumber: string;
  airline: string;
  scheduledAt: string;
  direction: 'arrival' | 'departure';
  estimatedPassengers: number;
}

export interface FlightsOverview {
  hasData: boolean;
  flights: OverviewFlight[];
  nextPeakAt: string | null;
  peakPassengers: number | null;
}

export interface OverviewShift {
  staffName: string;
  start: string;
  end: string;
  hours: number;
}

export interface CoverageGap {
  airline: string;
  flightNumber: string;
  passengers: number;
  scheduledAt: string;
}

export interface ScheduleOverview {
  hasData: boolean;
  coverageScore: number | null;
  staffOnDuty: number | null;
  shifts: OverviewShift[];
  gaps: CoverageGap[];
}

export interface ConcessionOverview {
  hasData: boolean;
  month: string;
  grossSalesUsd: number | null;
  payableEcd: number | null;
  exceedsThreshold: boolean | null;
}

export interface UnhealthyImportSource {
  source: ImportSource;
  status: Extract<ImportSourceHealth['status'], 'failed' | 'stale' | 'never'>;
  lastSuccessAt: string | null;
  message: string | null;
}

export interface ConnectionsOverview {
  overall: 'healthy' | 'attention' | 'not-configured';
  unhealthySources: UnhealthyImportSource[];
  sources: ImportSourceHealth[];
}

export interface OverviewResponse {
  generatedAt: string;
  date: string;
  sales: DomainResult<SalesOverview>;
  inventory: DomainResult<InventoryOverview>;
  flights: DomainResult<FlightsOverview>;
  schedule: DomainResult<ScheduleOverview>;
  concession: DomainResult<ConcessionOverview>;
  connections: DomainResult<ConnectionsOverview>;
}

export type OverviewDomain = Exclude<
  keyof OverviewResponse,
  'generatedAt' | 'date'
>;

export type ActionLevel = 'act-now' | 'watch' | 'on-track';

export type ActionKind =
  | 'critical-inventory'
  | 'uncovered-flight'
  | 'import-health'
  | 'concession-threshold'
  | 'at-risk-inventory'
  | 'passenger-peak'
  | 'positive-sales';

export interface OverviewAction {
  id: string;
  kind: ActionKind;
  level: ActionLevel;
  title: string;
  detail: string;
  href: string;
}
