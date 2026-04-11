# Production Readiness Status

**Last updated:** 2026-04-10 (end of session 3)
**Build status:** ✅ `npx next build` passes clean (0 TS errors, 0 lint warnings)

## Quick index
- **Session 1** — initial fixes (sales page errors, schedule drag rollback, concession loading, DraggableShift race). See below.
- **Session 2** — full production audit (49 issues, 6 Critical, 21 High). Report: [AUDIT_REPORT.md](AUDIT_REPORT.md). Critical + High tiers were fixed.
- **Session 3** — auth gate (C1 closed), UI jumpiness fix, full inventory intelligence feature. See: [SESSION_3_SUMMARY.md](SESSION_3_SUMMARY.md).

## Current login
Username: `admin` · Password: `1tailor` — set via `AUTH_USERNAME` / `AUTH_PASSWORD` in `.env.local`.

## Next steps (pending)
1. **UI polish** — user wants a more "official" / less boutique feel. Currently undecided between monospace numbers + Inter, institutional serif, tighter layout, or all three. Plan: use AIDesigner MCP to generate 2 alternative directions. See [SESSION_3_SUMMARY.md §UI polish](SESSION_3_SUMMARY.md).
2. **Credential rotation** before any deploy.
3. **C6 schema fix** — `cust_no` hack still stores ticket counts. Needs proper `ticket_count INTEGER` migration.
4. **Deployment** to Vercel or Railway.

---

## Session 1 details (archived)

## What's been fixed this session

### Overview page — `src/app/dashboard/page.tsx`
- Rewrote `fetchData` to call the correct endpoints: `/api/sales/daily`, `/api/schedules/latest`, `/api/concession`, and the new `/api/flights/day`
- Added refresh button with spinning icon + "Updated HH:MM" timestamp in header
- Replaced undefined `aiInsight` reference (would have been a runtime crash) with a **Concession widget** showing current-month ECD rent payable, USD equivalent, threshold status, and gross sales — clickable to full Concession page
- Wired `setFlights` to real data via new endpoint, filtered to upcoming (scheduled_time ≥ now)
- Fixed broken `formatTime` that called `new Date()` on "HH:MM" strings

### Schedules page — `src/app/dashboard/schedules/page.tsx`
- **Email errors now visible** — `sendEmail` checks `res.ok`, shows red inline error message; success auto-clears after 5s
- **Shift drag rollback** — `handleShiftUpdate` snapshots previous state, reverts on Supabase failure, shows "edit was reverted" error
- Removed unused `date` prop and dead `totalStaff` variable

### Concession page — `src/app/dashboard/concession/page.tsx`
- Added loading spinner (`CircleNotch`) in header while fetching
- Replaced plain `<input type="month">` with smart dropdown populated from actual uploaded months (falls back to input if none)
- Removed unused `CurrencyDollar` and `ArrowRight` imports
- Swapped silent catch for `console.error`

### DraggableShift — `src/components/DraggableShift.tsx`
- **Fixed latent bug**: mouseup handler was reading stale values via `bar.getAttribute('data-temp-start/end')` from DOM, racing React state flushes. Rewrote using `latestStart`/`latestEnd` refs that update synchronously with state.
- Removed unused `staffName` destructure and `initialX` variable

### flight-schedule.ts — `src/lib/flight-schedule.ts`
- Removed 6 `console.log` debug statements (PDF extraction, Claude response logging)
- Removed unused `storeFlightData` import

### schedule.ts — `src/lib/schedule.ts`
- Removed dead `missedHV` computation (never consumed)
- Renamed unused `dayIndex` → `_dayIndex`

### email.ts — `src/lib/email.ts`
- Renamed unused `totalStaffHours` → `_totalStaffHours`

### eslint.config.mjs
- Added `argsIgnorePattern: "^_"` so underscore-prefix convention silences unused-var warnings

### New file
- `src/app/api/flights/day/route.ts` — GET endpoint returning individual flights for a specific date (powers Overview's upcoming flights table)

## Files touched

```
src/app/dashboard/page.tsx                  (Overview — major rewrite)
src/app/dashboard/schedules/page.tsx        (error handling + rollback)
src/app/dashboard/concession/page.tsx       (loading state + dropdown)
src/components/DraggableShift.tsx           (latent bug fix)
src/lib/flight-schedule.ts                  (remove debug logs)
src/lib/schedule.ts                         (dead code)
src/lib/email.ts                            (unused param)
src/app/api/flights/day/route.ts            (NEW)
eslint.config.mjs                           (ignore pattern)
```

## Still pending (high priority)

These were identified but **not yet audited with the specialized tools**:

1. **Sales page** — 715 lines, not yet reviewed for bugs / silent failures / type issues
2. **All 13 API routes** — not systematically reviewed for error handling, input validation, SQL injection surface
3. **counterpoint.ts** (sales importer) — known historical issues with duplicate prevention, should be re-verified
4. **claude.ts / analytics.ts** — haven't looked at these lib files in this session
5. **Runtime audit** — no live browser walkthrough has been done; no console error capture

## Pending (not code bugs — need user decisions)

1. **Authentication** — no login gate. Anyone with the URL can upload/delete data. Recommend Supabase Auth.
2. **Credential rotation** — `.env.local` is gitignored but contains live Supabase service-role key, Anthropic key, Gmail OAuth secret.
3. **Railway deployment** — env vars need to be copied to Railway dashboard.
