import type { SystemAnalysisDocument, SystemInteractionContractTarget } from './model.js';
import { assertValidSystemAnalysisDocument } from './validate.js';

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function contractLabel(contract: SystemInteractionContractTarget): string {
  if (contract.targetKind === 'job_queue') {
    return `${contract.technology}:${contract.queue ?? '<dynamic>'}:${contract.job ?? '<queue-wide/dynamic>'}`;
  }
  return `${contract.mode}:${contract.canonicalPattern ?? '<dynamic>'}`;
}

export function renderSystemAnalysisMarkdown(input: SystemAnalysisDocument): string {
  const document = assertValidSystemAnalysisDocument(input);
  const stateCounts = new Map<string, number>();
  for (const correlation of document.correlations) {
    stateCounts.set(correlation.state, (stateCounts.get(correlation.state) ?? 0) + 1);
  }
  const endpoints = new Map(document.interactionEndpoints.map((record) => [record.id, record]));
  const services = new Map(document.services.map((record) => [record.id, record]));
  const lines = [
    `# System analysis: ${document.systemName}`,
    '',
    '> Static artifact correlation only. A declared-realm candidate is conditional and does not prove deployment, broker delivery, handler execution, or downstream effects.',
    '',
    '## Summary',
    '',
    `- Services: ${document.services.length}`,
    `- Broker realms: ${document.brokerRealms.length}`,
    `- Distributed endpoints: ${document.interactionEndpoints.length}`,
    `- Correlations: ${document.correlations.length}`,
    `- Declared-realm candidates: ${stateCounts.get('declared_realm_candidate') ?? 0}`,
    `- Target-only candidates: ${stateCounts.get('target_only_candidate') ?? 0}`,
    `- Ambiguous: ${stateCounts.get('ambiguous') ?? 0}`,
    `- Unmatched: ${stateCounts.get('unmatched') ?? 0}`,
    `- Diagnostics: ${document.diagnostics.length}`,
    '',
    '## Services',
    '',
    '| Namespace | Analysis schema | Result | Artifact label |',
    '| --- | --- | --- | --- |',
    ...document.services.map(
      (service) =>
        `| ${cell(service.namespace)} | ${service.analysisSchemaVersion} | ${service.analysisResultState} | ${cell(service.artifactLabel)} |`,
    ),
    '',
    '## Correlations',
    '',
    '| State | Producer service | Consumer services | Contract | Realm | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
    ...document.correlations.map((correlation) => {
      const producer =
        correlation.producerEndpointId === null
          ? null
          : endpoints.get(correlation.producerEndpointId);
      const consumers = correlation.consumerEndpointIds.flatMap((id) => {
        const endpoint = endpoints.get(id);
        const service = endpoint === undefined ? undefined : services.get(endpoint.serviceId);
        return service === undefined ? [] : [service.namespace];
      });
      const producerService =
        producer === undefined || producer === null
          ? '—'
          : (services.get(producer.serviceId)?.namespace ?? '—');
      const contract =
        producer?.contract ?? endpoints.get(correlation.consumerEndpointIds[0] ?? '')?.contract;
      const reason = correlation.unmatchedReason ?? correlation.ambiguityReason ?? '—';
      return `| ${correlation.state} | ${cell(producerService)} | ${cell(consumers.join(', ') || '—')} | ${cell(contract === undefined ? correlation.contractKey : contractLabel(contract))} | ${cell(correlation.brokerRealmId ?? '—')} | ${reason} |`;
    }),
    '',
  ];
  if (document.diagnostics.length > 0) {
    lines.push(
      '## Diagnostics',
      '',
      ...document.diagnostics.map(
        (diagnostic) => `- \`${diagnostic.code}\`: ${diagnostic.message}`,
      ),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
