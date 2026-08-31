import {
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  analysisHasResourceAccessFacts,
  type AnalysisDocument,
  type EndpointTraceView,
} from '../model/analysis.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import { resourceAccessLabel } from '../model/resource-access.js';
import { buildEndpointAuthorization } from '../authorization/endpoint-authorization.js';
import {
  inProcessEventTargetLabel,
  jobQueueTargetLabel,
  microserviceMessageTargetLabel,
  outboundHttpTargetLabel,
} from './interaction-labels.js';

function escapeTableCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function recordLabel(analysis: AnalysisDocument, id: string | null): string {
  if (id === null) return 'unresolved';
  const endpoint = analysis.endpoints.find((record) => record.id === id);
  if (endpoint !== undefined) return `${endpoint.httpMethod} ${endpoint.path}`;
  const method = analysis.methods.find((record) => record.id === id);
  if (method !== undefined) return method.qualifiedName;
  const table = analysis.tables.find((record) => record.id === id);
  if (table !== undefined) return table.name;
  const guard = analysis.guards.find((record) => record.id === id);
  if (guard !== undefined) return guard.displayName;
  if (analysisHasResourceAccessFacts(analysis)) {
    const resourceAccess = analysis.resourceAccesses.find((record) => record.id === id);
    if (resourceAccess !== undefined) return resourceAccessLabel(resourceAccess);
  }
  if (analysisHasInteractionFacts(analysis)) {
    const interaction = analysis.interactions.find((record) => record.id === id);
    if (interaction?.kind === 'outbound_http') {
      return outboundHttpTargetLabel(interaction.target);
    }
    if (interaction?.kind === 'in_process_event') {
      return `event ${inProcessEventTargetLabel(interaction.target)}`;
    }
    if (interaction?.kind === 'job_queue') return jobQueueTargetLabel(interaction.target);
    if (interaction?.kind === 'microservice_message') {
      return microserviceMessageTargetLabel(interaction.target);
    }
    const handler = analysis.interactionHandlers.find((record) => record.id === id);
    if (handler?.kind === 'in_process_event') {
      return `@OnEvent ${inProcessEventTargetLabel(handler.target)} (${handler.registrationState})`;
    }
    if (handler?.kind === 'job_queue') {
      return `@Processor ${jobQueueTargetLabel(handler.target)} (${handler.registrationState})`;
    }
    if (handler?.kind === 'microservice_message') {
      const decorator = handler.target.mode === 'event' ? '@EventPattern' : '@MessagePattern';
      return `${decorator} ${microserviceMessageTargetLabel(handler.target)} (${handler.registrationState})`;
    }
  }
  return id;
}

function evidenceReferences(analysis: AnalysisDocument, evidenceIds: readonly string[]): string[] {
  const evidenceById = new Map(analysis.evidence.map((record) => [record.id, record]));
  const sourceById = new Map(analysis.sourceFiles.map((record) => [record.id, record]));
  return evidenceIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    const source = evidence === undefined ? undefined : sourceById.get(evidence.fileId);
    return evidence === undefined || source === undefined
      ? []
      : [`${evidence.role} ${source.path}:${evidence.startLine}:${evidence.startColumn}`];
  });
}

function renderDiagnosticList(
  analysis: AnalysisDocument,
  diagnostics: readonly DiagnosticRecord[],
): string[] {
  return diagnostics.map((diagnostic) => {
    const references = evidenceReferences(analysis, diagnostic.evidenceIds);
    return `- \`${diagnostic.code}\`: ${diagnostic.message}${
      references.length === 0
        ? ''
        : ` Evidence: ${references.map((item) => `\`${item}\``).join(', ')}.`
    }`;
  });
}

export function renderEndpointTraceMarkdown(input: {
  analysis: AnalysisDocument;
  trace: EndpointTraceView;
  diagnostics: readonly DiagnosticRecord[];
}): string {
  const { analysis, trace } = input;
  const diagnostics = input.diagnostics.filter(
    (diagnostic) => diagnostic.code !== 'AUTH_GLOBAL_POLICY_UNKNOWN',
  );
  const limitations = input.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'AUTH_GLOBAL_POLICY_UNKNOWN',
  );
  const lines = [
    '# Endpoint Trace',
    '',
    `Analysis: \`${trace.analysisId}\`  `,
    `Endpoint: \`${trace.endpoint.httpMethod} ${trace.endpoint.path}\`  `,
    `Direct guards: \`${trace.directGuardState}\`  `,
    `Global guards: \`${trace.globalGuardState}\`  `,
    `Effective guard state: \`${trace.effectiveGuardState}\``,
    '',
    '## Guards',
    '',
  ];

  if (trace.guards.length === 0) {
    lines.push(
      'No supported effective guard declaration was found. This is not proof that the endpoint is public or unprotected.',
    );
  } else {
    lines.push(
      '| Guard | Scope | Status | Evidence |',
      '|---|---|---|---|',
      ...trace.guards.map(
        (guard) =>
          `| ${escapeTableCell(guard.name)} | ${guard.scope} | ${guard.status} | ${escapeTableCell(evidenceReferences(analysis, guard.evidenceIds).join('<br>'))} |`,
      ),
    );
  }

  const authorization = buildEndpointAuthorization(analysis, trace.endpoint.id);
  lines.push('', '## Authorization metadata', '');
  if (authorization.availability === 'unavailable') {
    lines.push('Authorization metadata facts are unavailable in this analysis schema.');
  } else if (authorization.requirements.length === 0) {
    lines.push('No supported authorization metadata declaration was proven.');
  } else {
    lines.push(
      '| Metadata key | Scope | Source | Value shape | Enforcement | Guard | Evidence |',
      '|---|---|---|---|---|---|---|',
      ...authorization.requirements.map(
        (requirement) =>
          `| ${escapeTableCell(requirement.metadataKey)} | ${requirement.scope} | ${requirement.source} | ${requirement.valueShape.kind} (redacted) | ${requirement.enforcementState} | ${escapeTableCell(requirement.guardName ?? 'unknown')} | ${escapeTableCell(evidenceReferences(analysis, requirement.evidenceIds).join('<br>'))} |`,
      ),
    );
  }

  lines.push('', '## Trace steps', '');
  if (trace.steps.length === 0) {
    lines.push('No trace steps were resolved.');
  } else {
    lines.push(
      '| From | Relation | To | Status | Evidence |',
      '|---|---|---|---|---|',
      ...trace.steps.map(
        (step) =>
          `| ${escapeTableCell(recordLabel(analysis, step.fromId))} | ${step.relation} | ${escapeTableCell(recordLabel(analysis, step.toId))} | ${step.status} | ${escapeTableCell(evidenceReferences(analysis, step.evidenceIds).join('<br>'))} |`,
      ),
    );
  }

  if (analysisHasInteractionFacts(analysis)) {
    const interactionById = new Map(analysis.interactions.map((record) => [record.id, record]));
    const outbound = trace.steps.flatMap((step) => {
      if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
      const interaction = interactionById.get(step.toId);
      return interaction?.kind === 'outbound_http' ? [interaction] : [];
    });
    if (outbound.length > 0) {
      lines.push(
        '',
        '## Outbound HTTP interactions',
        '',
        '| Method and target | Resolution | Activation | Boundary | Evidence |',
        '|---|---|---|---|---|',
        ...outbound.map(
          (interaction) =>
            `| ${escapeTableCell(outboundHttpTargetLabel(interaction.target))} | ${interaction.target.url.resolution} | ${interaction.activation} | ${interaction.boundary} | ${escapeTableCell(evidenceReferences(analysis, interaction.evidenceIds).join('<br>'))} |`,
        ),
      );
    }
    const localEvents = trace.steps.flatMap((step) => {
      if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
      const interaction = interactionById.get(step.toId);
      return interaction?.kind === 'in_process_event' ? [interaction] : [];
    });
    if (localEvents.length > 0) {
      const handlerById = new Map(
        analysis.interactionHandlers.map((record) => [record.id, record]),
      );
      const matchesByInteraction = new Map<string, string[]>();
      for (const step of trace.steps) {
        if (step.relation !== 'INTERACTION_MATCHES_LOCAL_HANDLER' || step.toId === null) continue;
        const handler = handlerById.get(step.toId);
        if (handler === undefined) continue;
        matchesByInteraction.set(step.fromId, [
          ...(matchesByInteraction.get(step.fromId) ?? []),
          handler.registrationState,
        ]);
      }
      lines.push(
        '',
        '## In-process event interactions',
        '',
        '| Event identity | Dispatch timing | Boundary | Local handler candidates | Evidence |',
        '|---|---|---|---|---|',
        ...localEvents.map((interaction) => {
          const states = matchesByInteraction.get(interaction.id) ?? [];
          return `| ${escapeTableCell(inProcessEventTargetLabel(interaction.target))} | ${interaction.dispatchTiming} | ${interaction.boundary} | ${escapeTableCell(states.length === 0 ? 'none_proven' : states.sort().join(', '))} | ${escapeTableCell(evidenceReferences(analysis, interaction.evidenceIds).join('<br>'))} |`;
        }),
      );
    }
    const jobQueues = trace.steps.flatMap((step) => {
      if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
      const interaction = interactionById.get(step.toId);
      return interaction?.kind === 'job_queue' ? [interaction] : [];
    });
    if (jobQueues.length > 0) {
      const handlerById = new Map(
        analysis.interactionHandlers.map((record) => [record.id, record]),
      );
      const matchesByInteraction = new Map<string, string[]>();
      for (const step of trace.steps) {
        if (step.relation !== 'INTERACTION_MATCHES_LOCAL_HANDLER' || step.toId === null) continue;
        const handler = handlerById.get(step.toId);
        if (handler?.kind !== 'job_queue') continue;
        matchesByInteraction.set(step.fromId, [
          ...(matchesByInteraction.get(step.fromId) ?? []),
          handler.registrationState,
        ]);
      }
      lines.push(
        '',
        '## BullMQ interactions',
        '',
        '| Queue and job | Activation | Boundary | In-repository worker candidates | Evidence |',
        '|---|---|---|---|---|',
        ...jobQueues.map((interaction) => {
          const states = matchesByInteraction.get(interaction.id) ?? [];
          return `| ${escapeTableCell(jobQueueTargetLabel(interaction.target))} | ${interaction.activation} | ${interaction.boundary} | ${escapeTableCell(states.length === 0 ? 'none_proven' : states.sort().join(', '))} | ${escapeTableCell(evidenceReferences(analysis, interaction.evidenceIds).join('<br>'))} |`;
        }),
      );
    }
    const microserviceMessages = trace.steps.flatMap((step) => {
      if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
      const interaction = interactionById.get(step.toId);
      return interaction?.kind === 'microservice_message' ? [interaction] : [];
    });
    if (microserviceMessages.length > 0) {
      const handlerById = new Map(
        analysis.interactionHandlers.map((record) => [record.id, record]),
      );
      const matchesByInteraction = new Map<string, string[]>();
      for (const step of trace.steps) {
        if (step.relation !== 'INTERACTION_MATCHES_LOCAL_HANDLER' || step.toId === null) continue;
        const handler = handlerById.get(step.toId);
        if (handler?.kind !== 'microservice_message') continue;
        matchesByInteraction.set(step.fromId, [
          ...(matchesByInteraction.get(step.fromId) ?? []),
          `${step.status}:${handler.registrationState}`,
        ]);
      }
      lines.push(
        '',
        '## Nest microservice interactions',
        '',
        '| Mode, pattern, client, and transport | Activation | Boundary | In-repository delivery candidates | Evidence |',
        '|---|---|---|---|---|',
        ...microserviceMessages.map((interaction) => {
          const states = matchesByInteraction.get(interaction.id) ?? [];
          return `| ${escapeTableCell(microserviceMessageTargetLabel(interaction.target))} | ${interaction.activation} | ${interaction.boundary} | ${escapeTableCell(states.length === 0 ? 'none_proven' : states.sort().join(', '))} | ${escapeTableCell(evidenceReferences(analysis, interaction.evidenceIds).join('<br>'))} |`;
        }),
      );
    }
    if (trace.causalSummary !== undefined) {
      lines.push(
        '',
        '## Causal summary',
        '',
        `Synchronous effects: ${trace.causalSummary.synchronousEffects.length}  `,
        `Local interaction effects: ${trace.causalSummary.localInteractionEffects.length}  `,
        ...(trace.causalSummary.criticalSectionConditionalEffects === undefined
          ? []
          : [
              `Critical-section conditional effects: ${trace.causalSummary.criticalSectionConditionalEffects.length}<br>`,
            ]),
        `Distributed conditional effects: ${trace.causalSummary.distributedConditionalEffects.length}  `,
        `Outbound interactions: ${trace.causalSummary.outboundInteractionIds.length}  `,
        `Local interactions: ${trace.causalSummary.localInteractionIds.length}  `,
        ...(trace.causalSummary.distributedInteractionIds === undefined
          ? []
          : [
              `Distributed interactions: ${trace.causalSummary.distributedInteractionIds.length}  `,
            ]),
        `Completeness: ${trace.causalSummary.completeness.state}${
          trace.causalSummary.completeness.diagnosticCodes.length === 0
            ? ''
            : ` (${trace.causalSummary.completeness.diagnosticCodes.join(', ')})`
        }`,
      );
      if (
        analysisHasJobQueueBranchFacts(analysis) &&
        trace.causalSummary.jobQueueBranchIds !== undefined &&
        (trace.causalSummary.distributedInteractionIds ?? []).some(
          (interactionId) =>
            analysis.interactions.find(({ id }) => id === interactionId)?.kind === 'job_queue',
        )
      ) {
        const branches = trace.causalSummary.jobQueueBranchIds.flatMap((branchId) => {
          const branch = analysis.interactionHandlerBranches.find(({ id }) => id === branchId);
          return branch === undefined ? [] : [branch];
        });
        lines.push(
          '',
          '### Selected job-queue branches',
          '',
          ...(branches.length === 0
            ? ['No exact or common local worker branch was selected.']
            : [
                '| Selector | Control flow | Evidence |',
                '|---|---|---|',
                ...branches.map(
                  (branch) =>
                    `| ${escapeTableCell(JSON.stringify(branch.selector))} | ${branch.controlFlow} | ${escapeTableCell(evidenceReferences(analysis, branch.evidenceIds).join('<br>'))} |`,
                ),
              ]),
        );
      }
    }
  }

  lines.push('', '## Table access', '');
  if (trace.terminals.length === 0) {
    lines.push('No supported table access was reached.');
  } else if (analysisHasInteractionFacts(analysis)) {
    lines.push(
      '| Method | Direction | Table | Causal class |',
      '|---|---|---|---|',
      ...trace.terminals.map(
        (terminal) =>
          `| ${escapeTableCell(recordLabel(analysis, terminal.methodId))} | ${terminal.direction} | ${escapeTableCell(terminal.tableName)} | ${terminal.causalClass ?? 'not_recorded'} |`,
      ),
    );
  } else {
    lines.push(
      '| Method | Direction | Table |',
      '|---|---|---|',
      ...trace.terminals.map(
        (terminal) =>
          `| ${escapeTableCell(recordLabel(analysis, terminal.methodId))} | ${terminal.direction} | ${escapeTableCell(terminal.tableName)} |`,
      ),
    );
  }

  if (trace.resourceTerminals !== undefined) {
    const accessById = new Map(
      analysisHasResourceAccessFacts(analysis)
        ? analysis.resourceAccesses.map((access) => [access.id, access])
        : [],
    );
    lines.push('', '## Non-relational resource access', '');
    if (trace.resourceTerminals.length === 0) {
      lines.push('No supported cache or Redis access was reached.');
    } else {
      lines.push(
        '| Method | Resource access | Kind | API | Causal class |',
        '|---|---|---|---|---|',
        ...trace.resourceTerminals.map((terminal) => {
          const access = accessById.get(terminal.resourceAccessId);
          return `| ${escapeTableCell(recordLabel(analysis, terminal.methodId))} | ${escapeTableCell(access === undefined ? terminal.resourceAccessId : resourceAccessLabel(access))} | ${terminal.resourceKind} | ${access?.api ?? 'unknown'} | ${terminal.causalClass} |`;
        }),
      );
    }
  }

  lines.push('', '## Diagnostics', '');
  lines.push(
    ...(diagnostics.length === 0 ? ['None.'] : renderDiagnosticList(analysis, diagnostics)),
  );
  lines.push('', '## Limitations', '');
  lines.push(
    ...(limitations.length === 0 ? ['None.'] : renderDiagnosticList(analysis, limitations)),
  );

  return `${lines.join('\n')}\n`;
}
