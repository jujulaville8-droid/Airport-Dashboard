// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const modify = vi.fn();
  const logImport = vi.fn();
  const gmail = {
    users: {
      labels: {
        list: vi.fn().mockResolvedValue({
          data: {
            labels: [
              { name: 'TailorsDaughter/Imported', id: 'imported-label' },
              { name: 'TailorsDaughter/Failed', id: 'failed-label' },
            ],
          },
        }),
        create: vi.fn(),
      },
      messages: {
        list: vi.fn().mockResolvedValue({ data: { messages: [{ id: 'message-1' }] } }),
        get: vi.fn().mockResolvedValue({
          data: {
            payload: {
              headers: [
                { name: 'From', value: 'reports@example.com' },
                { name: 'Subject', value: 'Monthly sales report' },
              ],
              parts: [{
                filename: 'sales.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                body: { attachmentId: 'attachment-1', size: 128 },
              }],
            },
          },
        }),
        attachments: {
          get: vi.fn().mockResolvedValue({ data: { data: 'd29ya2Jvb2s=' } }),
        },
        modify,
      },
    },
  };
  return { gmail, logImport, modify };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    gmail: () => mocks.gmail,
  },
}));

vi.mock('./counterpoint', () => ({
  importSalesReport: vi.fn().mockResolvedValue({
    success: true,
    totalDays: 1,
    totalSales: 100,
    errors: [],
  }),
  importDailySalesReport: vi.fn(),
}));
vi.mock('./counterpoint-items', () => ({ importItemSales: vi.fn() }));
vi.mock('./counterpoint-inventory', () => ({ importInventorySnapshot: vi.fn() }));
vi.mock('./flight-schedule', () => ({ importFlightSchedule: vi.fn() }));
vi.mock('./carrier-capacity-importer', () => ({ importCarrierCapacityEmail: vi.fn() }));
vi.mock('./db', () => ({ logImport: mocks.logImport }));

import { scanInbox } from './gmail-inbox';

describe('scanInbox normalized health persistence', () => {
  beforeEach(() => {
    process.env.GMAIL_CLIENT_ID = 'client-id';
    process.env.GMAIL_CLIENT_SECRET = 'client-secret';
    process.env.GMAIL_REFRESH_TOKEN = 'refresh-token';
    mocks.logImport.mockRejectedValue(new Error('import health unavailable'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.GMAIL_REFRESH_TOKEN;
  });

  it('leaves a successfully imported message unlabeled when its normalized health row cannot persist', async () => {
    await expect(scanInbox()).rejects.toThrow('import health unavailable');
    expect(mocks.modify).not.toHaveBeenCalled();
  });
});
