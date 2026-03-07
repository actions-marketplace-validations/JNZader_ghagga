import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteMemoryStorage } from './sqlite.js';

// ─── Test Setup ─────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ghagga-sqlite-test-'));
  dbPath = join(tmpDir, 'test.db');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helpers ────────────────────────────────────────────────────

function makeObservationData(overrides: Partial<{
  sessionId: number;
  project: string;
  type: string;
  title: string;
  content: string;
  topicKey: string;
  filePaths: string[];
}> = {}) {
  return {
    project: 'owner/repo',
    type: 'pattern',
    title: 'Test observation',
    content: 'Some content about auth patterns.',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('SqliteMemoryStorage', () => {
  // ── Schema Initialization ──

  describe('create()', () => {
    it('initializes schema with required tables and FTS5', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);
      const db = (storage as any).db;

      // Check memory_sessions table exists
      const sessions = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_sessions'",
      );
      expect(sessions).toHaveLength(1);

      // Check memory_observations table exists
      const observations = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_observations'",
      );
      expect(observations).toHaveLength(1);

      // Check FTS5 virtual table exists
      const fts = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_observations_fts'",
      );
      expect(fts).toHaveLength(1);

      // Check indexes exist
      const indexes = db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_obs_%'",
      );
      expect(indexes[0]!.values.length).toBeGreaterThanOrEqual(3);

      await storage.close();
    });
  });

  // ── saveObservation — Insert ──

  describe('saveObservation()', () => {
    it('inserts a new observation and returns correct row shape', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const row = await storage.saveObservation(makeObservationData());

      expect(row).toEqual({
        id: expect.any(Number),
        type: 'pattern',
        title: 'Test observation',
        content: 'Some content about auth patterns.',
        filePaths: expect.any(Array),
      });
      expect(row.id).toBeGreaterThan(0);

      await storage.close();
    });

    it('serializes filePaths as JSON and deserializes on return', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const row = await storage.saveObservation(
        makeObservationData({ filePaths: ['src/auth.ts', 'src/login.ts'] }),
      );

      expect(row.filePaths).toEqual(['src/auth.ts', 'src/login.ts']);

      await storage.close();
    });

    it('defaults filePaths to empty array when not provided', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const row = await storage.saveObservation(makeObservationData());

      expect(row.filePaths).toEqual([]);

      await storage.close();
    });

    it('links observation to session when sessionId is provided', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const session = await storage.createSession({ project: 'owner/repo', prNumber: 1 });
      const row = await storage.saveObservation(
        makeObservationData({ sessionId: session.id }),
      );

      // Verify via raw SQL
      const db = (storage as any).db;
      const result = db.exec(
        `SELECT session_id FROM memory_observations WHERE id = ${row.id}`,
      );
      expect(result[0]!.values[0]![0]).toBe(session.id);

      await storage.close();
    });
  });

  // ── Content-Hash Dedup ──

  describe('content-hash deduplication', () => {
    it('returns existing row when same content is saved within 15-minute window', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);
      const data = makeObservationData();

      const first = await storage.saveObservation(data);
      const second = await storage.saveObservation(data);

      expect(second.id).toBe(first.id);
      expect(second.title).toBe(first.title);

      await storage.close();
    });

    it('creates new row when same content is saved to different project', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const first = await storage.saveObservation(
        makeObservationData({ project: 'org/repo-a' }),
      );
      const second = await storage.saveObservation(
        makeObservationData({ project: 'org/repo-b' }),
      );

      expect(second.id).not.toBe(first.id);

      await storage.close();
    });

    it('creates new row when content differs (different hash)', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const first = await storage.saveObservation(
        makeObservationData({ content: 'Version A content' }),
      );
      const second = await storage.saveObservation(
        makeObservationData({ content: 'Version B content' }),
      );

      expect(second.id).not.toBe(first.id);

      await storage.close();
    });
  });

  // ── TopicKey Upsert ──

  describe('topicKey upsert', () => {
    it('updates existing observation when same topicKey and project', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const first = await storage.saveObservation(
        makeObservationData({
          topicKey: 'auth-pattern',
          content: 'Original content',
          title: 'Original title',
        }),
      );

      const second = await storage.saveObservation(
        makeObservationData({
          topicKey: 'auth-pattern',
          content: 'Updated content',
          title: 'Updated title',
        }),
      );

      expect(second.id).toBe(first.id);
      expect(second.content).toBe('Updated content');
      expect(second.title).toBe('Updated title');

      await storage.close();
    });

    it('creates new row when same topicKey but different project', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const first = await storage.saveObservation(
        makeObservationData({
          project: 'org/repo-a',
          topicKey: 'shared-key',
        }),
      );

      const second = await storage.saveObservation(
        makeObservationData({
          project: 'org/repo-b',
          topicKey: 'shared-key',
        }),
      );

      expect(second.id).not.toBe(first.id);

      await storage.close();
    });

    it('increments revision_count on upsert', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const first = await storage.saveObservation(
        makeObservationData({
          topicKey: 'evolving-topic',
          content: 'Version 1',
        }),
      );

      // Upsert with new content
      await storage.saveObservation(
        makeObservationData({
          topicKey: 'evolving-topic',
          content: 'Version 2',
        }),
      );

      // Query raw SQL to check revision_count
      const db = (storage as any).db;
      const result = db.exec(
        `SELECT revision_count FROM memory_observations WHERE id = ${first.id}`,
      );
      expect(result[0]!.values[0]![0]).toBe(2);

      await storage.close();
    });
  });

  // ── searchObservations ──

  describe('searchObservations()', () => {
    it('finds observations by FTS5 keyword match', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(
        makeObservationData({
          title: 'Authentication pattern',
          content: 'JWT tokens should be validated on every request.',
        }),
      );

      const results = await storage.searchObservations('owner/repo', 'authentication JWT');

      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Authentication pattern');

      await storage.close();
    });

    it('returns empty array when no match found', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(makeObservationData());

      const results = await storage.searchObservations('owner/repo', 'nonexistent xyz');

      expect(results).toHaveLength(0);

      await storage.close();
    });

    it('scopes results to the specified project', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(
        makeObservationData({
          project: 'org/project-a',
          title: 'Auth in project A',
          content: 'Auth content for project A.',
        }),
      );
      await storage.saveObservation(
        makeObservationData({
          project: 'org/project-b',
          title: 'Auth in project B',
          content: 'Auth content for project B.',
        }),
      );

      const results = await storage.searchObservations('org/project-a', 'Auth');

      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Auth in project A');

      await storage.close();
    });

    it('filters by type when specified', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(
        makeObservationData({ type: 'pattern', content: 'Security pattern found.' }),
      );
      await storage.saveObservation(
        makeObservationData({ type: 'bugfix', title: 'Fixed security bug', content: 'Security bugfix applied.' }),
      );

      const results = await storage.searchObservations('owner/repo', 'security', { type: 'bugfix' });

      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('bugfix');

      await storage.close();
    });

    it('respects the limit parameter', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      for (let i = 0; i < 5; i++) {
        await storage.saveObservation(
          makeObservationData({
            title: `Performance observation ${i}`,
            content: `Performance issue number ${i} detected.`,
          }),
        );
      }

      const results = await storage.searchObservations('owner/repo', 'performance', { limit: 2 });

      expect(results).toHaveLength(2);

      await storage.close();
    });

    it('returns empty array for empty query string', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(makeObservationData());

      const results = await storage.searchObservations('owner/repo', '');

      expect(results).toHaveLength(0);

      await storage.close();
    });

    it('returns empty array for whitespace-only query', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(makeObservationData());

      const results = await storage.searchObservations('owner/repo', '   ');

      expect(results).toHaveLength(0);

      await storage.close();
    });

    it('returns correct MemoryObservationRow shape with filePaths', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(
        makeObservationData({
          filePaths: ['src/auth.ts', 'src/middleware.ts'],
          title: 'Middleware auth',
          content: 'Middleware handles auth validation.',
        }),
      );

      const results = await storage.searchObservations('owner/repo', 'middleware');

      expect(results[0]).toEqual({
        id: expect.any(Number),
        type: 'pattern',
        title: 'Middleware auth',
        content: 'Middleware handles auth validation.',
        filePaths: ['src/auth.ts', 'src/middleware.ts'],
      });

      await storage.close();
    });
  });

  // ── Session Lifecycle ──

  describe('session lifecycle', () => {
    it('createSession returns an auto-incremented id', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const session1 = await storage.createSession({ project: 'owner/repo', prNumber: 1 });
      const session2 = await storage.createSession({ project: 'owner/repo', prNumber: 2 });

      expect(session1.id).toBeGreaterThan(0);
      expect(session2.id).toBe(session1.id + 1);

      await storage.close();
    });

    it('endSession sets ended_at and summary', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const session = await storage.createSession({ project: 'owner/repo', prNumber: 1 });
      await storage.endSession(session.id, 'Review completed with 3 findings.');

      const db = (storage as any).db;
      const result = db.exec(
        `SELECT ended_at, summary FROM memory_sessions WHERE id = ${session.id}`,
      );
      expect(result[0]!.values[0]![0]).not.toBeNull(); // ended_at is set
      expect(result[0]!.values[0]![1]).toBe('Review completed with 3 findings.');

      await storage.close();
    });

    it('createSession accepts optional prNumber', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      const session = await storage.createSession({ project: 'owner/repo' });

      const db = (storage as any).db;
      const result = db.exec(
        `SELECT pr_number FROM memory_sessions WHERE id = ${session.id}`,
      );
      expect(result[0]!.values[0]![0]).toBeNull();

      await storage.close();
    });
  });

  // ── close() and File Persistence ──

  describe('close()', () => {
    it('writes database file to disk', async () => {
      const storage = await SqliteMemoryStorage.create(dbPath);

      await storage.saveObservation(makeObservationData());
      await storage.close();

      expect(existsSync(dbPath)).toBe(true);
    });

    it('creates parent directories if they do not exist', async () => {
      const nestedPath = join(tmpDir, 'nested', 'dir', 'memory.db');
      const storage = await SqliteMemoryStorage.create(nestedPath);

      await storage.close();

      expect(existsSync(nestedPath)).toBe(true);
    });

    it('persists data that can be reopened', async () => {
      // Write data and close
      const storage1 = await SqliteMemoryStorage.create(dbPath);
      await storage1.saveObservation(
        makeObservationData({
          title: 'Persistent observation',
          content: 'This should survive close and reopen.',
        }),
      );
      await storage1.close();

      // Reopen and verify data persists
      const storage2 = await SqliteMemoryStorage.create(dbPath);
      const results = await storage2.searchObservations('owner/repo', 'persistent');

      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('Persistent observation');

      await storage2.close();
    });
  });
});
