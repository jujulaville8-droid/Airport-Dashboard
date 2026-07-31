import type {
  ImportSource,
  ImportSourceHealth,
} from '@/lib/import-health';

export type ConnectionOverallStatus =
  | 'healthy'
  | 'attention'
  | 'not-configured';

export interface RecentImport {
  source: ImportSource;
  attemptedAt: string;
  status: 'success' | 'failed';
  records: number;
  message: string | null;
}

export interface ConnectionsStatusResponse {
  overall: ConnectionOverallStatus;
  cron: {
    configured: boolean;
    schedule: 'hourly';
  };
  flightProvider: {
    provider: 'AeroDataBox';
    configured: boolean;
    airport: 'ANU';
    direction: 'departure';
  };
  sources: ImportSourceHealth[];
  recentImports: RecentImport[];
}

export type RecoveryImportSource = Exclude<
  ImportSource,
  'passenger_summary'
>;

export const RECOVERY_ENDPOINTS: Record<RecoveryImportSource, string> = {
  sales: '/api/sales/import',
  item_sales: '/api/items/import',
  inventory: '/api/inventory/snapshot',
  flight_schedule: '/api/flights/upload-pdf',
};
