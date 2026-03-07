/**
 * Simple circuit breaker for external service calls.
 *
 * States:
 *   - closed:    requests pass through normally
 *   - open:      requests are rejected immediately (fail-fast)
 *   - half-open: one probe request is allowed to test recovery
 *
 * Opens after `threshold` consecutive failures. Resets after
 * `resetTimeoutMs` of inactivity in the open state.
 */

export class SimpleCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeoutMs: number = 30_000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeoutMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }
}

/**
 * Shared circuit breaker instance for GitHub API calls.
 *
 * Opens after 5 consecutive failures, resets after 30 seconds.
 * Import this where GitHub API calls are made at the server level
 * to wrap outbound requests.
 */
export const githubCircuitBreaker = new SimpleCircuitBreaker(5, 30_000);
