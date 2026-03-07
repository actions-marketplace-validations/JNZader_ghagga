/**
 * Tool binary caching via `@actions/cache`.
 *
 * Caches installed tool binaries across workflow runs to reduce
 * installation time. Cache keys include tool name + pinned version
 * + runner OS so version bumps invalidate correctly.
 *
 * All operations are non-fatal — cache failures log warnings
 * and allow the pipeline to continue.
 */

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import type { ToolName } from './types.js';
import { TOOL_VERSIONS } from './types.js';

/** Cache paths per tool */
const CACHE_PATHS: Record<ToolName, string[]> = {
  semgrep: ['~/.local/bin/semgrep', '~/.local/lib/python3*/site-packages/semgrep*'],
  trivy: ['/usr/local/bin/trivy'],
  cpd: ['/opt/pmd'],
};

/**
 * Get the cache key for a tool.
 * Format: ghagga-{tool}-{version}-{RUNNER_OS}
 */
function getCacheKey(tool: ToolName): string {
  const version = TOOL_VERSIONS[tool === 'cpd' ? 'pmd' : tool];
  return `ghagga-${tool}-${version}-${process.env.RUNNER_OS ?? 'Linux'}`;
}

/**
 * Attempt to restore a tool's cached binaries.
 * @returns true if cache hit, false if miss or error
 */
export async function restoreToolCache(tool: ToolName): Promise<boolean> {
  const key = getCacheKey(tool);
  try {
    const hit = await cache.restoreCache(CACHE_PATHS[tool], key);
    if (hit) {
      core.info(`Cache hit for ${tool} (key: ${key})`);
      return true;
    }
    core.info(`Cache miss for ${tool} (key: ${key})`);
    return false;
  } catch (error) {
    core.warning(`Cache restore failed for ${tool}: ${error}`);
    return false;
  }
}

/**
 * Save a tool's binaries to the cache.
 * Non-fatal — logs warning on failure.
 */
export async function saveToolCache(tool: ToolName): Promise<void> {
  const key = getCacheKey(tool);
  try {
    await cache.saveCache(CACHE_PATHS[tool], key);
    core.info(`Cache saved for ${tool} (key: ${key})`);
  } catch (error) {
    core.warning(`Cache save failed for ${tool}: ${error}`);
  }
}
