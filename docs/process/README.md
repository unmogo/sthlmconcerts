# STHLM Concerts — Build Process

This directory contains process documents that guide autonomous development sessions.

## How It Works

⚠️ **Token budget rule**: Only check `backlog.md` and `questions.md` **once per week** (or when the human explicitly asks). Do NOT read them on every session — save tokens for actual work.

1. **Once a week** (or when asked), review `backlog.md` for priorities and `questions.md` for answered questions
2. **During work**, follow `process-cleanup.md` and other process docs for standards
3. **When blocked**, add questions to `questions.md` instead of stopping
4. **After completing work**, update `changelog.md` and move completed items in `backlog.md`
5. **If you discover issues**, add them to `backlog.md` with priority

## Files

| File | Purpose |
|------|---------|
| `backlog.md` | Prioritized task list — the single source of truth for what to build next |
| `questions.md` | Questions for the human — check here before starting, answer and clear regularly |
| `changelog.md` | Log of completed work with dates |
| `process-cleanup.md` | Data quality & scraper rules |
| `process-ui.md` | UI/UX conventions and design system rules |
| `process-edge-functions.md` | Edge function patterns and deployment notes |
| `architecture.md` | System architecture overview |

## Autonomous Build Rules

- Pick the top unclaimed item from `backlog.md`
- If a task is ambiguous, add a question to `questions.md` and move to the next task
- Never block on a question — always have a fallback task
- Update `changelog.md` after each completed task
- If you find a bug while working on something else, log it in `backlog.md`
