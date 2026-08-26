import type { PolicyResultsDocument } from './model.js';
import { assertValidPolicyResultsDocument } from './validate.js';

function escapeMarkdown(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

export function renderPolicyResultsMarkdown(input: PolicyResultsDocument): string {
  const document = assertValidPolicyResultsDocument(input);
  const lines = [
    '# API Intelligence Policy Results',
    '',
    '> A proven guard declaration is a static guard-policy fact, not proof of authentication or runtime authorization.',
    '',
    `Policy schema: \`${document.schemaVersion}\`  `,
    `Analysis: \`${document.analysis.analysisId}\` (analysis \`${document.analysis.analysisSchemaVersion}\`, ${document.analysis.resultState})  `,
    `Baseline: ${document.baseline === null ? 'not supplied' : `\`${document.baseline.analysisId}\` (analysis \`${document.baseline.analysisSchemaVersion}\`)`}`,
    '',
    '## Summary',
    '',
    '| Outcome | Count |',
    '| --- | ---: |',
    `| Passed | ${document.summary.passed} |`,
    `| Failed | ${document.summary.failed} |`,
    `| Unknown | ${document.summary.unknown} |`,
    `| Not applicable | ${document.summary.notApplicable} |`,
    `| Warning findings | ${document.summary.warnings} |`,
    `| Error findings | ${document.summary.errors} |`,
    `| Blocking findings | ${document.summary.blocking} |`,
    '',
    '## Configured rules',
    '',
    '| Rule | Severity | Unknown severity | Options |',
    '| --- | --- | --- | --- |',
  ];
  for (const rule of document.configuration.rules) {
    const options =
      rule.minimumSeverity === undefined
        ? '-'
        : `minimum diagnostic severity: ${rule.minimumSeverity}`;
    lines.push(`| \`${rule.ruleId}\` | ${rule.severity} | ${rule.onUnknown} | ${options} |`);
  }

  lines.push(
    '',
    '## Results',
    '',
    '| Outcome | Severity | Rule | Subject | Reason | Message |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const result of document.results) {
    lines.push(
      `| ${result.outcome}${result.blocking ? ' (blocking)' : ''} | ${result.severity} | \`${result.ruleId}\` v${result.ruleVersion} | ${escapeMarkdown(result.subject.displayName)} | \`${result.reasonCode}\` | ${escapeMarkdown(result.message)} |`,
    );
  }

  lines.push('', '## Canonical and evidence references', '');
  for (const result of document.results) {
    lines.push(
      `- \`${result.ruleId}\` / ${escapeMarkdown(result.subject.displayName)}: canonical=${result.subject.canonicalIds.map((id) => `\`${id}\``).join(', ')}; evidence=${result.evidenceIds.map((id) => `\`${id}\``).join(', ') || 'none'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
