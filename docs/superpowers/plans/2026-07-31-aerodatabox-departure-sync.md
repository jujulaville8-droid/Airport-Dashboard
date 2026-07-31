# AeroDataBox Departure Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically import live and upcoming ANU departures from AeroDataBox into Supabase while preserving local passenger data and staying within RapidAPI's free quota.

**Architecture:** Add a server-only AeroDataBox client and pure normalizer, then a database-backed synchronization coordinator with separate live and planning freshness leases. Existing flight and schedule APIs call the coordinator before reading Supabase; failures retain the last valid data and surface safe source-health metadata.

**Tech Stack:** Next.js 16.2 App Router route handlers, TypeScript 5, Supabase/PostgreSQL, React 19, Vitest, Testing Library, Playwright, RapidAPI AeroDataBox v1.

## Global Constraints

- Import V.C. Bird International Airport (`ANU`) departures only.
- Use `https://aerodatabox.p.rapidapi.com` and keep `AERODATABOX_RAPIDAPI_KEY` server-side.
- Never expose provider credentials in client code, API responses, logs, Git history, or browser storage.
- Live data is fresh for six hours; the 14-day planning window is fresh for seven days.
- AeroDataBox airport-flight requests cover no more than 12 local hours per request and run no faster than one request per second.
- Preserve existing `estimated_passengers`, `actual_passengers`, and manual enrichments when provider fields are absent.
- Failed, empty, or partial provider responses never delete existing flight rows.
- Existing PDF and passenger-summary imports remain supported.
- Read the relevant Next.js 16 route-handler documentation under `node_modules/next/dist/docs/` before modifying route handlers.

---

## File Map

- Create `src/lib/aerodatabox.ts`: request construction, provider response types, normalization, status mapping, codeshare deduplication.
- Create `src/lib/aerodatabox.test.ts`: pure client/normalizer tests with injected `fetch`.
- Create `src/lib/flight-sync.ts`: freshness, lease claiming, quota-safe window generation, preservation merge, persistence and import logging.
- Create `src/lib/flight-sync.test.ts`: coordinator behavior tests through injected repositories and client.
- Create `supabase/migrations/006_aerodatabox_sync.sql`: atomic sync leases and provider metadata.
- Modify `src/lib/database.types.ts`: add migration types used by the coordinator.
- Create `src/app/api/flights/sync/route.ts`: authenticated manual recovery endpoint.
- Create `src/app/api/flights/sync/route.test.ts`: safe route response tests.
- Modify `src/app/api/flights/day/route.ts`: request live freshness before reading a day.
- Modify `src/app/api/flights/analytics/route.ts`: request planning freshness before month analytics.
- Modify `src/app/api/schedules/generate/route.ts`: request planning freshness for the requested range.
- Modify `src/features/flights/FlightsPage.tsx`: departures-first board and source freshness display.
- Create `src/features/flights/flights.test.tsx`: source/freshness and departure presentation coverage.
- Modify `src/app/api/connections/status/route.ts`: include AeroDataBox configuration state.
- Modify `src/features/connections/types.ts`: add flight-provider configuration metadata.
- Modify `src/features/connections/ConnectionsPage.tsx`: show the provider setup/freshness message.
- Create `docs/operations/render-deployment.md`: document the Render secret and initial synchronization.
- Modify `docs/operations/final-acceptance.md`: add departure-sync acceptance checks.

---

### Task 1: AeroDataBox client and normalization

**Files:**
- Create: `src/lib/aerodatabox.ts`
- Create: `src/lib/aerodatabox.test.ts`

**Interfaces:**
- Produces: `fetchAirportDepartures(window, options): Promise<AeroDataBoxDeparture[]>`
- Produces: `normalizeDepartures(payload): NormalizedDeparture[]`
- Produces: `buildDepartureWindows(startDate, days): DepartureWindow[]`
- Produces: `AeroDataBoxError` with safe `kind` values `configuration | rate-limit | upstream | malformed | timeout`

- [ ] **Step 1: Write failing request and window tests**

Create tests that express the public API before implementation:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  buildDepartureWindows,
  fetchAirportDepartures,
  normalizeDepartures,
} from './aerodatabox';

describe('buildDepartureWindows', () => {
  it('splits fourteen local days into twenty-eight twelve-hour windows', () => {
    const windows = buildDepartureWindows('2026-08-03', 14);
    expect(windows).toHaveLength(28);
    expect(windows[0]).toEqual({ fromLocal: '2026-08-03T00:00', toLocal: '2026-08-03T12:00' });
    expect(windows[27]).toEqual({ fromLocal: '2026-08-16T12:00', toLocal: '2026-08-17T00:00' });
  });
});

describe('fetchAirportDepartures', () => {
  it('requests ANU departures without cargo, private flights, or locations', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ departures: [] }), { status: 200 }));
    await fetchAirportDepartures(
      { fromLocal: '2026-08-03T00:00', toLocal: '2026-08-03T12:00' },
      { apiKey: 'secret', fetcher },
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('/flights/airports/iata/ANU/2026-08-03T00%3A00/2026-08-03T12%3A00');
    expect(String(url)).toContain('direction=Departure');
    expect(String(url)).toContain('withCargo=false');
    expect(String(url)).toContain('withPrivate=false');
    expect(init.headers).toMatchObject({
      'X-RapidAPI-Key': 'secret',
      'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify the expected red state**

Run: `npm test -- src/lib/aerodatabox.test.ts`

Expected: FAIL because `./aerodatabox` does not exist.

- [ ] **Step 3: Implement request construction and 12-hour window generation**

Implement these exact types and signatures:

```ts
export type DepartureWindow = { fromLocal: string; toLocal: string };
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type AeroDataBoxClientOptions = {
  apiKey: string;
  fetcher?: FetchLike;
  signal?: AbortSignal;
};

export function buildDepartureWindows(startDate: string, days: number): DepartureWindow[];
export async function fetchAirportDepartures(
  window: DepartureWindow,
  options: AeroDataBoxClientOptions,
): Promise<AeroDataBoxDeparture[]>;
```

Validate `YYYY-MM-DD`, positive integer days, a nonblank key, response status, and JSON shape. Use `encodeURIComponent` for each path segment and the fixed query parameters `direction=Departure`, `withLeg=true`, `withCancelled=true`, `withCodeshared=false`, `withCargo=false`, `withPrivate=false`, and `withLocation=false`.

- [ ] **Step 4: Write failing normalization tests**

Use a provider fixture containing an operating departure, its codeshare, a cancelled flight, and one malformed entry. Assert that normalization returns only valid operating departures with fields matching `TablesInsert<'flight_data'>`, including `flight_type: 'departure'`, `origin_destination`, `schedule_week_start`, `schedule_month`, and normalized status.

```ts
expect(normalizeDepartures(fixture)).toEqual([
  expect.objectContaining({
    flight_num: 'AA1136',
    flight_date: '2026-08-03',
    flight_type: 'departure',
    origin_destination: 'John F Kennedy International',
    status: 'scheduled',
    schedule_week_start: '2026-08-03',
    schedule_month: '2026-08',
  }),
]);
```

- [ ] **Step 5: Run the normalization test and verify it fails for missing behavior**

Run: `npm test -- src/lib/aerodatabox.test.ts`

Expected: request/window tests PASS and normalization assertions FAIL.

- [ ] **Step 6: Implement normalization and safe errors**

Implement:

```ts
export type NormalizedDeparture = Omit<TablesInsert<'flight_data'>, 'id'>;
export function normalizeDepartures(rows: AeroDataBoxDeparture[]): NormalizedDeparture[];

export class AeroDataBoxError extends Error {
  constructor(
    public readonly kind: 'configuration' | 'rate-limit' | 'upstream' | 'malformed' | 'timeout',
    message: string,
  ) { super(message); }
}
```

Prefer the operating flight number, use the departure airport movement's scheduled local time, map destination from the arrival airport, normalize provider statuses without exposing raw payloads, and skip malformed records. Do not assign passenger counts in this layer.

- [ ] **Step 7: Verify Task 1 and commit**

Run:

```bash
npm test -- src/lib/aerodatabox.test.ts
npm run typecheck
git add src/lib/aerodatabox.ts src/lib/aerodatabox.test.ts
git commit -m "feat: add AeroDataBox departure client"
```

Expected: all focused tests PASS and typecheck exits 0.

---

### Task 2: Database-backed quota and persistence coordinator

**Files:**
- Create: `supabase/migrations/006_aerodatabox_sync.sql`
- Modify: `src/lib/database.types.ts`
- Create: `src/lib/flight-sync.ts`
- Create: `src/lib/flight-sync.test.ts`

**Interfaces:**
- Consumes: `buildDepartureWindows`, `fetchAirportDepartures`, `normalizeDepartures`, `NormalizedDeparture`
- Produces: `ensureDepartureDataFresh(request): Promise<FlightSyncResult>`
- Produces: injectable `FlightSyncDependencies` for unit testing without Supabase or network calls

- [ ] **Step 1: Add failing coordinator tests**

Define the desired interface in the test:

```ts
type FlightSyncRequest = {
  mode: 'live' | 'planning';
  startDate: string;
  days?: number;
  now?: Date;
};

it('does not call AeroDataBox when a successful live sync is under six hours old', async () => {
  const deps = makeDeps({ lastSuccessAt: '2026-08-03T08:00:00.000Z' });
  const result = await ensureDepartureDataFresh(
    { mode: 'live', startDate: '2026-08-03', now: new Date('2026-08-03T12:00:00.000Z') },
    deps,
  );
  expect(result.status).toBe('fresh');
  expect(deps.fetchWindow).not.toHaveBeenCalled();
});

it('preserves passenger values while applying provider fields', async () => {
  const deps = makeDeps({
    existing: [{ flight_num: 'AA1136', estimated_passengers: 172, actual_passengers: 151 }],
    providerRows: [{ flight_num: 'AA1136', estimated_passengers: undefined, actual_passengers: undefined }],
  });
  await ensureDepartureDataFresh({ mode: 'live', startDate: '2026-08-03' }, deps);
  expect(deps.upsert).toHaveBeenCalledWith([
    expect.objectContaining({ flight_num: 'AA1136', estimated_passengers: 172, actual_passengers: 151 }),
  ]);
});
```

Also cover: seven-day planning freshness, lease contention, partial-window failure, no deletions, safe failed logging, and a 1,000 ms minimum interval between planning requests through an injected `wait` function.

- [ ] **Step 2: Run coordinator tests and verify red**

Run: `npm test -- src/lib/flight-sync.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Create atomic sync state migration**

Create `006_aerodatabox_sync.sql` with:

```sql
CREATE TABLE IF NOT EXISTS external_sync_state (
  sync_key TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION claim_external_sync(
  requested_key TEXT,
  requested_now TIMESTAMPTZ,
  requested_lease_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO external_sync_state(sync_key, lease_until, updated_at)
  VALUES (requested_key, requested_now + make_interval(secs => requested_lease_seconds), requested_now)
  ON CONFLICT (sync_key) DO UPDATE
    SET lease_until = EXCLUDED.lease_until, updated_at = EXCLUDED.updated_at
    WHERE external_sync_state.lease_until IS NULL
       OR external_sync_state.lease_until <= requested_now;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION claim_external_sync(TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_external_sync(TEXT, TIMESTAMPTZ, INTEGER) TO service_role;
```

Add matching `external_sync_state` row/insert/update definitions and `claim_external_sync` function arguments/result to `src/lib/database.types.ts`.

- [ ] **Step 4: Implement the coordinator minimally**

Define:

```ts
export type FlightSyncResult = {
  status: 'fresh' | 'updated' | 'in-progress' | 'failed' | 'not-configured';
  records: number;
  lastSuccessAt: string | null;
  message: string | null;
};

export type FlightSyncDependencies = {
  apiKey: string | undefined;
  getState(syncKey: string): Promise<{ lastSuccessAt: string | null }>;
  claim(syncKey: string, now: Date, leaseSeconds: number): Promise<boolean>;
  complete(syncKey: string, at: Date): Promise<void>;
  release(syncKey: string): Promise<void>;
  fetchWindow(window: DepartureWindow): Promise<AeroDataBoxDeparture[]>;
  loadExisting(startDate: string, endDate: string): Promise<ExistingFlight[]>;
  upsert(rows: NormalizedDeparture[]): Promise<void>;
  record(result: AuthoritativeImportResult): Promise<void>;
  wait(ms: number): Promise<void>;
};

export async function ensureDepartureDataFresh(
  request: FlightSyncRequest,
  dependencies?: FlightSyncDependencies,
): Promise<FlightSyncResult>;
```

Use sync keys `aerodatabox:live` and `aerodatabox:planning`, freshness windows of six hours and seven days, and a five-minute lease. Merge existing enrichment by uniqueness key before upsert. Record `fileName` as `aerodatabox-live` or `aerodatabox-planning`. Always release a failed lease; only advance `last_success_at` after all required persistence succeeds.

- [ ] **Step 5: Verify Task 2 and commit**

Run:

```bash
npm test -- src/lib/aerodatabox.test.ts src/lib/flight-sync.test.ts
npm run typecheck
git diff --check
git add supabase/migrations/006_aerodatabox_sync.sql src/lib/database.types.ts src/lib/flight-sync.ts src/lib/flight-sync.test.ts
git commit -m "feat: add quota-safe departure synchronization"
```

Expected: focused tests PASS, typecheck exits 0, and diff check is clean.

---

### Task 3: Connect synchronization to Flights, Schedules, and Data Connections

**Files:**
- Create: `src/app/api/flights/sync/route.ts`
- Create: `src/app/api/flights/sync/route.test.ts`
- Modify: `src/app/api/flights/day/route.ts`
- Modify: `src/app/api/flights/analytics/route.ts`
- Modify: `src/app/api/schedules/generate/route.ts`
- Modify: `src/features/flights/FlightsPage.tsx`
- Create: `src/features/flights/flights.test.tsx`
- Modify: `src/app/api/connections/status/route.ts`
- Modify: `src/features/connections/types.ts`
- Modify: `src/features/connections/ConnectionsPage.tsx`

**Interfaces:**
- Consumes: `ensureDepartureDataFresh`
- Produces: `POST /api/flights/sync` returning a safe `FlightSyncResult`
- Extends: `GET /api/flights/day` with `source: { provider, status, lastSuccessAt, message }`

- [ ] **Step 1: Read Next.js 16 route-handler guidance**

Run:

```bash
rg -n "Route Handlers|NextRequest|Response.json" node_modules/next/dist/docs/01-app node_modules/next/dist/docs/02-pages | head -80
```

Read the matched App Router route-handler document completely before editing routes.

- [ ] **Step 2: Write failing route and UI tests**

Add route assertions that a configured manual sync returns status and counts, while provider errors return a safe message without upstream bodies or the key. Add UI assertions:

```tsx
expect(await screen.findByText(/AeroDataBox departures/i)).toBeVisible();
expect(screen.getByText(/Last refreshed/i)).toBeVisible();
expect(screen.queryByRole('option', { name: 'Arrivals' })).not.toBeInTheDocument();
```

Add a schedule route assertion that planning freshness is requested before `getFlightData`.

- [ ] **Step 3: Run the focused tests and verify red**

Run:

```bash
npm test -- src/app/api/flights/sync/route.test.ts src/features/flights/flights.test.tsx src/app/api/schedules
```

Expected: FAIL because the sync route, source metadata, and integration calls are absent.

- [ ] **Step 4: Implement route integration**

Before database reads:

- `GET /api/flights/day`: call live mode for today's date; planning mode for a future date.
- `GET /api/flights/analytics`: call planning mode for the month when it intersects the next 14 days.
- `POST /api/schedules/generate`: call planning mode with the requested start and capped 14-day range.
- `POST /api/flights/sync`: require the existing application session and accept `{ mode: 'live' | 'planning', startDate }`.

Provider synchronization failure must not make existing flight reads fail. Include safe sync metadata in successful responses.

- [ ] **Step 5: Implement departures-only presentation and connection status**

Default the flight board to departures and remove the arrivals selector because this provider integration intentionally excludes arrivals. Show a compact source line based on the API response:

```tsx
<p className="text-sm text-muted">
  AeroDataBox departures · {source.status === 'updated' ? 'Refreshed now' : `Last refreshed ${formatted}`}
</p>
```

Extend the Data Connections response with:

```ts
flightProvider: {
  provider: 'AeroDataBox';
  configured: boolean;
  airport: 'ANU';
  direction: 'departure';
}
```

Render configuration-required guidance only when `AERODATABOX_RAPIDAPI_KEY` is missing.

- [ ] **Step 6: Verify Task 3 and commit**

Run:

```bash
npm test -- src/app/api/flights src/app/api/schedules src/features/flights src/features/connections
npm run typecheck
npm run lint
git diff --check
git add src/app/api/flights src/app/api/schedules/generate/route.ts src/features/flights src/features/connections src/app/api/connections/status/route.ts
git commit -m "feat: connect live departures to operations"
```

Expected: focused tests PASS, typecheck and lint exit 0, and diff check is clean.

---

### Task 4: Operations documentation, deployment, and acceptance

**Files:**
- Create: `docs/operations/render-deployment.md`
- Modify: `docs/operations/final-acceptance.md`
- Modify: `.env.example` if present

**Interfaces:**
- Consumes: deployed Render service, RapidAPI free-plan key, Supabase migration 006
- Produces: live ANU departure data and repeatable operator instructions

- [ ] **Step 1: Update deployment documentation**

Document:

```text
AERODATABOX_RAPIDAPI_KEY=<RapidAPI application key; Render secret only>
```

Include the migration command/process, the first live sync, the first planning sync, free-quota expectations, failure recovery, and key-rotation steps. Do not include the real key.

- [ ] **Step 2: Run the full local verification gate**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0 with no test failures or build errors.

- [ ] **Step 3: Review all code changes**

Invoke the required TypeScript/JavaScript code reviewer after all changes. Address every high- or medium-confidence correctness, security, or quota issue, then rerun the full verification gate.

- [ ] **Step 4: Commit documentation and reviewed fixes**

```bash
git add docs/operations .env.example
git commit -m "docs: operate AeroDataBox departure sync"
```

If reviewer fixes changed source files, include those exact files in the same reviewed-fix commit.

- [ ] **Step 5: Apply the database migration**

Apply `supabase/migrations/006_aerodatabox_sync.sql` to project `ubacwceiwgooqkbqjnzg`. Verify `external_sync_state` exists and `claim_external_sync` is executable only by `service_role`.

- [ ] **Step 6: Configure Render and deploy**

Add the RapidAPI credential to Render service `srv-d9md0iu417fc73b5tlq0` as `AERODATABOX_RAPIDAPI_KEY`, rebuild, and wait for the deployment to become Live. Never print the secret in tool output or chat.

- [ ] **Step 7: Perform live acceptance**

On `https://airport-dashboard-x7ke.onrender.com`:

1. Trigger a live departure sync.
2. Verify today's Flights board shows ANU departures with AeroDataBox freshness.
3. Trigger the planning sync and verify future departure records when available.
4. Generate a 14-day schedule and verify nonzero flight demand on dates with departures.
5. Verify Data Connections reports a successful `flight_schedule` import.
6. Reload Flights and Schedules to confirm persistence.
7. Inspect Render logs for credential leakage, unhandled errors, rate limits, or repeated synchronization.

- [ ] **Step 8: Push and record the release state**

```bash
git status --short
git log -5 --oneline
git push origin main
```

Expected: the worktree is clean after push and the live deployment uses the pushed commit.
