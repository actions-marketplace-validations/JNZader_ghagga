# Hooks Specification

> **Domain**: hooks (new)
> **Change**: cli-git-hooks
> **Status**: draft

## Purpose

Git hook management for the GHAGGA CLI. Provides commands to install, uninstall, and inspect GHAGGA-managed git hooks (`pre-commit` and `commit-msg`) that automatically trigger code review on every commit.

## Requirements

---

### Requirement: Hook Installation

The system MUST provide a `ghagga hooks install` command that creates `pre-commit` and `commit-msg` hook scripts in the current repository's `.git/hooks/` directory.

#### Scenario: Install both hooks in a clean repository

- GIVEN the current directory is a git repository
- AND no hooks exist in `.git/hooks/pre-commit` or `.git/hooks/commit-msg`
- WHEN the user runs `ghagga hooks install`
- THEN a `pre-commit` hook script MUST be written to `.git/hooks/pre-commit`
- AND a `commit-msg` hook script MUST be written to `.git/hooks/commit-msg`
- AND both files MUST be executable (`chmod +x`)
- AND a success message MUST be displayed

#### Scenario: Install creates backup of existing hooks

- GIVEN the current directory is a git repository
- AND `.git/hooks/pre-commit` already exists with content from another tool
- WHEN the user runs `ghagga hooks install --force`
- THEN the existing `.git/hooks/pre-commit` MUST be copied to `.git/hooks/pre-commit.ghagga-backup`
- AND the new GHAGGA hook MUST replace the original file
- AND a message MUST indicate the backup was created

#### Scenario: Install refuses to overwrite existing hook without --force

- GIVEN the current directory is a git repository
- AND `.git/hooks/pre-commit` already exists
- AND the existing hook was NOT installed by GHAGGA (no GHAGGA marker comment)
- WHEN the user runs `ghagga hooks install` without `--force`
- THEN the command MUST NOT overwrite the existing hook
- AND the command MUST display a warning naming the conflicting hook
- AND the command MUST suggest using `--force` to override
- AND the exit code MUST be non-zero

#### Scenario: Install overwrites existing GHAGGA hook without --force

- GIVEN `.git/hooks/pre-commit` exists AND contains the GHAGGA marker comment
- WHEN the user runs `ghagga hooks install` without `--force`
- THEN the existing GHAGGA hook MUST be replaced with the new version
- AND no backup MUST be created (it's already a GHAGGA hook)

#### Scenario: Install with --quick flag

- GIVEN the current directory is a git repository
- WHEN the user runs `ghagga hooks install --quick`
- THEN the generated `pre-commit` hook script MUST include the `--quick` flag in the `ghagga review` invocation
- AND the `commit-msg` hook MUST NOT include `--quick` (commit message validation is always LLM-based)

#### Scenario: Install with --no-pre-commit

- GIVEN the current directory is a git repository
- WHEN the user runs `ghagga hooks install --no-pre-commit`
- THEN only the `commit-msg` hook MUST be installed
- AND no `pre-commit` hook MUST be created or modified

#### Scenario: Install with --no-commit-msg

- GIVEN the current directory is a git repository
- WHEN the user runs `ghagga hooks install --no-commit-msg`
- THEN only the `pre-commit` hook MUST be installed
- AND no `commit-msg` hook MUST be created or modified

#### Scenario: Install outside a git repository

- GIVEN the current directory is NOT a git repository (no `.git/` directory)
- WHEN the user runs `ghagga hooks install`
- THEN the command MUST display an error message indicating no git repository was found
- AND the exit code MUST be non-zero

---

### Requirement: Hook Script Content

Each generated hook script MUST be a valid POSIX shell script that invokes `ghagga review` with the appropriate flags for non-interactive, blocking review.

#### Scenario: Pre-commit hook script content

- GIVEN `ghagga hooks install` has been run
- WHEN the generated `.git/hooks/pre-commit` script is inspected
- THEN the script MUST start with `#!/bin/sh`
- AND the script MUST contain a `# GHAGGA HOOK` marker comment
- AND the script MUST invoke `ghagga review --staged --exit-on-issues --plain`
- AND the script MUST support the `${GHAGGA_HOOK_ARGS:-}` environment variable for additional flags

#### Scenario: Commit-msg hook script content

- GIVEN `ghagga hooks install` has been run
- WHEN the generated `.git/hooks/commit-msg` script is inspected
- THEN the script MUST start with `#!/bin/sh`
- AND the script MUST contain a `# GHAGGA HOOK` marker comment
- AND the script MUST invoke `ghagga review --commit-msg "$1" --exit-on-issues --plain`
- AND `$1` MUST be passed as the commit message file path (provided by git)

#### Scenario: Pre-commit hook with --quick option

- GIVEN `ghagga hooks install --quick` has been run
- WHEN the generated `.git/hooks/pre-commit` script is inspected
- THEN the `ghagga review` invocation MUST include the `--quick` flag
- AND the invocation MUST still include `--staged --exit-on-issues --plain`

---

### Requirement: Hook Graceful Degradation

Hook scripts MUST NOT block commits when GHAGGA is unavailable. If the `ghagga` binary is not found in PATH, the hook MUST print a warning and exit with code 0.

#### Scenario: ghagga not in PATH

- GIVEN a pre-commit hook is installed
- AND the `ghagga` binary is NOT available in the system PATH
- WHEN a developer runs `git commit`
- THEN the hook MUST print a warning message to stderr indicating `ghagga` was not found
- AND the hook MUST exit with code 0 (commit proceeds)

#### Scenario: ghagga available and review succeeds

- GIVEN a pre-commit hook is installed
- AND `ghagga` is available in PATH
- AND the staged changes have no critical or high severity issues
- WHEN a developer runs `git commit`
- THEN the hook MUST run the review and exit with code 0
- AND the commit MUST proceed

#### Scenario: ghagga available and review finds critical issues

- GIVEN a pre-commit hook is installed
- AND `ghagga` is available in PATH
- AND the staged changes have critical severity issues
- WHEN a developer runs `git commit`
- THEN the hook MUST run the review and exit with code 1
- AND the commit MUST be blocked

---

### Requirement: Hook Uninstallation

The system MUST provide a `ghagga hooks uninstall` command that removes GHAGGA-installed hooks and restores any backups.

#### Scenario: Uninstall GHAGGA hooks

- GIVEN both `pre-commit` and `commit-msg` hooks are installed by GHAGGA (contain `# GHAGGA HOOK` marker)
- WHEN the user runs `ghagga hooks uninstall`
- THEN both `.git/hooks/pre-commit` and `.git/hooks/commit-msg` MUST be deleted
- AND a success message MUST be displayed

#### Scenario: Uninstall restores backups

- GIVEN `.git/hooks/pre-commit` is a GHAGGA hook
- AND `.git/hooks/pre-commit.ghagga-backup` exists from a prior `install --force`
- WHEN the user runs `ghagga hooks uninstall`
- THEN the GHAGGA hook MUST be deleted
- AND `.git/hooks/pre-commit.ghagga-backup` MUST be renamed to `.git/hooks/pre-commit`
- AND a message MUST indicate the original hook was restored

#### Scenario: Uninstall skips non-GHAGGA hooks

- GIVEN `.git/hooks/pre-commit` exists but does NOT contain the `# GHAGGA HOOK` marker
- WHEN the user runs `ghagga hooks uninstall`
- THEN the hook MUST NOT be deleted
- AND a message MUST indicate the hook was skipped because it was not installed by GHAGGA

#### Scenario: Uninstall when no hooks exist

- GIVEN no hooks are installed in `.git/hooks/`
- WHEN the user runs `ghagga hooks uninstall`
- THEN the command MUST display a message indicating no GHAGGA hooks were found
- AND the exit code MUST be 0

#### Scenario: Uninstall outside a git repository

- GIVEN the current directory is NOT a git repository
- WHEN the user runs `ghagga hooks uninstall`
- THEN the command MUST display an error message indicating no git repository was found
- AND the exit code MUST be non-zero

---

### Requirement: Hook Status

The system MUST provide a `ghagga hooks status` command that reports which GHAGGA hooks are currently installed.

#### Scenario: Status with both hooks installed

- GIVEN both `pre-commit` and `commit-msg` GHAGGA hooks are installed
- WHEN the user runs `ghagga hooks status`
- THEN the output MUST list each installed hook with its type
- AND the output MUST indicate whether each hook includes `--quick` mode

#### Scenario: Status with no hooks installed

- GIVEN no GHAGGA hooks are installed
- WHEN the user runs `ghagga hooks status`
- THEN the output MUST indicate no GHAGGA hooks are installed
- AND the output SHOULD suggest running `ghagga hooks install`

#### Scenario: Status with mixed hooks

- GIVEN `.git/hooks/pre-commit` is a GHAGGA hook
- AND `.git/hooks/commit-msg` exists but is NOT a GHAGGA hook
- WHEN the user runs `ghagga hooks status`
- THEN `pre-commit` MUST be reported as installed by GHAGGA
- AND `commit-msg` MUST be reported as present but not managed by GHAGGA

---

### Requirement: GHAGGA Hook Marker

All GHAGGA-generated hook scripts MUST contain a marker comment that uniquely identifies them as GHAGGA-managed. This marker is the source of truth for `uninstall` and `status` commands.

#### Scenario: Marker present in generated hooks

- GIVEN `ghagga hooks install` has been run
- WHEN any generated hook file is read
- THEN the file content MUST contain the exact string `# GHAGGA HOOK`

#### Scenario: Marker used for identification

- GIVEN a hook file exists in `.git/hooks/`
- WHEN `ghagga hooks uninstall` or `ghagga hooks status` reads the file
- THEN the command MUST check for the presence of `# GHAGGA HOOK` to determine ownership
- AND hooks without this marker MUST be treated as externally managed

---

### Requirement: core.hooksPath Detection

The system SHOULD detect when git's `core.hooksPath` configuration is set to a non-default path, which would cause hooks in `.git/hooks/` to be ignored.

#### Scenario: core.hooksPath is set

- GIVEN `git config core.hooksPath` returns a non-empty value (e.g., `.husky`)
- WHEN the user runs `ghagga hooks install`
- THEN the command MUST display a warning that `core.hooksPath` is set
- AND the warning MUST explain that hooks installed to `.git/hooks/` may not execute
- AND the installation MUST still proceed (the user may know what they're doing)

#### Scenario: core.hooksPath is not set

- GIVEN `git config core.hooksPath` returns empty or errors (not configured)
- WHEN the user runs `ghagga hooks install`
- THEN no warning about `core.hooksPath` MUST be displayed

---

### Requirement: Hook GHAGGA_HOOK_ARGS Support

Generated hook scripts MUST support runtime customization via the `GHAGGA_HOOK_ARGS` environment variable, allowing developers to pass additional flags without editing the hook script.

#### Scenario: Developer passes extra args via environment

- GIVEN a pre-commit hook is installed
- AND the developer sets `GHAGGA_HOOK_ARGS="--no-memory"` before committing
- WHEN `git commit` is run
- THEN the hook MUST invoke `ghagga review --staged --exit-on-issues --plain --no-memory`

#### Scenario: No GHAGGA_HOOK_ARGS set

- GIVEN a pre-commit hook is installed
- AND `GHAGGA_HOOK_ARGS` is not set in the environment
- WHEN `git commit` is run
- THEN the hook MUST invoke `ghagga review` with only the built-in flags (no extra args appended)
