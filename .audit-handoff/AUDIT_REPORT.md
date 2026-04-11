# Production Readiness Audit — Session 2

**Date:** 2026-04-09
**Scope:** All non-session-1 files under `src/`
**Method:** 4 parallel static-analysis agents (silent-failure-hunter, type-design-analyzer, code-simplifier, code-reviewer) + live Playwright walkthrough of 5 dashboard pages + Anthropic model ID verification.
**Runtime status:** All 5 pages load clean — 0 console errors, all API calls 200.

---

## CRITICAL (ship-blockers)

### C1. No authentication on any API route
**Files:** `src/app/api/**` — every route calls the Supabase service-role client via `db.ts`, bypassing RLS.
Any internet user can delete all sales, wipe flight schedules, insert arbitrary staff, burn Anthropic budget, or trigger emails.
**Fix:** Add a session-auth gate (Supabase `@supabase/ssr` server client + `getUser()`) to every non-GET route at minimum. Known gap from session 1 — re-flagged as blocker.

### C2. No file-size limit on Excel/PDF uploads → trivial OOM/DoS
**Files:**
- `src/app/api/sales/import/route.ts:19`
- `src/app/api/flights/upload-pdf/route.ts:26`

Both read the entire upload into memory (`Buffer.from(await file.arrayBuffer())`) with no size check. Combined with C1, attacker can POST a 2GB file and kill the process. `xlsx` has known parse-bomb CVEs.
**Fix:** Check `file.size` (reject > 10MB) before reading. Validate MIME. `instanceof File` check (currently `as File` cast).

### C3. Anthropic model IDs are broken — AI feature dead in prod
**File:** `src/lib/claude.ts:52,56,58`
- Uses `claude-haiku-4-5-20250514` — real Haiku 4.5 is `claude-haiku-4-5-20251001`
- Uses `claude-sonnet-4-20250514` — stale Sonnet 4; current is `claude-sonnet-4-6`

Any `/api/ai/analyze` request returns 404 from Anthropic → 500 to client.
**Fix:** Update to `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`. Consider env vars for future.

### C4. Counterpoint importer: delete-failure path still inserts → data corruption
**File:** `src/lib/counterpoint.ts:160-169, 183-189, 296-302`
Both `importSalesReport` and `importDailySalesReport` push delete errors to `errors[]` but **do not abort**; the subsequent insert runs anyway, producing duplicate/mixed rows. This is the root cause of the "duplicate bug history" noted in the handoff.
Additionally, `importSalesReport:172` destructures `existingDaily` **without checking `error`** — a failed query returns `undefined`, `dailyDates` becomes empty, and the monthly importer clobbers authoritative daily data.
**Fix:** On any `delError`, return early with `success: false` and skip insert. Wrap delete+insert in a Supabase RPC/transaction, or convert to idempotent upsert keyed on `(tkt_dt, upload_type)`.

### C5. `sales/daily` DOW query scans entire table, silent truncation at 1000 rows
**File:** `src/app/api/sales/daily/route.ts:78-80`
```ts
const { data: allRows } = await supabase.from('sales_transactions').select('tkt_dt, tot_amt, cust_no');
```
- No filter → Supabase default 1000-row limit kicks in silently once table grows. `dowAvg` silently becomes wrong.
- `error` field not destructured → DB failures masked as "no historical data" (`dowAvg: 0`).
**Fix:** Scope query to last 90 days (`.gte('tkt_dt', ninetyDaysAgo)`), destructure and surface `error`. Even better: Postgres RPC for the aggregation.

### C6. `cust_no` column misused to store ticket count → silent data loss time-bomb
**Files:** `src/lib/counterpoint.ts:144,284` (producer); `src/lib/db.ts:40`, `src/app/api/sales/{daily,months,query}/route.ts` (consumers)
`cust_no` is a varchar holding a numeric ticket count via `parseInt(... as string) || 0`. If any legitimate customer number lands there (e.g. `"C-1234"`), it parses to `NaN → 0` and every "tickets" metric silently drops to zero.
**Fix:** Add proper `ticket_count INTEGER` column to `sales_transactions`, migrate, and update all consumers. Short-term: validate numeric-only before parsing and log anomalies.

---

## HIGH (fix before launch)

### H1. API routes leak raw error messages + no server-side logging
**Files:** ~14 routes — every catch does `(error as Error).message` and returns it to the client with no `console.error`.
- Leaks DB table/constraint names (info disclosure)
- No production log trail → 500s invisible
- Crashes if thrown value isn't an Error
**Fix:** Shared `errorMessage(e: unknown)` helper; `console.error` with context in every catch; return generic `{error: 'Internal error', id: errorId}` to clients.

### H2. Frontend pages swallow all fetch errors with empty catches
**Files:**
- `src/app/dashboard/sales/page.tsx:99-106, 109-119, 121-134, 216-233`
- `src/app/dashboard/flights/page.tsx:68-76, 78-87, 146-155`
- `src/components/StaffSettings.tsx:50, 67, 84, 106, 118`

Every client fetcher has `catch { /* empty */ }` with no `res.ok` check. Failed requests silently leave blank UI, stale state, or "delete succeeded" when it didn't.
**Fix:** Check `res.ok`, set `loadError` state, render an error banner. Shared `logClientError` helper.

### H3. `sales/daily` issues 9 sequential DB queries per request
**File:** `src/app/api/sales/daily/route.ts:58-74`
`getDayData` is awaited once for today, once for last-week, and 7 more times in a sequential for-loop. Single range query with in-memory grouping is ~10x faster.
**Fix:** One `.gte/.lte` query for the 7-day window, bucket in JS.

### H4. `sales/months` unbounded scan + silent truncation
**File:** `src/app/api/sales/months/route.ts:6-9`
Same bug as C5: no limit, 1000-row silent truncation → months silently disappear from the month selector as data grows.
**Fix:** Server-side aggregation RPC, or explicit pagination window.

### H5. Timezone bugs in date-range helpers
**Files:** `sales/daily`, `sales/query`, `schedules/notify`, `schedules/generate`, `schedules/export` all build day sequences with `new Date(ymd + 'T00:00:00').toISOString().substring(0,10)` and `current.setDate(...)`. Breaks on non-UTC process TZ around DST.
**Fix:** Shared `addDays(ymd: string, n: number): string` string-arithmetic helper.

### H6. `/api/concession` ccSales/cashSales: no numeric validation
**File:** `src/app/api/concession/route.ts:34-35`
`parseFloat(... || '0')` returns `NaN` for non-numeric input, propagating `NaN` through ECD calcs and breaking the UI. Negative values also accepted.
**Fix:** `Number.isFinite(v) && v >= 0` guard; 400 on bad input. Use `number | null` to distinguish 0 from missing.

### H7. Concession route silently reports $0 sales on DB error
**File:** `src/app/api/concession/route.ts:61-71`
`sales ? ... : 0` means a null row produces $0 concession, which would drive a bad rent decision ("you owe MAG" when really "we couldn't load your data").
**Fix:** Assert `sales` non-null after the `if (error) throw`; fail loudly.

### H8. `schedules/generate` delete-before-insert is not transactional
**File:** `src/app/api/schedules/generate/route.ts:100-110`
`supabase.from('staff_schedules').delete()...` — `error` field not destructured. A failed delete + successful insert produces duplicate shifts silently.
**Fix:** Check delete error and abort; wrap in RPC transaction.

### H9. `schedules/notify` returns 200 on `sent: false`
**File:** `src/app/api/schedules/notify/route.ts:75-80`
When Gmail isn't configured, returns `{success: false}` with status 200 → callers checking `res.ok` report success to the user.
**Fix:** Return 4xx/5xx on failure.

### H10. Staff POST/PUT mass-assignment
**File:** `src/app/api/staff/route.ts:59-80`
`const { id, ...updates } = body; update(updates)` forwards every body key to Supabase. Arbitrary columns (e.g. `is_active`, `created_at`) can be set by the caller.
**Fix:** Allow-list fields explicitly.

### H11. Flights upload-pdf DELETE: no format validation on `scheduleMonth`
**File:** `src/app/api/flights/upload-pdf/route.ts:43-49`
POST validates `/^\d{4}-\d{2}$/`, DELETE only checks truthiness → any string reaches `.eq('schedule_month', x)` enabling accidental/malicious mass delete.
**Fix:** Apply the same regex guard.

### H12. `claude.ts` empty-content-array crash + text fallback masks failures
**File:** `src/lib/claude.ts:111, 124-125`
- `response.content[0].type` crashes if `content` is empty (e.g. `max_tokens` stop). Needs `content[0]?.type`.
- `response.usage as unknown as Record<string, number>` double-cast hides real SDK types; if Anthropic renames a field, silently returns 0 instead of a type error.
- Line 111 non-text block → `analysisText = ''` stored in DB and shown as blank to user.
**Fix:** `const block = response.content[0]; const text = block?.type === 'text' ? block.text : null;` — treat `null` as error, not empty string. Drop the double-cast, destructure `cache_read_input_tokens` directly.

### H13. `db.ts:115-126` `getUploadedMonths` discards DB error
**File:** `src/lib/db.ts:115-126`
`const { data: depData } = await supabase...` — error not checked. Failed query → every month shows `departures: 0` silently.
**Fix:** Destructure and throw on error.

### H14. `schedules/latest` fabricates 100% coverage on DB error
**File:** `src/app/api/schedules/latest/route.ts:29-36`
Second (flights) query's error is ignored; `coverageScore` then computed against an empty HV list → UI shows 100% perfect coverage when the DB call failed. Misleads staff scheduling decisions.
**Fix:** Check error; surface failure.

### H15. `sales/query` fills missing days with zeros — no "no data" signal
**File:** `src/app/api/sales/query/route.ts:36-52`
Client cannot distinguish legit zero-sales day from data-gap day.
**Fix:** Add `hasData: boolean` per day (pattern already in `sales/daily`).

### H16. Counterpoint parser: hardcoded column indices, silent miss
**File:** `src/lib/counterpoint.ts:74,98-100`
Magic column indices (12,15,19,25) with no layout-version detection. Any Counterpoint export format change silently yields `tickets: 0`/`sales: 0` rows with `success: true`.
**Fix:** Detect columns by header-row name match; log skipped rows into `errors[]`.

### H17. Counterpoint year detection inverted
**File:** `src/lib/counterpoint.ts:44-62`
Break logic compares against `new Date().getFullYear()`; current-year reports behave by coincidence. Inner `break` only exits cell loop. If regex misses, year silently defaults to current year → March 2023 file imported in 2026 stored under 2026-03.
**Fix:** Explicit `found` flag, break both loops unconditionally, throw if not found.

### H18. Sales page parses JSON before checking `res.ok`
**File:** `src/app/dashboard/sales/page.tsx:170-183, 186-214, 242-258`
`const result = await res.json();` before `res.ok` check — 500 HTML error pages throw and fall into generic "Upload failed" catch, losing the real message. Analysis panel renders `data.error` as if it were content.
**Fix:** Check `res.ok` first; show errors with distinct styling.

### H19. Supabase responses all typed as `any` via `Record<string, unknown>`
**Files:** `db.ts` (all helpers), every API route that maps DB results.
No generated types → every consumer casts field-by-field (`f.estimated_passengers as number`, `f.flight_type as 'arrival' | 'departure'`). Nullable columns lose their null type; DB drift hides.
**Fix:** `npx supabase gen types typescript > src/lib/database.types.ts`, then `createClient<Database>()`. Eliminates ~30 casts across the codebase. (Larger change — can defer but creates ongoing drift risk.)

### H20. API request bodies all untyped (`any`)
**Files:** every POST/PUT/DELETE route.
`const body = await request.json()` → runtime validation is manual `if (!x)` checks, cannot catch type mismatches. E.g. `schedules/generate/route.ts:15` casts `any` to `StaffMember[]` with no check.
**Fix:** Add Zod schemas in `src/lib/api-schemas.ts`, one per endpoint. `parse()` gives both runtime validation and compile-time types.

### H21. `src/lib/analytics.ts` is empty (1 line)
If anything imports it, silent no-op. Either delete or populate.
**Fix:** `grep "from '@/lib/analytics'"` → if nothing, `rm`.

---

## MEDIUM

### M1. Duplicate schedule response shape across `generate`, `latest`, `notify`, `export`
Four files re-declare `{shifts, coverageScore, flightCount, staffOnDuty, dayOff, flights}` inline. Will drift.
**Fix:** Extract to `src/lib/schedule-types.ts`.

### M2. `claude.ts` confidence level parsed via substring match
Matches "HIGH" inside "highlight" etc. Stringly-typed return `string` not `'HIGH'|'MEDIUM'|'LOW'`.
**Fix:** Regex with word boundaries; typed union.

### M3. AI analyze slices first 200 rows without telling Claude
**File:** `src/app/api/ai/analyze/route.ts:48,55`
Prompt says "analyze sales data" but only 200 most-recent rows sent — biased recommendations.
**Fix:** Disclose sampling in prompt or aggregate to daily summaries server-side.

### M4. `parseInt(... )` calls lack radix
Multiple files. Lint warning long-standing.

### M5. `formData.get('file') as File` casts
`sales/import/route.ts:7`, `flights/upload-pdf/route.ts:8` — no null/string check. Combines with C2.

### M6. Magic constants duplicated (`HV_THRESHOLD=100`, `STAFF_ROLES`, `ANALYSIS_TYPES`, `MONTHS`)
Spread across 4+ files.
**Fix:** `src/lib/constants.ts`.

### M7. `AnalysisType` defined in both `claude.ts:23` and `ai/analyze/route.ts:5-18` + `VALID_TYPES` runtime array
Three places for one union.
**Fix:** `const ANALYSIS_TYPES = [...] as const; type AnalysisType = typeof ANALYSIS_TYPES[number];`

### M8. `concession/route.ts` inline consts + result type
Business rules (`ECD_MONTHLY_MINIMUM`, etc.) never exported.
**Fix:** `src/lib/concession-types.ts`.

### M9. `DailySales`/`DailyImportResult`/`ImportResult` overlap in `counterpoint.ts:5-28`
Shared fields should be a base interface.

### M10. `NaN` passes `typeof === 'number'` guards in counterpoint parser
**File:** `src/lib/counterpoint.ts:74`
**Fix:** `Number.isFinite(salesVal)`.

### M11. `claude.ts` `extractKeyInsights`/`extractActionItems` only written to DB, never read
Either consume downstream or delete.

### M12. `flights/correlate/route.ts` appears unused
(simplifier flagged; verify with grep before deletion)

### M13. `sales/page.tsx` is 715 lines — extract `<SalesDropzone>` + shared upload handler
120-line reduction opportunity.

---

## LOW

- L1. `dayOff` field sometimes `string`, sometimes `undefined` (should be `string | undefined` in shared type, or omit key)
- L2. `hourly_breakdown: unknown` shipped client-side without shape definition
- L3. Month-name-to-number map duplicated between `counterpoint.ts` and `sales/page.tsx`
- L4. `selectModel` return type `string` instead of literal union
- L5. Non-null assertion `!` in `schedules/latest` bypasses compiler narrowing
- L6. `flights/day/route.ts` response shape not typed
- L7. `schedules/export` workbook `writeBuffer()` error not logged specifically
- L8. `concession/route.ts:74-75` truthy check conflates 0 with missing
- L9. `ai_confidence: coverageScore/100` — no NaN guard before DB insert

---

## Recommended fix order (for the ship pass)

**Tier 1 — code bugs that affect correctness today:**
1. C3 (Anthropic model IDs) — 3 lines, feature-dead without it
2. C4 (counterpoint transactional) — root of data corruption
3. C5 (DOW query scope + error check)
4. H12 (claude.ts content[0] crash + cast removal)
5. H13, H14 (unchecked `error` destructures)
6. H17 (year detection)
7. H7 (concession null-masking)
8. H8 (schedule delete error check)
9. H9 (notify wrong status code)

**Tier 2 — security / DoS surface:**
10. C2 (file size limit + instanceof File)
11. H10 (staff mass-assignment allow-list)
12. H11 (flights DELETE regex guard)
13. H6 (concession numeric validation)

**Tier 3 — observability:**
14. H1 (API error logging + generic responses)
15. H2 (frontend empty catches → error state)
16. H18 (sales page res.ok check)

**Tier 4 — structural (may partially defer):**
17. H19 (generated Supabase types) — high value, touches many files
18. H20 (Zod request schemas)
19. H3, H4, H5 (perf/tz cleanup)
20. C6 (ticket_count schema migration) — needs DB migration

**Non-code blockers still pending user decision:**
- C1 — authentication gate (Supabase Auth wiring)
- Credential rotation
- Railway deployment env vars

---

## Summary

| Severity | Count |
|---|---|
| Critical | 6 |
| High | 21 |
| Medium | 13 |
| Low | 9 |
| **Total** | **49** |

Runtime walkthrough confirmed all 5 pages render with 0 console errors and green API traces at the current data volume — so none of these bugs are actively visible in dev, but C3/C4/C5/C6 are correctness/data-corruption bombs that fire as soon as data grows, an AI request is made, or an import format shifts.
