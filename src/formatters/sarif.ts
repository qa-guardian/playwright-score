import type { Finding, ScoreResult } from '../types.js';
import type { Tier } from '../catalogue/types.js';
import { viewTier } from '../report-view.js';

/** QAG-287 S10a: SARIF level by tier. Every finding is reported; advisory and needs-check as `note`. */
export const SARIF_LEVEL: Record<Tier, 'error' | 'warning' | 'note'> = {
  certain: 'error',
  likely: 'warning',
  advisory: 'note',
  'needs-check': 'note',
};

export function sarifLevel(f: Finding): 'error' | 'warning' | 'note' {
  // QAG-287 FIX1: no-files has no tier; its level follows its JSON severity (error).
  if (f.rule === 'playwright-score/no-files') return 'error';
  return SARIF_LEVEL[viewTier(f)];
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri?: string;
}

/** Minimal SARIF 2.1.0 for CI integrations */
export function formatSarif(result: ScoreResult): string {
  const rulesMap = new Map<string, SarifRule>();
  for (const f of result.findings) {
    const known = rulesMap.get(f.rule);
    if (!known) {
      rulesMap.set(f.rule, {
        id: f.rule,
        shortDescription: { text: f.title ?? f.rule },
        ...(f.docs ? { helpUri: f.docs } : {}),
      });
    } else if (!known.helpUri && f.docs) {
      known.helpUri = f.docs;
    }
  }

  const sarif = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'playwright-score',
            informationUri: 'https://github.com/qa-guardian/playwright-score',
            version: result.scoreVersion,
            rules: [...rulesMap.values()],
          },
        },
        results: result.findings.map((f) => ({
          ruleId: f.rule,
          level: sarifLevel(f),
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                region: f.line
                  ? { startLine: f.line, startColumn: f.column ?? 1 }
                  : undefined,
              },
            },
          ],
        })),
        properties: {
          score: result.score,
          grade: result.grade,
          pass: result.pass,
          profile: result.profile,
          threshold: result.threshold,
        },
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
