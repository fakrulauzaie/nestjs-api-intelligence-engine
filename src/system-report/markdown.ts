import type { SystemReportDocument } from './model.js';
import { assertValidSystemReportDocument } from './validate.js';

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderSystemReportMarkdown(input: SystemReportDocument): string {
  const document = assertValidSystemReportDocument(input);
  const lines = [
    `# System report: ${document.system.name}`,
    '',
    '> Static artifact projection only. Every cross-service path is a conditional candidate; broker delivery, handler execution, and downstream effects are not runtime-proven.',
    '',
    '## Summary',
    '',
    `- Services: ${document.summary.services}`,
    `- Broker realms: ${document.summary.brokerRealms}`,
    `- Declared-realm candidates: ${document.summary.declaredRealmCandidates}`,
    `- Conditional paths: ${document.summary.conditionalPaths}`,
    `- Worker-side effects on conditional paths: ${document.summary.workerEffects}`,
    `- Policy failures: ${document.summary.policyFailures}`,
    `- Diagnostics: ${document.summary.diagnostics}`,
    `- Display omissions: ${document.summary.omittedNodes} nodes, ${document.summary.omittedEdges} edges`,
    '',
    '## Conditional paths',
    '',
    '| Root | Producer | Broker destination | Candidate consumer | Effects | Completeness |',
    '| --- | --- | --- | --- | ---: | --- |',
    ...document.conditionalPaths.map(
      (path) =>
        `| ${cell(path.httpRootNodeId ?? 'non-HTTP/unobserved')} | ${path.producerNodeId} | ${path.brokerDestinationNodeId} | ${path.consumerNodeId} | ${path.effectNodeIds.length} | ${path.completeness} |`,
    ),
    '',
    '## Typed policy results',
    '',
    '| Rule | Outcome | Reason |',
    '| --- | --- | --- |',
    ...document.policies.results.map(
      (result) => `| ${result.ruleId} | ${result.outcome} | ${cell(result.message)} |`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
