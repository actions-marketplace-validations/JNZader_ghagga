# Design: CLI Git Hooks — Pre-Commit and Commit-Msg Review

## Technical Approach

Add git hook management and hook-oriented review flags to the GHAGGA CLI. The design follows two parallel tracks:

1. **`hooks` command group** — new `install`, `uninstall`, and `status` subcommands under `ghagga hooks`, following the exact pattern established by `apps/cli/src/commands/memory/index.ts`.
2. **Review command extensions** — four new flags (`--staged`, `--commit-msg`, `--exit-on-issues`, `--quick`) added to the existing `review` command. These flags compose with existing flags and are the mechanism the hook scripts invoke.

The core pipeline (`packages/core/src/pipeline.ts`) already supports `aiReviewEnabled: false` for static-only mode, so `--quick` maps directly to that. The `--staged` flag is handled entirely in the CLI layer (different `git diff` invocation), and `--commit-msg` introduces a new lightweight review mode that bypasses the file-based pipeline entirely.

No new npm dependencies are required. Hook scripts are plain POSIX shell strings generated at install time.

## Architecture Decisions

### Decision: Hook Scripts as Embedded String Templates

**Choice**: Generate hook scripts from TypeScript string template functions in `apps/cli/src/commands/hooks/templates.ts`. No external template files.

**Alternatives considered**: (a) Ship `.sh` files in the package and copy them; (b) Use a template engine like Handlebars/Mustache.

**Rationale**: The hook scripts are 5-10 lines each. String templates are trivially testable (assert output contains expected flags), require no file resolution logic, and survive `ncc` bundling without any special config. Shipping `.sh` files would require `__dirname` resolution that breaks under ncc. A template engine is overkill for two small scripts.

### Decision: Diff Source Selection in CLI Layer Only

**Choice**: The `--staged` flag modifies the diff acquisition in `apps/cli/src/commands/review.ts` before calling `reviewPipeline()`. The core pipeline receives a diff string and doesn't know whether it came from staged changes, HEAD, or a PR.

**Alternatives considered**: (a) Add a `staged` field to `ReviewInput` and let the core pipeline call git; (b) Add a `diffSource` abstraction to the core.

**Rationale**: The core pipeline is deliberately transport-agnostic — it receives a diff string, not a git reference. The CLI already has `getGitDiff()` that calls `execSync('git diff ...')`. Adding `--staged` is a one-line change to that function (use `git diff --staged` unconditionally when the flag is set). Pushing git knowledge into the core would violate the existing architecture boundary. The server and GitHub Action adapters provide diffs from completely different sources.

### Decision: `--commit-msg` as a Separate Review Path (Not the Pipeline)

**Choice**: When `--commit-msg <file>` is passed, skip the file-based review pipeline entirely. Read the commit message from the file, run a dedicated LLM prompt for commit message quality, and output the result. Static analysis tools are not run.

**Alternatives considered**: (a) Route through `reviewPipeline()` with the commit message as the "diff"; (b) Add a `commitMessage` field to `ReviewInput` and handle it inside the pipeline.

**Rationale**: The review pipeline is designed for code diffs — it parses diff files, detects stacks, runs Semgrep/Trivy/CPD, and feeds code context to the LLM. None of that applies to commit message validation. Routing a commit message through `reviewPipeline()` would hit the "No changes detected" exit path or produce nonsensical static analysis results. A separate function (`reviewCommitMessage()`) is cleaner: it reads the file, validates basic format (length, empty check), calls one LLM prompt, and returns a `ReviewResult`-compatible structure for consistent exit-code handling.

### Decision: `--exit-on-issues` Controlled in CLI Layer

**Choice**: After `reviewPipeline()` returns (or after `reviewCommitMessage()` returns), check findings for `critical` or `high` severity. If any exist and `--exit-on-issues` is set, exit with code 1. Otherwise exit with code 0.

**Alternatives considered**: (a) Change `getExitCode()` to always exit 1 on FAILED; (b) Add an `exitOnIssues` field to `ReviewInput`.

**Rationale**: The current `getExitCode()` already exits 1 on `FAILED` status — but `FAILED` is set by the AI agent based on its assessment. `--exit-on-issues` needs a deterministic check: scan `result.findings` for `severity === 'critical' || severity === 'high'`. This is a CLI-layer concern (process exit codes), not a core concern. The core pipeline doesn't know about process exit codes. The check happens right after the pipeline returns, overriding the default exit code logic when the flag is active.

### Decision: `--quick` Maps to `aiReviewEnabled: false`

**Choice**: When `--quick` is set, pass `aiReviewEnabled: false` to the review pipeline. This skips all LLM calls and returns only static analysis results.

**Alternatives considered**: (a) Add a new `mode: 'quick'` to `ReviewMode`; (b) Add a `skipAi` boolean to `ReviewSettings`.

**Rationale**: The pipeline already supports `aiReviewEnabled: false` — it was added for the SaaS server to support plans without AI access. The `--quick` flag is the CLI-facing name for this existing capability. No core changes needed. The `resolveAiEnabled()` function in `pipeline.ts:279` already handles this. Adding a new mode would require exhaustive switch cases in all agent files.

### Decision: Hook Marker Comment for Identification

**Choice**: Use `# GHAGGA HOOK` as the marker comment on line 2 of every generated hook script. `uninstall` checks for this exact string.

**Alternatives considered**: (a) Use a JSON metadata comment; (b) Write a `.ghagga-hooks.json` manifest alongside hooks; (c) Use a UUID marker.

**Rationale**: The proposal already specifies `# GHAGGA HOOK`. A single grep-able string is the simplest detection mechanism. No manifest files to get out of sync. No UUID collision concerns. Standard practice in the ecosystem (Husky uses `# husky`, pre-commit uses `# pre-commit`).

### Decision: `status` Subcommand for Hook Inspection

**Choice**: Add `ghagga hooks status` that reports which hooks are installed, whether they have the GHAGGA marker, and whether backups exist. This was not explicitly in the proposal but follows from the pattern: any command group with `install` / `uninstall` benefits from a `status` check.

**Alternatives considered**: (a) Only `install` and `uninstall` with no status; (b) `ghagga hooks list`.

**Rationale**: `status` provides a non-destructive way to debug hook issues ("why isn't my hook running?"). It reads `.git/hooks/pre-commit` and `.git/hooks/commit-msg`, checks for the marker, and reports. Minimal implementation cost, high debugging value.

### Decision: Backup Strategy — `<hook>.ghagga-backup`

**Choice**: When `install` finds an existing hook without the GHAGGA marker, rename it to `<hook>.ghagga-backup` (e.g., `.git/hooks/pre-commit.ghagga-backup`). When `uninstall` runs, restore the backup if it exists.

**Alternatives considered**: (a) Append to existing hook (chain hooks); (b) Refuse to install if hook exists (require `--force`).

**Rationale**: Backup-and-replace is the simplest strategy. Chaining hooks is fragile (what if the existing hook exits non-zero?). Refusing without `--force` is hostile for first-time users. The backup can be restored on `uninstall`, giving clean round-trip behavior. If the existing hook already has the GHAGGA marker, `install` overwrites it (idempotent reinstall) without creating a backup.

### Decision: `--force` on `install` Only for Overwriting GHAGGA Hooks

**Choice**: `install` is idempotent — running it twice overwrites the GHAGGA hook with the latest version. Non-GHAGGA hooks are always backed up. `--force` is reserved for skipping the `core.hooksPath` warning.

**Alternatives considered**: (a) `--force` to skip backup; (b) `--force` to overwrite non-GHAGGA hooks without backup.

**Rationale**: Destroying a user's existing hook without backup is never acceptable. `--force` addresses a different concern: if `core.hooksPath` is set (Husky), `install` warns and exits. `--force` overrides this to write to `.git/hooks/` anyway, acknowledging the user understands the hooks may not run.

## Data Flow

### Pre-Commit Hook Flow

```
git commit
  └─ .git/hooks/pre-commit  (shell script)
       └─ ghagga review --staged --exit-on-issues --plain
            │
            ├─ CLI: getGitDiff(repoPath, { staged: true })
            │     └─ execSync('git diff --staged')  →  diff string
            │
            ├─ CLI: reviewCommand() calls reviewPipeline({
            │     diff,
            │     aiReviewEnabled: false,  ← (if --quick)
            │     settings,
            │     ...
            │   })
            │
            ├─ Core: Parse diff → filter files → run static analysis
            │     └─ (if AI enabled) Run agent → return ReviewResult
            │
            ├─ CLI: Check --exit-on-issues
            │     └─ findings.some(f => f.severity === 'critical' || f.severity === 'high')
            │           ├─ true  → process.exit(1)  →  git commit BLOCKED
            │           └─ false → process.exit(0)  →  git commit PROCEEDS
            │
            └─ Memory: Persist observations to SQLite (async, non-blocking)
```

### Commit-Msg Hook Flow

```
git commit
  └─ .git/hooks/commit-msg "$1"  (shell script, $1 = .git/COMMIT_EDITMSG)
       └─ ghagga review --commit-msg .git/COMMIT_EDITMSG --exit-on-issues --plain
            │
            ├─ CLI: readFileSync(commitMsgFile)  →  commit message string
            │
            ├─ CLI: reviewCommitMessage({
            │     message,
            │     provider, model, apiKey,
            │   })
            │     ├─ Validate: non-empty, length > 3 chars
            │     ├─ LLM prompt: "Evaluate this commit message..."
            │     └─ Return ReviewResult with findings
            │
            ├─ CLI: Check --exit-on-issues (same logic as pre-commit)
            │     ├─ critical/high → exit(1) → commit BLOCKED
            │     └─ else → exit(0) → commit PROCEEDS
            │
            └─ No memory persistence (commit messages are ephemeral)
```

### Hook Install Flow

```
ghagga hooks install [--quick] [--no-commit-msg] [--no-pre-commit] [--force]
  │
  ├─ Detect .git directory (find git root)
  │     └─ Not found → error + exit(1)
  │
  ├─ Check core.hooksPath
  │     └─ Set (e.g., Husky) → warn, exit(1) unless --force
  │
  ├─ For each hook (pre-commit, commit-msg):
  │     ├─ Skip if --no-pre-commit / --no-commit-msg
  │     ├─ Check .git/hooks/<hook> exists
  │     │     ├─ Has GHAGGA marker → overwrite (idempotent)
  │     │     └─ No marker → backup to <hook>.ghagga-backup
  │     ├─ Generate script from template (with --quick flag baked in)
  │     ├─ Write to .git/hooks/<hook>
  │     └─ chmod +x .git/hooks/<hook>
  │
  └─ Print summary: "Installed N hook(s) to .git/hooks/"
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/cli/src/commands/hooks/index.ts` | Create | Command group barrel — creates `Command('hooks')`, registers `install`, `uninstall`, `status` subcommands. Follows `memory/index.ts` pattern exactly. |
| `apps/cli/src/commands/hooks/install.ts` | Create | `registerInstallCommand(parent)` — generates hook scripts from templates, writes to `.git/hooks/`, handles backup of existing hooks, detects `core.hooksPath`. |
| `apps/cli/src/commands/hooks/uninstall.ts` | Create | `registerUninstallCommand(parent)` — removes GHAGGA hooks (by marker detection), restores `.ghagga-backup` files if they exist. |
| `apps/cli/src/commands/hooks/status.ts` | Create | `registerStatusCommand(parent)` — reads `.git/hooks/pre-commit` and `commit-msg`, reports installed/not-installed/foreign status. |
| `apps/cli/src/commands/hooks/templates.ts` | Create | Pure functions that return hook script strings. `generatePreCommitHook(opts)` and `generateCommitMsgHook(opts)`. No side effects, trivially testable. |
| `apps/cli/src/commands/hooks/git-utils.ts` | Create | Shared helpers: `findGitRoot(cwd)`, `getHooksDir(gitRoot)`, `hasGhaggaMarker(filePath)`, `getCoreHooksPath(gitRoot)`. Pure fs/git operations, isolated for testing. |
| `apps/cli/src/commands/review.ts` | Modify | (1) Add `--staged`, `--commit-msg <file>`, `--exit-on-issues`, `--quick` options. (2) Extract `getGitDiff` to accept a `staged` boolean. (3) Add `--commit-msg` early-return path that calls `reviewCommitMessage()`. (4) Add `--exit-on-issues` severity check after pipeline returns. (5) Pass `aiReviewEnabled: false` to pipeline when `--quick`. |
| `apps/cli/src/commands/review-commit-msg.ts` | Create | `reviewCommitMessage({ message, provider, model, apiKey })` — lightweight function that validates commit message format and calls a single LLM prompt. Returns a `ReviewResult`-compatible object. |
| `apps/cli/src/index.ts` | Modify | Import and register `hooksCommand` from `./commands/hooks/index.js`. Add new options to the `review` command definition (`.option('--staged', ...)` etc.). |
| `apps/cli/src/lib/git.ts` | Modify | Add `getStagedDiff(repoPath)` and `getStagedFileList(repoPath)` helper functions. |

## Interfaces / Contracts

### New CLI Options (added to `review` command in `index.ts`)

```typescript
// apps/cli/src/index.ts — new options on the review command
.option('--staged', 'Review only staged changes (for pre-commit hooks)')
.option('--commit-msg <file>', 'Validate commit message from file path')
.option('--exit-on-issues', 'Exit with code 1 if critical/high issues found')
.option('--quick', 'Static analysis only — skip LLM review')
```

### Extended ReviewOptions

```typescript
// apps/cli/src/commands/review.ts
export interface ReviewOptions {
  mode: ReviewMode;
  provider: LLMProvider;
  model: string;
  apiKey: string;
  format: 'markdown' | 'json';
  semgrep: boolean;
  trivy: boolean;
  cpd: boolean;
  memory: boolean;
  config?: string;
  verbose: boolean;
  // New fields:
  staged: boolean;          // --staged flag
  commitMsg?: string;       // --commit-msg <file> path
  exitOnIssues: boolean;    // --exit-on-issues flag
  quick: boolean;           // --quick flag
}
```

### Extended ReviewCommandOptions (in `index.ts`)

```typescript
// apps/cli/src/index.ts
interface ReviewCommandOptions {
  mode: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  format: string;
  semgrep: boolean;
  trivy: boolean;
  cpd: boolean;
  memory: boolean;
  config?: string;
  verbose: boolean;
  // New:
  staged: boolean;
  commitMsg?: string;
  exitOnIssues: boolean;
  quick: boolean;
}
```

### Hook Template Functions

```typescript
// apps/cli/src/commands/hooks/templates.ts

export interface HookTemplateOptions {
  /** Include --quick flag in the hook script */
  quick: boolean;
}

/** Marker comment used to identify GHAGGA-generated hooks */
export const GHAGGA_HOOK_MARKER = '# GHAGGA HOOK';

/** Generate the pre-commit hook shell script */
export function generatePreCommitHook(opts: HookTemplateOptions): string;

/** Generate the commit-msg hook shell script */
export function generateCommitMsgHook(): string;
```

### Hook Git Utilities

```typescript
// apps/cli/src/commands/hooks/git-utils.ts

/** Find the nearest .git directory from cwd, walking up. Returns null if not in a repo. */
export function findGitRoot(cwd: string): string | null;

/** Resolve the hooks directory (.git/hooks) for a given git root. */
export function getHooksDir(gitRoot: string): string;

/** Check if a hook file contains the GHAGGA marker. */
export function hasGhaggaMarker(hookPath: string): boolean;

/** Read git config core.hooksPath. Returns null if not set. */
export function getCoreHooksPath(gitRoot: string): string | null;
```

### Commit Message Review Function

```typescript
// apps/cli/src/commands/review-commit-msg.ts

export interface CommitMsgReviewOptions {
  message: string;
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

/**
 * Validate a commit message using basic heuristics + optional LLM review.
 * Returns a ReviewResult for consistent exit-code handling.
 */
export async function reviewCommitMessage(
  opts: CommitMsgReviewOptions,
): Promise<ReviewResult>;
```

### Exit Code Logic (Modified in `review.ts`)

```typescript
// After pipeline returns in reviewCommand():

function resolveExitCode(
  result: ReviewResult,
  exitOnIssues: boolean,
): number {
  if (exitOnIssues) {
    const hasBlockingIssues = result.findings.some(
      (f) => f.severity === 'critical' || f.severity === 'high',
    );
    return hasBlockingIssues ? 1 : 0;
  }
  // Default behavior: use status-based exit code
  return getExitCode(result.status);
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `templates.ts` — hook script generation | Assert output strings contain expected flags, marker, shebang. Test `--quick` variant. Pure functions, no mocks. |
| Unit | `git-utils.ts` — git root detection, marker detection | Mock `execSync` and `readFileSync`. Test edge cases: no .git dir, core.hooksPath set, empty hook file. |
| Unit | `review-commit-msg.ts` — commit message validation | Mock the LLM provider. Test empty message, short message, good message, conventional commit format. |
| Unit | `install.ts` — hook installation logic | Mock `fs.writeFileSync`, `fs.chmodSync`, `fs.existsSync`, `fs.renameSync`, `git-utils`. Test: fresh install, overwrite GHAGGA hook, backup non-GHAGGA hook, skip hooks with `--no-pre-commit`, `core.hooksPath` warning. |
| Unit | `uninstall.ts` — hook removal logic | Mock fs operations. Test: remove GHAGGA hook, restore backup, no-op when no GHAGGA hook exists. |
| Unit | `status.ts` — status reporting | Mock fs reads. Test: both hooks installed, one installed, none, foreign hooks detected. |
| Unit | `review.ts` — new flag handling | Extend existing `review.test.ts`. Test: `--staged` uses staged diff, `--quick` passes `aiReviewEnabled: false`, `--exit-on-issues` exits 1 on critical findings, `--commit-msg` calls `reviewCommitMessage()`. |
| Integration | End-to-end hook lifecycle | Create a temp git repo, run `install`, verify hook files exist with correct content, run `status`, run `uninstall`, verify hooks removed and backup restored. Uses `execSync` on the actual CLI binary. |

All tests follow the existing pattern: Vitest with `vi.mock()`, `vi.hoisted()`, `ProcessExitError` sentinel for `process.exit` mocking, Commander `parseAsync` for subcommand tests. See `apps/cli/src/commands/memory/clear.test.ts` for the canonical pattern.

## Migration / Rollout

No migration required. This feature is purely additive:
- New `hooks` command group doesn't affect existing commands
- New `review` flags are optional and default to disabled (no behavioral change for existing users)
- No database schema changes
- No configuration file changes
- No server-side changes

The feature ships in v2.2.0 as described in the proposal. Users opt in by running `ghagga hooks install`.

## Open Questions

- [x] Should `--quick` be the default for `ghagga hooks install`? **Resolved: Yes** — the proposal says "Make `--quick` the default for `ghagga hooks install`". The install command generates hooks with `--quick` by default; users pass `--no-quick` to opt into full LLM review in hooks.
- [x] Should `--commit-msg` call the LLM or use heuristics only? **Resolved: LLM by default** — the proposal specifies "lightweight LLM prompt focused on commit message review only". If `--quick` is also set alongside `--commit-msg`, skip LLM and use heuristics only (length, non-empty, not single-word).
- [ ] Should the commit message LLM prompt enforce conventional commits format, or just general quality? Suggestion: general quality by default (length, clarity, imperative mood). Conventional commits enforcement could be a future `--conventional` flag.
- [ ] Partially staged files: static analyzers (Semgrep) read files from disk, not the index. With `--staged`, the diff correctly reflects only staged content, but Semgrep may analyze un-staged changes too. Accept this as a known limitation for v2.2.0? Or use `git stash --keep-index` before analysis? Recommendation: accept the limitation and document it — `git stash --keep-index` has edge cases with untracked files and is risky to automate.
