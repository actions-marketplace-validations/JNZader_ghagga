/**
 * Unit tests for resolveActivatedTools.
 *
 * Parametric tests for all resolution scenarios from specs/runner/spec.md:
 * - Always-on activation
 * - Auto-detect activation
 * - enabledTools force-enable
 * - disabledTools force-disable (overrides always-on)
 * - Deprecated boolean flag fallback
 * - New fields precedence over deprecated flags
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from './registry.js';
import { resolveActivatedTools } from './resolve.js';
import type { ToolDefinition } from './types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test-tool' as ToolDefinition['name'],
    displayName: 'Test Tool',
    category: 'quality',
    tier: 'always-on',
    version: '1.0.0',
    outputFormat: 'json',
    install: async () => {},
    run: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false }),
    parse: () => [],
    ...overrides,
  };
}

function setupRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Always-on tools
  registry.register(makeToolDef({ name: 'semgrep', tier: 'always-on', category: 'security' }));
  registry.register(makeToolDef({ name: 'trivy', tier: 'always-on', category: 'sca' }));
  registry.register(makeToolDef({ name: 'cpd', tier: 'always-on', category: 'duplication' }));
  registry.register(
    makeToolDef({
      name: 'gitleaks' as ToolDefinition['name'],
      tier: 'always-on',
      category: 'secrets',
    }),
  );

  // Auto-detect tools
  registry.register(
    makeToolDef({
      name: 'ruff' as ToolDefinition['name'],
      tier: 'auto-detect',
      category: 'linting',
      detect: (files) => files.some((f) => f.endsWith('.py')),
    }),
  );
  registry.register(
    makeToolDef({
      name: 'bandit' as ToolDefinition['name'],
      tier: 'auto-detect',
      category: 'security',
      detect: (files) => files.some((f) => f.endsWith('.py')),
    }),
  );
  registry.register(
    makeToolDef({
      name: 'golangci-lint' as ToolDefinition['name'],
      tier: 'auto-detect',
      category: 'linting',
      detect: (files) => files.some((f) => f === 'go.mod' || f.endsWith('.go')),
    }),
  );
  registry.register(
    makeToolDef({
      name: 'clippy' as ToolDefinition['name'],
      tier: 'auto-detect',
      category: 'linting',
      detect: (files) => files.some((f) => f === 'Cargo.toml' || f.endsWith('.rs')),
    }),
  );
  registry.register(
    makeToolDef({
      name: 'hadolint' as ToolDefinition['name'],
      tier: 'auto-detect',
      category: 'linting',
      detect: (files) => files.some((f) => /Dockerfile/.test(f.split('/').pop() ?? '')),
    }),
  );

  return registry;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('resolveActivatedTools', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = setupRegistry();
  });

  // ── Step 1: Always-on ──

  describe('always-on activation', () => {
    it('includes all always-on tools with empty files', () => {
      const result = resolveActivatedTools({ registry, files: [] });
      const names = result.map((r) => r.definition.name);
      expect(names).toContain('semgrep');
      expect(names).toContain('trivy');
      expect(names).toContain('cpd');
      expect(names).toContain('gitleaks');
    });

    it('sets reason to "always-on"', () => {
      const result = resolveActivatedTools({ registry, files: [] });
      const semgrep = result.find((r) => r.definition.name === 'semgrep');
      expect(semgrep?.reason).toBe('always-on');
    });
  });

  // ── Step 2: Auto-detect ──

  describe('auto-detect activation', () => {
    it('activates Python tools when .py files present', () => {
      const result = resolveActivatedTools({ registry, files: ['src/main.py', 'utils/helper.py'] });
      const names = result.map((r) => r.definition.name);
      expect(names).toContain('ruff');
      expect(names).toContain('bandit');
      expect(names).not.toContain('golangci-lint');
      expect(names).not.toContain('clippy');
    });

    it('activates Go tools when go.mod present', () => {
      const result = resolveActivatedTools({ registry, files: ['go.mod', 'main.go'] });
      const names = result.map((r) => r.definition.name);
      expect(names).toContain('golangci-lint');
      expect(names).not.toContain('ruff');
    });

    it('activates Hadolint for Dockerfile', () => {
      const result = resolveActivatedTools({ registry, files: ['Dockerfile', 'src/app.ts'] });
      const names = result.map((r) => r.definition.name);
      expect(names).toContain('hadolint');
    });

    it('activates Hadolint for Dockerfile.prod', () => {
      const result = resolveActivatedTools({ registry, files: ['docker/Dockerfile.prod'] });
      const names = result.map((r) => r.definition.name);
      expect(names).toContain('hadolint');
    });

    it('does not activate auto-detect when no matching files', () => {
      const result = resolveActivatedTools({ registry, files: ['src/app.ts', 'README.md'] });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('ruff');
      expect(names).not.toContain('bandit');
      expect(names).not.toContain('golangci-lint');
      expect(names).not.toContain('clippy');
      expect(names).not.toContain('hadolint');
    });

    it('sets reason to "auto-detect"', () => {
      const result = resolveActivatedTools({ registry, files: ['main.py'] });
      const ruff = result.find((r) => r.definition.name === 'ruff');
      expect(ruff?.reason).toBe('auto-detect');
    });

    it('activates multiple language tools for polyglot repo', () => {
      const result = resolveActivatedTools({
        registry,
        files: ['main.py', 'go.mod', 'Dockerfile'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).toContain('ruff');
      expect(names).toContain('bandit');
      expect(names).toContain('golangci-lint');
      expect(names).toContain('hadolint');
    });
  });

  // ── Step 3: enabledTools force-enable ──

  describe('enabledTools (force-enable)', () => {
    it('force-enables an auto-detect tool despite no matching files', () => {
      const result = resolveActivatedTools({
        registry,
        files: ['src/app.ts'],
        enabledTools: ['clippy'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).toContain('clippy');
    });

    it('sets reason to "force-enabled"', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        enabledTools: ['ruff'],
      });
      const ruff = result.find((r) => r.definition.name === 'ruff');
      expect(ruff?.reason).toBe('force-enabled');
    });

    it('ignores unknown tool names in enabledTools', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        enabledTools: ['nonexistent'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('nonexistent');
    });

    it('does not duplicate already-activated tools', () => {
      const result = resolveActivatedTools({
        registry,
        files: ['main.py'],
        enabledTools: ['ruff'], // already activated by auto-detect
      });
      const ruffEntries = result.filter((r) => r.definition.name === 'ruff');
      expect(ruffEntries).toHaveLength(1);
      // Should keep original reason
      expect(ruffEntries[0]?.reason).toBe('auto-detect');
    });
  });

  // ── Step 4: disabledTools force-disable ──

  describe('disabledTools (force-disable)', () => {
    it('disables an always-on tool', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        disabledTools: ['gitleaks'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('gitleaks');
    });

    it('disables an auto-detected tool', () => {
      const result = resolveActivatedTools({
        registry,
        files: ['main.py'],
        disabledTools: ['ruff'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('ruff');
      expect(names).toContain('bandit'); // other Python tool still active
    });

    it('disabledTools overrides enabledTools for the same tool', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        enabledTools: ['ruff'],
        disabledTools: ['ruff'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('ruff');
    });

    it('can disable multiple tools', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        disabledTools: ['semgrep', 'trivy', 'gitleaks'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('semgrep');
      expect(names).not.toContain('trivy');
      expect(names).not.toContain('gitleaks');
      expect(names).toContain('cpd'); // not disabled
    });
  });

  // ── Step 5: Deprecated boolean flags ──

  describe('deprecated boolean flags', () => {
    it('disables semgrep via enableSemgrep: false when no disabledTools', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        enableSemgrep: false,
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('semgrep');
    });

    it('disables trivy via enableTrivy: false when no disabledTools', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        enableTrivy: false,
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('trivy');
    });

    it('disables cpd via enableCpd: false when no disabledTools', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        enableCpd: false,
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('cpd');
    });

    it('deprecated flags ignored when disabledTools has entries', () => {
      // When disabledTools is provided, deprecated boolean flags are NOT consulted
      const result = resolveActivatedTools({
        registry,
        files: [],
        enableSemgrep: false,
        disabledTools: ['gitleaks'], // disabledTools present → deprecated flags skipped
      });
      const names = result.map((r) => r.definition.name);
      // semgrep stays active because deprecated flag is ignored when new field is in use
      expect(names).toContain('semgrep');
      expect(names).not.toContain('gitleaks');
    });

    it('disabledTools takes precedence: enableSemgrep: true + disabledTools: [semgrep]', () => {
      const result = resolveActivatedTools({
        registry,
        files: [],
        enableSemgrep: true,
        disabledTools: ['semgrep'],
      });
      const names = result.map((r) => r.definition.name);
      expect(names).not.toContain('semgrep');
    });
  });

  // ── Combined scenarios ──

  describe('combined scenarios', () => {
    it('default activation: all defaults with Python files', () => {
      const result = resolveActivatedTools({
        registry,
        files: ['src/app.py', 'tests/test_app.py'],
      });
      const names = result.map((r) => r.definition.name);
      // 4 always-on + 2 Python auto-detect
      expect(names).toContain('semgrep');
      expect(names).toContain('trivy');
      expect(names).toContain('cpd');
      expect(names).toContain('gitleaks');
      expect(names).toContain('ruff');
      expect(names).toContain('bandit');
      expect(result).toHaveLength(6);
    });

    it('returns tools in correct order: always-on, auto-detect, force-enabled', () => {
      const result = resolveActivatedTools({
        registry,
        files: ['main.py'],
        enabledTools: ['clippy'],
      });
      const names = result.map((r) => r.definition.name);
      // Always-on first
      const semgrepIdx = names.indexOf('semgrep');
      const ruffIdx = names.indexOf('ruff');
      const clippyIdx = names.indexOf('clippy');
      expect(semgrepIdx).toBeLessThan(ruffIdx);
      expect(ruffIdx).toBeLessThan(clippyIdx);
    });
  });
});
