/**
 * Action Tool Infrastructure — Public API
 *
 * Re-exports the orchestrator entry point and shared types.
 */

export { runLocalAnalysis } from './orchestrator.js';
export type {
  ExecResult,
  FindingSeverity,
  ReviewFinding,
  StaticAnalysisResult,
  ToolName,
  ToolResult,
  ToolRunConfig,
} from './types.js';
export { TOOL_TIMEOUT_MS, TOOL_VERSIONS } from './types.js';
