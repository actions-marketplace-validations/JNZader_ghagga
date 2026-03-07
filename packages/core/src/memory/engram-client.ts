/**
 * Thin HTTP client wrapping native fetch() for the Engram REST API.
 *
 * Uses Node 18+ built-in fetch — no external dependencies.
 * All methods are wrapped in try/catch and return safe fallback values
 * (null, false, []) on failure. Errors are logged via console.warn
 * for graceful degradation — the review never fails because of Engram.
 */

import type { EngramConfig, EngramObservation, EngramStats } from './engram-types.js';

export class EngramClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: EngramConfig) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = config.host.replace(/\/+$/, '');
    this.timeout = config.timeout;
  }

  // ─── Public API ─────────────────────────────────────────────────

  /** Health check: GET /api/stats. Returns true if Engram is reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/stats`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Search observations. GET /api/search?q=...&project=...&limit=... */
  async search(
    query: string,
    project?: string,
    limit?: number,
  ): Promise<EngramObservation[]> {
    try {
      const params = new URLSearchParams({ q: query });
      if (project) params.set('project', project);
      if (limit != null) params.set('limit', String(limit));

      const response = await fetch(`${this.baseUrl}/api/search?${params}`, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return [];

      const data: unknown = await response.json();

      // Handle both array response and { observations: [...] } envelope
      if (Array.isArray(data)) return data as EngramObservation[];
      if (data != null && typeof data === 'object' && 'observations' in data && Array.isArray((data as Record<string, unknown>).observations)) {
        return (data as Record<string, unknown>).observations as EngramObservation[];
      }

      return [];
    } catch (error) {
      console.warn('[ghagga:engram] search failed:', (error as Error).message);
      return [];
    }
  }

  /** Save an observation. POST /api/save */
  async save(data: {
    type: string;
    title: string;
    content: string;
    project?: string;
    topic_key?: string;
    scope?: string;
  }): Promise<EngramObservation | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return null;

      return (await response.json()) as EngramObservation;
    } catch (error) {
      console.warn('[ghagga:engram] save failed:', (error as Error).message);
      return null;
    }
  }

  /** Get a single observation by ID. GET /api/observations/:id */
  async getObservation(id: string | number): Promise<EngramObservation | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/observations/${id}`, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return null;

      return (await response.json()) as EngramObservation;
    } catch (error) {
      console.warn('[ghagga:engram] getObservation failed:', (error as Error).message);
      return null;
    }
  }

  /** Delete an observation by ID. DELETE /api/observations/:id */
  async deleteObservation(id: string | number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/observations/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(this.timeout),
      });

      return response.ok;
    } catch (error) {
      console.warn('[ghagga:engram] deleteObservation failed:', (error as Error).message);
      return false;
    }
  }

  /** Get aggregate stats. GET /api/stats */
  async getStats(): Promise<EngramStats | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/stats`, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return null;

      return (await response.json()) as EngramStats;
    } catch (error) {
      console.warn('[ghagga:engram] getStats failed:', (error as Error).message);
      return null;
    }
  }

  /** Create a new session. POST /api/sessions */
  async createSession(project: string): Promise<number | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { id?: number };
      return data.id ?? null;
    } catch (error) {
      console.warn('[ghagga:engram] createSession failed:', (error as Error).message);
      return null;
    }
  }

  /** End a session with a summary. POST /api/sessions/:id/summary */
  async endSession(id: number, summary: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/sessions/${id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      console.warn('[ghagga:engram] endSession failed:', (error as Error).message);
    }
  }
}
