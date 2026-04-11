⚠️ OUTDATED — the production audit is done. See STATUS.md and SESSION_3_SUMMARY.md for current state and next-steps. Below is preserved for history.

---

Resume the production-readiness audit for The Tailor's Daughter (airport gift shop platform at ~/Desktop/airport-gift-shop).

Read these files first to get full context:
1. `.audit-handoff/STATUS.md` — what's already been fixed
2. `.audit-handoff/AUDIT_PLAN.md` — the remaining audit steps
3. `.audit-handoff/PLUGINS.md` — available plugins/agents

Then execute the audit plan. Specifically:

**Phase 1 — Static analysis (run in parallel):**
- Spawn the `silent-failure-hunter` agent on the full `src/` tree to find empty catch blocks, unchecked Promise rejects, and swallowed errors
- Spawn the `type-design-analyzer` agent to find `any` usage, weak types, and type-unsafe patterns
- Spawn the `code-simplifier` agent to find dead code, unused abstractions, and over-engineering
- Spawn the `code-reviewer` agent on the 5 dashboard pages and all API routes for correctness issues

**Phase 2 — Live runtime audit with Playwright:**
- Start the dev server (`npm run dev`) in the background
- Use Playwright MCP tools to navigate every page: `/dashboard`, `/dashboard/sales` (both tabs), `/dashboard/flights`, `/dashboard/schedules`, `/dashboard/concession`
- Capture browser console errors and network failures on each
- Take screenshots for visual regression reference
- Test key interactions: upload a sales file, generate a schedule, drag a shift bar, calculate concession

**Phase 3 — Docs verification with context7:**
- Check any Next.js 16 App Router patterns against current docs (we're on 16.2.2 — beyond training cutoff)
- Verify Supabase client usage against current docs
- Verify Anthropic SDK usage for the Haiku flight parser

**Phase 4 — Consolidated report:**
Produce a single markdown report at `.audit-handoff/AUDIT_REPORT.md` with:
- Critical issues (blockers for production)
- High-priority issues (should fix before launch)
- Medium/low-priority (nice-to-have)
- Each item should include: file:line, what's wrong, why it matters, suggested fix

After the report is written, fix everything marked Critical and High without asking, then run `npx next build` to verify nothing broke.

Do not ask clarifying questions. The user wants this production-ready by end of day.
