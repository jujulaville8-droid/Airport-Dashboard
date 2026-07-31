import {
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

import {
  GET as getConnectionsStatus,
  POST as recordRecoveryImport,
} from '@/app/api/connections/status/route';
import { GET as runInboxCron } from '@/app/api/cron/inbox/route';

afterEach(cleanup);

const statusFixture: ConnectionsStatusResponse = {
  overall: 'attention',
  cron: { configured: true, schedule: 'hourly' },
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
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.GMAIL_REFRESH_TOKEN;
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
  });

  it('records a normalized recovery result for the source health timeline', async () => {
    const response = await recordRecoveryImport(
      new Request('http://localhost/api/connections/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'inventory',
          status: 'success',
          records: 18,
          message: null,
          fileName: 'inventory.xlsx',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.logImport).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'inventory',
        status: 'success',
        successful_records: 18,
        attempted_at: expect.any(String),
      }),
    );
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

      const request = vi.mocked(global.fetch).mock.calls[0][1];
      const body = request?.body as FormData;
      expect((body.get('file') as File).name).toBe(fileName);
      if (source === 'sales') expect(body.get('type')).toBe('monthly');
      if (source === 'flight_schedule') {
        expect(body.get('scheduleMonth')).toBe('2026-08');
      }
    },
  );

  it('records a successful recovery before refreshing source health', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { success: true, rowsParsed: 24 },
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }));
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/connections/status',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'item_sales',
          status: 'success',
          records: 24,
          message: null,
          fileName: 'items.xlsx',
        }),
      }),
    );
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
