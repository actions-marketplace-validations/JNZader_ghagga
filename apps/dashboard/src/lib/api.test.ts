/**
 * Tests for Runner API hooks: useRunnerStatus, useCreateRunner, useConfigureRunnerSecret.
 *
 * Uses vi.stubGlobal('fetch') to mock network calls since the hooks
 * use fetchApi/fetchData which call the global fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRunnerStatus, useCreateRunner, useConfigureRunnerSecret } from './api';
import { createWrapper, createTestQueryClient } from '../test/test-utils';
import type { QueryClient } from '@tanstack/react-query';

// ─── Mocks ──────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  // Set up localStorage token (required by fetchApi)
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue('ghp_test-token'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Helpers ────────────────────────────────────────────────────

function mockJsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ═══════════════════════════════════════════════════════════════════
// useRunnerStatus
// ═══════════════════════════════════════════════════════════════════

describe('useRunnerStatus', () => {
  it('returns runner status when ownerLogin is provided', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: { exists: true, repoFullName: 'acme/ghagga-runner', isPrivate: false },
      }),
    );

    const { result } = renderHook(() => useRunnerStatus('acme'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      exists: true,
      repoFullName: 'acme/ghagga-runner',
      isPrivate: false,
    });
  });

  it('does not fetch when ownerLogin is undefined (enabled: false)', async () => {
    const { result } = renderHook(() => useRunnerStatus(undefined), {
      wrapper: createWrapper(),
    });

    // Should stay in idle/pending state, not fire a request
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when ownerLogin is empty string', async () => {
    const { result } = renderHook(() => useRunnerStatus(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns isError true on API failure', async () => {
    // useRunnerStatus has retry: 1, so we need to provide responses for both attempts
    mockFetch.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    const { result } = renderHook(() => useRunnerStatus('acme'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
  });

  it('returns exists: false for runner not configured', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ data: { exists: false } }),
    );

    const { result } = renderHook(() => useRunnerStatus('acme'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.exists).toBe(false);
  });

  it('includes isPrivate and warning fields when runner is private', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          exists: true,
          repoFullName: 'acme/ghagga-runner',
          isPrivate: true,
          warning: 'Private repo uses org minutes',
        },
      }),
    );

    const { result } = renderHook(() => useRunnerStatus('acme'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.isPrivate).toBe(true);
    expect(result.current.data?.warning).toBe('Private repo uses org minutes');
  });
});

// ═══════════════════════════════════════════════════════════════════
// useCreateRunner
// ═══════════════════════════════════════════════════════════════════

describe('useCreateRunner', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it('creates runner successfully and invalidates runner status cache', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          created: true,
          repoFullName: 'acme/ghagga-runner',
          secretConfigured: true,
          isPrivate: false,
        },
      }),
    );

    const { result } = renderHook(() => useCreateRunner(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      created: true,
      repoFullName: 'acme/ghagga-runner',
      secretConfigured: true,
      isPrivate: false,
    });

    // Should invalidate runner status queries
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['runner', 'status'],
    });
  });

  it('sends POST to /api/runner/create', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: { created: true, repoFullName: 'acme/ghagga-runner', secretConfigured: true, isPrivate: false },
      }),
    );

    const { result } = renderHook(() => useCreateRunner(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/runner/create');
    expect(options.method).toBe('POST');
  });

  it('reports error on API failure (scope mismatch 403)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient_scope' }), { status: 403 }),
    );

    const { result } = renderHook(() => useCreateRunner(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('reports error on generic server error', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const { result } = renderHook(() => useCreateRunner(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ═══════════════════════════════════════════════════════════════════
// useConfigureRunnerSecret
// ═══════════════════════════════════════════════════════════════════

describe('useConfigureRunnerSecret', () => {
  it('configures secret successfully', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ data: { configured: true } }),
    );

    const { result } = renderHook(() => useConfigureRunnerSecret(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ configured: true });
  });

  it('sends POST to /api/runner/configure-secret', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ data: { configured: true } }),
    );

    const { result } = renderHook(() => useConfigureRunnerSecret(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/runner/configure-secret');
    expect(options.method).toBe('POST');
  });

  it('reports error on failure', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Server Error', { status: 500 }),
    );

    const { result } = renderHook(() => useConfigureRunnerSecret(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
