# Task 6 Report — Daily action brief Overview

## Status

Implemented and reviewed. The dashboard entry point is now a responsive
Terminal Precision daily action brief backed by one partial-failure-safe
overview endpoint. Missing or failed data is never presented as a successful
zero, and the client retains last-valid domain data and timestamps when a
refresh fails.

## Files

Created:

- `src/app/api/overview/route.ts`
- `src/features/overview/types.ts`
- `src/features/overview/derive-actions.ts`
- `src/features/overview/derive-actions.test.ts`
- `src/features/overview/OverviewPage.tsx`
- `src/features/overview/TrafficWindow.tsx`
- `src/features/overview/ActionCard.tsx`
- `src/features/overview/overview.test.tsx`

Modified:

- `src/app/dashboard/page.tsx`

Deleted after `rg` proved it had no remaining consumer:

- `src/components/MetricCard.tsx`

## Implementation summary

- Added a dynamic `GET /api/overview` route that starts sales, inventory,
  flights, schedules, concession, and connection-health requests together and
  resolves them with one `Promise.allSettled`.
- Each domain returns a typed `DomainResult<T>`. Successful-but-empty source
  responses use `hasData: false` and nullable values; request or normalization
  failures use a domain message and `data: null`.
- A failed or malformed domain is isolated. Other domains continue to return,
  including when connection freshness itself is malformed.
- Data Connections last-success timestamps enrich sales, inventory, flight,
  concession, and connection domains. Inventory can fall back to its exact
  snapshot date. Schedule persistence has no timestamp in the owned contract,
  so the UI explicitly says `Update time unavailable`.
- The operating date and current flight minute are both derived in
  `America/Antigua`; this avoids UTC server rollover and early flight expiry.
- Upcoming flight data excludes departed flights. High-value coverage gaps are
  calculated at the established 30-minute selling window.
- `deriveActions()` implements the exact priority:
  critical inventory, uncovered high-value flight, failed/stale import,
  concession threshold, at-risk inventory, passenger peak, positive sales.
  It returns at most three actions and at most one `on-track` action.
- Action links carry exact filter contracts, including
  `?risk=CRITICAL`, `?risk=AT_RISK`, date/type/airline flight filters,
  concession month, sales date, and `/dashboard/connections`.
- `OverviewPage` uses a monotonic request generation so older responses cannot
  replace newer data. Per-domain refresh errors merge with the last valid data
  and preserve the last-valid timestamp.
- The UI composes `PageHeader`, the navy traffic-window signature, linked
  action cards, sales pace, upcoming traffic, staff coverage, inventory
  actions, and automatic import health. All links and controls have at least
  44px targets and visible shared focus treatment.
- Only canonical semantic tokens are used. The legacy brand classes and
  `animejs` behavior were removed from Overview; no new motion was added.
- Automatic imports remain the primary workflow. Recovery always leads to
  `/dashboard/connections`.

## Design guidance applied

Read before implementation:

- `AGENTS.md`
- approved redesign specification and implementation plan
- exact Task 6 brief and Tasks 3–5 briefs/reports/contracts
- complete `frontend-design` and `ui-ux-pro-max` skills
- complete TDD, good-test, plan-execution, and verification guidance
- local Next.js 16 route-handler, Server/Client Component, fetching, `use
  client`, and Vitest guides

The required UI design-system search proposed a generic exaggerated-minimalist
system. The approved Terminal Precision palette, type, and information
hierarchy correctly overrode that generic suggestion. The one deliberate
signature remains the traffic-window band; supporting panels stay restrained.

## TDD evidence

### Initial feature RED

```text
npm test -- src/features/overview
Test Files 2 failed (2)
Failed to resolve import "./derive-actions"
Failed to resolve import "@/app/api/overview/route"
exit code 1
```

The suites failed only because the new production modules did not exist.

### Initial GREEN

```text
npm test -- src/features/overview
Test Files 2 passed (2)
Tests 10 passed (10)
exit code 0
```

### Review/self-review regressions

Each behavior was captured failing before its fix:

```text
never-seen source priority:
expected [] but received one import-health action

malformed connection freshness:
TypeError: b.localeCompare is not a function

departed high-value flight:
expected uncovered-flight false, received true

UTC/Antigua boundary:
expected 2026-07-30, received 2026-07-31
```

Each focused regression then passed after the corresponding minimal change.
The final focused suite contains 14 tests.

## Code review

Initial read-only review reported:

1. **High:** UTC/server clock use could expire Antigua flights early and roll
   the brief date during Antigua evening.
2. **High, staged dependency:** current legacy destination pages do not yet
   consume every emitted query parameter.
3. **Medium, contract limitation:** the schedule endpoint does not expose a
   persistence timestamp.

Disposition:

- Fixed the timezone issue with an Antigua boundary regression.
- The integration owner confirmed destination query consumption belongs to
  Tasks 7–11. Task 6 emits and tests the precise href contracts and does not
  edit those pages outside ownership.
- The integration owner confirmed the schedule timestamp requires an unowned
  schedule/API/DB contract change. Task 6 keeps honest `Update time
  unavailable` copy and does not invent freshness.

The timeboxed re-review returned:

```text
No remaining actionable Task 6 in-scope findings.
Verdict: APPROVED.
```

## Final verification

```text
npm test
Test Files 13 passed (13)
Tests 84 passed (84)
exit code 0
```

```text
npm run typecheck
tsc --noEmit
exit code 0
```

```text
npm run lint
eslint
exit code 0
```

```text
npm run build
Next.js 16.2.2 (Turbopack)
Compiled successfully
Finished TypeScript
Generated static pages (39/39)
/api/overview emitted as a dynamic route
exit code 0
```

The first final-matrix build attempt could not reach the three existing Google
font endpoints in the restricted sandbox. After explicit temporary network
permission, the fresh build above passed.

```text
git diff --check
exit code 0
```

Scope checks found no `brand-*`, raw color, `animejs`, or `MetricCard`
reference in the new Overview surface.

## Staged risks

- Tasks 7–11 must consume the Task 6 query-string contracts when their legacy
  destination pages are rebuilt. The Overview hrefs and their ordering are
  already covered.
- Schedule freshness remains unavailable until the schedule persistence
  contract exposes a reliable timestamp. The current UI is deliberately
  explicit about that limitation.
- Full authenticated browser acceptance across phone, tablet, laptop, and
  wide desktop remains part of the later end-to-end integration task.
