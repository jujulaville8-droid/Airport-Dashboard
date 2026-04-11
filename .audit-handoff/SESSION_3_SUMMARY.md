# Session 3 Summary — Auth, Polish, Inventory

**Date:** 2026-04-09 → 2026-04-10
**Build status:** ✅ `npx next build` clean (0 TS errors, 0 lint warnings)
**Runtime:** All pages render 200, 0 console errors

---

## 1. Single-user authentication

Replaced the initial Supabase Auth magic-link scaffold with a simpler username/password gate since this is a single-tenant ops dashboard.

**Credentials:** `admin` / `1tailor`

### Architecture

- [src/lib/auth.ts](../src/lib/auth.ts) — HMAC-SHA256 signed session cookie using Web Crypto (Edge-runtime compatible, works in the proxy). Constant-time credential check. 30-day max age. Rotating `AUTH_SECRET` invalidates all sessions.
- [src/proxy.ts](../src/proxy.ts) — single authorization boundary. Runs on every request. `/api/*` routes get 401 JSON; pages get redirected to `/login?next=...`. Public paths: `/login`, `/auth/*`, `/favicon.ico`.
- [src/app/login/page.tsx](../src/app/login/page.tsx) — username/password form, Suspense-wrapped for Next 16, hard `window.location.href` navigation after login so the browser sends the fresh cookie on first request.
- [src/app/auth/login/route.ts](../src/app/auth/login/route.ts) — validates credentials, sets `tdash_session` HTTPonly SameSite=Lax cookie.
- [src/app/auth/signout/route.ts](../src/app/auth/signout/route.ts) — POST-only, clears cookie, redirects to `/login`.
- [src/components/Sidebar.tsx](../src/components/Sidebar.tsx) — shows logged-in username with sign-out button.
- [src/app/dashboard/layout.tsx](../src/app/dashboard/layout.tsx) — reads username from signed cookie to display in sidebar.

### Env vars added to `.env.local`

```
AUTH_USERNAME=admin
AUTH_PASSWORD=1tailor
AUTH_SECRET=2b30442c78b4280bcfffb4ba2ea07faf066f2346bfc00663a1fe43a8a0e5b657
```

### Deleted (previous Supabase Auth scaffold, no longer used)

- `src/lib/supabase-browser.ts`
- `src/lib/supabase-server.ts`
- `src/app/auth/callback/route.ts`
- `@supabase/ssr` package (uninstalled)

### C1 status
The session-2 audit flagged "no authentication on any API route" as C1 (ship-blocker). **C1 is now closed.** The proxy is the single authorization boundary; every non-public route requires a valid signed session cookie.

---

## 2. Next.js 16 proxy migration

Next.js 16 renamed `middleware.ts` → `proxy.ts` and `middleware` function → `proxy`. Migrated per `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`. Eliminates the deprecation warning; behavior is identical.

---

## 3. UI jumpiness fix

**Symptom:** Dashboard pages flickered when data loaded — sections started `opacity-0`, anime.js entrance animations re-fired every time a state variable changed.

**Root cause:**
- Overview page animated on mount before data loaded → empty skeleton animated, then content popped in
- Sales / Flights / Concession pages had animation `useEffect` deps that included data state (`[dayData, salesData, ...]`) → full fade-in re-triggered on every update

**Fix:** Added `animatedRef = useRef(false)` to each page. Animation fires exactly once after first meaningful data load:
- [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx) — waits for `loading === false`
- [src/app/dashboard/sales/page.tsx](../src/app/dashboard/sales/page.tsx) — waits for `dayData || salesData || uploadedMonths`
- [src/app/dashboard/flights/page.tsx](../src/app/dashboard/flights/page.tsx) — waits for `analytics || uploadedMonths`
- [src/app/dashboard/concession/page.tsx](../src/app/dashboard/concession/page.tsx) — waits for `data`
- [src/app/dashboard/schedules/page.tsx](../src/app/dashboard/schedules/page.tsx) — entrance fires once, result sections fire once on first `scheduleData`

**Fallback:** Added `@keyframes fadeInFallback` in [src/app/globals.css](../src/app/globals.css) that auto-reveals `.anime-section` / `.anime-result` after 1.2s even if JS doesn't fire. Prevents permanently invisible content.

---

## 4. Inventory Intelligence feature (Phases 1-3 of the roadmap)

Full spec in `/Users/julianlaville/.claude/plans/tingly-moseying-bird.md`. Summary of what shipped:

### Schema — [supabase/migrations/001_inventory.sql](../supabase/migrations/001_inventory.sql)

Applied to Supabase project `ubacwceiwgooqkbqjnzg` via the SQL editor.

- `item_master` — SKU catalog (item_no PK, descr, categ_cod, subcat_cod, unit_cost, unit_price, first_seen_at, last_seen_at, is_active)
- `inventory_snapshots` — point-in-time stock levels (UNIQUE on snapshot_date + item_no)
- `reorder_rules` — per-SKU min/reorder_point/max/lead_time_days
- Composite index `idx_line_items_item_ticket` on existing `sales_line_items(item_no, tkt_no)` for velocity queries

### Parsers (both detect columns by header NAME, not magic index)

- [src/lib/counterpoint-items.ts](../src/lib/counterpoint-items.ts) — parses Counterpoint Item Sales Analysis. Writes one row per (ticket, item) to `sales_line_items`, upserts `item_master`. Creates stub `sales_transactions` rows when a real ticket column isn't present so the FK constraint holds. Transactional abort pattern matches the hardened counterpoint.ts from session 2.
- [src/lib/counterpoint-inventory.ts](../src/lib/counterpoint-inventory.ts) — parses Counterpoint Inventory Valuation / Stock On Hand. Writes one `inventory_snapshots` row per SKU per snapshot_date. Upserts latest `unit_cost` to `item_master`.

### Shared date utils — [src/lib/date-utils.ts](../src/lib/date-utils.ts)

New file extracting `MONTHS`, `MONTH_NAMES`, `addDays()`, `todayYmd()`, `lastDayOfMonth()`. Replaces 4 duplicated copies across the codebase (audit M6, L3).

### Analytics engine — [src/lib/inventory-analytics.ts](../src/lib/inventory-analytics.ts)

- `computeRiskSummary(velocityWindowDays)` — single-pass computation over all SKUs. Returns grouped critical / at-risk / healthy / dead-stock / overstocked lists plus summary counts.
- `getItemSalesHistory(itemNo, days)` — 90-day daily sales for the item detail drawer.
- Classification rules:
  - `DEAD_STOCK` — zero sales in 30+ days AND stock > 0
  - `CRITICAL` — stock ≤ min_stock OR days-of-cover < lead_time/2
  - `AT_RISK` — stock ≤ reorder_point OR days-of-cover < lead_time
  - `OVERSTOCKED` — stock > max_stock
  - `HEALTHY` — default
- Uses single range queries (snapshot join + sales window), bucketed in JS. No N+1. Bounded by 30-day window on sales.

### API routes

- [POST /api/items/import](../src/app/api/items/import/route.ts) — upload item sales XLS (10MB cap, instanceof File guard)
- [POST /api/inventory/snapshot](../src/app/api/inventory/snapshot/route.ts) — upload stock snapshot, accepts optional `snapshotDate` for backfill
- [GET /api/inventory/risk](../src/app/api/inventory/risk/route.ts) — returns full risk summary, optional `?window=N` param (1-90)
- [GET /api/inventory/item?itemNo=...](../src/app/api/inventory/item/route.ts) — item detail with master, snapshots, rule, 90-day sales history
- [GET / PUT /api/inventory/rules](../src/app/api/inventory/rules/route.ts) — reorder rules CRUD with allow-list pattern from staff route

### Dashboard — [src/app/dashboard/inventory/page.tsx](../src/app/dashboard/inventory/page.tsx)

- Summary cards: Critical / Dead stock / Overstocked / Total value
- AI Restock Briefing section with "Generate Weekly Briefing" button
- Risk tables per class (critical, at-risk, dead stock, overstocked) with top-50 rows
- Click row → slide-out drawer with:
  - Item description + category/subcategory badges
  - Last 5 stock snapshots
  - 90-day sales history (scrollable)
  - Reorder rules editor (min / reorder_point / max / lead_time_days)
- Two upload buttons in header: "Upload Item Sales" (secondary) + "Upload Stock Snapshot" (primary)
- Empty state when no snapshots exist

### AI — restock briefing analysis type

- [src/lib/claude.ts](../src/lib/claude.ts) — added `'restock_briefing'` to `AnalysisType` union. Uses Sonnet model, 1500 max tokens. Structured prompt with 5 sections: ORDER NOW / WATCH LIST / DISCOUNT CLEAR / DEMAND OUTLOOK / RISK FLAGS.
- [src/app/api/ai/analyze/route.ts](../src/app/api/ai/analyze/route.ts) — new `restock_briefing` case. Inputs: trimmed risk summary (top 25 critical + at-risk, top 15 dead stock) + next 7 days of flight departures aggregated by date.

### Integrations

- [src/components/Sidebar.tsx](../src/components/Sidebar.tsx) — new `Inventory` nav entry between Sales and Flights, Phosphor `Package` icon
- [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx) — new Inventory Alerts widget on Overview above the flights row. Only renders when there's snapshot data and at least one risk flag. Shows critical count / at-risk count / dead stock $. Click-through to inventory page.

---

## Files touched this session

### New files
```
src/lib/auth.ts                                NEW (HMAC session cookie)
src/lib/date-utils.ts                          NEW (shared date helpers)
src/lib/counterpoint-items.ts                  NEW (item sales parser)
src/lib/counterpoint-inventory.ts              NEW (stock snapshot parser)
src/lib/inventory-analytics.ts                 NEW (velocity + risk engine)
src/proxy.ts                                   NEW (ex-middleware)
src/app/login/page.tsx                         NEW
src/app/auth/login/route.ts                    NEW
src/app/auth/signout/route.ts                  NEW
src/app/api/items/import/route.ts              NEW
src/app/api/inventory/snapshot/route.ts        NEW
src/app/api/inventory/risk/route.ts            NEW
src/app/api/inventory/item/route.ts            NEW
src/app/api/inventory/rules/route.ts           NEW
src/app/dashboard/inventory/page.tsx           NEW
supabase/migrations/001_inventory.sql          NEW (applied)
.audit-handoff/AUDIT_REPORT.md                 NEW (session 2 audit)
.audit-handoff/SESSION_3_SUMMARY.md            NEW (this file)
```

### Modified
```
src/lib/claude.ts                              + restock_briefing type
src/app/api/ai/analyze/route.ts                + restock_briefing case
src/components/Sidebar.tsx                     + inventory nav, signout
src/app/dashboard/layout.tsx                   reads session from cookie
src/app/dashboard/page.tsx                     + inventory alerts widget, animation fire-once
src/app/dashboard/sales/page.tsx               animation fire-once
src/app/dashboard/flights/page.tsx             animation fire-once
src/app/dashboard/concession/page.tsx          animation fire-once
src/app/dashboard/schedules/page.tsx           animation fire-once
src/app/globals.css                            + fadeInFallback keyframes
```

### Deleted
```
src/lib/supabase-browser.ts                    (replaced by auth.ts)
src/lib/supabase-server.ts                     (replaced by auth.ts)
src/app/auth/callback/route.ts                 (magic-link flow dropped)
```

---

## What's pending

### From session 2 audit (not yet addressed)

- **C6** — `cust_no` schema hack storing ticket counts. Needs a proper `ticket_count INTEGER` column migration. Time-bomb for data loss.
- **H19** — Generated Supabase types (`npx supabase gen types typescript`). Would eliminate ~30 casts. Multi-file but high value.
- **H20** — Zod request body schemas for API routes. Structural improvement.
- **Credential rotation** — `.env.local` contains live Supabase service-role key, Anthropic key, Gmail OAuth secret + refresh token. Rotate before any deploy or if you share the file.

### Inventory feature — Phase 4 (documented but not built)

Per `/Users/julianlaville/.claude/plans/tingly-moseying-bird.md`:
- Bundle recommendations grounded in real SKU data (market-basket analysis)
- Category-level gross margin dashboard (now possible with `unit_cost`)
- Flight-correlated item demand (join `sales_line_items` × `flight_data`)
- Shrink detection (diff between expected and actual next snapshot)
- Weekly email digest of restock list (reuse existing Gmail OAuth)

### UI polish (user flagged but not implemented)

User said the Playfair Display serif numbers feel "not official enough" — too boutique, not enough business-tool gravitas. Discussion about going more institutional (Source Serif / Tiempos), or Stripe/Linear/Bloomberg-style (monospace numbers + Inter), or tighter layout, or flatter color palette. **No design decision made yet.** Next step: use AIDesigner MCP to generate 2 alternative directions.

### Deployment

Still on localhost. Ready for Vercel or Railway. Before deploying:
1. Rotate credentials
2. Update Supabase dashboard Site URL + Redirect URLs (for future if reintroducing email OTP flow — currently not used)
3. Set env vars in hosting dashboard including `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_SECRET`, and all existing ones
