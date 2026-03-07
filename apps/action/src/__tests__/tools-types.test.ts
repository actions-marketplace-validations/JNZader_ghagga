/**
 * Unit tests for action tool constants — TOOL_VERSIONS and TOOL_TIMEOUT_MS.
 *
 * Pure constants — no mocking needed.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_TIMEOUT_MS, TOOL_VERSIONS } from '../tools/types.js';

// ─── TOOL_VERSIONS ──────────────────────────────────────────────

describe('TOOL_VERSIONS', () => {
  it('should have semgrep, trivy, and pmd keys with semver-like strings', () => {
    expect(TOOL_VERSIONS).toHaveProperty('semgrep');
    expect(TOOL_VERSIONS).toHaveProperty('trivy');
    expect(TOOL_VERSIONS).toHaveProperty('pmd');

    const semverPattern = /^\d+\.\d+\.\d+$/;
    expect(TOOL_VERSIONS.semgrep).toMatch(semverPattern);
    expect(TOOL_VERSIONS.trivy).toMatch(semverPattern);
    expect(TOOL_VERSIONS.pmd).toMatch(semverPattern);
  });
});

// ─── TOOL_TIMEOUT_MS ────────────────────────────────────────────

describe('TOOL_TIMEOUT_MS', () => {
  it('should be 180000 (3 minutes)', () => {
    expect(TOOL_TIMEOUT_MS).toBe(180_000);
  });

  it('should be a positive number', () => {
    expect(TOOL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
