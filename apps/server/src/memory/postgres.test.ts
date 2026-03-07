/**
 * PostgresMemoryStorage management stub tests.
 *
 * Verifies that the 5 management methods (listObservations, getObservation,
 * deleteObservation, getStats, clearObservations) throw "Not implemented"
 * errors, directing users to the Dashboard UI. (S39–S43, R5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresMemoryStorage } from './postgres.js';

// ─── Mock ghagga-db ─────────────────────────────────────────────

const mockSearchObservations = vi.hoisted(() => vi.fn());
const mockSaveObservation = vi.hoisted(() => vi.fn());
const mockCreateMemorySession = vi.hoisted(() => vi.fn());
const mockEndMemorySession = vi.hoisted(() => vi.fn());

vi.mock('ghagga-db', () => ({
  searchObservations: mockSearchObservations,
  saveObservation: mockSaveObservation,
  createMemorySession: mockCreateMemorySession,
  endMemorySession: mockEndMemorySession,
}));

// ─── Tests ──────────────────────────────────────────────────────

describe('PostgresMemoryStorage — management stubs', () => {
  const storage = new PostgresMemoryStorage({} as never);
  const expectedMessage = 'Not implemented — use Dashboard for memory management';

  it('listObservations throws "Not implemented"', async () => {
    await expect(storage.listObservations()).rejects.toThrow(expectedMessage);
  });

  it('listObservations throws with options', async () => {
    await expect(storage.listObservations({ project: 'a/b', limit: 10 })).rejects.toThrow(expectedMessage);
  });

  it('getObservation throws "Not implemented"', async () => {
    await expect(storage.getObservation(1)).rejects.toThrow(expectedMessage);
  });

  it('deleteObservation throws "Not implemented"', async () => {
    await expect(storage.deleteObservation(1)).rejects.toThrow(expectedMessage);
  });

  it('getStats throws "Not implemented"', async () => {
    await expect(storage.getStats()).rejects.toThrow(expectedMessage);
  });

  it('clearObservations throws "Not implemented" without options', async () => {
    await expect(storage.clearObservations()).rejects.toThrow(expectedMessage);
  });

  it('clearObservations throws "Not implemented" with project scope', async () => {
    await expect(storage.clearObservations({ project: 'owner/repo' })).rejects.toThrow(expectedMessage);
  });
});

// ─── Core method tests ──────────────────────────────────────────

describe('PostgresMemoryStorage — core methods', () => {
  const fakeDb = {} as never;
  let storage: PostgresMemoryStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new PostgresMemoryStorage(fakeDb);
  });

  describe('searchObservations', () => {
    it('calls ghagga-db.searchObservations and maps rows to MemoryObservationRow', async () => {
      mockSearchObservations.mockResolvedValueOnce([
        { id: 1, type: 'pattern', title: 'Title A', content: 'Content A', filePaths: ['src/a.ts'], extra: 'ignored' },
        { id: 2, type: 'decision', title: 'Title B', content: 'Content B', filePaths: null, extra: 'ignored' },
      ]);

      const result = await storage.searchObservations('owner/repo', 'search query');

      expect(mockSearchObservations).toHaveBeenCalledWith(fakeDb, 'owner/repo', 'search query', undefined);
      expect(result).toEqual([
        { id: 1, type: 'pattern', title: 'Title A', content: 'Content A', filePaths: ['src/a.ts'] },
        { id: 2, type: 'decision', title: 'Title B', content: 'Content B', filePaths: null },
      ]);
    });

    it('passes options (limit, type) to ghagga-db', async () => {
      mockSearchObservations.mockResolvedValueOnce([]);

      await storage.searchObservations('owner/repo', 'query', { limit: 5, type: 'pattern' });

      expect(mockSearchObservations).toHaveBeenCalledWith(fakeDb, 'owner/repo', 'query', { limit: 5, type: 'pattern' });
    });

    it('handles null filePaths by mapping to null', async () => {
      mockSearchObservations.mockResolvedValueOnce([
        { id: 3, type: 'preference', title: 'T', content: 'C', filePaths: null },
      ]);

      const result = await storage.searchObservations('proj', 'q');
      expect(result[0]!.filePaths).toBeNull();
    });
  });

  describe('saveObservation', () => {
    it('calls ghagga-db.saveObservation and maps row to MemoryObservationRow', async () => {
      const input = {
        sessionId: 1,
        project: 'owner/repo',
        type: 'pattern',
        title: 'New Pattern',
        content: 'Details here',
        topicKey: 'auth',
        filePaths: ['src/auth.ts'],
      };

      mockSaveObservation.mockResolvedValueOnce({
        id: 10,
        type: 'pattern',
        title: 'New Pattern',
        content: 'Details here',
        filePaths: ['src/auth.ts'],
        extra: 'ignored',
      });

      const result = await storage.saveObservation(input);

      expect(mockSaveObservation).toHaveBeenCalledWith(fakeDb, input);
      expect(result).toEqual({
        id: 10,
        type: 'pattern',
        title: 'New Pattern',
        content: 'Details here',
        filePaths: ['src/auth.ts'],
      });
    });

    it('handles null filePaths in saved row', async () => {
      mockSaveObservation.mockResolvedValueOnce({
        id: 11,
        type: 'decision',
        title: 'D',
        content: 'C',
        filePaths: null,
      });

      const result = await storage.saveObservation({
        project: 'proj',
        type: 'decision',
        title: 'D',
        content: 'C',
      });

      expect(result.filePaths).toBeNull();
    });
  });

  describe('createSession', () => {
    it('calls ghagga-db.createMemorySession and returns { id }', async () => {
      mockCreateMemorySession.mockResolvedValueOnce({ id: 42, project: 'owner/repo' });

      const result = await storage.createSession({ project: 'owner/repo', prNumber: 7 });

      expect(mockCreateMemorySession).toHaveBeenCalledWith(fakeDb, { project: 'owner/repo', prNumber: 7 });
      expect(result).toEqual({ id: 42 });
    });
  });

  describe('endSession', () => {
    it('calls ghagga-db.endMemorySession with sessionId and summary', async () => {
      mockEndMemorySession.mockResolvedValueOnce(undefined);

      await storage.endSession(42, 'Session completed');

      expect(mockEndMemorySession).toHaveBeenCalledWith(fakeDb, 42, 'Session completed');
    });
  });

  describe('close', () => {
    it('is a no-op that resolves without error', async () => {
      await expect(storage.close()).resolves.toBeUndefined();
    });
  });
});
