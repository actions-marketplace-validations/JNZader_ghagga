/**
 * Hook script templates for pre-commit and commit-msg hooks.
 *
 * Pure functions that return POSIX shell script strings.
 * Each script includes the GHAGGA marker, a PATH check with
 * graceful degradation, and the appropriate ghagga CLI invocation.
 */

import { HOOK_MARKER } from './hooks-types.js';

/** Generate the pre-commit hook script */
export function generatePreCommitHook(extraArgs?: string): string {
  const args = extraArgs ? ` ${extraArgs}` : '';
  return `#!/bin/sh
${HOOK_MARKER}
# Installed by: ghagga hooks install
# To remove: ghagga hooks uninstall

# Check if ghagga is available
if ! command -v ghagga >/dev/null 2>&1; then
  echo "Warning: ghagga not found in PATH. Skipping pre-commit review."
  echo "Install: npm install -g ghagga"
  exit 0
fi

# Check if there are staged changes
if git diff --cached --quiet; then
  exit 0
fi

# Run review on staged files
exec ghagga review --staged --plain --exit-on-issues${args}
`;
}

/** Generate the commit-msg hook script */
export function generateCommitMsgHook(extraArgs?: string): string {
  const args = extraArgs ? ` ${extraArgs}` : '';
  return `#!/bin/sh
${HOOK_MARKER}
# Installed by: ghagga hooks install
# To remove: ghagga hooks uninstall

# Check if ghagga is available
if ! command -v ghagga >/dev/null 2>&1; then
  echo "Warning: ghagga not found in PATH. Skipping commit message review."
  echo "Install: npm install -g ghagga"
  exit 0
fi

# Validate commit message
exec ghagga review --commit-msg "$1" --plain --exit-on-issues${args}
`;
}
