// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  logImport: vi.fn(),
  importSalesReport: vi.fn(),
  importDailySalesReport: vi.fn(),
  importItemSales: vi.fn(),
  importInventorySnapshot: vi.fn(),
  importFlightSchedule: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  logImport: mocks.logImport,
  deleteFlightMonth: vi.fn(),
  deleteFlightSchedulePDF: vi.fn(),
  getUploadedMonths: vi.fn(),
}));

vi.mock('@/lib/counterpoint', () => ({
  importSalesReport: mocks.importSalesReport,
  importDailySalesReport: mocks.importDailySalesReport,
}));

vi.mock('@/lib/counterpoint-items', () => ({
  importItemSales: mocks.importItemSales,
}));

vi.mock('@/lib/counterpoint-inventory', () => ({
  importInventorySnapshot: mocks.importInventorySnapshot,
}));

vi.mock('@/lib/flight-schedule', () => ({
  importFlightSchedule: mocks.importFlightSchedule,
}));

import { POST as importSales } from '@/app/api/sales/import/route';
import { POST as importItems } from '@/app/api/items/import/route';
import { POST as importInventory } from '@/app/api/inventory/snapshot/route';
import { POST as importFlights } from '@/app/api/flights/upload-pdf/route';

const monthlySalesResult = {
  success: true,
  batchId: 'sales-batch',
  month: 'July',
  year: 2026,
  totalDays: 31,
  totalSales: 18420.52,
  totalTickets: 604,
  totalDiscounts: 184.25,
  totalReturns: 72.5,
  avgTransaction: 30.5,
  dailyData: [],
  errors: [],
  fileHash: 'sales-hash',
};

const itemSalesResult = {
  success: true,
  batchId: 'items-batch',
  rowsParsed: 42,
  uniqueSkus: 19,
  ticketsWritten: 8,
  lineItemsWritten: 42,
  errors: [],
  fileHash: 'items-hash',
};

const inventoryResult = {
  success: true,
  batchId: 'inventory-batch',
  snapshotDate: '2026-07-30',
  rowsParsed: 18,
  uniqueSkus: 18,
  totalValue: 9250.4,
  errors: [],
  fileHash: 'inventory-hash',
};

const flightResult = {
  success: true,
  scheduleMonth: '2026-08',
  totalFlights: 88,
  arrivals: 44,
  departures: 44,
  errors: [],
};

function uploadRequest(
  path: string,
  fileName: string,
  fields: Record<string, string> = {},
) {
  const formData = new FormData();
  formData.set('file', new File(['authoritative report'], fileName));
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: formData,
  });
}

describe('authoritative route import-health logging', () => {
  beforeEach(() => {
    mocks.logImport.mockReset();
    mocks.logImport.mockResolvedValue(undefined);
    mocks.importSalesReport.mockReset();
    mocks.importSalesReport.mockResolvedValue(monthlySalesResult);
    mocks.importDailySalesReport.mockReset();
    mocks.importDailySalesReport.mockResolvedValue({
      success: true,
      batchId: 'daily-batch',
      date: '2026-07-30',
      sales: 612.25,
      tickets: 20,
      discounts: 4.5,
      returns: 0,
      avgTransaction: 30.61,
      errors: [],
    });
    mocks.importItemSales.mockReset();
    mocks.importItemSales.mockResolvedValue(itemSalesResult);
    mocks.importInventorySnapshot.mockReset();
    mocks.importInventorySnapshot.mockResolvedValue(inventoryResult);
    mocks.importFlightSchedule.mockReset();
    mocks.importFlightSchedule.mockResolvedValue(flightResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'daily sales',
      invoke: () =>
        importSales(
          uploadRequest('/api/sales/import', 'daily-sales.csv', {
            type: 'daily',
          }),
        ),
      source: 'sales',
      fileName: 'daily-sales.csv',
      records: 1,
    },
    {
      name: 'monthly sales',
      invoke: () =>
        importSales(
          uploadRequest('/api/sales/import', 'sales.xlsx', {
            type: 'monthly',
          }),
        ),
      source: 'sales',
      fileName: 'sales.xlsx',
      records: 31,
    },
    {
      name: 'item sales',
      invoke: () =>
        importItems(uploadRequest('/api/items/import', 'items.xlsx')),
      source: 'item_sales',
      fileName: 'items.xlsx',
      records: 42,
    },
    {
      name: 'inventory',
      invoke: () =>
        importInventory(
          uploadRequest('/api/inventory/snapshot', 'inventory.xlsx'),
        ),
      source: 'inventory',
      fileName: 'inventory.xlsx',
      records: 18,
    },
    {
      name: 'flight schedule',
      invoke: () =>
        importFlights(
          uploadRequest('/api/flights/upload-pdf', 'schedule.pdf', {
            scheduleMonth: '2026-08',
          }),
        ),
      source: 'flight_schedule',
      fileName: 'schedule.pdf',
      records: 88,
    },
  ])(
    'maps the real $name result before returning success',
    async ({ invoke, source, fileName, records }) => {
      const response = await invoke();

      expect(response.status).toBe(200);
      expect(mocks.logImport).toHaveBeenCalledOnce();
      expect(mocks.logImport).toHaveBeenCalledWith(
        expect.objectContaining({
          source,
          status: 'success',
          file_name: fileName,
          total_records: records,
          successful_records: records,
          failed_records: 0,
          message: null,
          attempted_at: expect.any(String),
        }),
      );
    },
  );

  it('treats a Counterpoint warning result as failed instead of guessing partial success', async () => {
    mocks.importSalesReport.mockResolvedValue({
      ...monthlySalesResult,
      success: false,
      errors: ['Warning: fallback layout could not be reconciled'],
    });

    const response = await importSales(
      uploadRequest('/api/sales/import', 'warning-sales.xlsx', {
        type: 'monthly',
      }),
    );

    expect(response.status).toBe(422);
    expect(mocks.logImport).toHaveBeenCalledOnce();
    expect(mocks.logImport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'sales',
        status: 'failed',
        total_records: 31,
        successful_records: 0,
        failed_records: 31,
        message: 'Warning: fallback layout could not be reconciled',
      }),
    );
  });

  it('maps a parsed inventory failure to failed health with its real record count', async () => {
    mocks.importInventorySnapshot.mockResolvedValue({
      ...inventoryResult,
      success: false,
      rowsParsed: 17,
      errors: ['inventory_snapshots insert failed: constraint violation'],
    });

    const response = await importInventory(
      uploadRequest('/api/inventory/snapshot', 'bad-inventory.xlsx'),
    );

    expect(response.status).toBe(422);
    expect(mocks.logImport).toHaveBeenCalledOnce();
    expect(mocks.logImport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'inventory',
        status: 'failed',
        total_records: 17,
        successful_records: 0,
        failed_records: 17,
        message: 'inventory_snapshots insert failed: constraint violation',
      }),
    );
  });

  it('rejects an invalid upload before the importer or health log is invoked', async () => {
    const response = await importItems(
      uploadRequest('/api/items/import', 'items.exe'),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'File must be .xls, .xlsx, or .csv',
    });
    expect(mocks.importItemSales).not.toHaveBeenCalled();
    expect(mocks.logImport).not.toHaveBeenCalled();
  });

  it('does not return normal success when normalized health persistence fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.logImport.mockRejectedValue(new Error('health database unavailable'));

    const response = await importItems(
      uploadRequest('/api/items/import', 'items.xlsx'),
    );

    expect(response.status).toBe(500);
    expect(mocks.logImport).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      error: 'Import result could not be recorded',
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('health'),
      expect.any(Error),
    );
  });

  it('records an importer throw as failed health without exposing its cause publicly', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.importFlightSchedule.mockRejectedValue(
      new Error('private parser stack detail'),
    );

    const response = await importFlights(
      uploadRequest('/api/flights/upload-pdf', 'schedule.pdf', {
        scheduleMonth: '2026-08',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      success: false,
      error: 'Flight upload failed',
    });
    expect(JSON.stringify(body)).not.toContain('private parser stack detail');
    expect(mocks.logImport).toHaveBeenCalledOnce();
    expect(mocks.logImport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'flight_schedule',
        status: 'failed',
        successful_records: 0,
        message: 'private parser stack detail',
      }),
    );
    expect(consoleError).toHaveBeenCalled();
  });
});
