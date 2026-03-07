/**
 * Tests for hook script template generators.
 *
 * Validates that generatePreCommitHook() and generateCommitMsgHook()
 * produce correct POSIX shell scripts with the GHAGGA marker,
 * PATH checks, and appropriate CLI invocations.
 *
 * @see Phase 4, Test 1
 */

import { describe, expect, it } from 'vitest';
import { generateCommitMsgHook, generatePreCommitHook } from './hook-templates.js';
import { HOOK_MARKER } from './hooks-types.js';

// ─── pre-commit template ────────────────────────────────────────

describe('generatePreCommitHook', () => {
  it('starts with #!/bin/sh shebang', () => {
    const script = generatePreCommitHook();
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
  });

  it('includes the GHAGGA marker comment', () => {
    const script = generatePreCommitHook();
    expect(script).toContain(HOOK_MARKER);
  });

  it('includes the ghagga review --staged command', () => {
    const script = generatePreCommitHook();
    expect(script).toContain('ghagga review --staged --plain --exit-on-issues');
  });

  it('includes PATH check with graceful fallback', () => {
    const script = generatePreCommitHook();
    expect(script).toContain('command -v ghagga');
    expect(script).toContain('ghagga not found in PATH');
    expect(script).toContain('exit 0');
  });

  it('includes empty staged check (git diff --cached --quiet)', () => {
    const script = generatePreCommitHook();
    expect(script).toContain('git diff --cached --quiet');
  });

  it('appends extra args when provided', () => {
    const script = generatePreCommitHook('--quick');
    expect(script).toContain('ghagga review --staged --plain --exit-on-issues --quick');
  });

  it('does not append extra args when not provided', () => {
    const script = generatePreCommitHook();
    // Should end the exec line without trailing args
    expect(script).toContain('exec ghagga review --staged --plain --exit-on-issues\n');
  });
});

// ─── commit-msg template ────────────────────────────────────────

describe('generateCommitMsgHook', () => {
  it('starts with #!/bin/sh shebang', () => {
    const script = generateCommitMsgHook();
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
  });

  it('includes the GHAGGA marker comment', () => {
    const script = generateCommitMsgHook();
    expect(script).toContain(HOOK_MARKER);
  });

  it('includes the ghagga review --commit-msg command', () => {
    const script = generateCommitMsgHook();
    expect(script).toContain('ghagga review --commit-msg "$1" --plain --exit-on-issues');
  });

  it('includes PATH check with graceful fallback', () => {
    const script = generateCommitMsgHook();
    expect(script).toContain('command -v ghagga');
    expect(script).toContain('ghagga not found in PATH');
    expect(script).toContain('exit 0');
  });

  it('appends extra args when provided', () => {
    const script = generateCommitMsgHook('--quick');
    expect(script).toContain('ghagga review --commit-msg "$1" --plain --exit-on-issues --quick');
  });

  it('does not append extra args when not provided', () => {
    const script = generateCommitMsgHook();
    expect(script).toContain('exec ghagga review --commit-msg "$1" --plain --exit-on-issues\n');
  });
});
