export {
  generateRecommendations,
  type HealthRecommendation,
} from './recommendations.js';
export {
  computeHealthScore,
  formatTopIssues,
  getScoreColor,
  type HealthScore,
  SEVERITY_WEIGHTS,
} from './score.js';
export {
  computeTrend,
  type HealthHistoryEntry,
  type HealthTrend,
  loadHistory,
  saveHistory,
} from './trends.js';
