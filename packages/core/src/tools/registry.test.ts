/**
 * Unit tests for ToolRegistry.
 *
 * Tests: register, getAll, getByName, getByTier, size,
 * duplicate registration, auto-detect validation.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from './registry.js';
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

// ─── Tests ──────────────────────────────────────────────────────

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ── register ──

  describe('register', () => {
    it('registers a tool successfully', () => {
      const tool = makeToolDef({ name: 'semgrep' });
      registry.register(tool);
      expect(registry.size).toBe(1);
    });

    it('throws on duplicate name registration', () => {
      const tool = makeToolDef({ name: 'semgrep' });
      registry.register(tool);
      expect(() => registry.register(tool)).toThrow('Tool "semgrep" is already registered');
    });

    it('throws when auto-detect tool has no detect function', () => {
      const tool = makeToolDef({
        name: 'ruff' as ToolDefinition['name'],
        tier: 'auto-detect',
        detect: undefined,
      });
      expect(() => registry.register(tool)).toThrow(
        'Tool "ruff" has tier "auto-detect" but no detect function',
      );
    });

    it('accepts auto-detect tool with detect function', () => {
      const tool = makeToolDef({
        name: 'ruff' as ToolDefinition['name'],
        tier: 'auto-detect',
        detect: (files) => files.some((f) => f.endsWith('.py')),
      });
      registry.register(tool);
      expect(registry.size).toBe(1);
    });

    it('accepts always-on tool without detect function', () => {
      const tool = makeToolDef({ name: 'semgrep', tier: 'always-on', detect: undefined });
      registry.register(tool);
      expect(registry.size).toBe(1);
    });

    it('accepts always-on tool with optional detect function', () => {
      const tool = makeToolDef({
        name: 'semgrep',
        tier: 'always-on',
        detect: () => true,
      });
      registry.register(tool);
      expect(registry.size).toBe(1);
    });
  });

  // ── getAll ──

  describe('getAll', () => {
    it('returns empty array when no tools registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('returns all registered tools', () => {
      registry.register(makeToolDef({ name: 'semgrep' }));
      registry.register(makeToolDef({ name: 'trivy' }));
      registry.register(makeToolDef({ name: 'cpd' }));
      expect(registry.getAll()).toHaveLength(3);
    });
  });

  // ── getByName ──

  describe('getByName', () => {
    it('returns tool by name', () => {
      const tool = makeToolDef({ name: 'semgrep' });
      registry.register(tool);
      expect(registry.getByName('semgrep')).toBe(tool);
    });

    it('returns undefined for unregistered name', () => {
      expect(registry.getByName('nonexistent')).toBeUndefined();
    });
  });

  // ── getByTier ──

  describe('getByTier', () => {
    it('returns only always-on tools', () => {
      registry.register(makeToolDef({ name: 'semgrep', tier: 'always-on' }));
      registry.register(
        makeToolDef({
          name: 'ruff' as ToolDefinition['name'],
          tier: 'auto-detect',
          detect: () => true,
        }),
      );

      const alwaysOn = registry.getByTier('always-on');
      expect(alwaysOn).toHaveLength(1);
      expect(alwaysOn[0]?.name).toBe('semgrep');
    });

    it('returns only auto-detect tools', () => {
      registry.register(makeToolDef({ name: 'semgrep', tier: 'always-on' }));
      registry.register(
        makeToolDef({
          name: 'ruff' as ToolDefinition['name'],
          tier: 'auto-detect',
          detect: () => true,
        }),
      );

      const autoDetect = registry.getByTier('auto-detect');
      expect(autoDetect).toHaveLength(1);
      expect(autoDetect[0]?.name).toBe('ruff');
    });

    it('returns empty array when no tools match tier', () => {
      registry.register(makeToolDef({ name: 'semgrep', tier: 'always-on' }));
      expect(registry.getByTier('auto-detect')).toEqual([]);
    });
  });

  // ── size ──

  describe('size', () => {
    it('returns 0 for empty registry', () => {
      expect(registry.size).toBe(0);
    });

    it('returns correct count after registrations', () => {
      registry.register(makeToolDef({ name: 'semgrep' }));
      registry.register(makeToolDef({ name: 'trivy' }));
      expect(registry.size).toBe(2);
    });
  });

  // ── validateAll ──

  describe('validateAll', () => {
    it('succeeds when all tools are valid', () => {
      registry.register(makeToolDef({ name: 'semgrep', tier: 'always-on' }));
      registry.register(
        makeToolDef({
          name: 'ruff' as ToolDefinition['name'],
          tier: 'auto-detect',
          detect: () => true,
        }),
      );
      expect(() => registry.validateAll()).not.toThrow();
    });

    it('succeeds on empty registry', () => {
      expect(() => registry.validateAll()).not.toThrow();
    });
  });

  // ── clear ──

  describe('clear', () => {
    it('removes all registrations', () => {
      registry.register(makeToolDef({ name: 'semgrep' }));
      registry.register(makeToolDef({ name: 'trivy' }));
      expect(registry.size).toBe(2);

      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });
  });
});
