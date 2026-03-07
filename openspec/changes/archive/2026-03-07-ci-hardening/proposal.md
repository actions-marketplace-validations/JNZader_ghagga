# Proposal: CI Hardening

**Change ID**: ci-hardening
**Status**: approved
**Created**: 2026-03-07

## Intent

Harden the CI pipeline by addressing three gaps identified in the v2.2.0 audit:
1. No security scanning for dependency vulnerabilities (audit #5)
2. No coverage reporting in CI (audit #6)
3. No mutation testing on main branch (audit #11)

## Scope

All changes are confined to CI configuration and workflow files:
- `.github/workflows/ci.yml` — add security job, enhance test job with coverage, add mutation job

No application code changes required. All workspace packages already have `test:coverage` scripts and the turbo.json already defines the `test:coverage` task.

## Approach

1. **Security scanning**: New `security` job running `pnpm audit --prod --audit-level=high` with `continue-on-error: true` (advisory-only, no gate)
2. **Coverage reporting**: Modify existing `test` job to run `test:coverage` instead of `test`, upload coverage directories as CI artifacts
3. **Mutation testing**: New `mutation` job running Stryker on `packages/core` only, triggered only on pushes to main, gated behind `needs: [test]`, with 30-minute timeout and `continue-on-error: true`

## Risks

- **Low**: `pnpm audit` may report existing advisories that cannot be immediately resolved — mitigated by `continue-on-error`
- **Low**: Coverage upload increases artifact storage — mitigated by 7-day retention
- **Medium**: Stryker can be slow on large codebases — mitigated by 30-minute timeout and main-only trigger

## Acceptance Criteria

- [ ] `security` job runs `pnpm audit --prod --audit-level=high` on every CI trigger
- [ ] `test` job generates coverage reports and uploads them as artifacts
- [ ] `mutation` job runs Stryker on `packages/core` only on pushes to main
- [ ] No external service dependencies (no Codecov token, no SonarCloud)
- [ ] All new jobs use `continue-on-error: true` where appropriate
- [ ] CI still passes typecheck after changes
