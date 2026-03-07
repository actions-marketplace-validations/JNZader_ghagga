# Tasks: CLI Git Hooks — Pre-Commit and Commit-Msg Review

## Phase 1: Foundation — Types, Utilities, and Templates

- [ ] 1.1 Extend `ReviewOptions` in `apps/cli/src/commands/review.ts` with `staged: boolean`, `commitMsg?: string`, `exitOnIssues: boolean`, `quick: boolean` fields. Extend `ReviewCommandOptions` in `apps/cli/src/index.ts` with the same four fields.
- [ ] 1.2 Create `apps/cli/src/commands/hooks/git-utils.ts` with `findGitRoot(cwd)`, `getHooksDir(gitRoot)`, `hasGhaggaMarker(hookPath)`, and `getCoreHooksPath(gitRoot)`. Pure fs/execSync helpers, isolated for testing. Follow `execSync` pattern from `apps/cli/src/lib/git.ts`.
- [ ] 1.3 Create `apps/cli/src/commands/hooks/templates.ts` with `GHAGGA_HOOK_MARKER` constant, `generatePreCommitHook(opts: HookTemplateOptions)`, and `generateCommitMsgHook()`. Templates must include `#!/bin/sh`, the marker comment, `ghagga` PATH check with graceful degradation (warn + exit 0), and `${GHAGGA_HOOK_ARGS:-}` support. Pre-commit includes `--quick` conditionally.
- [ ] 1.4 Add `getStagedDiff(repoPath)` and `getStagedFileList(repoPath)` helper functions to `apps/cli/src/lib/git.ts`. Uses `git diff --cached` and `git diff --cached --name-only` respectively.

## Phase 2: Core Implementation — Review Command Extensions

- [ ] 2.1 Add `--staged`, `--commit-msg <file>`, `--exit-on-issues`, and `--quick` options to the `review` command in `apps/cli/src/index.ts` (`.option(...)` calls). Wire the parsed options through to `reviewCommand()` — map `staged`, `commitMsg`, `exitOnIssues`, `quick` fields.
- [ ] 2.2 Add mutual exclusivity check in `reviewCommand()` in `apps/cli/src/commands/review.ts`: if both `--staged` and `--commit-msg` are set, print error via `tui.log.error()` and `process.exit(1)`. Place check before any pipeline work.
- [ ] 2.3 Modify `reviewCommand()` in `apps/cli/src/commands/review.ts` to handle `--staged` flag: when `options.staged` is true, call `getStagedDiff(repoPath)` from `lib/git.ts` instead of `getGitDiff(repoPath)`. The rest of the pipeline receives the diff string as before.
- [ ] 2.4 Modify `reviewCommand()` in `apps/cli/src/commands/review.ts` to handle `--quick` flag: when `options.quick` is true, pass `aiReviewEnabled: false` to `reviewPipeline()`. Maps to the existing `aiReviewEnabled` mechanism in `packages/core/src/pipeline.ts`. Also skip API key validation when `--quick` is set (static analysis needs no key).
- [ ] 2.5 Create `apps/cli/src/commands/review-commit-msg.ts` with `reviewCommitMessage(opts: CommitMsgReviewOptions): Promise<ReviewResult>`. Read the message string, validate non-empty and length > 3 chars (heuristics), then call a single LLM prompt for commit message quality. When `quick` is true, skip LLM and use heuristics only. Return a `ReviewResult`-compatible object with findings.
- [ ] 2.6 Modify `reviewCommand()` in `apps/cli/src/commands/review.ts` to handle `--commit-msg <file>` flag: when `options.commitMsg` is set, read the file with `readFileSync`, call `reviewCommitMessage()`, output the result, and skip the file-based review pipeline entirely.
- [ ] 2.7 Add `resolveExitCode(result, exitOnIssues)` function in `apps/cli/src/commands/review.ts`. When `exitOnIssues` is true, check `result.findings.some(f => f.severity === 'critical' || f.severity === 'high')` — return 1 if true, 0 if false. When `exitOnIssues` is false, delegate to the existing `getExitCode(result.status)`. Replace the direct `getExitCode()` call in `reviewCommand()` with `resolveExitCode()`.

## Phase 3: Hooks Command Group — Install, Uninstall, Status

- [ ] 3.1 Create `apps/cli/src/commands/hooks/index.ts` following `memory/index.ts` pattern. Export `hooksCommand` as a `Command('hooks')` with description. Register `install`, `uninstall`, and `status` subcommands.
- [ ] 3.2 Create `apps/cli/src/commands/hooks/install.ts` with `registerInstallCommand(parent)`. Options: `--quick`, `--no-pre-commit`, `--no-commit-msg`, `--force`. Logic: find git root → check `core.hooksPath` (warn if set, exit 1 unless `--force`) → for each hook: check existing file → if non-GHAGGA and no `--force`, error → if non-GHAGGA and `--force`, backup to `.ghagga-backup` → if GHAGGA, overwrite → generate script from templates → write file → `chmod +x` → print summary.
- [ ] 3.3 Create `apps/cli/src/commands/hooks/uninstall.ts` with `registerUninstallCommand(parent)`. Logic: find git root → for each hook (`pre-commit`, `commit-msg`): check file exists → check GHAGGA marker → if GHAGGA, delete → if backup exists, restore from `.ghagga-backup` → if not GHAGGA, warn and skip → print summary.
- [ ] 3.4 Create `apps/cli/src/commands/hooks/status.ts` with `registerStatusCommand(parent)`. Logic: find git root → for each hook: check file exists → check GHAGGA marker → detect `--quick` in content → report installed/not-installed/foreign via `tui.log.*`. Follow styled/plain mode pattern.
- [ ] 3.5 Register `hooksCommand` in `apps/cli/src/index.ts`: import from `./commands/hooks/index.js` and add `program.addCommand(hooksCommand)` alongside the existing `memoryCommand` registration.

## Phase 4: Testing

- [ ] 4.1 Create `apps/cli/src/commands/hooks/templates.test.ts`. Test `generatePreCommitHook` and `generateCommitMsgHook`: verify shebang, GHAGGA marker, `--staged --exit-on-issues --plain` flags, `${GHAGGA_HOOK_ARGS:-}`, `--quick` variant, and PATH check for graceful degradation. Pure function tests, no mocks needed.
- [ ] 4.2 Create `apps/cli/src/commands/hooks/git-utils.test.ts`. Mock `execSync` and `readFileSync`. Test `findGitRoot` (found, not found), `getHooksDir`, `hasGhaggaMarker` (with marker, without marker, file missing), `getCoreHooksPath` (set, not set). Follow `vi.mock`/`vi.hoisted` pattern from `memory/clear.test.ts`.
- [ ] 4.3 Create `apps/cli/src/commands/hooks/install.test.ts`. Mock `fs`, `git-utils`, `templates`. Test: fresh install (both hooks), idempotent reinstall (GHAGGA hook exists), backup of non-GHAGGA hook with `--force`, refusal without `--force` when non-GHAGGA exists, `--no-pre-commit`, `--no-commit-msg`, `--quick` flag baked into template, `core.hooksPath` warning, not a git repo error. Follow Commander `parseAsync` pattern.
- [ ] 4.4 Create `apps/cli/src/commands/hooks/uninstall.test.ts`. Mock `fs`, `git-utils`. Test: uninstall both GHAGGA hooks, restore backup, skip non-GHAGGA hooks, no hooks installed, not a git repo error.
- [ ] 4.5 Create `apps/cli/src/commands/hooks/status.test.ts`. Mock `fs`, `git-utils`. Test: both hooks installed, no hooks, mixed (one GHAGGA + one foreign), detect `--quick` in hook content.
- [ ] 4.6 Create `apps/cli/src/commands/review-commit-msg.test.ts`. Mock LLM provider. Test: valid commit message (PASSED), low-quality message "fix" (FAILED with high severity), empty message (FAILED), quick mode uses heuristics only (no LLM call). Verify `ReviewResult` structure.
- [ ] 4.7 Extend `apps/cli/src/commands/review.test.ts` with new test cases: `--staged` uses staged diff, `--quick` passes `aiReviewEnabled: false`, `--exit-on-issues` exits 1 on critical findings and 0 on medium-only, `--commit-msg` calls `reviewCommitMessage()`, mutual exclusivity error for `--staged --commit-msg` together, `--quick` skips API key validation.
- [ ] 4.8 Run full test suite (`vitest run`) and verify all existing tests still pass with zero regressions.

## Phase 5: Integration Verification and Cleanup

- [ ] 5.1 Manual integration test: create a temp git repo, run `ghagga hooks install`, verify `.git/hooks/pre-commit` and `.git/hooks/commit-msg` exist with correct content and are executable. Run `ghagga hooks status`. Run `ghagga hooks uninstall`, verify hooks removed.
- [ ] 5.2 Verify `ghagga --help` lists `hooks` command, `ghagga hooks --help` lists all three subcommands, `ghagga hooks install --help` documents all options, `ghagga review --help` documents all four new flags.
- [ ] 5.3 Verify existing `ghagga review .` behavior is unchanged: run without new flags and confirm identical output/exit-code to pre-change behavior. Confirm all pre-existing flags still work.
