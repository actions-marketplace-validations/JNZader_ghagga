# Proposal: reviews-by-day

**Status**: approved
**Priority**: MEDIUM (Audit item #12)
**Author**: Claude Code
**Date**: 2026-03-07

## Intent

The `/api/stats` endpoint currently returns `reviewsByDay: []` (a stub). The dashboard's "Reviews Over Time" chart component (`ReviewChart`) checks for empty data and renders nothing. This is incomplete functionality visible to users.

## Scope

- **Affected packages**: `packages/db` (new query), `apps/server` (wire query into stats endpoint)
- **NOT affected**: `apps/dashboard` (already renders `DayStats[]` correctly), CLI, GitHub Action
- **Distribution modes**: SaaS only (server-only query using PostgreSQL)

## Approach

1. Add a `getReviewsByDay()` query function in `packages/db/src/queries.ts` using Drizzle ORM + raw SQL for `DATE()` grouping
2. Wire it into the `/api/stats` endpoint in `apps/server/src/routes/api.ts`, replacing the `[]` stub
3. The dashboard `DayStats` type expects `{ date: string; total: number; passed: number; failed: number; }` — the query must match this shape
4. Add tests in `apps/server/src/routes/api.test.ts`

## Key Decision: DayStats Shape

The requirements doc says `{ date, count }` but the dashboard's `DayStats` interface requires `{ date, total, passed, failed }`. We implement what the dashboard expects (`DayStats`) since the goal is to make the chart work without dashboard changes.

## Risks

- **Low**: Pure additive change — adding a query and replacing a stub. No breaking changes.
- **PostgreSQL-specific**: Uses `DATE()` cast which is PostgreSQL-only. This is acceptable since the server always uses PostgreSQL.

## Rollback Plan

Revert the two files to their previous state. The dashboard gracefully handles `reviewsByDay: []`.

## Acceptance Criteria

- [ ] `GET /api/stats?repo=owner/repo` returns `reviewsByDay` with actual data
- [ ] Data covers last 30 days, grouped by date, sorted ascending
- [ ] Each entry has `{ date, total, passed, failed }` matching `DayStats`
- [ ] Days with no reviews are omitted (sparse array)
- [ ] Tests cover: data present, empty repo, date grouping, ordering
- [ ] `pnpm exec turbo typecheck` passes
- [ ] `pnpm exec turbo test` passes
