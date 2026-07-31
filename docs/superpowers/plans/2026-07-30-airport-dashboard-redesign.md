# Airport Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild The Tailor's Daughter dashboard as the approved Terminal Precision operations product while preserving trusted business logic and making automatic ingestion, recovery, responsive use, and failure handling more reliable.

**Architecture:** Keep the Next.js 16 App Router and existing domain services. Introduce a typed design system and responsive app shell, migrate each large page into a feature folder with focused components, make import freshness a first-class domain, and repair committed database schema drift. Foundation tasks land first; commerce and operations/finance tasks then run in parallel; integration and end-to-end verification land last.

**Tech Stack:** Next.js 16.2.2, React 19.2.4, TypeScript, Tailwind CSS 4, Supabase, Gmail API, Anthropic SDK, Vitest, Testing Library, Playwright

## Global Constraints

- Visual direction is **Terminal Precision**: bright, official, and quietly premium.
- The primary user is one owner/manager; do not add multi-user roles.
- Overview is a daily action brief led by Act now, Watch, and On track.
- Data ingestion is fully automatic by default; manual uploads are recovery tools under Data Connections.
- Retain Next.js 16, React 19, TypeScript, Supabase, Gmail, Anthropic, and Vercel.
- Preserve existing domain behavior unless a failing test, schema mismatch, or validated defect justifies a targeted change.
- Use Terminal Navy `#122535`, Runway Amber `#F4B41F`, Tower Glass `#F7F9FB`, Paper White `#FFFFFF`, Lagoon Teal `#1A817B`, Alert Clay `#D45835`, Slate Ink `#142535`, Instrument Gray `#61727E`, and Structural Line `#D8E1E6` through semantic tokens.
- All functionality must be keyboard accessible, WCAG AA compliant, reduced-motion aware, and usable at phone, tablet, laptop, and wide-desktop widths.
- Never silently swallow a request failure or turn missing/failed data into a valid-looking zero.
- Before editing Next.js code, read the relevant guide under `node_modules/next/dist/docs/` as required by `AGENTS.md`.
- Write a failing test before each production behavior change and observe the expected failure.
- Run a code-review agent after each task that changes production code.

## Parallel delivery map

1. **Foundation gate:** Tasks 1–4 run in order because every page consumes their contracts.
2. **Parallel domain wave:** After Task 4, assign Task 5 to one worker, Tasks 6–7 to a commerce worker, Tasks 8–9 to an operations worker, and Tasks 10–11 to a finance/reliability worker.
3. **Integration gate:** Tasks 12–13 run after all domain branches are merged.

Shared-file ownership during the parallel wave:

- Only the integration owner edits `src/app/globals.css`, `src/app/layout.tsx`, `src/app/dashboard/layout.tsx`, `src/components/shell/**`, and `src/components/ui/**`.
- Domain workers own only their `src/features/<domain>/**` directory and corresponding `src/app/dashboard/<domain>/page.tsx`.
- API work is assigned explicitly by task. Workers must not edit another task's route.
- Workers must not revert edits made by others and must adapt their implementation to the shared contracts already merged.

---

### Task 1: Testing harness and shared operational state contracts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/lib/ui/data-state.ts`
- Test: `src/lib/ui/data-state.test.ts`

**Interfaces:**
- Produces: `DataStatus`, `Freshness`, `deriveFreshness(updatedAt, now, staleAfterMinutes)`, and `getDataStatus(freshness, error, hasData)`.
- Consumes: no application contracts.

- [ ] **Step 1: Read the local Next.js testing guidance**

Run:

```bash
rg -n "Vitest|Testing Library" node_modules/next/dist/docs
```

Read the matched testing guide completely before changing configuration.

- [ ] **Step 2: Install the test dependencies and add scripts**

Run:

```bash
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
```

Set these exact scripts in `package.json`:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 3: Create the Vitest environment**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Write failing freshness tests**

Create `src/lib/ui/data-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveFreshness, getDataStatus } from './data-state';

describe('deriveFreshness', () => {
  const now = new Date('2026-07-30T20:00:00Z');

  it('marks a recent source as current', () => {
    expect(deriveFreshness('2026-07-30T19:52:00Z', now, 60)).toEqual({
      kind: 'current',
      minutesOld: 8,
      updatedAt: '2026-07-30T19:52:00Z',
    });
  });

  it('marks an old source as stale without discarding its timestamp', () => {
    expect(deriveFreshness('2026-07-30T17:00:00Z', now, 60).kind).toBe('stale');
  });

  it('returns missing when no successful timestamp exists', () => {
    expect(deriveFreshness(null, now, 60)).toEqual({ kind: 'missing' });
  });
});

describe('getDataStatus', () => {
  it('keeps stale data visible when refresh fails', () => {
    expect(getDataStatus({ kind: 'stale', minutesOld: 180, updatedAt: 'x' }, 'Sync failed', true))
      .toEqual({ kind: 'error-with-data', message: 'Sync failed' });
  });
});
```

- [ ] **Step 5: Run the tests and verify the expected missing-module failure**

Run:

```bash
npm test -- src/lib/ui/data-state.test.ts
```

Expected: FAIL because `src/lib/ui/data-state.ts` does not exist.

- [ ] **Step 6: Implement the operational state contracts**

Create `src/lib/ui/data-state.ts`:

```ts
export type Freshness =
  | { kind: 'current'; updatedAt: string; minutesOld: number }
  | { kind: 'stale'; updatedAt: string; minutesOld: number }
  | { kind: 'missing' };

export type DataStatus =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready' }
  | { kind: 'stale' }
  | { kind: 'error-with-data'; message: string }
  | { kind: 'error'; message: string };

export function deriveFreshness(
  updatedAt: string | null,
  now = new Date(),
  staleAfterMinutes = 60,
): Freshness {
  if (!updatedAt) return { kind: 'missing' };
  const minutesOld = Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 60_000));
  return {
    kind: minutesOld > staleAfterMinutes ? 'stale' : 'current',
    updatedAt,
    minutesOld,
  };
}

export function getDataStatus(
  freshness: Freshness,
  error: string | null,
  hasData: boolean,
): DataStatus {
  if (error && hasData) return { kind: 'error-with-data', message: error };
  if (error) return { kind: 'error', message: error };
  if (!hasData) return { kind: 'empty' };
  if (freshness.kind === 'stale') return { kind: 'stale' };
  return { kind: 'ready' };
}
```

- [ ] **Step 7: Verify tests, type checking, and lint**

Run:

```bash
npm test -- src/lib/ui/data-state.test.ts
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test src/lib/ui
git commit -m "test: add dashboard testing foundation"
```

---

### Task 2: Database readiness and typed Supabase access

**Files:**
- Create: `supabase/migrations/004_schema_readiness.sql`
- Create: `supabase/migrations/005_import_health.sql`
- Create: `src/lib/database.types.ts`
- Create: `src/lib/import-health.ts`
- Test: `src/lib/import-health.test.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/counterpoint.ts`
- Modify: `src/lib/gmail-inbox.ts`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `Database`, `ImportSource`, `ImportSourceHealth`, `summarizeImportHealth(logs, now)`.
- Consumes: `Freshness` from Task 1.

- [ ] **Step 1: Write failing import-health tests**

Create `src/lib/import-health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeImportHealth } from './import-health';

describe('summarizeImportHealth', () => {
  it('uses the latest success and latest failure independently', () => {
    const result = summarizeImportHealth([
      { source: 'sales', attemptedAt: '2026-07-30T19:00:00Z', status: 'success', message: null },
      { source: 'sales', attemptedAt: '2026-07-30T19:30:00Z', status: 'failed', message: 'Bad workbook' },
    ], new Date('2026-07-30T20:00:00Z'));

    expect(result.sales.lastSuccessAt).toBe('2026-07-30T19:00:00Z');
    expect(result.sales.lastAttemptAt).toBe('2026-07-30T19:30:00Z');
    expect(result.sales.status).toBe('failed');
    expect(result.sales.message).toBe('Bad workbook');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/lib/import-health.test.ts
```

Expected: FAIL because `summarizeImportHealth` is missing.

- [ ] **Step 3: Add backward-compatible schema migrations**

`004_schema_readiness.sql` must:

```sql
ALTER TABLE sales_transactions
  ADD COLUMN IF NOT EXISTS ticket_count INTEGER,
  ADD COLUMN IF NOT EXISTS upload_type TEXT;

UPDATE sales_transactions
SET ticket_count = CASE
  WHEN cust_no ~ '^[0-9]+$' THEN cust_no::INTEGER
  ELSE 0
END
WHERE ticket_count IS NULL;

ALTER TABLE sales_transactions
  ALTER COLUMN ticket_count SET DEFAULT 0;

ALTER TABLE flight_data
  ADD COLUMN IF NOT EXISTS schedule_month TEXT;

UPDATE flight_data
SET schedule_month = to_char(flight_date, 'YYYY-MM')
WHERE schedule_month IS NULL;

CREATE TABLE IF NOT EXISTS staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('full-time', 'part-time', 'backup')),
  max_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8,
  min_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 3,
  weekly_hour_target NUMERIC(5,2),
  days_off_per_week INTEGER,
  available_start TIME NOT NULL DEFAULT '09:00',
  available_end TIME NOT NULL DEFAULT '20:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_upload_type ON sales_transactions(upload_type);
CREATE INDEX IF NOT EXISTS idx_flight_schedule_month ON flight_data(schedule_month);
```

`005_import_health.sql` must add normalized import fields without deleting legacy columns:

```sql
ALTER TABLE import_logs
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_import_logs_source_attempt
  ON import_logs(source, attempted_at DESC);
```

Mirror the resulting fresh-install shape in `supabase/schema.sql`.

- [ ] **Step 4: Add typed health derivation**

Create exact exports in `src/lib/import-health.ts`:

```ts
import { deriveFreshness } from './ui/data-state';

export const IMPORT_SOURCES = ['sales', 'item_sales', 'inventory', 'flight_schedule', 'passenger_summary'] as const;
export type ImportSource = typeof IMPORT_SOURCES[number];
export type ImportLogSummary = {
  source: ImportSource;
  attemptedAt: string;
  status: 'success' | 'failed';
  message: string | null;
};
export type ImportSourceHealth = {
  source: ImportSource;
  status: 'healthy' | 'stale' | 'failed' | 'never';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  message: string | null;
};

export function summarizeImportHealth(
  logs: ImportLogSummary[],
  now = new Date(),
): Record<ImportSource, ImportSourceHealth> {
  return Object.fromEntries(IMPORT_SOURCES.map((source) => {
    const sourceLogs = logs.filter((log) => log.source === source)
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
    const latest = sourceLogs[0];
    const lastSuccessAt = sourceLogs.find((log) => log.status === 'success')?.attemptedAt ?? null;
    const freshness = deriveFreshness(lastSuccessAt, now, 24 * 60);
    return [source, {
      source,
      status: !latest ? 'never' : latest.status === 'failed' ? 'failed' : freshness.kind === 'stale' ? 'stale' : 'healthy',
      lastAttemptAt: latest?.attemptedAt ?? null,
      lastSuccessAt,
      message: latest?.message ?? null,
    }];
  })) as Record<ImportSource, ImportSourceHealth>;
}
```

- [ ] **Step 5: Type Supabase and remove the ticket-count workaround**

Generate or author `src/lib/database.types.ts` from the committed schema, then change:

```ts
_client = createClient<Database>(supabaseUrl, supabaseServiceKey);
```

Update Counterpoint imports to write `ticket_count` and update all readers to use:

```ts
const totalTransactions = data.reduce((sum, row) => sum + (row.ticket_count ?? 0), 0);
```

Keep `cust_no` unchanged for genuine customer identifiers. Update Gmail import logging to write `source`, `status`, `message`, and `attempted_at` alongside legacy fields.

- [ ] **Step 6: Verify the test and all static checks**

Run:

```bash
npm test -- src/lib/import-health.test.ts
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase src/lib/database.types.ts src/lib/import-health.ts src/lib/import-health.test.ts src/lib/db.ts src/lib/counterpoint.ts src/lib/gmail-inbox.ts
git commit -m "fix: make database schema reproducible"
```

---

### Task 3: Terminal Precision design system and shared components

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/DataState.tsx`
- Create: `src/components/ui/PageHeader.tsx`
- Create: `src/components/ui/Metric.tsx`
- Create: `src/components/ui/Panel.tsx`
- Create: `src/components/ui/ConfirmDialog.tsx`
- Create: `src/components/ui/DetailDrawer.tsx`
- Create: `src/components/ui/ui.test.tsx`
- Delete after migration: `src/components/MetricCard.tsx`

**Interfaces:**
- Produces: `Button`, `Badge`, `LoadingState`, `EmptyState`, `ErrorState`, `FreshnessIndicator`, `PageHeader`, `Metric`, `Panel`, `ConfirmDialog`, `DetailDrawer`.
- Consumes: `Freshness` and `DataStatus` from Task 1.

- [ ] **Step 1: Write failing shared-component tests**

Create `src/components/ui/ui.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState, FreshnessIndicator } from './DataState';
import { ConfirmDialog } from './ConfirmDialog';

describe('shared operational UI', () => {
  it('pairs stale color with visible text', () => {
    render(<FreshnessIndicator freshness={{ kind: 'stale', updatedAt: '2026-07-30T10:00:00Z', minutesOld: 180 }} />);
    expect(screen.getByText(/stale/i)).toBeVisible();
  });

  it('exposes the recovery action for an error', async () => {
    const retry = vi.fn();
    render(<ErrorState title="Sales import failed" message="Workbook could not be parsed." actionLabel="Open recovery" onAction={retry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open recovery' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('requires an explicit destructive confirmation', async () => {
    const confirm = vi.fn();
    render(<ConfirmDialog open title="Clear schedule?" description="This removes seven days." confirmLabel="Clear schedule" onConfirm={confirm} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear schedule' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests and verify missing-component failures**

Run:

```bash
npm test -- src/components/ui/ui.test.tsx
```

Expected: FAIL because the new UI modules do not exist.

- [ ] **Step 3: Implement semantic tokens and typography**

Replace the legacy brand aliases with semantic CSS variables:

```css
@theme inline {
  --color-app-bg: #F7F9FB;
  --color-surface: #FFFFFF;
  --color-nav: #122535;
  --color-ink: #142535;
  --color-muted: #61727E;
  --color-line: #D8E1E6;
  --color-accent: #F4B41F;
  --color-positive: #1A817B;
  --color-danger: #D45835;
  --font-sans: var(--font-body);
  --font-display: var(--font-display);
  --font-mono: var(--font-data);
}
```

Load one display grotesk, one body sans, and JetBrains Mono through `next/font`. Set tabular numerals for data only rather than every text element.

- [ ] **Step 4: Implement the shared components**

Use typed props and semantic HTML. `DataState.tsx` must export:

```ts
export function LoadingState(props: { label: string }): React.ReactNode;
export function EmptyState(props: { title: string; message: string; actionLabel?: string; onAction?: () => void }): React.ReactNode;
export function ErrorState(props: { title: string; message: string; actionLabel?: string; onAction?: () => void }): React.ReactNode;
export function FreshnessIndicator(props: { freshness: Freshness }): React.ReactNode;
```

`ConfirmDialog` must use `role="dialog"`, `aria-modal="true"`, close on Escape, restore focus, and never call `onConfirm` from the cancel action.

- [ ] **Step 5: Verify component tests and accessibility lint**

Run:

```bash
npm test -- src/components/ui/ui.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/components/ui
git commit -m "feat: add Terminal Precision design system"
```

---

### Task 4: Responsive app shell and navigation

**Files:**
- Create: `src/components/shell/AppShell.tsx`
- Create: `src/components/shell/DesktopSidebar.tsx`
- Create: `src/components/shell/MobileNavigation.tsx`
- Create: `src/components/shell/navigation.ts`
- Create: `src/components/shell/navigation.test.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Delete: `src/components/Sidebar.tsx`

**Interfaces:**
- Produces: `AppShell({ username, children })`, grouped `DESKTOP_NAV`, and five-item `MOBILE_NAV`.
- Consumes: Task 3 UI components.

- [ ] **Step 1: Write failing navigation tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesktopSidebar } from './DesktopSidebar';
import { MobileNavigation } from './MobileNavigation';

describe('dashboard navigation', () => {
  it('groups desktop destinations by the manager mental model', () => {
    render(<DesktopSidebar pathname="/dashboard/inventory" username="admin" />);
    expect(screen.getByText('Commerce')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /imports healthy/i })).toHaveAttribute('href', '/dashboard/connections');
  });

  it('keeps exactly five primary mobile destinations', () => {
    render(<MobileNavigation pathname="/dashboard" />);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Today' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'More' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- src/components/shell/navigation.test.tsx
```

Expected: FAIL because shell components are missing.

- [ ] **Step 3: Implement the exact navigation contracts**

`navigation.ts` must export grouped desktop entries:

```ts
export const DESKTOP_NAV = [
  { label: 'Today', items: [{ href: '/dashboard', label: 'Overview' }] },
  { label: 'Commerce', items: [
    { href: '/dashboard/sales', label: 'Sales' },
    { href: '/dashboard/inventory', label: 'Inventory' },
  ] },
  { label: 'Operations', items: [
    { href: '/dashboard/flights', label: 'Flights' },
    { href: '/dashboard/schedules', label: 'Schedules' },
  ] },
  { label: 'Finance', items: [{ href: '/dashboard/concession', label: 'Concession' }] },
] as const;
```

Mobile items are Today, Sales, Stock, Flights, and More. More opens an accessible sheet containing Schedules, Concession, Data Connections, and Sign out.

- [ ] **Step 4: Replace the dashboard layout**

`src/app/dashboard/layout.tsx` must render:

```tsx
<AppShell username={username}>{children}</AppShell>
```

The desktop sidebar remains fixed while the content region scrolls. Mobile content includes safe-area padding so the bottom navigation never covers actions.

- [ ] **Step 5: Verify navigation tests and static checks**

Run:

```bash
npm test -- src/components/shell/navigation.test.tsx
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell src/app/dashboard/layout.tsx src/components/Sidebar.tsx
git commit -m "feat: rebuild responsive dashboard shell"
```

---

### Task 5: Data Connections and automatic-import recovery

**Files:**
- Create: `src/app/api/connections/status/route.ts`
- Create: `src/features/connections/types.ts`
- Create: `src/features/connections/ConnectionsPage.tsx`
- Create: `src/features/connections/SourceCard.tsx`
- Create: `src/features/connections/RecoveryUpload.tsx`
- Create: `src/features/connections/connections.test.tsx`
- Create: `src/app/dashboard/connections/page.tsx`
- Modify: `src/app/api/cron/inbox/route.ts`

**Interfaces:**
- Produces: `GET /api/connections/status` returning `{ overall, cron, sources, recentImports }`.
- Consumes: `ImportSourceHealth` from Task 2 and UI/shell contracts from Tasks 3–4.

- [ ] **Step 1: Write failing health-route and page tests**

The route test must assert an ordered source list and no secret values:

```ts
expect(body.sources.map((source: { source: string }) => source.source)).toEqual([
  'sales', 'item_sales', 'inventory', 'flight_schedule', 'passenger_summary',
]);
expect(JSON.stringify(body)).not.toContain('GMAIL_REFRESH_TOKEN');
```

The component test must assert that a failed source renders `Open recovery`, while a healthy source renders `Connected`.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm test -- src/features/connections
```

Expected: FAIL because the feature is missing.

- [ ] **Step 3: Implement the status route**

Query the latest 100 normalized import logs, pass them through `summarizeImportHealth`, and return:

```ts
type ConnectionsStatusResponse = {
  overall: 'healthy' | 'attention' | 'not-configured';
  cron: { configured: boolean; schedule: 'hourly' };
  sources: ImportSourceHealth[];
  recentImports: Array<{
    source: ImportSource;
    attemptedAt: string;
    status: 'success' | 'failed';
    records: number;
    message: string | null;
  }>;
};
```

Do not expose environment-variable contents. Only report configured booleans.

- [ ] **Step 4: Build Data Connections**

Render one source card per import type, chronological import history, configuration guidance, and recovery uploads mapped to existing endpoints:

```ts
const RECOVERY_ENDPOINTS = {
  sales: '/api/sales/import',
  item_sales: '/api/items/import',
  inventory: '/api/inventory/snapshot',
  flight_schedule: '/api/flights/upload-pdf',
} as const;
```

Passenger summaries remain email-only; the recovery message tells the manager to remove the Gmail Failed label after correcting the message.

- [ ] **Step 5: Improve cron responses**

Keep bearer-token auth. Return summary counts and log a normalized failed scan if `scanInbox()` throws. Public responses use `Inbox scan failed`; detailed causes stay in server logs/import logs.

- [ ] **Step 6: Verify the feature**

Run:

```bash
npm test -- src/features/connections
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/connections src/app/api/cron/inbox src/app/dashboard/connections src/features/connections
git commit -m "feat: add automatic import health center"
```

---

### Task 6: Daily action brief Overview

**Files:**
- Create: `src/app/api/overview/route.ts`
- Create: `src/features/overview/types.ts`
- Create: `src/features/overview/derive-actions.ts`
- Create: `src/features/overview/derive-actions.test.ts`
- Create: `src/features/overview/OverviewPage.tsx`
- Create: `src/features/overview/TrafficWindow.tsx`
- Create: `src/features/overview/ActionCard.tsx`
- Create: `src/features/overview/overview.test.tsx`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Produces: one `OverviewResponse` and `deriveActions(response)`.
- Consumes: shared UI from Task 3 and connections health from Task 5.

- [ ] **Step 1: Write failing action-priority tests**

```ts
it('prioritizes critical inventory before a positive sales trend', () => {
  const actions = deriveActions({
    inventory: { criticalCount: 2, atRiskCount: 4, deadStockValue: 1200 },
    staffing: { coverageScore: 92, gaps: [] },
    sales: { revenue: 8420, comparisonPercent: 12 },
    traffic: { nextPeakAt: '20:05', peakPassengers: 302 },
  });
  expect(actions[0]).toMatchObject({ level: 'act-now', href: '/dashboard/inventory?risk=CRITICAL' });
  expect(actions.at(-1)?.level).toBe('on-track');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- src/features/overview
```

Expected: FAIL because overview contracts are missing.

- [ ] **Step 3: Create the aggregated overview API**

Fetch sales, inventory, flights, schedule, concession, and connections concurrently with `Promise.allSettled`. Return successful domains plus a per-domain status:

```ts
export type DomainResult<T> =
  | { status: 'ready'; data: T; updatedAt: string | null }
  | { status: 'error'; data: T | null; message: string };
```

One domain failure must not turn the entire Overview into an error page.

- [ ] **Step 4: Implement deterministic action derivation**

Priority order:

1. Critical inventory
2. Uncovered high-value flight
3. Failed/stale automatic import
4. Concession threshold exceeded
5. At-risk inventory
6. Upcoming passenger peak
7. Positive sales pace

Return at most three actions, with at most one `on-track` item.

- [ ] **Step 5: Build the responsive Overview**

Compose:

```tsx
<PageHeader />
<TrafficWindow />
<ActionList />
<SalesPacePanel />
<UpcomingTrafficPanel />
<StaffCoveragePanel />
<InventoryActionPanel />
<ImportHealthPanel />
```

Each action links to a pre-filtered detail page. Show stale data with its last-valid timestamp and retain it if refresh fails.

- [ ] **Step 6: Verify the Overview**

Run:

```bash
npm test -- src/features/overview
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/overview src/app/dashboard/page.tsx src/features/overview
git commit -m "feat: turn overview into daily action brief"
```

---

### Task 7: Sales experience

**Files:**
- Create: `src/features/sales/types.ts`
- Create: `src/features/sales/SalesPage.tsx`
- Create: `src/features/sales/SalesSummary.tsx`
- Create: `src/features/sales/SalesTrend.tsx`
- Create: `src/features/sales/SalesCoverage.tsx`
- Create: `src/features/sales/SalesAnalysis.tsx`
- Create: `src/features/sales/sales.test.tsx`
- Modify: `src/app/dashboard/sales/page.tsx`
- Modify: `src/app/api/sales/daily/route.ts`
- Modify: `src/app/api/sales/months/route.ts`
- Modify: `src/app/api/sales/query/route.ts`

**Interfaces:**
- Produces: focused sales feature components and consistent `{ data, meta: { updatedAt, source } }` API metadata.
- Consumes: shared UI from Task 3.

- [ ] **Step 1: Write failing sales-state tests**

Cover these exact behaviors:

```tsx
it('labels a missing day instead of presenting zero revenue', async () => {
  render(<SalesPage initialState={{ kind: 'empty', date: '2026-07-30' }} />);
  expect(screen.getByText('No sales report has arrived for this day')).toBeVisible();
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
});

it('keeps monthly results visible when refresh fails', () => {
  render(<SalesPage initialState={{ kind: 'stale', data: fixture, message: 'Latest sync failed' }} />);
  expect(screen.getByText('Latest sync failed')).toBeVisible();
  expect(screen.getByText('$8,420.00')).toBeVisible();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- src/features/sales
```

Expected: FAIL because feature components are missing.

- [ ] **Step 3: Normalize sales API errors and metadata**

All three GET routes must:

- Check Supabase errors.
- Avoid silent 1,000-row truncation through bounded queries or pagination.
- Return `hasData` for each day.
- Return `updatedAt` and `source`.
- Use `addDays()` from `date-utils.ts`.
- Log server context and return a generic public error.

- [ ] **Step 4: Build the sales page**

Daily is the default tab. Monthly retains month comparisons and drill-downs. Remove routine upload dropzones. Replace them with an `Import source` link to Data Connections. Keep Run AI analysis as an explicit action with loading, error, and evidence states.

- [ ] **Step 5: Verify sales**

Run:

```bash
npm test -- src/features/sales
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/sales src/app/dashboard/sales/page.tsx src/app/api/sales
git commit -m "feat: rebuild automatic sales reporting"
```

---

### Task 8: Inventory action center

**Files:**
- Create: `src/features/inventory/types.ts`
- Create: `src/features/inventory/InventoryPage.tsx`
- Create: `src/features/inventory/RiskSummary.tsx`
- Create: `src/features/inventory/InventoryTable.tsx`
- Create: `src/features/inventory/ItemDrawer.tsx`
- Create: `src/features/inventory/ReorderRuleForm.tsx`
- Create: `src/features/inventory/inventory.test.tsx`
- Modify: `src/app/dashboard/inventory/page.tsx`
- Modify: `src/app/api/inventory/risk/route.ts`
- Modify: `src/app/api/inventory/rules/route.ts`

**Interfaces:**
- Produces: typed inventory feature with query-string filters and accessible rule editing.
- Consumes: Task 3 `DetailDrawer`, `DataState`, table, badge, and form primitives.

- [ ] **Step 1: Write failing inventory interaction tests**

```tsx
it('opens a critical item in a labelled detail drawer', async () => {
  render(<InventoryPage initialRisk={inventoryFixture} />);
  await userEvent.click(screen.getByRole('button', { name: /open SKU-100/i }));
  expect(screen.getByRole('dialog', { name: 'SKU-100 inventory details' })).toBeVisible();
});

it('rejects a reorder point below minimum stock', async () => {
  render(<ReorderRuleForm value={{ minStock: 10, reorderPoint: 12, maxStock: 30, leadTimeDays: 14 }} onSave={vi.fn()} />);
  await userEvent.clear(screen.getByLabelText('Reorder point'));
  await userEvent.type(screen.getByLabelText('Reorder point'), '5');
  await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  expect(screen.getByText('Reorder point must be at least the minimum stock')).toBeVisible();
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- src/features/inventory
```

Expected: FAIL because new inventory modules are missing.

- [ ] **Step 3: Strengthen inventory API contracts**

Add exact validation:

```ts
if (![minStock, reorderPoint, maxStock, leadTimeDays].every(Number.isFinite)) return 400;
if (minStock < 0 || reorderPoint < minStock || maxStock < reorderPoint || leadTimeDays < 0) return 400;
```

Risk responses include `snapshotDate`, `salesWindow`, and `updatedAt`. DB errors return 500, never an empty healthy summary.

- [ ] **Step 4: Build the action center**

Lead with critical, at-risk, dead-stock, and overstocked metrics. Apply `?risk=CRITICAL` from Overview. Provide stable sorting, text search, category filter, and a mobile card layout. Detail drawer contains velocity, days of cover, current stock, value, history, reorder rule, and evidence-backed AI recommendation.

- [ ] **Step 5: Verify inventory**

Run:

```bash
npm test -- src/features/inventory
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/inventory src/app/dashboard/inventory/page.tsx src/app/api/inventory
git commit -m "feat: rebuild inventory action center"
```

---

### Task 9: Flight intelligence board

**Files:**
- Create: `src/features/flights/types.ts`
- Create: `src/features/flights/FlightsPage.tsx`
- Create: `src/features/flights/FlightBoard.tsx`
- Create: `src/features/flights/TrafficForecast.tsx`
- Create: `src/features/flights/PassengerAccuracy.tsx`
- Create: `src/features/flights/SchedulePdfDrawer.tsx`
- Create: `src/features/flights/flights.test.tsx`
- Modify: `src/app/dashboard/flights/page.tsx`
- Modify: `src/app/api/flights/analytics/route.ts`
- Modify: `src/app/api/flights/day/route.ts`
- Modify: `src/app/api/flights/file/route.ts`
- Modify: `src/app/api/flights/upload-pdf/route.ts`

**Interfaces:**
- Produces: daily flight board, month analytics, estimate/actual accuracy, and stored PDF drawer.
- Consumes: Task 3 UI contracts.

- [ ] **Step 1: Write failing flight-display tests**

```tsx
it('shows actual passengers and variance when a capacity email matched', () => {
  render(<FlightBoard flights={[{ ...flight, estimatedPassengers: 156, actualPassengers: 142 }]} />);
  expect(screen.getByText('142 actual')).toBeVisible();
  expect(screen.getByText('−14')).toBeVisible();
});

it('marks an unmatched passenger summary as an import issue', () => {
  render(<PassengerAccuracy unmatched={['BA2157']} rows={[]} />);
  expect(screen.getByText('1 passenger summary needs attention')).toBeVisible();
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- src/features/flights
```

Expected: FAIL because flight feature modules are missing.

- [ ] **Step 3: Normalize flight APIs**

Day and analytics responses include `updatedAt`, `actualPassengers`, `estimateVariance`, and stable filter metadata. Validate every `YYYY-MM` parameter on GET and DELETE. Validate PDF instance, MIME, and 10 MB limit before reading bytes. DB/storage errors return generic public responses and detailed server logs.

- [ ] **Step 4: Build the flight board**

Default to today. Provide arrival/departure/airline filters, traffic windows, monthly analytics, estimate-versus-actual accuracy, and PDF access. Move upload/delete tools to Data Connections recovery; keep a link to that area.

- [ ] **Step 5: Verify flights**

Run:

```bash
npm test -- src/features/flights
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/flights src/app/dashboard/flights/page.tsx src/app/api/flights
git commit -m "feat: rebuild flight intelligence board"
```

---

### Task 10: Weekly scheduling workspace

**Files:**
- Create: `src/features/schedules/types.ts`
- Create: `src/features/schedules/SchedulesPage.tsx`
- Create: `src/features/schedules/WeekToolbar.tsx`
- Create: `src/features/schedules/ScheduleTimeline.tsx`
- Create: `src/features/schedules/CoverageSummary.tsx`
- Create: `src/features/schedules/ShiftDialog.tsx`
- Create: `src/features/schedules/schedules.test.tsx`
- Modify: `src/components/DraggableShift.tsx`
- Modify: `src/components/StaffSettings.tsx`
- Modify: `src/app/dashboard/schedules/page.tsx`
- Modify: `src/app/api/schedules/generate/route.ts`
- Modify: `src/app/api/schedules/shift/route.ts`
- Modify: `src/app/api/schedules/latest/route.ts`
- Modify: `src/app/api/schedules/notify/route.ts`

**Interfaces:**
- Produces: week-first scheduling UI with pointer/keyboard editing and optimistic rollback.
- Consumes: shared dialog, data-state, and button contracts.

- [ ] **Step 1: Write failing schedule behavior tests**

```tsx
it('restores the original shift when persistence fails', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Database unavailable'));
  render(<ScheduleTimeline days={weekFixture} onSaveShift={save} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit Nichelle on Thursday' }));
  await userEvent.clear(screen.getByLabelText('Start time'));
  await userEvent.type(screen.getByLabelText('Start time'), '10:00');
  await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
  expect(await screen.findByText('The edit was not saved. The previous shift was restored.')).toBeVisible();
  expect(screen.getByText('9:00 AM–5:00 PM')).toBeVisible();
});

it('offers keyboard editing for each shift', () => {
  render(<ScheduleTimeline days={weekFixture} onSaveShift={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Edit Nichelle on Thursday' })).toBeVisible();
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- src/features/schedules
```

Expected: FAIL because scheduling feature modules are missing.

- [ ] **Step 3: Make persistence safe**

Generation must check deletion errors before insert. Latest must check flight query errors before calculating coverage. Notify must return a non-2xx status when Gmail is not configured or send returns false. Shift mutations validate `HH:MM`, staff name, hours, and date before touching Supabase.

- [ ] **Step 4: Build the week-first workspace**

Default range is Monday–Sunday. Preserve drag editing, add an equivalent Edit button/dialog for keyboard and touch, show coverage gaps tied to flights, and show save/sending/export states. Clear schedule uses `ConfirmDialog`. Staff settings use the shared drawer/dialog styling.

- [ ] **Step 5: Verify schedules**

Run:

```bash
npm test -- src/features/schedules
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/schedules src/components/DraggableShift.tsx src/components/StaffSettings.tsx src/app/dashboard/schedules/page.tsx src/app/api/schedules
git commit -m "feat: rebuild weekly scheduling workspace"
```

---

### Task 11: Concession workspace and login

**Files:**
- Create: `src/lib/concession.ts`
- Create: `src/lib/concession.test.ts`
- Create: `src/features/concession/ConcessionPage.tsx`
- Create: `src/features/concession/CalculationBreakdown.tsx`
- Create: `src/features/concession/concession.test.tsx`
- Modify: `src/app/dashboard/concession/page.tsx`
- Modify: `src/app/api/concession/route.ts`
- Modify: `src/app/api/concession/export/route.ts`
- Create: `src/features/auth/LoginForm.tsx`
- Create: `src/features/auth/login.test.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/auth/login/route.ts`

**Interfaces:**
- Produces: one shared `calculateConcession()` contract used by API, export, and tests; Terminal Precision login.
- Consumes: Task 3 UI.

- [ ] **Step 1: Write failing concession calculation tests**

```ts
import { calculateConcession } from './concession';

it('returns no additional payable below MAG', () => {
  const result = calculateConcession({ grossSalesUsd: 10_000, creditCardSalesUsd: 8_000, cashSalesUsd: 2_000 });
  expect(result.additionalPayableEcd).toBe(0);
});

it('rejects a card/cash split that does not reconcile to gross sales', () => {
  expect(() => calculateConcession({
    grossSalesUsd: 30_000,
    creditCardSalesUsd: 20_000,
    cashSalesUsd: 5_000,
  })).toThrow('Card and cash sales must equal gross sales');
});
```

- [ ] **Step 2: Write failing login error tests**

```tsx
it('shows a configuration error separately from invalid credentials', () => {
  render(<LoginForm initialError="Server authentication is not configured" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Server authentication is not configured');
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run:

```bash
npm test -- src/lib/concession.test.ts src/features/concession src/features/auth
```

Expected: FAIL because shared calculation and feature modules are missing.

- [ ] **Step 4: Centralize concession calculations**

Export:

```ts
export type ConcessionInput = {
  grossSalesUsd: number;
  creditCardSalesUsd: number;
  cashSalesUsd: number;
};
export type ConcessionResult = {
  netSalesUsd: number;
  percentageRentEcd: number;
  magEcd: number;
  additionalPayableEcd: number;
  additionalPayableUsd: number;
  exceedsMag: boolean;
};
export function calculateConcession(input: ConcessionInput): ConcessionResult;
```

Use this function in both API and export. Reject negative/non-finite inputs and unreconciled splits. A missing sales row returns a missing-data response, not zero.

- [ ] **Step 5: Build the concession workspace**

Show selected month, data freshness, gross sales, editable/reconciled split, full calculation breakdown, MAG status, and export action. The export button preserves its loading state and displays download failure inline.

- [ ] **Step 6: Rebuild login**

Keep current single-manager auth and cookie. Return distinct server configuration status from the route without leaking secrets. Preserve and validate the same-origin `next` path. Build a focused accessible form with visible error and pending state.

- [ ] **Step 7: Verify concession and login**

Run:

```bash
npm test -- src/lib/concession.test.ts src/features/concession src/features/auth
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/concession* src/features/concession src/features/auth src/app/dashboard/concession src/app/api/concession src/app/login src/app/auth/login
git commit -m "feat: rebuild concession and login workflows"
```

---

### Task 12: Full-story end-to-end and responsive verification

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/fixtures/session.ts`
- Create: `e2e/dashboard.spec.ts`
- Create: `e2e/connections.spec.ts`
- Create: `e2e/commerce.spec.ts`
- Create: `e2e/operations.spec.ts`
- Create: `e2e/finance.spec.ts`

**Interfaces:**
- Produces: repeatable critical-journey verification at desktop and mobile widths.
- Consumes: every merged task.

- [ ] **Step 1: Configure Playwright**

Use a local production server:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000/login',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
});
```

- [ ] **Step 2: Write the failing critical journeys**

Cover:

- Login and logout
- Daily action links to a filtered inventory page
- Automatic import source health and recovery entry
- Sales daily/monthly switching and missing-day state
- Inventory search, risk filter, item drawer, and rule validation
- Flight arrival/departure filter and passenger accuracy
- Schedule generation, edit, failure rollback, email state, and export
- Concession month, reconciled split, and export

Use seeded/mock route data at the browser boundary; never depend on production credentials.

- [ ] **Step 3: Run E2E and observe the failures**

Run:

```bash
npm run test:e2e
```

Expected: the new journeys expose integration defects or missing stable selectors; record each failing assertion.

- [ ] **Step 4: Add stable test identifiers only where semantics are insufficient**

Prefer roles and accessible names. Add `data-testid` only for visual charts or repeated timeline regions that cannot be uniquely named. Fix product behavior rather than weakening assertions.

- [ ] **Step 5: Run the full verification matrix**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Expected: all commands exit 0 with no failing tests.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e src
git commit -m "test: cover redesigned dashboard journeys"
```

---

### Task 13: Production documentation and final acceptance

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Create: `docs/operations/data-connections.md`
- Create: `docs/operations/supabase-setup.md`
- Modify if required by implementation: `vercel.json`

**Interfaces:**
- Produces: reproducible setup, deployment, automatic-ingestion, recovery, and verification instructions.
- Consumes: final merged product.

- [ ] **Step 1: Replace the scaffold README**

Document:

- Product purpose and page map
- Required Node/npm versions
- Installation and local environment
- Supabase schema/migrations
- Gmail OAuth scopes including `gmail.modify`
- Vercel Cron and `CRON_SECRET`
- Development, tests, lint, typecheck, build, and E2E commands
- Deployment checklist

- [ ] **Step 2: Document Data Connections operations**

`docs/operations/data-connections.md` must explain each source, expected email/report naming, Imported/Failed Gmail labels, last-success semantics, automatic retry behavior, and manual recovery steps.

- [ ] **Step 3: Document fresh Supabase setup**

`docs/operations/supabase-setup.md` must list migration order, private `flight-schedules` bucket creation, generated types, and a verification query for every required table/column.

- [ ] **Step 4: Run a clean acceptance build**

Run:

```bash
git status --short
npm ci --cache /private/tmp/airport-dashboard-final-npm-cache
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

Expected:

- Install exits 0.
- Unit/component tests report zero failures.
- Type checking exits 0.
- Lint exits 0 with no errors.
- Production build exits 0.
- Desktop/mobile E2E reports zero failures.
- `git diff --check` prints nothing.

- [ ] **Step 5: Perform the manual browser acceptance walkthrough**

At desktop and mobile widths, verify:

- No unexpected console errors
- No horizontal page overflow
- Focus is visible and ordered
- Reduced-motion mode removes nonessential motion
- Every loading, empty, stale, error, and ready state is visually usable
- No action ends without visible feedback
- Data Connections is reachable from desktop and mobile navigation

- [ ] **Step 6: Request final code and security review**

Run dedicated code-review and security-review agents against the complete diff. Resolve all critical/high findings, add a failing regression test for each behavior fix, and repeat Step 4.

- [ ] **Step 7: Commit**

```bash
git add README.md .env.example docs vercel.json
git commit -m "docs: document redesigned dashboard operations"
```

- [ ] **Step 8: Record final evidence**

Save the exact command results and browser routes checked in the final handoff. Do not claim completion from partial or earlier runs.
