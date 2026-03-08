/**
 * Health command — quick project health check with scoring and trends.
 *
 * Does NOT require authentication. Runs always-on static analysis
 * tools locally and computes a health score with trends.
 */

import { resolve } from 'node:path';
import type { HealthHistoryEntry, ReviewFinding } from 'ghagga-core';
import {
  computeHealthScore,
  computeTrend,
  createNodeExecutionContext,
  formatTopIssues,
  generateRecommendations,
  initializeDefaultTools,
  loadHistory,
  resolveActivatedTools,
  runTools,
  saveHistory,
  toolRegistry,
} from 'ghagga-core';
import { getConfigDir } from '../lib/config.js';
import { resolveProjectId } from '../lib/git.js';
import { formatHealthScore, formatSeverityLine } from '../ui/format.js';
import * as tui from '../ui/tui.js';

// ─── Types ──────────────────────────────────────────────────────

export interface HealthOptions {
  /** Output format: 'json' or default (styled TUI). */
  output?: string;
  /** Plain mode. */
  plain?: boolean;
  /** Number of top issues to show (default: 5). */
  top?: number;
}

// ─── Constants ──────────────────────────────────────────────────

/** Direction arrows for trend display. */
const TREND_ARROWS: Record<string, string> = {
  up: '↑',
  down: '↓',
  unchanged: '→',
};

// ─── Main Command ───────────────────────────────────────────────

export async function healthCommand(targetPath: string, options: HealthOptions): Promise<void> {
  const repoPath = resolve(targetPath);
  const top = options.top ?? 5;

  try {
    // Step 1: Initialize tool registry
    initializeDefaultTools();

    if (!options.output) {
      tui.intro('🏥 GHAGGA Health Check');
    }

    // Step 2: Run static analysis (always-on tools only)
    if (!options.output) {
      tui.log.step('Running static analysis...');
    }

    const alwaysOnTools = resolveActivatedTools({
      registry: toolRegistry,
      files: [],
      enabledTools: toolRegistry
        .getAll()
        .filter((t) => t.tier === 'always-on')
        .map((t) => t.name),
    });

    const ctx = createNodeExecutionContext();
    const staticResult = await runTools(ctx, alwaysOnTools, repoPath, []);

    // Step 3: Collect all findings
    const allFindings: ReviewFinding[] = [];
    const toolsRun: string[] = [];

    for (const [toolName, toolResult] of Object.entries(staticResult)) {
      if (toolResult.status === 'success' || toolResult.status === 'error') {
        toolsRun.push(toolName);
      }
      allFindings.push(...toolResult.findings);
    }

    // Step 4: Compute health score
    const healthScore = computeHealthScore(allFindings);

    // Step 5: Load history and compute trend
    const projectPath = resolveProjectId(repoPath);
    const configDir = getConfigDir();
    const history = loadHistory(configDir, projectPath);
    const trend = computeTrend(healthScore.score, history);

    // Step 6: Generate recommendations
    const recommendations = generateRecommendations(allFindings, top);

    // Step 7: Get top issues
    const topIssues = formatTopIssues(allFindings, top);

    // Step 8: Output
    if (options.output === 'json') {
      const result = {
        score: healthScore,
        trend,
        recommendations,
        topIssues: topIssues.map((f) => ({
          file: f.file,
          line: f.line,
          severity: f.severity,
          category: f.category,
          message: f.message,
          source: f.source,
        })),
        toolsRun,
        timestamp: new Date().toISOString(),
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      renderStyledOutput(healthScore, trend, topIssues, recommendations, toolsRun);
    }

    // Step 9: Save history
    const entry: HealthHistoryEntry = {
      timestamp: new Date().toISOString(),
      score: healthScore.score,
      findingCounts: { ...healthScore.findingCounts },
      toolsRun,
      projectPath,
    };
    saveHistory(configDir, entry);

    if (!options.output) {
      tui.outro('Health check complete');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tui.log.error(`\n❌ Health check failed: ${message}`);
    process.exit(1);
  }
}

// ─── Styled Output ──────────────────────────────────────────────

function renderStyledOutput(
  healthScore: ReturnType<typeof computeHealthScore>,
  trend: ReturnType<typeof computeTrend>,
  topIssues: ReviewFinding[],
  recommendations: ReturnType<typeof generateRecommendations>,
  toolsRun: string[],
): void {
  // Score box
  const scoreLines = formatHealthScore(healthScore.score, healthScore.grade);

  // Add trend info
  if (trend.direction) {
    const arrow = TREND_ARROWS[trend.direction] ?? '';
    const deltaStr =
      trend.delta !== null ? (trend.delta > 0 ? `+${trend.delta}` : String(trend.delta)) : '';
    scoreLines.push(`Trend: ${arrow} ${deltaStr} (previous: ${trend.previous})`);
  } else {
    scoreLines.push('Trend: First run — no history yet');
  }

  scoreLines.push('');
  scoreLines.push(`Tools: ${toolsRun.join(', ')}`);

  tui.log.message(tui.box('Health Score', scoreLines));

  // Top issues
  if (topIssues.length > 0) {
    tui.log.message('');
    tui.log.message(tui.divider('Top Issues'));
    for (const issue of topIssues) {
      tui.log.message(`  ${formatSeverityLine(issue)}`);
    }
  }

  // Recommendations
  if (recommendations.length > 0) {
    tui.log.message('');
    tui.log.message(tui.divider('Recommendations'));
    for (const rec of recommendations) {
      const impact = rec.impact === 'high' ? '🔴' : rec.impact === 'medium' ? '🟡' : '🟢';
      tui.log.message(`  ${impact} [${rec.category}] ${rec.action}`);
    }
  }
}
