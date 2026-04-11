# Audit Handoff — The Tailor's Daughter

This folder contains everything needed to resume the production-readiness audit in a fresh Claude Code window after restarting to load newly-installed plugins.

## Files

- **RESUME_PROMPT.md** — Copy-paste this into the new Claude Code session to pick up exactly where we left off.
- **STATUS.md** — What's been fixed so far in this audit sprint.
- **AUDIT_PLAN.md** — The remaining audit steps, organized by plugin/agent to run.
- **PLUGINS.md** — List of installed plugins and what each provides.

## Quick start in new session

1. Open Claude Code in `~/Desktop/airport-gift-shop`
2. Paste the contents of `RESUME_PROMPT.md` as your first message
3. Claude will read STATUS + AUDIT_PLAN and begin the remaining audit
