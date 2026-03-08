/**
 * Minimal SARIF v2.1.0 type subset for GHAGGA output.
 *
 * Only the interfaces we produce — not the full 100+ type schema.
 * See: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */

export interface SarifDocument {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

export interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
}

export interface SarifDriver {
  name: string;
  version: string;
  informationUri: string;
  rules: SarifRule[];
}

export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: SarifLevel };
}

export type SarifLevel = 'error' | 'warning' | 'note' | 'none';

export interface SarifResult {
  ruleId: string;
  message: { text: string };
  level: SarifLevel;
  locations: SarifLocation[];
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number };
  };
}
