import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ConnectionsStatusResponse } from './types';
import { ConnectionsPage } from './ConnectionsPage';
import { RecoveryUpload } from './RecoveryUpload';

const mocks = vi.hoisted(() => {
  const queryResult = {
    data: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  };
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'in', 'not', 'order']) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn(async () => queryResult);

  return {
    from: vi.fn(() => query),
    logImport: vi.fn(),
    query,
    queryResult,
    scanInbox: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  logImport: mocks.logImport,
  supabase: { from: mocks.from },
}));

vi.mock('@/lib/gmail-inbox', () => ({
  scanInbox: mocks.scanInbox,
}));

import * as connectionsStatusRoute from '@/app/api/connections/status/route';
import { GET as runInboxCron } from '@/app/api/cron/inbox/route';
import { proxy } from '@/proxy';

const getConnectionsStatus = connectionsStatusRoute.GET;

afterEach(cleanup);

const statusFixture: ConnectionsStatusResponse = {
  overall: 'attention',
  cron: { configured: true, schedule: 'hourly' },
  flightProvider: {
    provider: 'AeroDataBox',
    configured: true,
    airport: 'ANU',
    direction: 'departure',
  },
  sources: [
    {
      source: 'sales',
      status: 'healthy',
      lastAttemptAt: '2026-07-30T19:55:00.000Z',
      lastSuccessAt: '2026-07-30T19:55:00.000Z',
      message: null,
    },
    {
      source: 'item_sales',
      status: 'failed',
      lastAttemptAt: '2026-07-30T19:50:00.000Z',
      lastSuccessAt: '2026-07-29T19:50:00.000Z',
      message: 'Workbook is missing the item number column',
    },
    {
      source: 'inventory',
      status: 'never',
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
    },
    {
      source: 'flight_schedule',
      status: 'never',
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
    },
    {
      source: 'passenger_summary',
      status: 'failed',
      lastAttemptAt: '2026-07-30T19:45:00.000Z',
      lastSuccessAt: null,
      message: 'No matching flights were found',
    },
  ],
  recentImports: [
    {
      source: 'item_sales',
      attemptedAt: '2026-07-30T19:50:00.000Z',
      status: 'failed',
      records: 0,
      message: 'Workbook is missing the item number column',
    },
    {
      source: 'sales',
      attemptedAt: '2026-07-30T19:55:00.000Z',
      status: 'success',
      records: 31,
      message: null,
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('GET /api/connections/status', () => {
  beforeEach(() => {
    mocks.queryResult.data = [
      {
        source: 'passenger_summary',
        attempted_at: '2099-07-30T19:56:00.000Z',
        status: 'success',
        message: null,
        successful_records: 8,
        total_records: 8,
      },
      {
        source: 'flight_schedule',
        attempted_at: '2099-07-30T19:55:00.000Z',
        status: 'success',
        message: null,
        successful_records: 44,
        total_records: 44,
      },
      {
        source: 'inventory',
        attempted_at: '2099-07-30T19:54:00.000Z',
        status: 'success',
        message: null,
        successful_records: 120,
        total_records: 120,
      },
      {
        source: 'item_sales',
        attempted_at: '2099-07-30T19:53:00.000Z',
        status: 'failed',
        message: 'Bad workbook',
        successful_records: 0,
        total_records: 0,
      },
      {
        source: 'sales',
        attempted_at: '2099-07-30T19:52:00.000Z',
        status: 'success',
        message: null,
        successful_records: 31,
        total_records: 31,
      },
      {
        source: 'gmail_inbox',
        attempted_at: '2099-07-30T19:51:00.000Z',
        status: 'failed',
        message: 'Scan detail',
        successful_records: 0,
        total_records: 1,
      },
    ];
    mocks.queryResult.error = null;
    process.env.CRON_SECRET = 'cron-secret-value';
    process.env.GMAIL_CLIENT_ID = 'gmail-client-id-value';
    process.env.GMAIL_CLIENT_SECRET = 'gmail-client-secret-value';
    process.env.GMAIL_REFRESH_TOKEN = 'GMAIL_REFRESH_TOKEN';
    process.env.AERODATABOX_RAPIDAPI_KEY = 'rapid-key-value';
    process.env.FLIGHT_CRON_SECRET = 'flight-cron-secret-value';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.GMAIL_REFRESH_TOKEN;
    delete process.env.AERODATABOX_RAPIDAPI_KEY;
    delete process.env.FLIGHT_CRON_SECRET;
  });

  it('returns the five artifact sources in operational order without exposing configuration secrets', async () => {
    const response = await getConnectionsStatus();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sources.map((source: { source: string }) => source.source)).toEqual([
      'sales',
      'item_sales',
      'inventory',
      'flight_schedule',
      'passenger_summary',
    ]);
    expect(body.recentImports).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain('GMAIL_REFRESH_TOKEN');
    expect(body).toMatchObject({
      overall: 'attention',
      cron: { configured: true, schedule: 'hourly' },
      flightProvider: {
        provider: 'AeroDataBox',
        configured: true,
        airport: 'ANU',
        direction: 'departure',
      },
    });
    expect(mocks.query.order).toHaveBeenCalledWith('attempted_at', {
      ascending: false,
    });
    expect(mocks.query.limit).toHaveBeenCalledWith(100);
  });

  it('reports missing deployment configuration as a boolean state, never as environment contents', async () => {
    delete process.env.GMAIL_CLIENT_SECRET;

    const response = await getConnectionsStatus();
    const body = await response.json();

    expect(body.overall).toBe('not-configured');
    expect(body.cron).toEqual({ configured: true, schedule: 'hourly' });
    expect(JSON.stringify(body)).not.toContain('gmail-client-id-value');
    expect(JSON.stringify(body)).not.toContain('cron-secret-value');
    expect(JSON.stringify(body)).not.toContain('rapid-key-value');
  });

  it('reports flight automation as unconfigured when its dedicated cron secret is missing', async () => {
    delete process.env.FLIGHT_CRON_SECRET;

    const response = await getConnectionsStatus();
    const body = await response.json();

    expect(body.overall).toBe('not-configured');
    expect(body.flightProvider.configured).toBe(false);
    expect(JSON.stringify(body)).not.toContain('flight-cron-secret-value');
  });

  it('does not expose a browser-callable result attestation method', () => {
    expect(connectionsStatusRoute).not.toHaveProperty('POST');
  });

  it('keeps the status boundary behind the production session proxy', async () => {
    const response = await proxy(
      new NextRequest('http://localhost/api/connections/status', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});

describe('Data Connections', () => {
  it('keeps automatic imports primary and offers recovery only for sources needing attention', () => {
    render(<ConnectionsPage initialStatus={statusFixture} />);

    expect(
      screen.getByRole('heading', { name: 'Data Connections' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/automatic imports run every hour/i),
    ).toBeInTheDocument();

    const salesCard = screen.getByRole('article', { name: 'Sales totals' });
    const itemSalesCard = screen.getByRole('article', { name: 'Item sales' });

    expect(within(salesCard).getByText('Connected')).toBeInTheDocument();
    expect(
      within(salesCard).queryByRole('button', { name: 'Open recovery' }),
    ).not.toBeInTheDocument();
    expect(
      within(itemSalesCard).getByRole('button', { name: 'Open recovery' }),
    ).toBeInTheDocument();
    expect(
      within(itemSalesCard).getByText(
        'Workbook is missing the item number column',
        { exact: false },
      ),
    ).toBeInTheDocument();
  });

  it('explains the email-only retry path for failed passenger summaries', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage initialStatus={statusFixture} />);

    const card = screen.getByRole('article', { name: 'Passenger summary' });
    await user.click(
      within(card).getByRole('button', { name: 'Open recovery' }),
    );

    expect(card).toHaveTextContent(
      /remove the TailorsDaughter\/Failed label in Gmail/i,
    );
    expect(
      within(card).queryByLabelText('Recovery file'),
    ).not.toBeInTheDocument();
  });

  it('presents failed history as a failure instead of a healthy-looking zero', () => {
    render(<ConnectionsPage initialStatus={statusFixture} />);

    const history = screen.getByRole('list', {
      name: 'Import history, newest first',
    });
    const failedImport = within(history)
      .getByText('Workbook is missing the item number column', {
        exact: false,
      })
      .closest('li');

    expect(failedImport).not.toBeNull();
    expect(failedImport).toHaveTextContent('Import failed');
    expect(failedImport).not.toHaveTextContent('0 records');
    expect(
      within(failedImport as HTMLElement).getByText('Import failed.'),
    ).toHaveClass('text-ink');
  });

  it('loads connection status once on mount instead of starting a request loop', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(statusFixture, { status: 200 }),
    );
    global.fetch = fetchMock;

    try {
      render(<ConnectionsPage />);

      expect(
        await screen.findByRole('heading', { name: 'Data Connections' }),
      ).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not claim retained status exists when the initial request fails', async () => {
    const originalFetch = global.fetch;
    const originalConsoleError = console.error;
    global.fetch = vi.fn().mockRejectedValue(new Error('network unavailable'));
    console.error = vi.fn();

    try {
      render(<ConnectionsPage />);

      const errorState = await screen.findByRole('alert');
      expect(errorState).toHaveTextContent(
        'Automatic import status could not be refreshed',
      );
      expect(errorState).not.toHaveTextContent(
        'The last known state remains visible',
      );
    } finally {
      global.fetch = originalFetch;
      console.error = originalConsoleError;
    }
  });

  it('uses accessible ink text for small configuration warnings', () => {
    render(
      <ConnectionsPage
        initialStatus={{
          ...statusFixture,
          overall: 'not-configured',
          cron: { configured: false, schedule: 'hourly' },
        }}
      />,
    );

    expect(screen.getByText('Configuration required')).toHaveClass('text-ink');
  });

  it('ignores an older response that resolves after a post-recovery refresh', async () => {
    const originalFetch = global.fetch;
    const oldRequest = deferred<Response>();
    const healthyStatus: ConnectionsStatusResponse = {
      ...statusFixture,
      overall: 'healthy',
      sources: statusFixture.sources.map((source) => ({
        ...source,
        status: 'healthy',
        lastAttemptAt: '2026-07-30T20:10:00.000Z',
        lastSuccessAt: '2026-07-30T20:10:00.000Z',
        message: null,
      })),
    };
    const supersededStatus: ConnectionsStatusResponse = {
      ...statusFixture,
      sources: statusFixture.sources.map((source) => ({
        ...source,
        status: 'never',
        lastAttemptAt: null,
        lastSuccessAt: null,
        message: null,
      })),
    };
    let statusReads = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/connections/status') {
          if (init?.method === 'POST') {
            return Response.json({ ok: true }, { status: 200 });
          }
          statusReads += 1;
          return statusReads === 1
            ? oldRequest.promise
            : Response.json(healthyStatus, { status: 200 });
        }
        if (url === '/api/items/import') {
          return Response.json(
            {
              success: true,
              batchId: 'items-batch',
              rowsParsed: 24,
              uniqueSkus: 12,
              ticketsWritten: 5,
              lineItemsWritten: 24,
              errors: [],
              fileHash: 'items-hash',
            },
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    );
    global.fetch = fetchMock as typeof fetch;
    const user = userEvent.setup();

    try {
      render(<ConnectionsPage initialStatus={statusFixture} />);
      await user.click(screen.getByRole('button', { name: 'Refresh status' }));

      const itemCard = screen.getByRole('article', { name: 'Item sales' });
      await user.click(
        within(itemCard).getByRole('button', { name: 'Open recovery' }),
      );
      await user.upload(
        within(itemCard).getByLabelText('Recovery file'),
        new File(['report'], 'items.xlsx'),
      );
      await user.click(
        within(itemCard).getByRole('button', {
          name: 'Upload recovery file',
        }),
      );

      expect(
        await screen.findByText('5 of 5 sources current'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Refresh status' }),
      ).toBeEnabled();

      await act(async () => {
        oldRequest.resolve(
          Response.json(supersededStatus, { status: 200 }),
        );
        await oldRequest.promise;
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(
        screen.getByText('5 of 5 sources current'),
      ).toBeInTheDocument();
      expect(screen.queryByText('0 of 5 sources current')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Refresh status' }),
      ).toBeEnabled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('recovery uploads', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({ success: true }, { status: 200 }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it.each([
    ['sales', '/api/sales/import', 'sales.xlsx'],
    ['item_sales', '/api/items/import', 'items.xlsx'],
    ['inventory', '/api/inventory/snapshot', 'inventory.xlsx'],
    ['flight_schedule', '/api/flights/upload-pdf', 'schedule.pdf'],
  ] as const)(
    'submits %s recovery files to the existing importer',
    async (source, endpoint, fileName) => {
      const user = userEvent.setup();
      render(<RecoveryUpload source={source} />);

      if (source === 'flight_schedule') {
        fireEvent.change(screen.getByLabelText('Schedule month'), {
          target: { value: '2026-08' },
        });
      }

      const file = new File(['report'], fileName);
      await user.upload(screen.getByLabelText('Recovery file'), file);
      await user.click(
        screen.getByRole('button', { name: 'Upload recovery file' }),
      );

      expect(global.fetch).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      );
      expect(global.fetch).toHaveBeenCalledOnce();

      const request = vi.mocked(global.fetch).mock.calls[0][1];
      const body = request?.body as FormData;
      expect((body.get('file') as File).name).toBe(fileName);
      if (source === 'sales') expect(body.get('type')).toBe('monthly');
      if (source === 'flight_schedule') {
        expect(body.get('scheduleMonth')).toBe('2026-08');
      }
    },
  );

  it('trusts the authoritative endpoint response without posting client-derived health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          success: true,
          batchId: 'items-batch',
          rowsParsed: 24,
          uniqueSkus: 12,
          ticketsWritten: 5,
          lineItemsWritten: 24,
          errors: [],
          fileHash: 'items-hash',
        },
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<RecoveryUpload source="item_sales" />);

    await user.upload(
      screen.getByLabelText('Recovery file'),
      new File(['report'], 'items.xlsx'),
    );
    await user.click(
      screen.getByRole('button', { name: 'Upload recovery file' }),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/import',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );
    expect(
      screen.getByText('item sales recovery import completed.'),
    ).toBeInTheDocument();
  });

  it('shows an authoritative malformed-import failure without posting health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          success: false,
          batchId: 'inventory-batch',
          snapshotDate: '2026-07-30',
          rowsParsed: 17,
          uniqueSkus: 17,
          totalValue: 0,
          errors: ['inventory_snapshots insert failed'],
          fileHash: 'inventory-hash',
        },
        { status: 422 },
      ),
    );
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<RecoveryUpload source="inventory" />);

    await user.upload(
      screen.getByLabelText('Recovery file'),
      new File(['report'], 'inventory.xlsx'),
    );
    await user.click(
      screen.getByRole('button', { name: 'Upload recovery file' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'inventory_snapshots insert failed',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses accessible ink text for small recovery errors', async () => {
    const user = userEvent.setup();
    render(<RecoveryUpload source="sales" />);

    await user.click(
      screen.getByRole('button', { name: 'Upload recovery file' }),
    );

    expect(screen.getByRole('alert')).toHaveClass('text-ink');
  });
});

describe('GET /api/cron/inbox', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
    mocks.logImport.mockResolvedValue(undefined);
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    delete process.env.CRON_SECRET;
    vi.clearAllMocks();
  });

  function authorizedRequest() {
    return new NextRequest('http://localhost/api/cron/inbox', {
      headers: { authorization: 'Bearer cron-secret' },
    });
  }

  it('returns only summary counts after a successful authenticated scan', async () => {
    mocks.scanInbox.mockResolvedValue({
      scanned: 4,
      imported: 2,
      failed: 1,
      skipped: 1,
      details: [{ reason: 'private parser detail' }],
    });

    const response = await runInboxCron(authorizedRequest());

    expect(await response.json()).toEqual({
      ok: true,
      scanned: 4,
      imported: 2,
      failed: 1,
      skipped: 1,
    });
    expect(mocks.logImport).not.toHaveBeenCalled();
  });

  it('records one failed scan with the detailed cause while returning a generic public error', async () => {
    mocks.scanInbox.mockRejectedValue(
      new Error('OAuth refresh failed for private mailbox'),
    );

    const response = await runInboxCron(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'Inbox scan failed' });
    expect(JSON.stringify(body)).not.toContain('private mailbox');
    expect(mocks.logImport).toHaveBeenCalledOnce();
    expect(mocks.logImport).toHaveBeenCalledWith(
      expect.objectContaining({
        file_name: 'gmail-inbox-scan',
        source: 'gmail_inbox',
        status: 'failed',
        message: 'OAuth refresh failed for private mailbox',
      }),
    );
  });
});
