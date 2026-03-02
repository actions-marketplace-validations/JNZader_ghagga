/**
 * Tech stack detection from file extensions.
 *
 * Analyzes a list of file paths (typically from a diff) to determine
 * which technology stacks are involved. This allows the review engine
 * to inject stack-specific review hints into agent prompts.
 */

import { extname } from 'node:path';

/**
 * Mapping of file extensions to the technology stacks they represent.
 * Some extensions map to multiple stacks (e.g., .tsx → typescript + react).
 */
const EXTENSION_MAP: Record<string, string[]> = {
  '.ts': ['typescript'],
  '.tsx': ['typescript', 'react'],
  '.js': ['javascript'],
  '.jsx': ['javascript', 'react'],
  '.mjs': ['javascript'],
  '.cjs': ['javascript'],
  '.py': ['python'],
  '.java': ['java'],
  '.kt': ['kotlin'],
  '.kts': ['kotlin'],
  '.go': ['go'],
  '.rs': ['rust'],
  '.sql': ['sql'],
  '.cs': ['csharp'],
  '.rb': ['ruby'],
  '.php': ['php'],
  '.swift': ['swift'],
  '.scala': ['scala'],
  '.ex': ['elixir'],
  '.exs': ['elixir'],
};

/**
 * Detect technology stacks from a list of file paths.
 *
 * @param fileList - Array of file paths (e.g., ["src/index.ts", "lib/utils.py"])
 * @returns Deduplicated array of stack names (e.g., ["typescript", "python"])
 */
export function detectStacks(fileList: string[]): string[] {
  const stacks = new Set<string>();

  for (const filePath of fileList) {
    const ext = extname(filePath).toLowerCase();
    const mapped = EXTENSION_MAP[ext];
    if (mapped) {
      for (const stack of mapped) {
        stacks.add(stack);
      }
    }
  }

  return [...stacks];
}
