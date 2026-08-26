import type { ImpactDocument, ImpactPath } from './model.js';
import { assertValidImpactDocument } from './validate.js';

function escapeMarkdown(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function renderPath(path: ImpactPath): string {
  if (path.steps.length === 0) return `${path.side}: endpoint subject`;
  const relations = path.steps.map(({ predicate, status }) =>
    status === 'resolved' ? predicate : `${predicate} (${status})`,
  );
  return `${path.side}: ${relations.join(' → ')}`;
}

export function renderImpactMarkdown(input: ImpactDocument): string {
  const document = assertValidImpactDocument(input);
  const lines = [
    '# API Intelligence Potential Impact',
    '',
    '> Potential impact means a changed static fact is reachable from an endpoint. It does not prove runtime behavior changed.',
    '',
    `Impact schema: \`${document.schemaVersion}\`  `,
    `Before: \`${document.before.analysisId}\`  `,
    `After: \`${document.after.analysisId}\`  `,
    `Call depth: before=${document.before.configuration.maxCallDepth}, after=${document.after.configuration.maxCallDepth}`,
    '',
    '## Summary',
    '',
    '| Category | Count |',
    '| --- | ---: |',
    `| Source files added | ${document.summary.sourceFilesAdded} |`,
    `| Source files removed | ${document.summary.sourceFilesRemoved} |`,
    `| Source files modified | ${document.summary.sourceFilesModified} |`,
    `| Impacted endpoint slots | ${document.summary.impactedEndpointSlots} |`,
    `| Directly changed endpoint slots | ${document.summary.directlyChangedEndpointSlots} |`,
    `| Transitively impacted endpoint slots | ${document.summary.transitivelyImpactedEndpointSlots} |`,
    `| Changed but unreachable source files | ${document.summary.unreachableSourceChanges} |`,
    '',
    '## Impacted endpoints',
    '',
  ];

  if (document.impactedEndpoints.length === 0) {
    lines.push('No endpoint is reachable from a changed supported fact.');
  } else {
    for (const endpoint of document.impactedEndpoints) {
      lines.push(
        `### ${escapeMarkdown(endpoint.httpMethod)} ${escapeMarkdown(endpoint.path)}`,
        '',
        `Classification: **${endpoint.direct ? 'direct endpoint change' : 'potential transitive impact'}**  `,
        `Endpoint IDs: before=${endpoint.beforeEndpointIds.map((id) => `\`${id}\``).join(', ') || 'none'}; after=${endpoint.afterEndpointIds.map((id) => `\`${id}\``).join(', ') || 'none'}`,
        '',
      );
      for (const reason of endpoint.reasons) {
        const source =
          reason.sourceChangePath === null
            ? ''
            : `; source=\`${escapeMarkdown(reason.sourceChangePath)}\``;
        lines.push(
          `- **${reason.category} / ${reason.reasonCode}** — ${escapeMarkdown(reason.subject.displayName)}${source}`,
        );
        for (const path of reason.paths) {
          const evidence = path.steps.flatMap(({ evidenceIds }) => evidenceIds);
          lines.push(
            `  - ${renderPath(path)}; assertions=${path.steps.map(({ assertionId }) => `\`${assertionId}\``).join(', ') || 'none'}; evidence=${evidence.map((id) => `\`${id}\``).join(', ') || 'reason evidence'}`,
          );
        }
      }
      lines.push('');
    }
  }

  lines.push('## Changed but unreachable source files', '');
  if (document.unreachableSourceChanges.length === 0) {
    lines.push(
      'Every changed source file with supported declarations has a recorded endpoint path.',
    );
  } else {
    for (const source of document.unreachableSourceChanges) {
      lines.push(
        `- \`${escapeMarkdown(source.path)}\` (${source.change}): ${source.reasonCodes.join(', ')}; subjects before=${source.beforeSubjectKeys.length}, after=${source.afterSubjectKeys.length}`,
      );
    }
  }

  lines.push('', '## Source changes', '');
  if (document.sourceChanges.length === 0) {
    lines.push('No source path or content-hash changes were derived from the supplied analyses.');
  } else {
    for (const change of document.sourceChanges) {
      lines.push(
        `- **${change.change}** \`${escapeMarkdown(change.path)}\`: before=${change.before?.contentHash ?? 'none'}, after=${change.after?.contentHash ?? 'none'}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
