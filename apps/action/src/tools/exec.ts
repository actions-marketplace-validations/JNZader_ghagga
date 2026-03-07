/**
 * Exec wrapper with timeout and captured output.
 *
 * Wraps `@actions/exec` with Promise.race timeout, captured stdout/stderr,
 * and configurable error handling for non-zero exit codes.
 */

import * as exec from '@actions/exec';
import type { ExecResult } from './types.js';
import { TOOL_TIMEOUT_MS } from './types.js';

/**
 * Execute a command with timeout and captured output.
 * Never throws — returns result with exitCode, stdout, stderr.
 * Throws only on timeout or when allowNonZero is false and exitCode !== 0.
 */
export async function execWithTimeout(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number;
    allowNonZero?: boolean;
    cwd?: string;
  } = {},
): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? TOOL_TIMEOUT_MS;
  let stdout = '';
  let stderr = '';

  const execPromise = exec.exec(command, args, {
    cwd: options.cwd,
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

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const exitCode = await Promise.race([execPromise, timeoutPromise]);

  if (!options.allowNonZero && exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${stderr.slice(0, 500)}`);
  }

  return { exitCode, stdout, stderr };
}
