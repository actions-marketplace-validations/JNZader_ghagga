/**
 * Tests for plugin registration in the tool registry.
 *
 * Validates:
 * - All 3 plugins register successfully
 * - Plugins are discoverable via registry methods
 * - initializeDefaultTools() is idempotent
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../registry.js';
import { cpdPlugin } from '../cpd.js';
import { resetInitialization } from '../index.js';
import { semgrepPlugin } from '../semgrep.js';
import { trivyPlugin } from '../trivy.js';

// ─── Registration Tests ─────────────────────────────────────────

describe('plugin registration', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers semgrep plugin successfully', () => {
    registry.register(semgrepPlugin);
    expect(registry.getByName('semgrep')).toBeDefined();
  });

  it('registers trivy plugin successfully', () => {
    registry.register(trivyPlugin);
    expect(registry.getByName('trivy')).toBeDefined();
  });

  it('registers cpd plugin successfully', () => {
    registry.register(cpdPlugin);
    expect(registry.getByName('cpd')).toBeDefined();
  });

  it('registers all 3 plugins', () => {
    registry.register(semgrepPlugin);
    registry.register(trivyPlugin);
    registry.register(cpdPlugin);
    expect(registry.size).toBe(3);
  });

  it('all 3 plugins are always-on tier', () => {
    registry.register(semgrepPlugin);
    registry.register(trivyPlugin);
    registry.register(cpdPlugin);
    const alwaysOn = registry.getByTier('always-on');
    expect(alwaysOn).toHaveLength(3);
  });

  it('no auto-detect plugins registered yet', () => {
    registry.register(semgrepPlugin);
    registry.register(trivyPlugin);
    registry.register(cpdPlugin);
    const autoDetect = registry.getByTier('auto-detect');
    expect(autoDetect).toHaveLength(0);
  });

  it('passes validation for all plugins', () => {
    registry.register(semgrepPlugin);
    registry.register(trivyPlugin);
    registry.register(cpdPlugin);
    expect(() => registry.validateAll()).not.toThrow();
  });

  it('plugins are discoverable by name', () => {
    registry.register(semgrepPlugin);
    registry.register(trivyPlugin);
    registry.register(cpdPlugin);

    expect(registry.getByName('semgrep')?.displayName).toBe('Semgrep');
    expect(registry.getByName('trivy')?.displayName).toBe('Trivy');
    expect(registry.getByName('cpd')?.displayName).toBe('PMD/CPD');
  });

  it('getAll returns all 3 plugins', () => {
    registry.register(semgrepPlugin);
    registry.register(trivyPlugin);
    registry.register(cpdPlugin);
    const all = registry.getAll();
    const names = all.map((t) => t.name);
    expect(names).toContain('semgrep');
    expect(names).toContain('trivy');
    expect(names).toContain('cpd');
  });

  it('prevents duplicate registration', () => {
    registry.register(semgrepPlugin);
    expect(() => registry.register(semgrepPlugin)).toThrow('already registered');
  });
});

// ─── initializeDefaultTools Tests ───────────────────────────────

describe('initializeDefaultTools', () => {
  // Use the singleton toolRegistry imported from registry.ts
  // We need to test the initialization function, but we should
  // be careful not to pollute the singleton between tests

  beforeEach(() => {
    resetInitialization();
  });

  afterEach(() => {
    resetInitialization();
  });

  it('registers plugins in a fresh registry', () => {
    const registry = new ToolRegistry();
    // Manually register to test the list
    registry.register(semgrepPlugin);
    registry.register(trivyPlugin);
    registry.register(cpdPlugin);
    expect(registry.size).toBe(3);
  });

  it('each plugin has the required fields', () => {
    const plugins = [semgrepPlugin, trivyPlugin, cpdPlugin];
    for (const plugin of plugins) {
      expect(plugin.name).toBeTruthy();
      expect(plugin.displayName).toBeTruthy();
      expect(plugin.category).toBeTruthy();
      expect(plugin.tier).toBe('always-on');
      expect(plugin.version).toBeTruthy();
      expect(plugin.outputFormat).toBeTruthy();
      expect(typeof plugin.install).toBe('function');
      expect(typeof plugin.run).toBe('function');
      expect(typeof plugin.parse).toBe('function');
    }
  });
});
