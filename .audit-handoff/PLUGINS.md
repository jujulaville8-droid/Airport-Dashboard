# Installed Plugins & What They Provide

All installed at user scope, enabled. After restarting Claude Code these will be available in the new session.

## Audit-focused (newly installed)

### `pr-review-toolkit@claude-plugins-official`
Comprehensive PR review agents. **This is the primary tool for the audit.**

Specialized agents (spawn via the Agent tool):
- **`code-reviewer`** — overall code quality and correctness review
- **`silent-failure-hunter`** — finds empty catches, swallowed errors, missing error handling
- **`type-design-analyzer`** — finds `any`, weak types, missing types, type-safety issues
- **`code-simplifier`** — finds dead code, over-engineering, unused abstractions
- **`comment-analyzer`** — finds stale/misleading comments
- **`pr-test-analyzer`** — test coverage gaps (less relevant — this project has no tests yet)

Slash command:
- **`/review-pr`** — runs multi-agent review on a PR (requires a PR to exist)

### `code-review@claude-plugins-official`
Multi-agent code review with confidence scoring.

Slash command:
- **`/code-review`** — runs full code review on current changes

### `security-guidance@claude-plugins-official`
Background hooks that fire on Edit/Write to warn about security issues (XSS, command injection, unsafe patterns). Works automatically — no command needed.

### `code-simplifier@claude-plugins-official` (standalone)
Standalone agent version of the code-simplifier. Simplifies and refines code while preserving functionality.

### `typescript-lsp@claude-plugins-official`
TypeScript language server integration for deeper cross-file type analysis, go-to-definition, find-references.

## Already had (from before this session)

### `playwright@claude-plugins-official`
Browser automation. Tools prefixed `mcp__plugin_playwright_playwright__*`:
- `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`
- `browser_click`, `browser_fill_form`, `browser_file_upload`
- `browser_console_messages` — **critical for audit** (grabs all console errors)
- `browser_network_requests` — **critical** (shows failed API calls)
- `browser_evaluate` — run arbitrary JS in page context

### `context7@claude-plugins-official`
Current documentation lookup. Tools prefixed `mcp__plugin_context7_context7__*`:
- `resolve-library-id` — find the library
- `query-docs` — fetch current docs

**Use this for Next.js 16, Supabase, and Anthropic SDK** — training data is older than these versions.

### `frontend-design@claude-plugins-official`
Frontend design skill (UI/UX critique, design system review).

### `aidesigner` (MCP, not a plugin)
`mcp__aidesigner__generate_design`, `refine_design` — for generating new UI mockups.

## How to use in the new session

**Spawn an agent:**
Use the Agent tool with `subagent_type` matching the agent name, e.g.:
```
Agent tool call:
  subagent_type: silent-failure-hunter
  description: Find silent failures
  prompt: [detailed task — see AUDIT_PLAN.md Phase 1]
```

**Run slash commands:**
Use the Skill tool:
```
Skill tool call:
  skill: code-review
```

**Spawn multiple agents in parallel:**
Send one message with multiple Agent tool calls — they run concurrently. See AUDIT_PLAN.md Phase 1 for the exact task prompts.
