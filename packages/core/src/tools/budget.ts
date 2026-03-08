/**
 * Time Budget Manager — allocates and manages execution time across tools.
 *
 * - Total budget defaults to 600,000ms (10 minutes)
 * - Minimum per-tool budget is 30,000ms (30 seconds)
 * - Always-on tools get priority when budget is tight
 * - Unused time from fast tools rolls over to subsequent tools
 */

import type { ActivatedTool } from './resolve.js';
import type { TimeBudget } from './types.js';

const DEFAULT_TOTAL_BUDGET_MS = 600_000; // 10 minutes
const MINIMUM_PER_TOOL_MS = 30_000; // 30 seconds

/**
 * Allocate time budget across activated tools.
 *
 * Equal share: totalBudgetMs / toolCount.
 * If equal share < minimum, always-on tools get minimum first,
 * remaining budget is split among auto-detect tools.
 */
export function allocateTimeBudget(
  activatedTools: ActivatedTool[],
  totalBudgetMs: number = DEFAULT_TOTAL_BUDGET_MS,
): TimeBudget {
  const perToolMs = new Map<string, number>();

  if (activatedTools.length === 0) {
    return { totalMs: totalBudgetMs, perToolMs, minimumPerToolMs: MINIMUM_PER_TOOL_MS };
  }

  const equalShare = Math.floor(totalBudgetMs / activatedTools.length);

  if (equalShare >= MINIMUM_PER_TOOL_MS) {
    // Everyone gets equal share
    for (const tool of activatedTools) {
      perToolMs.set(tool.definition.name, equalShare);
    }
  } else {
    // Budget is tight — always-on gets priority
    const alwaysOnTools = activatedTools.filter((t) => t.reason === 'always-on');
    const otherTools = activatedTools.filter((t) => t.reason !== 'always-on');

    // Give always-on tools their minimum first
    let remainingBudget = totalBudgetMs;
    for (const tool of alwaysOnTools) {
      perToolMs.set(tool.definition.name, MINIMUM_PER_TOOL_MS);
      remainingBudget -= MINIMUM_PER_TOOL_MS;
    }

    // Distribute remaining among non-always-on tools
    if (otherTools.length > 0 && remainingBudget > 0) {
      const otherShare = Math.max(
        Math.floor(remainingBudget / otherTools.length),
        MINIMUM_PER_TOOL_MS,
      );
      for (const tool of otherTools) {
        perToolMs.set(tool.definition.name, otherShare);
      }
    } else {
      // No budget left for other tools — give them minimum anyway
      for (const tool of otherTools) {
        perToolMs.set(tool.definition.name, MINIMUM_PER_TOOL_MS);
      }
    }
  }

  return { totalMs: totalBudgetMs, perToolMs, minimumPerToolMs: MINIMUM_PER_TOOL_MS };
}

/**
 * Calculate the effective budget for the next tool, adding rollover from fast tools.
 *
 * rollover = sum of (allocated - actual) for all completed tools
 * effectiveBudget = allocated + rollover (clamped to remaining total budget)
 */
export function getEffectiveBudget(
  toolName: string,
  budget: TimeBudget,
  elapsedByTool: Map<string, number>,
): number {
  const allocated = budget.perToolMs.get(toolName) ?? budget.minimumPerToolMs;

  // Calculate rollover from tools that finished faster than allocated
  let rollover = 0;
  for (const [name, elapsed] of elapsedByTool) {
    const toolAllocated = budget.perToolMs.get(name) ?? 0;
    if (elapsed < toolAllocated) {
      rollover += toolAllocated - elapsed;
    }
  }

  // Calculate total elapsed time to ensure we don't exceed total budget
  const totalElapsed = Array.from(elapsedByTool.values()).reduce((sum, ms) => sum + ms, 0);
  const remainingTotal = Math.max(0, budget.totalMs - totalElapsed);

  // Effective budget: allocated + rollover, but can't exceed remaining total
  return Math.min(allocated + rollover, remainingTotal);
}
