/**
 * Tests for the AuthProvider and reAuthenticate flow.
 *
 * Focuses on reAuthenticate() which clears credentials then
 * restarts the Device Flow login.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';

// ─── Mock oauth module ──────────────────────────────────────────

const mockRequestDeviceCode = vi.fn();
const mockPollForAccessToken = vi.fn();
const mockFetchGitHubUser = vi.fn();

vi.mock('./oauth', () => ({
  requestDeviceCode: (...args: unknown[]) => mockRequestDeviceCode(...args),
  pollForAccessToken: (...args: unknown[]) => mockPollForAccessToken(...args),
  fetchGitHubUser: (...args: unknown[]) => mockFetchGitHubUser(...args),
}));

// ─── Mock window.open ───────────────────────────────────────────

const mockWindowOpen = vi.fn();

// ─── localStorage mock ──────────────────────────────────────────

const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
};

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Clear store
  for (const key of Object.keys(store)) delete store[key];

  vi.stubGlobal('localStorage', mockLocalStorage);
  vi.stubGlobal('open', mockWindowOpen);
  // Also stub window.open
  Object.defineProperty(window, 'open', { value: mockWindowOpen, writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Wrapper ────────────────────────────────────────────────────

function createAuthWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <AuthProvider>{children}</AuthProvider>
      </MemoryRouter>
    );
  };
}

// ═══════════════════════════════════════════════════════════════════
// reAuthenticate
// ═══════════════════════════════════════════════════════════════════

describe('reAuthenticate', () => {
  it('clears stored credentials before starting login', async () => {
    // Pre-populate credentials
    store['ghagga_token'] = 'old-token';
    store['ghagga_user'] = JSON.stringify({ githubLogin: 'testuser', githubUserId: 1, avatarUrl: '' });

    // Device flow will be "in progress" (we reject to avoid infinite polling)
    mockRequestDeviceCode.mockResolvedValueOnce({
      device_code: 'dc-123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForAccessToken.mockRejectedValueOnce(new Error('Login cancelled'));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createAuthWrapper(),
    });

    await act(async () => {
      try {
        await result.current.reAuthenticate();
      } catch {
        // expected: Login cancelled
      }
    });

    // localStorage.removeItem should have been called for both keys
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('ghagga_token');
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('ghagga_user');
  });

  it('calls startLogin (requestDeviceCode) after clearing credentials', async () => {
    mockRequestDeviceCode.mockResolvedValueOnce({
      device_code: 'dc-456',
      user_code: 'EFGH-5678',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForAccessToken.mockRejectedValueOnce(new Error('Login cancelled'));

    const { result } = renderHook(() => useAuth(), {
      wrapper: createAuthWrapper(),
    });

    await act(async () => {
      try {
        await result.current.reAuthenticate();
      } catch {
        // expected
      }
    });

    expect(mockRequestDeviceCode).toHaveBeenCalledOnce();
  });

  it('completes the full reAuthenticate flow successfully', async () => {
    mockRequestDeviceCode.mockResolvedValueOnce({
      device_code: 'dc-789',
      user_code: 'IJKL-9012',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    });
    mockPollForAccessToken.mockResolvedValueOnce('new-token-abc');
    mockFetchGitHubUser.mockResolvedValueOnce({
      login: 'newuser',
      id: 42,
      avatar_url: 'https://avatars.example.com/42',
    });

    const { result } = renderHook(() => useAuth(), {
      wrapper: createAuthWrapper(),
    });

    await act(async () => {
      await result.current.reAuthenticate();
    });

    // New credentials should be stored
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('ghagga_token', 'new-token-abc');
    expect(result.current.user?.githubLogin).toBe('newuser');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.loginPhase).toBe('success');
  });
});

// ═══════════════════════════════════════════════════════════════════
// useAuth — basic
// ═══════════════════════════════════════════════════════════════════

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    // Use a wrapper without AuthProvider
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');
  });

  it('starts with isAuthenticated: false when no stored credentials', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: createAuthWrapper(),
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.loginPhase).toBe('idle');
  });
});
