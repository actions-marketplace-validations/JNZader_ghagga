/**
 * TUI facade tests.
 *
 * Tests the init/isPlain mode resolution, intro/outro, log.* methods,
 * and spinner() in both plain and styled modes.
 * Mocks @clack/prompts and console.log/error.
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

// ─── Tests ──────────────────────────────────────────────────────

describe('TUI facade', () => {
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

  // We need a fresh module for each test to reset the _plain state
  async function freshTui() {
    vi.resetModules();
    return import('../tui.js');
  }

  describe('init() and isPlain()', () => {
    it('defaults to plain mode (non-TTY test environment)', async () => {
      const tui = await freshTui();
      tui.init();
      expect(tui.isPlain()).toBe(true);
    });

    it('init({ plain: true }) forces plain mode', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      expect(tui.isPlain()).toBe(true);
    });

    it('isPlain() returns true before init() is called (default state)', async () => {
      const tui = await freshTui();
      // _plain defaults to true
      expect(tui.isPlain()).toBe(true);
    });

    it('detects CI environment as plain', async () => {
      const originalCI = process.env.CI;
      process.env.CI = 'true';

      const tui = await freshTui();
      tui.init();
      expect(tui.isPlain()).toBe(true);

      if (originalCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCI;
      }
    });
  });

  describe('plain mode — intro/outro', () => {
    it('intro() prints with ═══ prefix via console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.intro('GHAGGA Review');

      expect(logSpy).toHaveBeenCalledWith('═══ GHAGGA Review ═══');
      expect(mockClackIntro).not.toHaveBeenCalled();
    });

    it('outro() prints with ─── prefix via console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.outro('Done!');

      expect(logSpy).toHaveBeenCalledWith('─── Done! ───');
      expect(mockClackOutro).not.toHaveBeenCalled();
    });
  });

  describe('plain mode — log methods', () => {
    it('log.info delegates to console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.log.info('info message');

      expect(logSpy).toHaveBeenCalledWith('info message');
    });

    it('log.success delegates to console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.log.success('success message');

      expect(logSpy).toHaveBeenCalledWith('success message');
    });

    it('log.warn delegates to console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.log.warn('warn message');

      expect(logSpy).toHaveBeenCalledWith('warn message');
    });

    it('log.error delegates to console.error', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.log.error('error message');

      expect(errorSpy).toHaveBeenCalledWith('error message');
      expect(logSpy).not.toHaveBeenCalledWith('error message');
    });

    it('log.step delegates to console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.log.step('step message');

      expect(logSpy).toHaveBeenCalledWith('step message');
    });

    it('log.message delegates to console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      tui.log.message('message text');

      expect(logSpy).toHaveBeenCalledWith('message text');
    });
  });

  describe('plain mode — spinner', () => {
    it('start() and message() are no-ops', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      const s = tui.spinner();

      // Should not throw
      s.start('loading...');
      s.message('still loading...');

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('stop(msg) calls console.log with the message', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      const s = tui.spinner();

      s.stop('Done!');
      expect(logSpy).toHaveBeenCalledWith('Done!');
    });

    it('stop() without message does not call console.log', async () => {
      const tui = await freshTui();
      tui.init({ plain: true });
      const s = tui.spinner();

      s.stop();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('styled mode — delegates to @clack/prompts', () => {
    // For styled mode we need isTTY=true and no CI
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

    it('isPlain() returns false in styled mode', async () => {
      const tui = await styledTui();
      expect(tui.isPlain()).toBe(false);
    });

    it('intro() delegates to clack.intro()', async () => {
      const tui = await styledTui();
      tui.intro('Review');

      expect(mockClackIntro).toHaveBeenCalledWith('Review');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('outro() delegates to clack.outro()', async () => {
      const tui = await styledTui();
      tui.outro('All done');

      expect(mockClackOutro).toHaveBeenCalledWith('All done');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('log.* methods delegate to clack.log.*', async () => {
      const tui = await styledTui();

      tui.log.info('i');
      tui.log.success('s');
      tui.log.warn('w');
      tui.log.error('e');
      tui.log.step('st');
      tui.log.message('m');

      expect(mockClackLog.info).toHaveBeenCalledWith('i');
      expect(mockClackLog.success).toHaveBeenCalledWith('s');
      expect(mockClackLog.warn).toHaveBeenCalledWith('w');
      expect(mockClackLog.error).toHaveBeenCalledWith('e');
      expect(mockClackLog.step).toHaveBeenCalledWith('st');
      expect(mockClackLog.message).toHaveBeenCalledWith('m');
    });

    it('spinner() delegates to clack.spinner()', async () => {
      const mockStart = vi.fn();
      const mockMessage = vi.fn();
      const mockStop = vi.fn();
      mockClackSpinner.mockReturnValue({
        start: mockStart,
        message: mockMessage,
        stop: mockStop,
      });

      const tui = await styledTui();
      const s = tui.spinner();

      s.start('loading');
      s.message('updating');
      s.stop('done');

      expect(mockClackSpinner).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledWith('loading');
      expect(mockMessage).toHaveBeenCalledWith('updating');
      expect(mockStop).toHaveBeenCalledWith('done');
    });
  });
});
