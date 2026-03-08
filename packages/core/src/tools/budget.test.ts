/**
 * Unit tests for time budget allocation and rollover.
 *
 * Tests from specs/runner/spec.md:
 * - Equal split
 * - Minimum enforcement
 * - Rollover from fast tools
 * - Total budget exhaustion
 * - Single tool
 * - Always-on priority when budget is tight
 */

import { describe, expect, it } from 'vitest';
import { allocateTimeBudget, getEffectiveBudget } from './budget.js';
import type { ActivatedTool } from './resolve.js';
import type { ToolDefinition } from './types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeActivatedTool(
  name: string,
  reason: ActivatedTool['reason'] = 'always-on',
): ActivatedTool {
  return {
    definition: {
      name: name as ToolDefinition['name'],
      displayName: name,
      category: 'quality',
      tier: reason === 'always-on' ? 'always-on' : 'auto-detect',
      version: '1.0.0',
      outputFormat: 'json',
      install: async () => {},
      run: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false }),
      parse: () => [],
    },
    reason,
  };
}

// ─── allocateTimeBudget ─────────────────────────────────────────

describe('allocateTimeBudget', () => {
  it('equal split: 10 tools / 600s = 60s each', () => {
    const tools = Array.from({ length: 10 }, (_, i) => makeActivatedTool(`tool-${i}`));
    const budget = allocateTimeBudget(tools, 600_000);

    expect(budget.totalMs).toBe(600_000);
    for (const tool of tools) {
      expect(budget.perToolMs.get(tool.definition.name)).toBe(60_000);
    }
  });

  it('single tool gets full budget', () => {
    const tools = [makeActivatedTool('semgrep')];
    const budget = allocateTimeBudget(tools, 600_000);

    expect(budget.perToolMs.get('semgrep')).toBe(600_000);
  });

  it('minimum enforcement: 25 tools must each get at least 30s', () => {
    const alwaysOnTools = Array.from({ length: 7 }, (_, i) =>
      makeActivatedTool(`ao-${i}`, 'always-on'),
    );
    const autoDetectTools = Array.from({ length: 18 }, (_, i) =>
      makeActivatedTool(`ad-${i}`, 'auto-detect'),
    );
    const tools = [...alwaysOnTools, ...autoDetectTools];
    const budget = allocateTimeBudget(tools, 600_000);

    // Every tool should get at least 30s
    for (const tool of tools) {
      const allocation = budget.perToolMs.get(tool.definition.name);
      expect(allocation).toBeGreaterThanOrEqual(30_000);
    }
  });

  it('always-on tools get priority when budget is tight', () => {
    const alwaysOn = Array.from({ length: 7 }, (_, i) => makeActivatedTool(`ao-${i}`, 'always-on'));
    const autoDetect = Array.from({ length: 18 }, (_, i) =>
      makeActivatedTool(`ad-${i}`, 'auto-detect'),
    );
    const tools = [...alwaysOn, ...autoDetect];
    const budget = allocateTimeBudget(tools, 600_000);

    // Always-on tools should get their minimum
    for (const tool of alwaysOn) {
      expect(budget.perToolMs.get(tool.definition.name)).toBeGreaterThanOrEqual(30_000);
    }
  });

  it('empty tool list produces empty budget', () => {
    const budget = allocateTimeBudget([], 600_000);
    expect(budget.perToolMs.size).toBe(0);
    expect(budget.totalMs).toBe(600_000);
  });

  it('defaults total budget to 600s', () => {
    const tools = [makeActivatedTool('semgrep')];
    const budget = allocateTimeBudget(tools);
    expect(budget.totalMs).toBe(600_000);
  });

  it('minimum per tool is 30s', () => {
    const tools = [makeActivatedTool('semgrep')];
    const budget = allocateTimeBudget(tools);
    expect(budget.minimumPerToolMs).toBe(30_000);
  });
});

// ─── getEffectiveBudget ─────────────────────────────────────────

describe('getEffectiveBudget', () => {
  it('returns allocated budget when no tools have completed', () => {
    const tools = [makeActivatedTool('semgrep'), makeActivatedTool('trivy')];
    const budget = allocateTimeBudget(tools, 600_000);
    const elapsed = new Map<string, number>();

    const effective = getEffectiveBudget('semgrep', budget, elapsed);
    expect(effective).toBe(300_000);
  });

  it('adds rollover from tool that finished early', () => {
    const tools = [makeActivatedTool('semgrep'), makeActivatedTool('trivy')];
    const budget = allocateTimeBudget(tools, 600_000);
    // Semgrep allocated 300s but finished in 10s → 290s rollover
    const elapsed = new Map([['semgrep', 10_000]]);

    const effective = getEffectiveBudget('trivy', budget, elapsed);
    // trivy's 300s + 290s rollover = 590s
    expect(effective).toBe(590_000);
  });

  it('caps at remaining total budget', () => {
    const tools = [makeActivatedTool('semgrep'), makeActivatedTool('trivy')];
    const budget = allocateTimeBudget(tools, 600_000);
    // Semgrep took 500s (over its 300s allocation)
    const elapsed = new Map([['semgrep', 500_000]]);

    const effective = getEffectiveBudget('trivy', budget, elapsed);
    // Remaining total = 600k - 500k = 100k
    expect(effective).toBe(100_000);
  });

  it('returns 0 when total budget is exhausted', () => {
    const tools = [makeActivatedTool('semgrep'), makeActivatedTool('trivy')];
    const budget = allocateTimeBudget(tools, 600_000);
    const elapsed = new Map([['semgrep', 600_000]]);

    const effective = getEffectiveBudget('trivy', budget, elapsed);
    expect(effective).toBe(0);
  });

  it('accumulates rollover from multiple fast tools', () => {
    const tools = [
      makeActivatedTool('semgrep'),
      makeActivatedTool('trivy'),
      makeActivatedTool('cpd'),
    ];
    const budget = allocateTimeBudget(tools, 600_000);
    // Each gets 200s. Semgrep took 50s (150s rollover), Trivy took 30s (170s rollover)
    const elapsed = new Map([
      ['semgrep', 50_000],
      ['trivy', 30_000],
    ]);

    const effective = getEffectiveBudget('cpd', budget, elapsed);
    // cpd's 200s + 150s + 170s = 520s
    // But remaining total = 600k - 50k - 30k = 520k
    expect(effective).toBe(520_000);
  });

  it('uses minimum per tool when tool is not in budget', () => {
    const tools = [makeActivatedTool('semgrep')];
    const budget = allocateTimeBudget(tools, 600_000);
    const elapsed = new Map<string, number>();

    // 'unknown-tool' not in budget → falls back to minimumPerToolMs
    const effective = getEffectiveBudget('unknown-tool', budget, elapsed);
    expect(effective).toBe(30_000);
  });
});
