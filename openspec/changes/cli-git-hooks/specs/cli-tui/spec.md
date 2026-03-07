# Delta for CLI TUI

> **Domain**: cli-tui
> **Change**: cli-git-hooks
> **Status**: draft

## ADDED Requirements

---

### Requirement: Hooks Command Group Help and Output

The `ghagga hooks` command group and its subcommands (`install`, `uninstall`, `status`) MUST use the TUI facade for all output, consistent with existing CLI commands.

#### Scenario: hooks install success output in styled mode

- GIVEN the TUI is in `styled` mode
- WHEN `ghagga hooks install` completes successfully
- THEN a branded intro MUST be displayed
- AND success messages MUST use `tui.log.success()`
- AND a branded outro MUST be displayed

#### Scenario: hooks install output in plain mode

- GIVEN the TUI is in `plain` mode
- WHEN `ghagga hooks install` completes successfully
- THEN all output MUST be plain text via `console.log`
- AND no ANSI escape sequences MUST be present in the output

#### Scenario: hooks status output in styled mode

- GIVEN the TUI is in `styled` mode
- WHEN `ghagga hooks status` is run
- THEN hook status information MUST be displayed using structured `tui.log.*` methods
- AND installed hooks MUST use `tui.log.success()` indicators
- AND missing hooks MUST use `tui.log.info()` indicators

#### Scenario: hooks uninstall warning for non-GHAGGA hooks

- GIVEN a hook exists that was NOT installed by GHAGGA
- AND the TUI is in `styled` mode
- WHEN `ghagga hooks uninstall` encounters this hook
- THEN `tui.log.warn()` MUST be used to display the skip message

---

### Requirement: hooks --help Documentation

The `ghagga hooks` command group MUST be visible in `ghagga --help` output, and each subcommand MUST provide descriptive help text.

#### Scenario: hooks appears in top-level help

- GIVEN the user runs `ghagga --help`
- WHEN the help text is displayed
- THEN the output MUST include `hooks` as an available command with a description

#### Scenario: hooks install --help shows all options

- GIVEN the user runs `ghagga hooks install --help`
- WHEN the help text is displayed
- THEN the output MUST document `--quick`, `--no-pre-commit`, `--no-commit-msg`, and `--force` options

## MODIFIED Requirements

---

### Requirement: Review Command Help (modifies R20: All Existing CLI Flags Continue Working)

The `review` command help text MUST document the new flags alongside all existing flags.

(Previously: Help text documented `--no-memory`, `--no-semgrep`, `--no-trivy`, `--no-cpd`, `--verbose`, `--mode`, `--provider`, `--model`, `--api-key`, `--format`, `--config`.)

#### Scenario: review --help shows new flags

- GIVEN the user runs `ghagga review --help`
- WHEN the help text is displayed
- THEN the output MUST document `--staged`, `--commit-msg <file>`, `--exit-on-issues`, and `--quick` alongside the existing flags
- AND each new flag MUST have a description

#### Scenario: Existing flags still appear in review --help

- GIVEN the user runs `ghagga review --help`
- WHEN the help text is displayed
- THEN all pre-existing flags (`--no-memory`, `--no-semgrep`, `--no-trivy`, `--no-cpd`, `-v`, `-m`, `-p`, `--model`, `--api-key`, `-f`, `-c`) MUST still be listed
