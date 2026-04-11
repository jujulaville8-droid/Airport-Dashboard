# Remaining Audit Plan

The goal is production readiness by end of day. Run all of this in the fresh session.

## Phase 1 — Parallel static analysis (launch all at once)

Spawn these specialized agents in a single message with multiple Agent tool calls:

### A. `silent-failure-hunter` agent (from pr-review-toolkit)
**Task prompt:**
> Audit the entire `src/` directory for silent failures: empty catch blocks, unchecked Promise rejections, swallowed errors, missing error boundaries, and API routes that return 500 without logging. Focus especially on `src/app/api/**` and `src/lib/**`. Report file:line with the issue and suggested fix.

### B. `type-design-analyzer` agent (from pr-review-toolkit)
**Task prompt:**
> Audit `src/` for type safety issues: `any` usage, unnecessary `as` casts, weak union types, missing return types on exported functions, and places where discriminated unions would prevent runtime bugs. Focus on `src/lib/**` and `src/app/api/**`. Report file:line.

### C. `code-simplifier` agent (from pr-review-toolkit or code-simplifier plugin)
**Task prompt:**
> Find dead code, unused exports, unnecessary abstractions, and over-engineering across `src/`. Specifically look for: duplicate logic between counterpoint.ts and the API routes, unused helper functions, component props that are never read, state that's set but never consumed. Report file:line with a removal/simplification suggestion.

### D. `code-reviewer` agent (from pr-review-toolkit)
**Task prompt:**
> Review these files for correctness and logic bugs:
> - `src/app/dashboard/sales/page.tsx` (the big 715-line one with Today/Monthly tabs — hasn't been touched in audit yet)
> - `src/lib/counterpoint.ts` (known historical duplicate-prevention issues)
> - `src/lib/schedule.ts` (complex scheduling logic)
> - `src/lib/email.ts` (bi-weekly email generation)
> - All files in `src/app/api/**` (13 route handlers)
> Report file:line with issue and suggested fix.

### E. Manual check: credentials & secrets
Run `git status` and `git diff` to confirm `.env.local` is not staged. Grep the entire repo for any hardcoded API keys or credentials that might have leaked into source files.

## Phase 2 — Runtime audit with Playwright

**Setup:**
```bash
cd ~/Desktop/airport-gift-shop
npm run dev  # run in background
# Wait for "Ready on http://localhost:3000"
```

**Pages to walk through** (use playwright MCP tools):
1. `/` — root, verify redirect behavior
2. `/dashboard` — Overview. Check Concession widget populates, refresh button works, no console errors
3. `/dashboard/sales` — both Today and Monthly tabs. Test date picker, verify charts render
4. `/dashboard/flights` — verify uploaded months cards display, charts render for current month
5. `/dashboard/schedules` — verify bi-weekly schedule loads, try dragging a shift bar
6. `/dashboard/concession` — verify the month dropdown populates, calculation displays correctly

**For each page:**
- `mcp__plugin_playwright_playwright__browser_navigate` to the URL
- `mcp__plugin_playwright_playwright__browser_console_messages` to grab any errors/warnings
- `mcp__plugin_playwright_playwright__browser_network_requests` to check for failed API calls (4xx/5xx)
- `mcp__plugin_playwright_playwright__browser_snapshot` for DOM state
- `mcp__plugin_playwright_playwright__browser_take_screenshot` saved to `.audit-handoff/screenshots/<page>.png`

**Interactions to test:**
- Drag a shift bar on the Schedules page — verify persistence after reload
- Click the Overview refresh button — verify lastRefresh timestamp updates
- Switch months on Concession page — verify calculation updates
- Click "Upload Sales CSV" button — verify it routes to Sales page

## Phase 3 — Docs verification with context7

We're running **Next.js 16.2.2** which is past your training cutoff. Verify:

1. **Next.js 16 App Router route handlers** — especially the pattern used in `src/app/api/**`:
   - `export async function GET(request: NextRequest)` — still valid?
   - `request.nextUrl.searchParams.get()` — correct access pattern?
   - `Response.json()` return — still supported or should use `NextResponse`?
   - Run: `mcp__plugin_context7_context7__resolve-library-id` for "next.js", then `query-docs` for "route handlers app router 16"

2. **Supabase JS client** — verify `createClient` + service role key pattern in `src/lib/db.ts` matches current docs.

3. **Anthropic SDK** — `src/lib/flight-schedule.ts` uses `claude-haiku-4-5-20251001` model ID. Verify:
   - Model ID is still valid
   - `client.messages.create({ max_tokens: 10000 })` signature is current
   - `response.content[0].type === 'text'` access pattern

4. **AGENTS.md warning** — the project has this warning:
   > This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.
   
   **Before fixing anything**, read `node_modules/next/dist/docs/` for any topic you touch.

## Phase 4 — Consolidated report + auto-fix

Write everything found to `.audit-handoff/AUDIT_REPORT.md` with this structure:

```markdown
# Audit Report — YYYY-MM-DD

## Critical (blocks production)
- [ ] file:line — description — fix

## High (should fix before launch)
- [ ] ...

## Medium
- [ ] ...

## Low
- [ ] ...

## Not code issues (user decisions)
- Auth
- Credential rotation
- Deployment
```

Then **automatically fix everything in Critical and High** without asking. Run `npx next build` after fixes to verify.

## Phase 5 — Verification

After fixes:
1. `npx tsc --noEmit` — should be 0 errors
2. `npx eslint src` — should be 0 warnings
3. `npx next build` — should complete successfully
4. Re-run Playwright walk-through on any page that had fixes
5. Update `STATUS.md` with new state
