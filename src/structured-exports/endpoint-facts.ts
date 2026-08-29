import { analysisHasInteractionFacts, type AnalysisDocument } from '../model/analysis.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import {
  buildEndpointCatalogue,
  type EndpointCatalogueEntry,
} from '../reporting/endpoint-catalogue.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import {
  inProcessEventTargetLabel,
  jobQueueTargetLabel,
  microserviceMessageTargetLabel,
  outboundHttpTargetLabel,
} from '../reporting/interaction-labels.js';
import type {
  ControlEvidenceInfluence,
  ControlEvidencePolicyOutcome,
  EndpointInteractionSummary,
  EndpointDistributedCausalEffect,
  EndpointLocalCausalEffect,
  EndpointAuthorizationSummary,
  MutationClassification,
} from './model.js';

export interface EndpointExportFacts {
  readonly endpoint: EndpointCatalogueEntry;
  readonly dbReads: readonly string[];
  readonly dbWrites: readonly string[];
  readonly outboundInteractions: readonly EndpointInteractionSummary[];
  readonly localInteractions: readonly EndpointInteractionSummary[];
  readonly localCausalEffects: readonly EndpointLocalCausalEffect[];
  readonly distributedInteractions: readonly EndpointInteractionSummary[];
  readonly distributedConditionalEffects: readonly EndpointDistributedCausalEffect[];
  readonly jobQueueBranchIds: readonly string[];
  readonly authorizationRequirements: readonly EndpointAuthorizationSummary[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly incompletenessCodes: readonly string[];
  readonly mutationClassification: MutationClassification;
  readonly requestColumnInfluences: readonly ControlEvidenceInfluence[];
  readonly policyOutcomes: readonly ControlEvidencePolicyOutcome[];
  readonly evidenceIds: readonly string[];
  readonly sourceLocations: readonly string[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function persistenceIncomplete(code: string): boolean {
  return code.startsWith('CALL_') || code.startsWith('TYPEORM_');
}

function sourceLocations(analysis: AnalysisDocument, evidenceIds: readonly string[]): string[] {
  const evidence = new Map(analysis.evidence.map((record) => [record.id, record]));
  const sources = new Map(analysis.sourceFiles.map((record) => [record.id, record]));
  return sortedUnique(
    evidenceIds.flatMap((id) => {
      const record = evidence.get(id);
      const source = record === undefined ? undefined : sources.get(record.fileId);
      return record === undefined || source === undefined
        ? []
        : [`${source.path}:${record.startLine}:${record.startColumn}`];
    }),
  );
}

function provenanceForEndpoint(
  analysis: AnalysisDocument,
  handlerMethodId: string | null,
): ControlEvidenceInfluence[] {
  if (analysis.schemaVersion === '1.0.0' || handlerMethodId === null) return [];
  const origins = new Map(analysis.requestFieldOrigins.map((record) => [record.id, record]));
  const parameters = new Map(analysis.requestParameters.map((record) => [record.id, record]));
  const columns = new Map(analysis.entityColumns.map((record) => [record.id, record]));
  const entities = new Map(analysis.entities.map((record) => [record.id, record]));
  const methods = new Map(analysis.methods.map((record) => [record.id, record]));
  const assertions = new Map(analysis.assertions.map((record) => [record.id, record]));

  return analysis.columnInfluences.flatMap((influence): ControlEvidenceInfluence[] => {
    const origin = origins.get(influence.originId);
    const parameter = origin === undefined ? undefined : parameters.get(origin.requestParameterId);
    const column = columns.get(influence.columnId);
    if (parameter?.methodId !== handlerMethodId || origin === undefined || column === undefined) {
      return [];
    }
    const entity = entities.get(column.entityId);
    const method = methods.get(influence.methodId);
    const assertion = assertions.get(influence.assertionId);
    const selector =
      parameter.selectorState === 'literal' && parameter.selector !== null
        ? parameter.selector
        : origin.propertyPath.join('.');
    return [
      {
        origin: `${parameter.sourceKind}.${selector}`,
        column: `${entity?.displayName ?? column.entityId}.${column.propertyName}${column.databaseName === null || column.databaseName === column.propertyName ? '' : ` -> ${column.databaseName}`}`,
        state: influence.state,
        sinkMethod: method?.qualifiedName ?? influence.methodId,
        callDepth: influence.callPath.length,
        evidenceIds: sortedUnique([
          influence.sinkEvidenceId,
          influence.operationEvidenceId,
          ...influence.propagationEvidenceIds,
          ...influence.callPath.map(({ callEvidenceId }) => callEvidenceId),
          ...(assertion?.evidenceIds ?? []),
        ]),
      },
    ];
  });
}

function policyForEndpoint(
  analysis: AnalysisDocument,
  endpoint: EndpointCatalogueEntry,
  policyResults: PolicyResultsDocument | undefined,
): ControlEvidencePolicyOutcome[] {
  if (policyResults === undefined) return [];
  const method =
    endpoint.handlerMethodId === null
      ? undefined
      : analysis.methods.find(({ id }) => id === endpoint.handlerMethodId);
  const relevantIds = new Set(
    [endpoint.endpointId, endpoint.handlerMethodId, method?.classId].filter(
      (value): value is string => value !== null && value !== undefined,
    ),
  );
  return policyResults.results
    .filter(({ subject }) => subject.canonicalIds.some((id) => relevantIds.has(id)))
    .map((result) => ({
      ruleId: result.ruleId,
      outcome: result.outcome,
      severity: result.severity,
      blocking: result.blocking,
      reasonCode: result.reasonCode,
      evidenceIds: result.evidenceIds,
    }));
}

export function buildEndpointExportFacts(input: {
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
}): Map<string, EndpointExportFacts> {
  const catalogue = buildEndpointCatalogue(input.analysis);
  const evidenceByLocation = new Map<string, string[]>();
  const sourceById = new Map(input.analysis.sourceFiles.map((source) => [source.id, source]));
  for (const evidence of input.analysis.evidence) {
    const source = sourceById.get(evidence.fileId);
    if (source === undefined) continue;
    const key = `${source.path}:${evidence.startLine}:${evidence.startColumn}`;
    evidenceByLocation.set(key, [...(evidenceByLocation.get(key) ?? []), evidence.id]);
  }
  const result = new Map<string, EndpointExportFacts>();
  for (const endpoint of catalogue.endpoints) {
    const traceResult =
      endpoint.selectionStatus === 'resolved'
        ? buildEndpointTrace(input.analysis, {
            httpMethod: endpoint.httpMethod,
            path: endpoint.path,
          })
        : null;
    const trace = traceResult?.status === 'resolved' ? traceResult.trace : null;
    const synchronousTerminals = trace?.causalSummary?.synchronousEffects ?? trace?.terminals ?? [];
    const diagnostics = traceResult?.status === 'resolved' ? traceResult.diagnostics : [];
    const dbReads = sortedUnique(
      synchronousTerminals
        .filter(({ direction }) => direction === 'READ')
        .map(({ tableName }) => tableName),
    );
    const dbWrites = sortedUnique(
      synchronousTerminals
        .filter(({ direction }) => direction === 'WRITE')
        .map(({ tableName }) => tableName),
    );
    const interactionById = new Map(
      analysisHasInteractionFacts(input.analysis)
        ? input.analysis.interactions.map((interaction) => [interaction.id, interaction])
        : [],
    );
    const handlerById = new Map(
      analysisHasInteractionFacts(input.analysis)
        ? input.analysis.interactionHandlers.map((handler) => [handler.id, handler])
        : [],
    );
    const handlerStatesByInteraction = new Map<string, string[]>();
    for (const step of trace?.steps ?? []) {
      if (step.relation !== 'INTERACTION_MATCHES_LOCAL_HANDLER' || step.toId === null) continue;
      const handler = handlerById.get(step.toId);
      if (handler === undefined) continue;
      handlerStatesByInteraction.set(step.fromId, [
        ...(handlerStatesByInteraction.get(step.fromId) ?? []),
        handler.registrationState,
      ]);
    }
    const summarizeInteraction = (interactionId: string): EndpointInteractionSummary | null => {
      const interaction = interactionById.get(interactionId);
      if (interaction === undefined) return null;
      return {
        interactionId: interaction.id,
        kind: interaction.kind,
        target:
          interaction.kind === 'outbound_http'
            ? outboundHttpTargetLabel(interaction.target)
            : interaction.kind === 'in_process_event'
              ? inProcessEventTargetLabel(interaction.target)
              : interaction.kind === 'job_queue'
                ? jobQueueTargetLabel(interaction.target)
                : microserviceMessageTargetLabel(interaction.target),
        activation: interaction.activation,
        boundary: interaction.boundary,
        dispatchTiming: interaction.dispatchTiming,
        handlerStates: [
          ...new Set(handlerStatesByInteraction.get(interaction.id) ?? []),
        ].sort() as EndpointInteractionSummary['handlerStates'],
        evidenceIds: sortedUnique(interaction.evidenceIds),
      };
    };
    const outboundInteractions = (trace?.causalSummary?.outboundInteractionIds ?? [])
      .map(summarizeInteraction)
      .filter((value): value is EndpointInteractionSummary => value !== null);
    const localInteractions = (trace?.causalSummary?.localInteractionIds ?? [])
      .map(summarizeInteraction)
      .filter((value): value is EndpointInteractionSummary => value !== null);
    const distributedInteractions = (trace?.causalSummary?.distributedInteractionIds ?? [])
      .map(summarizeInteraction)
      .filter((value): value is EndpointInteractionSummary => value !== null);
    const localCausalEffects = (trace?.causalSummary?.localInteractionEffects ?? []).map(
      (terminal): EndpointLocalCausalEffect => ({
        direction: terminal.direction,
        table: terminal.tableName,
        causalClass: terminal.causalClass as EndpointLocalCausalEffect['causalClass'],
        evidenceIds: sortedUnique(
          trace?.steps
            .filter(
              ({ fromId, toId, relation }) =>
                fromId === terminal.methodId &&
                toId === terminal.tableId &&
                ['METHOD_READS_TABLE', 'METHOD_WRITES_TABLE'].includes(relation),
            )
            .flatMap(({ evidenceIds }) => evidenceIds) ?? [],
        ),
      }),
    );
    const distributedConditionalEffects = (
      trace?.causalSummary?.distributedConditionalEffects ?? []
    ).map(
      (terminal): EndpointDistributedCausalEffect => ({
        direction: terminal.direction,
        table: terminal.tableName,
        causalClass: 'distributed_conditional',
        evidenceIds: sortedUnique(
          trace?.steps
            .filter(
              ({ fromId, toId, relation }) =>
                fromId === terminal.methodId &&
                toId === terminal.tableId &&
                ['METHOD_READS_TABLE', 'METHOD_WRITES_TABLE'].includes(relation),
            )
            .flatMap(({ evidenceIds }) => evidenceIds) ?? [],
        ),
      }),
    );
    const jobQueueBranchIds = sortedUnique(trace?.causalSummary?.jobQueueBranchIds ?? []);
    const authorizationRequirements = endpoint.authorizationRequirements.map((requirement) => ({
      metadataKey: requirement.metadataKey,
      scope: requirement.scope,
      source: requirement.source,
      valueShape: requirement.valueShape,
      enforcementState: requirement.enforcementState,
      guardName: requirement.guardName,
      evidenceIds: sortedUnique(requirement.evidenceIds),
    }));
    const incompletenessCodes = sortedUnique(diagnostics.map(({ code }) => code));
    const mutationClassification: MutationClassification =
      dbWrites.length > 0
        ? 'write'
        : endpoint.selectionStatus === 'resolved' &&
            trace !== null &&
            !incompletenessCodes.some(persistenceIncomplete)
          ? 'non_write'
          : 'unknown';
    const requestColumnInfluences = provenanceForEndpoint(input.analysis, endpoint.handlerMethodId);
    const policyOutcomes = policyForEndpoint(input.analysis, endpoint, input.policyResults);
    const evidenceIds = sortedUnique([
      ...[...endpoint.evidence, ...endpoint.guards.flatMap(({ evidence }) => evidence)].flatMap(
        (location) => evidenceByLocation.get(location) ?? [],
      ),
      ...(trace?.guards.flatMap(({ evidenceIds: ids }) => ids) ?? []),
      ...(trace?.steps.flatMap(({ evidenceIds: ids }) => ids) ?? []),
      ...diagnostics.flatMap(({ evidenceIds: ids }) => ids),
      ...requestColumnInfluences.flatMap(({ evidenceIds: ids }) => ids),
      ...policyOutcomes.flatMap(({ evidenceIds: ids }) => ids),
    ]);
    result.set(endpoint.endpointId, {
      endpoint,
      dbReads,
      dbWrites,
      outboundInteractions,
      localInteractions,
      localCausalEffects,
      distributedInteractions,
      distributedConditionalEffects,
      jobQueueBranchIds,
      authorizationRequirements,
      diagnostics,
      incompletenessCodes,
      mutationClassification,
      requestColumnInfluences,
      policyOutcomes,
      evidenceIds,
      sourceLocations: sourceLocations(input.analysis, evidenceIds),
    });
  }
  return result;
}
