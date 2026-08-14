import type { ScoreResult } from '../types.js';

/** Minimal SARIF 2.1.0 for CI integrations */
export function formatSarif(result: ScoreResult): string {
  const rulesMap = new Map<string, { id: string; shortDescription: { text: string } }>();
  for (const f of result.findings) {
    if (!rulesMap.has(f.rule)) {
      rulesMap.set(f.rule, {
        id: f.rule,
        shortDescription: { text: f.rule },
      });
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
          level:
            f.severity === 'error'
              ? 'error'
              : f.severity === 'warning'
                ? 'warning'
                : 'note',
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
