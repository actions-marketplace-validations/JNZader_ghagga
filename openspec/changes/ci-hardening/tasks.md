# Tasks: CI Hardening

**Change ID**: ci-hardening
**Status**: in-progress
**Created**: 2026-03-07

## Task List

### Phase 1: CI Workflow Modifications

- [x] **T1**: Add `security` job to `.github/workflows/ci.yml`
  - Checkout, setup Node.js, setup pnpm, install deps
  - Run `pnpm audit --prod --audit-level=high`
  - `continue-on-error: true`, no job dependencies

- [x] **T2**: Modify `test` job for coverage reporting
  - Change `pnpm exec turbo test` to `pnpm exec turbo test:coverage`
  - Add step to upload coverage artifacts (7-day retention)
  - Use `actions/upload-artifact@v4`

- [x] **T3**: Add `mutation` job to `.github/workflows/ci.yml`
  - Only runs on push to main: `if: github.event_name == 'push'`
  - `needs: [test]`
  - `timeout-minutes: 30`
  - `continue-on-error: true`
  - Runs `pnpm exec stryker run` in `packages/core`
  - Uploads mutation report as artifact

### Phase 2: Verification

- [x] **T4**: Run `pnpm exec turbo typecheck` to verify no issues
- [x] **T5**: Review final ci.yml for correctness
