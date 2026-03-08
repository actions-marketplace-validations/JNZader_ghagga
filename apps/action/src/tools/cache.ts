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
import { toolRegistry } from 'ghagga-core';
import type { ToolName } from './types.js';
import { TOOL_VERSIONS } from './types.js';

/**
 * Get cache paths for a tool from the registry.
 */
function getCachePaths(tool: ToolName): string[] {
  const definition = toolRegistry.getByName(tool);
  return definition?.cachePaths ?? [];
}

/**
 * Get the cache key for a tool.
 * Format: ghagga-{tool}-{version}-{RUNNER_OS}
 */
function getCacheKey(tool: ToolName): string {
  const definition = toolRegistry.getByName(tool);
  const version =
    definition?.version ??
    TOOL_VERSIONS[tool === 'cpd' ? 'pmd' : (tool as keyof typeof TOOL_VERSIONS)] ??
    'unknown';

  return `ghagga-${tool}-${version}-${process.env.RUNNER_OS ?? 'Linux'}`;
}

/**
 * Attempt to restore a tool's cached binaries.
 * @returns true if cache hit, false if miss or error
 */
export async function restoreToolCache(tool: ToolName): Promise<boolean> {
  const key = getCacheKey(tool);
  const paths = getCachePaths(tool);
  try {
    const hit = await cache.restoreCache(paths, key);
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
  const paths = getCachePaths(tool);
  try {
    await cache.saveCache(paths, key);
    core.info(`Cache saved for ${tool} (key: ${key})`);
  } catch (error) {
    core.warning(`Cache save failed for ${tool}: ${error}`);
  }
}
