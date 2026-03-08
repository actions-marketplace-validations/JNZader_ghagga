/**
 * Circuit breaker tests.
 *
 * Verifies state transitions: closed -> open -> half-open -> closed,
 * threshold behaviour, and the reset timeout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleCircuitBreaker } from './circuit-breaker.js';

describe('SimpleCircuitBreaker', () => {
  let breaker: SimpleCircuitBreaker;

  beforeEach(() => {
    breaker = new SimpleCircuitBreaker(3, 1_000); // low threshold for tests
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Closed state ─────────────────────────────────────────────

  it('starts in closed state', () => {
    expect(breaker.getState()).toBe('closed');
  });

  it('passes through successful calls in closed state', async () => {
    const result = await breaker.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(breaker.getState()).toBe('closed');
  });

  it('stays closed when failures are below threshold', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    // 2 failures with threshold=3 should stay closed
    await expect(breaker.execute(fail)).rejects.toThrow('fail');
    await expect(breaker.execute(fail)).rejects.toThrow('fail');

    expect(breaker.getState()).toBe('closed');
  });

  // ── Transition to open ───────────────────────────────────────

  it('opens after reaching the failure threshold', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('fail');
    }

    expect(breaker.getState()).toBe('open');
  });

  it('rejects calls immediately when open', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('fail');
    }

    // Next call should be rejected with circuit breaker error
    await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(
      'Circuit breaker is open',
    );
  });

  // ── Half-open state ──────────────────────────────────────────

  it('transitions to half-open after reset timeout', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('fail');
    }
    expect(breaker.getState()).toBe('open');

    // Advance past the reset timeout
    vi.advanceTimersByTime(1_001);

    // Next call should be allowed (half-open probe)
    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('closed');
  });

  it('re-opens if the half-open probe fails', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('fail');
    }

    // Advance past reset timeout
    vi.advanceTimersByTime(1_001);

    // Half-open probe fails -> should re-open
    // failures was already at threshold (3) when breaker tripped, so onFailure()
    // increments to 4 which is >= threshold -> state goes back to 'open'
    await expect(breaker.execute(fail)).rejects.toThrow('fail');

    expect(breaker.getState()).toBe('open');
  });

  // ── Reset on success ─────────────────────────────────────────

  it('resets failure count on success', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    // 2 failures
    await expect(breaker.execute(fail)).rejects.toThrow('fail');
    await expect(breaker.execute(fail)).rejects.toThrow('fail');

    // 1 success -> resets counter
    await breaker.execute(() => Promise.resolve('ok'));

    // 2 more failures should not trip breaker (counter was reset)
    await expect(breaker.execute(fail)).rejects.toThrow('fail');
    await expect(breaker.execute(fail)).rejects.toThrow('fail');

    expect(breaker.getState()).toBe('closed');
  });

  // ── Default constructor values ───────────────────────────────

  it('uses default threshold of 5 and timeout of 30s', async () => {
    const defaultBreaker = new SimpleCircuitBreaker();
    const fail = () => Promise.reject(new Error('fail'));

    // 4 failures should not trip (threshold=5)
    for (let i = 0; i < 4; i++) {
      await expect(defaultBreaker.execute(fail)).rejects.toThrow('fail');
    }
    expect(defaultBreaker.getState()).toBe('closed');

    // 5th failure trips it
    await expect(defaultBreaker.execute(fail)).rejects.toThrow('fail');
    expect(defaultBreaker.getState()).toBe('open');
  });
});
