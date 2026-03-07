import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngramClient } from './engram-client.js';
import type { EngramConfig, EngramObservation, EngramStats } from './engram-types.js';

// ─── Test Setup ─────────────────────────────────────────────────

const DEFAULT_CONFIG: EngramConfig = {
  host: 'http://localhost:7437',
  timeout: 5000,
};

let client: EngramClient;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

function mockFetchResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  client = new EngramClient(DEFAULT_CONFIG);
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  fetchSpy.mockRestore();
  warnSpy.mockRestore();
});

// ─── Tests ──────────────────────────────────────────────────────

describe('EngramClient', () => {
  // ── healthCheck ──

  describe('healthCheck()', () => {
    it('returns true when Engram responds 200', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ total_observations: 10 }));

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:7437/api/stats',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns false when Engram is unreachable', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('returns false on non-200 status', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: false, status: 503 }));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('returns false on timeout', async () => {
      fetchSpy.mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('strips trailing slash from host URL', () => {
      const clientWithSlash = new EngramClient({
        host: 'http://localhost:7437/',
        timeout: 5000,
      });
      fetchSpy.mockReturnValue(mockFetchResponse({}));

      clientWithSlash.healthCheck();

      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:7437/api/stats', expect.any(Object));
    });

    it('strips multiple trailing slashes from host URL', () => {
      const clientWithSlashes = new EngramClient({
        host: 'http://localhost:7437///',
        timeout: 5000,
      });
      fetchSpy.mockReturnValue(mockFetchResponse({}));

      clientWithSlashes.healthCheck();

      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:7437/api/stats', expect.any(Object));
    });

    it('passes AbortSignal.timeout to fetch', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}));

      await client.healthCheck();

      const callArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(callArgs.signal).toBeDefined();
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ── search ──

  describe('search()', () => {
    it('sends correct URL with query params', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ observations: [] }));

      await client.search('auth patterns', 'acme/widgets', 5);

      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('/api/search?');
      expect(calledUrl).toContain('q=auth+patterns');
      expect(calledUrl).toContain('project=acme%2Fwidgets');
      expect(calledUrl).toContain('limit=5');
    });

    it('returns mapped observations from envelope response', async () => {
      const obs: EngramObservation[] = [
        { id: 1, type: 'pattern', title: 'Auth', content: 'JWT info' },
        { id: 2, type: 'bugfix', title: 'Bug', content: 'Fix applied' },
      ];
      fetchSpy.mockReturnValue(mockFetchResponse({ observations: obs }));

      const results = await client.search('test');

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe(1);
      expect(results[1]?.id).toBe(2);
    });

    it('returns mapped observations from array response', async () => {
      const obs: EngramObservation[] = [
        { id: 1, type: 'pattern', title: 'Auth', content: 'JWT info' },
      ];
      fetchSpy.mockReturnValue(mockFetchResponse(obs));

      const results = await client.search('test');

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(1);
    });

    it('returns empty array on error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('returns empty array on non-200 status', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: false, status: 500 }));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('omits project and limit params when not provided', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ observations: [] }));

      await client.search('query');

      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('q=query');
      expect(calledUrl).not.toContain('project=');
      expect(calledUrl).not.toContain('limit=');
    });

    it('returns empty array for unexpected response shape', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ something: 'else' }));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('returns empty array when response is null', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('returns empty array when response is a string', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse('not an object'));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('returns empty array when observations field is not an array', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ observations: 'not-array' }));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('returns empty array when observations field is a number', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ observations: 42 }));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('returns empty array when response is a boolean', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(true));

      const results = await client.search('test');

      expect(results).toEqual([]);
    });

    it('logs warning with [ghagga:engram] prefix on search error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      await client.search('test');

      expect(warnSpy).toHaveBeenCalledWith('[ghagga:engram] search failed:', 'Network error');
    });

    it('passes AbortSignal.timeout to fetch for search', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ observations: [] }));

      await client.search('test');

      const callArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(callArgs.signal).toBeDefined();
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });

    it('includes limit=0 when limit is 0', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ observations: [] }));

      await client.search('query', undefined, 0);

      const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('limit=0');
    });
  });

  // ── save ──

  describe('save()', () => {
    it('sends POST with correct body', async () => {
      const savedObs: EngramObservation = {
        id: 10,
        type: 'pattern',
        title: 'Auth',
        content: 'JWT patterns',
      };
      fetchSpy.mockReturnValue(mockFetchResponse(savedObs));

      const data = {
        type: 'pattern',
        title: 'Auth',
        content: 'JWT patterns',
        project: 'acme/widgets',
        topic_key: 'auth-key',
      };

      await client.save(data);

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:7437/api/save',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }),
      );
    });

    it('returns observation on success', async () => {
      const savedObs: EngramObservation = {
        id: 10,
        type: 'pattern',
        title: 'Auth',
        content: 'JWT patterns',
      };
      fetchSpy.mockReturnValue(mockFetchResponse(savedObs));

      const result = await client.save({
        type: 'pattern',
        title: 'Auth',
        content: 'JWT patterns',
      });

      expect(result).toEqual(savedObs);
    });

    it('returns null on error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await client.save({
        type: 'pattern',
        title: 'Auth',
        content: 'JWT patterns',
      });

      expect(result).toBeNull();
    });

    it('returns null on non-200 status', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: false, status: 422 }));

      const result = await client.save({
        type: 'pattern',
        title: 'Auth',
        content: 'JWT patterns',
      });

      expect(result).toBeNull();
    });

    it('logs warning with [ghagga:engram] prefix on save error', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection timeout'));

      await client.save({
        type: 'pattern',
        title: 'Auth',
        content: 'JWT patterns',
      });

      expect(warnSpy).toHaveBeenCalledWith('[ghagga:engram] save failed:', 'Connection timeout');
    });

    it('passes AbortSignal.timeout to fetch for save', async () => {
      fetchSpy.mockReturnValue(
        mockFetchResponse({ id: 1, type: 'pattern', title: 'T', content: 'C' }),
      );

      await client.save({
        type: 'pattern',
        title: 'T',
        content: 'C',
      });

      const callArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(callArgs.signal).toBeDefined();
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ── getObservation ──

  describe('getObservation()', () => {
    it('sends GET with correct ID', async () => {
      const obs: EngramObservation = {
        id: 42,
        type: 'pattern',
        title: 'Auth',
        content: 'Content',
      };
      fetchSpy.mockReturnValue(mockFetchResponse(obs));

      await client.getObservation(42);

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:7437/api/observations/42',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('sends GET with string ID', async () => {
      fetchSpy.mockReturnValue(
        mockFetchResponse({
          id: 'uuid-abc',
          type: 'pattern',
          title: 'Test',
          content: 'Content',
        }),
      );

      await client.getObservation('uuid-abc');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:7437/api/observations/uuid-abc',
        expect.any(Object),
      );
    });

    it('returns observation on success', async () => {
      const obs: EngramObservation = {
        id: 42,
        type: 'pattern',
        title: 'Auth',
        content: 'Content',
      };
      fetchSpy.mockReturnValue(mockFetchResponse(obs));

      const result = await client.getObservation(42);

      expect(result).toEqual(obs);
    });

    it('returns null on 404', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: false, status: 404 }));

      const result = await client.getObservation(999);

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('Timeout'));

      const result = await client.getObservation(42);

      expect(result).toBeNull();
    });

    it('logs warning with [ghagga:engram] prefix on getObservation error', async () => {
      fetchSpy.mockRejectedValue(new Error('Timeout'));

      await client.getObservation(42);

      expect(warnSpy).toHaveBeenCalledWith('[ghagga:engram] getObservation failed:', 'Timeout');
    });
  });

  // ── deleteObservation ──

  describe('deleteObservation()', () => {
    it('sends DELETE with correct ID', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: true }));

      await client.deleteObservation(42);

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:7437/api/observations/42',
        expect.objectContaining({
          method: 'DELETE',
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('returns true on success', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: true }));

      const result = await client.deleteObservation(42);

      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await client.deleteObservation(42);

      expect(result).toBe(false);
    });

    it('returns false on non-200 status', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: false, status: 404 }));

      const result = await client.deleteObservation(42);

      expect(result).toBe(false);
    });

    it('logs warning with [ghagga:engram] prefix on deleteObservation error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      await client.deleteObservation(42);

      expect(warnSpy).toHaveBeenCalledWith(
        '[ghagga:engram] deleteObservation failed:',
        'Network error',
      );
    });
  });

  // ── getStats ──

  describe('getStats()', () => {
    it('returns stats on success', async () => {
      const stats: EngramStats = {
        total_observations: 100,
        total_sessions: 5,
        projects: ['acme/widgets', 'acme/gadgets'],
      };
      fetchSpy.mockReturnValue(mockFetchResponse(stats));

      const result = await client.getStats();

      expect(result).toEqual(stats);
    });

    it('returns null on error', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));

      const result = await client.getStats();

      expect(result).toBeNull();
    });

    it('returns null on non-200 status', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: false, status: 500 }));

      const result = await client.getStats();

      expect(result).toBeNull();
    });

    it('logs warning with [ghagga:engram] prefix on getStats error', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));

      await client.getStats();

      expect(warnSpy).toHaveBeenCalledWith(
        '[ghagga:engram] getStats failed:',
        'Connection refused',
      );
    });
  });

  // ── createSession ──

  describe('createSession()', () => {
    it('returns session ID on success', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 7 }));

      const result = await client.createSession('acme/widgets');

      expect(result).toBe(7);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:7437/api/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: 'acme/widgets' }),
        }),
      );
    });

    it('returns null on error', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await client.createSession('acme/widgets');

      expect(result).toBeNull();
    });

    it('returns null on non-200 status', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse(null, { ok: false, status: 500 }));

      const result = await client.createSession('acme/widgets');

      expect(result).toBeNull();
    });

    it('returns null when response has no id field', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}));

      const result = await client.createSession('acme/widgets');

      expect(result).toBeNull();
    });

    it('logs warning with [ghagga:engram] prefix on createSession error', async () => {
      fetchSpy.mockRejectedValue(new Error('Server error'));

      await client.createSession('acme/widgets');

      expect(warnSpy).toHaveBeenCalledWith('[ghagga:engram] createSession failed:', 'Server error');
    });

    it('passes AbortSignal.timeout to fetch for createSession', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({ id: 1 }));

      await client.createSession('acme/widgets');

      const callArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(callArgs.signal).toBeDefined();
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ── endSession ──

  describe('endSession()', () => {
    it('sends POST with summary', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}));

      await client.endSession(7, 'Review completed');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:7437/api/sessions/7/summary',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: 'Review completed' }),
        }),
      );
    });

    it('handles errors gracefully (does not throw)', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));

      await expect(client.endSession(7, 'Summary')).resolves.toBeUndefined();
    });

    it('logs warning on error with exact prefix', async () => {
      fetchSpy.mockRejectedValue(new Error('Connection refused'));

      await client.endSession(7, 'Summary');

      expect(warnSpy).toHaveBeenCalledWith(
        '[ghagga:engram] endSession failed:',
        'Connection refused',
      );
    });

    it('passes AbortSignal.timeout to fetch for endSession', async () => {
      fetchSpy.mockReturnValue(mockFetchResponse({}));

      await client.endSession(7, 'Summary');

      const callArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit;
      expect(callArgs.signal).toBeDefined();
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
