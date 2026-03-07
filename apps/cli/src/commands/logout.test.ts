/**
 * Logout command tests.
 *
 * Tests the logout flow: not-logged-in shortcut, normal logout,
 * and fallback to "unknown" when githubLogin is missing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────

vi.mock('../lib/config.js', () => ({
  clearConfig: vi.fn(),
  isLoggedIn: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('../ui/tui.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
}));

import { clearConfig, isLoggedIn, loadConfig } from '../lib/config.js';
import * as tui from '../ui/tui.js';
import { logoutCommand } from './logout.js';

const mockIsLoggedIn = vi.mocked(isLoggedIn);
const mockLoadConfig = vi.mocked(loadConfig);
const mockClearConfig = vi.mocked(clearConfig);

// ─── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────

describe('logoutCommand', () => {
  it('shows "not logged in" when user has no stored credentials', () => {
    mockIsLoggedIn.mockReturnValue(false);

    logoutCommand();

    expect(tui.log.info).toHaveBeenCalledWith(expect.stringContaining('Not currently logged in'));
    expect(mockClearConfig).not.toHaveBeenCalled();
  });

  it('clears config and shows success with login name', () => {
    mockIsLoggedIn.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({
      githubToken: 'gho_tok',
      githubLogin: 'testuser',
    });

    logoutCommand();

    expect(mockClearConfig).toHaveBeenCalledOnce();
    expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining('testuser'));
    expect(tui.log.info).toHaveBeenCalledWith(
      expect.stringContaining('credentials have been removed'),
    );
  });

  it('falls back to "unknown" when githubLogin is not set', () => {
    mockIsLoggedIn.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({ githubToken: 'gho_tok' });

    logoutCommand();

    expect(mockClearConfig).toHaveBeenCalledOnce();
    expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining('unknown'));
  });
});
