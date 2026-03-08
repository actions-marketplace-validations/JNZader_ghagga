/**
 * Health trends unit tests.
 *
 * Tests loadHistory (file loading + filtering), saveHistory (persistence + pruning),
 * and computeTrend (direction detection). Uses temp directories for file I/O.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HealthHistoryEntry } from '../trends.js';
import { computeTrend, loadHistory, saveHistory } from '../trends.js';

// ─── Helpers ────────────────────────────────────────────────────

let testDir: string;

function makeEntry(overrides?: Partial<HealthHistoryEntry>): HealthHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    score: 85,
    findingCounts: { critical: 0, high: 1, medium: 2, low: 3, info: 0 },
    toolsRun: ['semgrep', 'trivy'],
    projectPath: '/test/project',
    ...overrides,
  };
}

function writeHistoryFile(dir: string, data: unknown): void {
  const filePath = join(dir, 'health-history.json');
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function readHistoryFile(dir: string): HealthHistoryEntry[] {
  const filePath = join(dir, 'health-history.json');
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ─── Setup / Teardown ───────────────────────────────────────────

beforeEach(() => {
  testDir = join(tmpdir(), `ghagga-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ─── Tests ──────────────────────────────────────────────────────

describe('loadHistory', () => {
  it('returns empty array when history file does not exist', () => {
    const result = loadHistory(testDir, '/test/project');
    expect(result).toEqual([]);
  });

  it('returns empty array for corrupted (non-JSON) file', () => {
    writeFileSync(join(testDir, 'health-history.json'), 'not valid json!!!', 'utf-8');

    const result = loadHistory(testDir, '/test/project');
    expect(result).toEqual([]);
  });

  it('returns empty array when file contains non-array JSON', () => {
    writeHistoryFile(testDir, { notAnArray: true });

    const result = loadHistory(testDir, '/test/project');
    expect(result).toEqual([]);
  });

  it('loads and filters entries by projectPath', () => {
    const entries = [
      makeEntry({ projectPath: '/project/a', score: 90 }),
      makeEntry({ projectPath: '/project/b', score: 70 }),
      makeEntry({ projectPath: '/project/a', score: 85 }),
    ];
    writeHistoryFile(testDir, entries);

    const result = loadHistory(testDir, '/project/a');

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.projectPath === '/project/a')).toBe(true);
    expect(result[0].score).toBe(90);
    expect(result[1].score).toBe(85);
  });

  it('returns empty array when no entries match the projectPath', () => {
    const entries = [makeEntry({ projectPath: '/other/project' })];
    writeHistoryFile(testDir, entries);

    const result = loadHistory(testDir, '/my/project');
    expect(result).toEqual([]);
  });

  it('returns empty array when configDir does not exist', () => {
    const result = loadHistory('/nonexistent/directory/path', '/test/project');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty JSON array', () => {
    writeHistoryFile(testDir, []);

    const result = loadHistory(testDir, '/test/project');
    expect(result).toEqual([]);
  });
});

describe('saveHistory', () => {
  it('creates config directory and file when they do not exist', () => {
    const newDir = join(testDir, 'nested', 'config');
    const entry = makeEntry();

    saveHistory(newDir, entry);

    expect(existsSync(newDir)).toBe(true);
    const saved = readHistoryFile(newDir);
    expect(saved).toHaveLength(1);
    expect(saved[0].score).toBe(entry.score);
  });

  it('appends to existing history file', () => {
    const entry1 = makeEntry({ score: 80, timestamp: '2024-01-01T00:00:00Z' });
    const entry2 = makeEntry({ score: 90, timestamp: '2024-01-02T00:00:00Z' });

    saveHistory(testDir, entry1);
    saveHistory(testDir, entry2);

    const saved = readHistoryFile(testDir);
    expect(saved).toHaveLength(2);
    expect(saved[0].score).toBe(80);
    expect(saved[1].score).toBe(90);
  });

  it('prunes entries to max 10 per project', () => {
    // Save 12 entries for the same project
    for (let i = 0; i < 12; i++) {
      saveHistory(testDir, makeEntry({ score: i * 5, projectPath: '/test/project' }));
    }

    const saved = readHistoryFile(testDir);
    const projectEntries = saved.filter((e) => e.projectPath === '/test/project');

    expect(projectEntries).toHaveLength(10);
    // Should keep the LAST 10 (indices 2-11 → scores 10..55)
    expect(projectEntries[0].score).toBe(10);
    expect(projectEntries[9].score).toBe(55);
  });

  it('prunes per-project independently', () => {
    // Save 12 entries for project A
    for (let i = 0; i < 12; i++) {
      saveHistory(testDir, makeEntry({ score: i, projectPath: '/project/a' }));
    }

    // Save 3 entries for project B
    for (let i = 0; i < 3; i++) {
      saveHistory(testDir, makeEntry({ score: 100 - i, projectPath: '/project/b' }));
    }

    const saved = readHistoryFile(testDir);
    const projectA = saved.filter((e) => e.projectPath === '/project/a');
    const projectB = saved.filter((e) => e.projectPath === '/project/b');

    expect(projectA).toHaveLength(10);
    expect(projectB).toHaveLength(3);
  });

  it('handles corrupted existing file gracefully (overwrites)', () => {
    writeFileSync(join(testDir, 'health-history.json'), 'corrupted data!!!', 'utf-8');

    const entry = makeEntry({ score: 75 });
    saveHistory(testDir, entry);

    const saved = readHistoryFile(testDir);
    expect(saved).toHaveLength(1);
    expect(saved[0].score).toBe(75);
  });

  it('handles non-array existing file gracefully', () => {
    writeHistoryFile(testDir, { notAnArray: true });

    const entry = makeEntry({ score: 60 });
    saveHistory(testDir, entry);

    const saved = readHistoryFile(testDir);
    expect(saved).toHaveLength(1);
    expect(saved[0].score).toBe(60);
  });

  it('preserves all entry fields when saving', () => {
    const entry = makeEntry({
      timestamp: '2024-06-15T12:00:00Z',
      score: 73,
      findingCounts: { critical: 1, high: 2, medium: 3, low: 4, info: 5 },
      toolsRun: ['semgrep', 'trivy', 'eslint'],
      projectPath: '/my/project',
    });

    saveHistory(testDir, entry);

    const saved = readHistoryFile(testDir);
    expect(saved[0]).toEqual(entry);
  });
});

describe('computeTrend', () => {
  it('returns null values when history is empty', () => {
    const result = computeTrend(85, []);

    expect(result.previous).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.direction).toBeNull();
  });

  it('detects improving trend (score went up)', () => {
    const history = [makeEntry({ score: 70 })];
    const result = computeTrend(85, history);

    expect(result.previous).toBe(70);
    expect(result.delta).toBe(15);
    expect(result.direction).toBe('up');
  });

  it('detects declining trend (score went down)', () => {
    const history = [makeEntry({ score: 90 })];
    const result = computeTrend(75, history);

    expect(result.previous).toBe(90);
    expect(result.delta).toBe(-15);
    expect(result.direction).toBe('down');
  });

  it('detects unchanged trend (same score)', () => {
    const history = [makeEntry({ score: 80 })];
    const result = computeTrend(80, history);

    expect(result.previous).toBe(80);
    expect(result.delta).toBe(0);
    expect(result.direction).toBe('unchanged');
  });

  it('uses only the last entry in history for comparison', () => {
    const history = [makeEntry({ score: 50 }), makeEntry({ score: 60 }), makeEntry({ score: 70 })];

    const result = computeTrend(80, history);

    expect(result.previous).toBe(70);
    expect(result.delta).toBe(10);
    expect(result.direction).toBe('up');
  });

  it('handles score improving from 0', () => {
    const history = [makeEntry({ score: 0 })];
    const result = computeTrend(50, history);

    expect(result.previous).toBe(0);
    expect(result.delta).toBe(50);
    expect(result.direction).toBe('up');
  });

  it('handles score declining to 0', () => {
    const history = [makeEntry({ score: 100 })];
    const result = computeTrend(0, history);

    expect(result.previous).toBe(100);
    expect(result.delta).toBe(-100);
    expect(result.direction).toBe('down');
  });

  it('handles perfect scores (100 → 100)', () => {
    const history = [makeEntry({ score: 100 })];
    const result = computeTrend(100, history);

    expect(result.previous).toBe(100);
    expect(result.delta).toBe(0);
    expect(result.direction).toBe('unchanged');
  });

  it('handles single delta of 1 point', () => {
    const history = [makeEntry({ score: 80 })];
    const result = computeTrend(81, history);

    expect(result.delta).toBe(1);
    expect(result.direction).toBe('up');
  });

  it('handles single delta of -1 point', () => {
    const history = [makeEntry({ score: 80 })];
    const result = computeTrend(79, history);

    expect(result.delta).toBe(-1);
    expect(result.direction).toBe('down');
  });
});
