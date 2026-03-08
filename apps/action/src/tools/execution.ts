/**
 * Actions execution context — wraps @actions/exec + @actions/cache.
 *
 * Implements the ExecutionContext interface from @ghagga/core
 * using GitHub Actions-specific APIs for command execution and caching.
 */

import * as actionsCache from '@actions/cache';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import type { ExecOptions, ExecutionContext, RawToolOutput } from 'ghagga-core';

/**
 * Create a GitHub Actions-based ExecutionContext.
 *
 * Uses `@actions/exec` for command execution (with timeout via AbortController)
 * and `@actions/cache` for tool binary caching across workflow runs.
 */
export function createActionsExecutionContext(): ExecutionContext {
  return {
    async exec(command: string, args: string[], opts: ExecOptions): Promise<RawToolOutput> {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutMs = opts.timeoutMs;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      try {
        const execPromise = exec.exec(command, args, {
          cwd: opts.cwd,
          env: opts.env
            ? (Object.fromEntries(
                Object.entries({ ...process.env, ...opts.env }).filter(
                  (entry): entry is [string, string] => entry[1] !== undefined,
                ),
              ) as Record<string, string>)
            : undefined,
          silent: true,
          ignoreReturnCode: true,
          listeners: {
            stdout: (data: Buffer) => {
              stdout += data.toString();
            },
            stderr: (data: Buffer) => {
              stderr += data.toString();
            },
          },
        });

        const exitCode = await Promise.race([execPromise, timeoutPromise]);

        return {
          stdout,
          stderr,
          exitCode,
          timedOut: false,
        };
      } catch (error) {
        if (timedOut) {
          return {
            stdout,
            stderr,
            exitCode: -1,
            timedOut: true,
          };
        }
        throw error;
      }
    },

    async cacheRestore(toolName: string, paths: string[]): Promise<boolean> {
      const key = `ghagga-${toolName}-${process.env.RUNNER_OS ?? 'Linux'}`;
      try {
        const hit = await actionsCache.restoreCache(paths, key);
        if (hit) {
          core.info(`[ghagga:tools] Cache hit for ${toolName} (key: ${hit})`);
          return true;
        }
        core.info(`[ghagga:tools] Cache miss for ${toolName}`);
        return false;
      } catch (error) {
        core.warning(
          `[ghagga:tools] Cache restore failed for ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },

    async cacheSave(toolName: string, paths: string[]): Promise<void> {
      const key = `ghagga-${toolName}-${process.env.RUNNER_OS ?? 'Linux'}`;
      try {
        await actionsCache.saveCache(paths, key);
        core.info(`[ghagga:tools] Cache saved for ${toolName}`);
      } catch (error) {
        core.warning(
          `[ghagga:tools] Cache save failed for ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },

    log(level: 'info' | 'warn' | 'error', message: string): void {
      switch (level) {
        case 'info':
          core.info(message);
          break;
        case 'warn':
          core.warning(message);
          break;
        case 'error':
          core.error(message);
          break;
      }
    },
  };
}
