/**
 * Token budget management for LLM context windows.
 *
 * Different models have different context window sizes. This module
 * provides utilities to calculate how much of the token budget should
 * be allocated to the diff vs. surrounding context (system prompt,
 * static analysis, memory, stack hints).
 */

// ─── Context Window Sizes ───────────────────────────────────────

/**
 * Known model context window sizes (in tokens).
 * Sourced from official provider documentation as of 2025.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-sonnet-4-20250514': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,

  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,

  // Google
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-flash-lite': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
  'gemini-3-flash': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.0-flash-lite': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
};

/** Default context window when the model is not in our lookup table. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Fraction of total budget allocated to the diff content. */
const DIFF_BUDGET_RATIO = 0.7;

/** Fraction of total budget allocated to context (system, memory, static analysis). */
const CONTEXT_BUDGET_RATIO = 0.3;

// ─── Public API ─────────────────────────────────────────────────

/**
 * Get the context window size for a given model.
 *
 * @param model - Model identifier (e.g., "claude-sonnet-4-20250514", "gpt-4o")
 * @returns Context window size in tokens
 */
export function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

/**
 * Calculate token budgets for diff and context.
 *
 * The diff gets 70% of the total context window, while surrounding
 * context (system prompt, memory, static analysis hints) gets 30%.
 * This ensures the diff always has enough room while leaving space
 * for enrichment.
 *
 * @param model - Model identifier
 * @returns Object with diffBudget and contextBudget in tokens
 */
export function calculateTokenBudget(model: string): {
  diffBudget: number;
  contextBudget: number;
} {
  const total = getContextWindow(model);

  return {
    diffBudget: Math.floor(total * DIFF_BUDGET_RATIO),
    contextBudget: Math.floor(total * CONTEXT_BUDGET_RATIO),
  };
}
