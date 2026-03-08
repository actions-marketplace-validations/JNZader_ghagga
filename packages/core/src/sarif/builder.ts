/**
 * SARIF v2.1.0 builder — pure function.
 *
 * Maps a ReviewResult to a valid SARIF document for
 * GitHub Code Scanning and other SARIF consumers.
 */

import type { FindingSeverity, ReviewResult } from '../types.js';
import type { SarifDocument, SarifLevel, SarifLocation, SarifResult, SarifRule } from './types.js';

const SARIF_SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json';

/**
 * Map GHAGGA severity to SARIF level.
 */
function toSarifLevel(severity: FindingSeverity): SarifLevel {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'note';
    default:
      return 'note';
  }
}

/**
 * Build a SARIF rule ID from source and category.
 * Format: "source/category" with spaces replaced by dashes.
 */
function buildRuleId(source: string, category: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
  return `${slug(source)}/${slug(category)}`;
}

/**
 * Build a SARIF v2.1.0 document from a ReviewResult.
 *
 * @param result - The review pipeline result
 * @param version - The GHAGGA version string (e.g. "2.5.0")
 * @returns A valid SARIF v2.1.0 document
 */
export function buildSarif(result: ReviewResult, version: string): SarifDocument {
  // Collect unique rules
  const ruleMap = new Map<string, SarifRule>();
  const sarifResults: SarifResult[] = [];

  for (const finding of result.findings) {
    const source = finding.source ?? 'ai';
    const category = finding.category ?? 'general';
    const ruleId = buildRuleId(source, category);

    // Register rule if not seen
    if (!ruleMap.has(ruleId)) {
      ruleMap.set(ruleId, {
        id: ruleId,
        shortDescription: { text: category },
        defaultConfiguration: { level: toSarifLevel(finding.severity) },
      });
    }

    // Build location
    const location: SarifLocation = {
      physicalLocation: {
        artifactLocation: { uri: finding.file },
        ...(finding.line ? { region: { startLine: finding.line } } : {}),
      },
    };

    sarifResults.push({
      ruleId,
      message: { text: finding.message },
      level: toSarifLevel(finding.severity),
      locations: [location],
    });
  }

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ghagga',
            version,
            informationUri: 'https://ghagga.dev',
            rules: Array.from(ruleMap.values()),
          },
        },
        results: sarifResults,
      },
    ],
  };
}
