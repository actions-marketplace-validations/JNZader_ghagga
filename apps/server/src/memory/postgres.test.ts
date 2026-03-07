/**
 * PostgresMemoryStorage management stub tests.
 *
 * Verifies that the 5 management methods (listObservations, getObservation,
 * deleteObservation, getStats, clearObservations) throw "Not implemented"
 * errors, directing users to the Dashboard UI. (S39–S43, R5)
 */

import { describe, it, expect, vi } from 'vitest';
import { PostgresMemoryStorage } from './postgres.js';

// ─── Mock ghagga-db (not needed for stubs, but required for import) ─

vi.mock('ghagga-db', () => ({
  searchObservations: vi.fn(),
  saveObservation: vi.fn(),
  createMemorySession: vi.fn(),
  endMemorySession: vi.fn(),
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
