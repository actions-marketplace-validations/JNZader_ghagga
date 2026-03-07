/**
 * PostgresMemoryStorage tests.
 *
 * Verifies that management methods delegate to the correct ghagga-db
 * functions with correct arguments and map results properly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresMemoryStorage } from './postgres.js';

// ─── Mock ghagga-db ─────────────────────────────────────────────

const mockSearchObservations = vi.hoisted(() => vi.fn());
const mockSaveObservation = vi.hoisted(() => vi.fn());
const mockCreateMemorySession = vi.hoisted(() => vi.fn());
const mockEndMemorySession = vi.hoisted(() => vi.fn());
const mockDeleteMemoryObservation = vi.hoisted(() => vi.fn());
const mockClearMemoryObservationsByProject = vi.hoisted(() => vi.fn());
const mockClearAllMemoryObservations = vi.hoisted(() => vi.fn());
const mockGetMemoryObservation = vi.hoisted(() => vi.fn());
const mockListMemoryObservations = vi.hoisted(() => vi.fn());
const mockGetMemoryStats = vi.hoisted(() => vi.fn());

vi.mock('ghagga-db', () => ({
  searchObservations: mockSearchObservations,
  saveObservation: mockSaveObservation,
  createMemorySession: mockCreateMemorySession,
  endMemorySession: mockEndMemorySession,
  deleteMemoryObservation: mockDeleteMemoryObservation,
  clearMemoryObservationsByProject: mockClearMemoryObservationsByProject,
  clearAllMemoryObservations: mockClearAllMemoryObservations,
  getMemoryObservation: mockGetMemoryObservation,
  listMemoryObservations: mockListMemoryObservations,
  getMemoryStats: mockGetMemoryStats,
}));

// ─── Core method tests ──────────────────────────────────────────

describe('PostgresMemoryStorage — core methods', () => {
  const fakeDb = {} as never;
  const installationId = 100;
  let storage: PostgresMemoryStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new PostgresMemoryStorage(fakeDb, installationId);
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

// ─── Management method delegation tests ─────────────────────────

describe('PostgresMemoryStorage — management methods', () => {
  const fakeDb = {} as never;
  const installationId = 100;
  let storage: PostgresMemoryStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new PostgresMemoryStorage(fakeDb, installationId);
  });

  describe('listObservations (S22)', () => {
    it('delegates to listMemoryObservations with installationId and no options', async () => {
      mockListMemoryObservations.mockResolvedValueOnce([]);

      const result = await storage.listObservations();

      expect(mockListMemoryObservations).toHaveBeenCalledWith(fakeDb, installationId, undefined);
      expect(result).toEqual([]);
    });

    it('delegates with options and maps DB rows to MemoryObservationDetail', async () => {
      const now = new Date('2026-03-07T12:00:00Z');
      mockListMemoryObservations.mockResolvedValueOnce([
        {
          id: 1,
          type: 'pattern',
          title: 'Auth pattern',
          content: 'Use JWT',
          filePaths: ['src/auth.ts'],
          project: 'acme/app',
          topicKey: 'auth',
          revisionCount: 2,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const result = await storage.listObservations({ project: 'acme/app', limit: 10 });

      expect(mockListMemoryObservations).toHaveBeenCalledWith(fakeDb, installationId, { project: 'acme/app', limit: 10 });
      expect(result).toEqual([
        {
          id: 1,
          type: 'pattern',
          title: 'Auth pattern',
          content: 'Use JWT',
          filePaths: ['src/auth.ts'],
          project: 'acme/app',
          topicKey: 'auth',
          revisionCount: 2,
          createdAt: '2026-03-07T12:00:00.000Z',
          updatedAt: '2026-03-07T12:00:00.000Z',
        },
      ]);
    });

    it('maps null topicKey and filePaths correctly', async () => {
      mockListMemoryObservations.mockResolvedValueOnce([
        {
          id: 2,
          type: 'decision',
          title: 'D',
          content: 'C',
          filePaths: null,
          project: 'acme/app',
          topicKey: null,
          revisionCount: 1,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);

      const result = await storage.listObservations();

      expect(result[0]!.filePaths).toBeNull();
      expect(result[0]!.topicKey).toBeNull();
    });
  });

  describe('getObservation (S23-S24)', () => {
    it('returns mapped observation when found (S23)', async () => {
      const now = new Date('2026-03-07T12:00:00Z');
      mockGetMemoryObservation.mockResolvedValueOnce({
        id: 42,
        type: 'pattern',
        title: 'Auth pattern',
        content: 'Use JWT',
        filePaths: ['src/auth.ts'],
        project: 'acme/app',
        topicKey: 'auth',
        revisionCount: 1,
        createdAt: now,
        updatedAt: now,
      });

      const result = await storage.getObservation(42);

      expect(mockGetMemoryObservation).toHaveBeenCalledWith(fakeDb, installationId, 42);
      expect(result).toEqual({
        id: 42,
        type: 'pattern',
        title: 'Auth pattern',
        content: 'Use JWT',
        filePaths: ['src/auth.ts'],
        project: 'acme/app',
        topicKey: 'auth',
        revisionCount: 1,
        createdAt: '2026-03-07T12:00:00.000Z',
        updatedAt: '2026-03-07T12:00:00.000Z',
      });
    });

    it('returns null when not found (S24)', async () => {
      mockGetMemoryObservation.mockResolvedValueOnce(null);

      const result = await storage.getObservation(999);

      expect(mockGetMemoryObservation).toHaveBeenCalledWith(fakeDb, installationId, 999);
      expect(result).toBeNull();
    });
  });

  describe('deleteObservation (S25)', () => {
    it('delegates to deleteMemoryObservation and returns true when deleted', async () => {
      mockDeleteMemoryObservation.mockResolvedValueOnce(true);

      const result = await storage.deleteObservation(42);

      expect(mockDeleteMemoryObservation).toHaveBeenCalledWith(fakeDb, installationId, 42);
      expect(result).toBe(true);
    });

    it('returns false when not found', async () => {
      mockDeleteMemoryObservation.mockResolvedValueOnce(false);

      const result = await storage.deleteObservation(999);

      expect(mockDeleteMemoryObservation).toHaveBeenCalledWith(fakeDb, installationId, 999);
      expect(result).toBe(false);
    });
  });

  describe('getStats (S26)', () => {
    it('delegates to getMemoryStats and maps to MemoryStats interface', async () => {
      const oldest = new Date('2026-01-01T00:00:00Z');
      const newest = new Date('2026-03-07T12:00:00Z');
      mockGetMemoryStats.mockResolvedValueOnce({
        totalObservations: 25,
        oldestDate: oldest,
        newestDate: newest,
        byType: [
          { type: 'pattern', count: 15 },
          { type: 'decision', count: 10 },
        ],
        byProject: [
          { project: 'acme/app', count: 20 },
          { project: 'acme/lib', count: 5 },
        ],
      });

      const result = await storage.getStats();

      expect(mockGetMemoryStats).toHaveBeenCalledWith(fakeDb, installationId);
      expect(result).toEqual({
        totalObservations: 25,
        byType: { pattern: 15, decision: 10 },
        byProject: { 'acme/app': 20, 'acme/lib': 5 },
        oldestObservation: '2026-01-01T00:00:00.000Z',
        newestObservation: '2026-03-07T12:00:00.000Z',
      });
    });

    it('handles null dates (empty store)', async () => {
      mockGetMemoryStats.mockResolvedValueOnce({
        totalObservations: 0,
        oldestDate: null,
        newestDate: null,
        byType: [],
        byProject: [],
      });

      const result = await storage.getStats();

      expect(result).toEqual({
        totalObservations: 0,
        byType: {},
        byProject: {},
        oldestObservation: null,
        newestObservation: null,
      });
    });
  });

  describe('clearObservations (S27-S28)', () => {
    it('delegates to clearMemoryObservationsByProject when project is provided (S27)', async () => {
      mockClearMemoryObservationsByProject.mockResolvedValueOnce(15);

      const result = await storage.clearObservations({ project: 'acme/app' });

      expect(mockClearMemoryObservationsByProject).toHaveBeenCalledWith(fakeDb, installationId, 'acme/app');
      expect(mockClearAllMemoryObservations).not.toHaveBeenCalled();
      expect(result).toBe(15);
    });

    it('delegates to clearAllMemoryObservations when no project (S28)', async () => {
      mockClearAllMemoryObservations.mockResolvedValueOnce(50);

      const result = await storage.clearObservations();

      expect(mockClearAllMemoryObservations).toHaveBeenCalledWith(fakeDb, installationId);
      expect(mockClearMemoryObservationsByProject).not.toHaveBeenCalled();
      expect(result).toBe(50);
    });

    it('delegates to clearAllMemoryObservations when options is empty object', async () => {
      mockClearAllMemoryObservations.mockResolvedValueOnce(0);

      const result = await storage.clearObservations({});

      expect(mockClearAllMemoryObservations).toHaveBeenCalledWith(fakeDb, installationId);
      expect(result).toBe(0);
    });
  });
});
