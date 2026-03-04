/**
 * Action Tool Infrastructure — Public API
 *
 * Re-exports the orchestrator entry point and shared types.
 */

export { runLocalAnalysis } from './orchestrator.js';
export type {
  ToolName,
  ToolResult,
  StaticAnalysisResult,
  ReviewFinding,
  FindingSeverity,
  ToolRunConfig,
  ExecResult,
} from './types.js';
export { TOOL_VERSIONS, TOOL_TIMEOUT_MS } from './types.js';
