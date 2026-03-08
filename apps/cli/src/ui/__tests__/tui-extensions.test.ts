/**
 * TUI extension tests — severity, box, divider, progress, setActiveSpinner.
 *
 * Tests the new TUI foundation methods in both plain and styled modes.
 * Also tests colorSeverity() from the chalk adapter.
 * Follows the same freshTui() + styledTui() patterns as tui.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock @clack/prompts ────────────────────────────────────────

const mockClackIntro = vi.hoisted(() => vi.fn());
const mockClackOutro = vi.hoisted(() => vi.fn());
const mockClackLog = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  step: vi.fn(),
  message: vi.fn(),
}));
const mockClackSpinner = vi.hoisted(() => vi.fn());

vi.mock('@clack/prompts', () => ({
  intro: mockClackIntro,
  outro: mockClackOutro,
  log: mockClackLog,
  spinner: mockClackSpinner,
}));

// ─── Mock chalk ─────────────────────────────────────────────────

vi.mock('chalk', () => {
  const mockChalk = {
    red: (t: string) => `[RED]${t}[/RED]`,
    hex: (_color: string) => (t: string) => `[HEX]${t}[/HEX]`,
    yellow: (t: string) => `[YELLOW]${t}[/YELLOW]`,
    blue: (t: string) => `[BLUE]${t}[/BLUE]`,
    gray: (t: string) => `[GRAY]${t}[/GRAY]`,
  };
  return { default: mockChalk };
});

// ─── Tests ──────────────────────────────────────────────────────

describe('TUI extensions', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // Fresh module for each test to reset _plain and _activeSpinner state
  async function freshTui() {
    vi.resetModules();
    return import('../tui.js');
  }

  // Styled mode: isTTY=true, no CI
  async function styledTui() {
    const originalTTY = process.stdout.isTTY;
    const originalCI = process.env.CI;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    delete process.env.CI;

    const tui = await freshTui();
    tui.init(); // should detect TTY, no CI → styled

    // Restore immediately after init
    Object.defineProperty(process.stdout, 'isTTY', { value: originalTTY, configurable: true });
    if (originalCI !== undefined) process.env.CI = originalCI;

    return tui;
  }

  // ─── severity() ─────────────────────────────────────────────

  describe('severity() — plain mode', () => {
    it('returns "[CRITICAL] msg" for critical level', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.severity('msg', 'critical')).toBe('[CRITICAL] msg');
    });

    it('returns "[HIGH] msg" for high level', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.severity('msg', 'high')).toBe('[HIGH] msg');
    });

    it('returns "[MEDIUM] msg" for medium level', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.severity('msg', 'medium')).toBe('[MEDIUM] msg');
    });

    it('returns "[LOW] msg" for low level', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.severity('msg', 'low')).toBe('[LOW] msg');
    });

    it('returns "[INFO] msg" for info level', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.severity('msg', 'info')).toBe('[INFO] msg');
    });

    it('returns empty string for empty text', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.severity('', 'critical')).toBe('');
    });
  });

  describe('severity() — styled mode', () => {
    it('returns a colored string (not plain [LEVEL] format)', async () => {
      const tui = await styledTui();
      const result = tui.severity('msg', 'critical');

      // Should be a non-empty string
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      // Must NOT be the plain format
      expect(result).not.toBe('[CRITICAL] msg');
    });
  });

  // ─── box() ──────────────────────────────────────────────────

  describe('box() — plain mode', () => {
    it('renders plain box with title and content lines', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });

      const result = tui.box('Title', ['line1', 'line2']);
      expect(result).toBe('--- Title ---\nline1\nline2\n---');
    });

    it('renders plain box with empty content', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });

      const result = tui.box('Title', []);
      expect(result).toBe('--- Title ---\n---');
    });
  });

  describe('box() — styled mode', () => {
    it('renders Unicode box-drawing characters', async () => {
      const tui = await styledTui();

      const result = tui.box('Title', ['line1', 'line2']);
      expect(result).toContain('┌');
      expect(result).toContain('┐');
      expect(result).toContain('│');
      expect(result).toContain('└');
      expect(result).toContain('┘');
    });
  });

  // ─── divider() ──────────────────────────────────────────────

  describe('divider() — plain mode', () => {
    it('renders "--- label ---" with a label', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.divider('label')).toBe('--- label ---');
    });

    it('renders "---" without a label', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.divider()).toBe('---');
    });
  });

  describe('divider() — styled mode', () => {
    it('renders ─ chars and the label text when given a label', async () => {
      const tui = await styledTui();

      const result = tui.divider('label');
      expect(result).toContain('─');
      expect(result).toContain('label');
    });

    it('renders 60 ─ chars without a label', async () => {
      const tui = await styledTui();

      const result = tui.divider();
      expect(result).toBe('─'.repeat(60));
    });
  });

  // ─── progress() ─────────────────────────────────────────────

  describe('progress() — plain mode', () => {
    it('calls console.log with "[current/total] label"', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });

      tui.progress(3, 7, 'Running...');
      expect(logSpy).toHaveBeenCalledWith('[3/7] Running...');
    });
  });

  describe('progress() — styled mode', () => {
    it('updates active spinner message when spinner is set', async () => {
      const mockMessage = vi.fn();
      const mockSpinner = {
        start: vi.fn(),
        message: mockMessage,
        stop: vi.fn(),
      };

      // Set up clack spinner mock so setActiveSpinner works
      mockClackSpinner.mockReturnValue({
        start: vi.fn(),
        message: vi.fn(),
        stop: vi.fn(),
      });

      const tui = await styledTui();
      tui.setActiveSpinner(mockSpinner);

      tui.progress(3, 7, 'Running...');
      expect(mockMessage).toHaveBeenCalledWith('[3/7] Running...');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('falls back to console.log when no active spinner', async () => {
      mockClackSpinner.mockReturnValue({
        start: vi.fn(),
        message: vi.fn(),
        stop: vi.fn(),
      });

      const tui = await styledTui();
      // No setActiveSpinner call — _activeSpinner is null

      tui.progress(3, 7, 'Running...');
      expect(logSpy).toHaveBeenCalledWith('[3/7] Running...');
    });
  });

  // ─── colorSeverity() from chalk.ts ──────────────────────────

  describe('colorSeverity()', () => {
    it('returns a non-empty string for each severity level', async () => {
      vi.resetModules();
      const { colorSeverity } = await import('../chalk.js');

      const levels = ['critical', 'high', 'medium', 'low', 'info'] as const;
      for (const level of levels) {
        const result = colorSeverity('test', level);
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
      }
    });

    it('produces distinct output for each severity level', async () => {
      vi.resetModules();
      const { colorSeverity } = await import('../chalk.js');

      const levels = ['critical', 'high', 'medium', 'low', 'info'] as const;
      const results = levels.map((level) => colorSeverity('test', level));

      // All 5 should be unique (distinct colors)
      const unique = new Set(results);
      expect(unique.size).toBe(5);
    });
  });
});
