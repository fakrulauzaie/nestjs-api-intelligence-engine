import {
  analysisHasAuthorizationFacts,
  analysisHasCriticalSectionFacts,
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  analysisHasResourceAccessFacts,
  type AnalysisDocument,
  type EndpointTraceStep,
} from '../model/analysis.js';
import type { AssertionRecord, AssertionStatus } from '../model/assertions.js';
import type { ImpactDocument, ImpactGraphSide, ImpactedEndpoint } from '../impact/model.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import { buildEndpointExportFacts } from '../structured-exports/endpoint-facts.js';
import { buildArchitectureOverview } from '../architecture/overview.js';
import {
  DEFAULT_GRAPH_EDGE_LIMIT,
  DEFAULT_GRAPH_NODE_LIMIT,
  GRAPH_REPORT_SCHEMA_VERSION,
  GRAPH_REPORT_SCHEMA_V4_VERSION,
  GRAPH_REPORT_SCHEMA_V5_VERSION,
  GRAPH_REPORT_SCHEMA_V7_VERSION,
  GRAPH_REPORT_SCHEMA_V8_VERSION,
  GRAPH_REPORT_SCHEMA_V9_VERSION,
  MAX_GRAPH_EDGE_LIMIT,
  MAX_GRAPH_NODE_LIMIT,
  MIN_GRAPH_DISPLAY_LIMIT,
  graphUncertaintyFromAssertion,
  type GraphImpactState,
  type GraphReportDocument,
  type GraphReportEdge,
  type GraphReportEndpoint,
  type GraphReportEvidence,
  type GraphReportInteractionHandler,
  type GraphReportNode,
  type GraphReportScene,
} from './model.js';
import type { InteractionHandlerRecord, InteractionRecord } from '../model/interactions.js';
import {
  inProcessEventTargetLabel,
  jobQueueTargetLabel,
  microserviceMessageTargetLabel,
  outboundHttpTargetLabel,
} from '../reporting/interaction-labels.js';
import { canonicalizeGraphReportDocument } from './ordering.js';
import { assertValidGraphReportDocument, graphImpactSide } from './validate.js';
import { buildInteractionHandlerTrace } from '../tracing/interaction-handler-trace.js';
import { buildGraphArchitectureOverview } from './architecture.js';
import { resourceAccessLabel, type ResourceAccessRecord } from '../model/resource-access.js';
import type { CriticalSectionRecord } from '../model/critical-sections.js';

export class GraphReportInputStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphReportInputStateError';
  }
}

export interface GraphReportBuildOptions {
  readonly maxNodesPerEndpoint?: number | undefined;
  readonly maxEdgesPerEndpoint?: number | undefined;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (
    !Number.isInteger(normalized) ||
    normalized < MIN_GRAPH_DISPLAY_LIMIT ||
    normalized > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer from ${MIN_GRAPH_DISPLAY_LIMIT} to ${maximum}.`,
    );
  }
  return normalized;
}

function assertionKey(input: {
  readonly fromId: string;
  readonly relation: string;
  readonly toId: string | null;
  readonly status: AssertionStatus;
  readonly ruleId: string;
}): string {
  return `${input.fromId}\u0000${input.relation}\u0000${input.toId ?? ''}\u0000${input.status}\u0000${input.ruleId}`;
}

function assertionForStep(
  step: EndpointTraceStep,
  assertions: ReadonlyMap<string, AssertionRecord>,
): AssertionRecord {
  const assertion = assertions.get(
    assertionKey({
      fromId: step.fromId,
      relation: step.relation,
      toId: step.toId,
      status: step.status,
      ruleId: step.ruleId,
    }),
  );
  if (assertion === undefined) {
    throw new GraphReportInputStateError(
      'A validated endpoint trace lost its canonical assertion.',
    );
  }
  return assertion;
}

function edgeLabel(predicate: AssertionRecord['predicate']): string {
  const labels: Partial<Record<AssertionRecord['predicate'], string>> = {
    ENDPOINT_IMPLEMENTED_BY: 'implemented by',
    METHOD_CALLS_METHOD: 'calls',
    METHOD_READS_TABLE: 'reads',
    METHOD_WRITES_TABLE: 'writes',
    METHOD_DECLARES_REQUEST_PARAMETER: 'declares request parameter',
    REQUEST_PARAMETER_HAS_FIELD_ORIGIN: 'has field origin',
    REQUEST_FIELD_MAY_FLOW_TO_COLUMN: 'may flow to column',
    METHOD_INITIATES_INTERACTION: 'initiates',
    INTERACTION_MATCHES_LOCAL_HANDLER: 'matches local handler',
    HANDLER_IMPLEMENTED_BY: 'implemented by',
    METHOD_ACCESSES_RESOURCE: 'accesses resource',
  };
  return labels[predicate] ?? predicate.toLowerCase().replaceAll('_', ' ');
}

function impactStateForEndpoint(endpoint: ImpactedEndpoint | undefined): GraphImpactState {
  if (endpoint === undefined) return 'none';
  if (endpoint.direct) return 'direct';
  if (endpoint.reasons.some(({ category }) => category === 'unknown_due_to_incomplete_trace')) {
    return 'unknown';
  }
  return 'potential';
}

function impactForCanonicalEndpoint(
  impact: ImpactDocument | undefined,
  side: ImpactGraphSide | null,
  endpointId: string,
): ImpactedEndpoint | undefined {
  if (impact === undefined || side === null) return undefined;
  return impact.impactedEndpoints.find((endpoint) =>
    (side === 'before' ? endpoint.beforeEndpointIds : endpoint.afterEndpointIds).includes(
      endpointId,
    ),
  );
}

function impactedAssertionIds(
  endpoint: ImpactedEndpoint | undefined,
  side: ImpactGraphSide | null,
): Set<string> {
  if (endpoint === undefined || side === null) return new Set();
  return new Set(
    endpoint.reasons.flatMap((reason) =>
      reason.paths
        .filter((path) => path.side === side)
        .flatMap((path) => path.steps.map(({ assertionId }) => assertionId)),
    ),
  );
}

function mergeImpact(left: GraphImpactState, right: GraphImpactState): GraphImpactState {
  const rank: Record<GraphImpactState, number> = { none: 0, potential: 1, unknown: 2, direct: 3 };
  return rank[right] > rank[left] ? right : left;
}

function addNode(target: Map<string, GraphReportNode>, node: GraphReportNode): void {
  const existing = target.get(node.id);
  if (existing === undefined) {
    target.set(node.id, { ...node, evidenceIds: sortedUnique(node.evidenceIds) });
    return;
  }
  target.set(node.id, {
    ...existing,
    impact: mergeImpact(existing.impact, node.impact),
    evidenceIds: sortedUnique([...existing.evidenceIds, ...node.evidenceIds]),
  });
}

interface ProjectionIndexes {
  readonly methods: ReadonlyMap<string, AnalysisDocument['methods'][number]>;
  readonly tables: ReadonlyMap<string, AnalysisDocument['tables'][number]>;
  readonly guards: ReadonlyMap<string, AnalysisDocument['guards'][number]>;
  readonly classes: ReadonlyMap<string, AnalysisDocument['classes'][number]>;
  readonly assertions: ReadonlyMap<string, AssertionRecord>;
  readonly interactions: ReadonlyMap<string, InteractionRecord>;
  readonly interactionHandlers: ReadonlyMap<string, InteractionHandlerRecord>;
  readonly resourceAccesses: ReadonlyMap<string, ResourceAccessRecord>;
  readonly criticalSections: ReadonlyMap<string, CriticalSectionRecord>;
  readonly criticalSectionByEffectAssertionId: ReadonlyMap<string, CriticalSectionRecord>;
}

function scopedAssertionSource(input: {
  readonly assertion: AssertionRecord;
  readonly indexes: ProjectionIndexes;
  readonly nodes: Map<string, GraphReportNode>;
  readonly edges: GraphReportEdge[];
  readonly impact: GraphImpactState;
}): string {
  const section = input.indexes.criticalSectionByEffectAssertionId.get(input.assertion.id);
  if (section === undefined) return input.assertion.subjectId;
  addNode(input.nodes, canonicalNode(section.sourceMethodId, input.indexes, input.impact));
  addNode(input.nodes, canonicalNode(section.id, input.indexes, input.impact));
  const scopeEdgeId = `critical-scope:${section.id}`;
  if (!input.edges.some(({ id }) => id === scopeEdgeId)) {
    input.edges.push({
      id: scopeEdgeId,
      source: section.sourceMethodId,
      target: section.id,
      label: 'bounded critical callback',
      kind: 'assertion',
      relation: null,
      uncertainty: 'resolved',
      impact: input.impact,
      evidenceIds: section.evidenceIds,
    });
    for (const accessId of section.lockResourceAccessIds) {
      addNode(input.nodes, canonicalNode(accessId, input.indexes, input.impact));
      input.edges.push({
        id: `critical-lock:${section.id}:${accessId}`,
        source: accessId,
        target: section.id,
        label: 'bounds callback',
        kind: 'assertion',
        relation: null,
        uncertainty: 'resolved',
        impact: input.impact,
        evidenceIds: section.evidenceIds,
      });
    }
  }
  return section.id;
}

function canonicalNode(
  id: string,
  indexes: ProjectionIndexes,
  impact: GraphImpactState,
): GraphReportNode {
  const method = indexes.methods.get(id);
  if (method !== undefined) {
    return {
      id,
      label: method.qualifiedName,
      kind: 'method',
      uncertainty: 'resolved',
      impact,
      evidenceIds: [method.declarationEvidenceId],
    };
  }
  const table = indexes.tables.get(id);
  if (table !== undefined) {
    return {
      id,
      label: table.name,
      kind: 'table',
      uncertainty: 'resolved',
      impact,
      evidenceIds: [],
    };
  }
  const guard = indexes.guards.get(id);
  if (guard !== undefined) {
    const guardClass = indexes.classes.get(guard.classId);
    return {
      id,
      label: guard.displayName,
      kind: 'guard',
      uncertainty: 'resolved',
      impact,
      evidenceIds: guardClass === undefined ? [] : [guardClass.declarationEvidenceId],
    };
  }
  const resourceAccess = indexes.resourceAccesses.get(id);
  if (resourceAccess !== undefined) {
    return {
      id,
      label: resourceAccessLabel(resourceAccess),
      kind: 'resource_access',
      uncertainty: resourceAccess.target.kind === 'dynamic' ? 'unknown' : 'resolved',
      impact,
      evidenceIds: resourceAccess.evidenceIds,
    };
  }
  const criticalSection = indexes.criticalSections.get(id);
  if (criticalSection !== undefined) {
    return {
      id,
      label: `critical section (${criticalSection.lockResourceAccessIds.length} lock resource${criticalSection.lockResourceAccessIds.length === 1 ? '' : 's'})`,
      kind: 'critical_section',
      uncertainty: 'resolved',
      impact,
      evidenceIds: criticalSection.evidenceIds,
    };
  }
  const interaction = indexes.interactions.get(id);
  if (interaction?.kind === 'outbound_http') {
    return {
      id,
      label: `outbound HTTP ${interaction.target.method} [${interaction.activation.replaceAll('_', ' ')}; ${interaction.dispatchTiming}]`,
      kind: 'interaction',
      uncertainty:
        interaction.target.url.resolution === 'dynamic' || interaction.target.method === 'UNKNOWN'
          ? 'unknown'
          : 'resolved',
      impact,
      evidenceIds: interaction.evidenceIds,
    };
  }
  if (interaction?.kind === 'in_process_event') {
    return {
      id,
      label: `event ${inProcessEventTargetLabel(interaction.target)} [${interaction.dispatchTiming}]`,
      kind: 'interaction',
      uncertainty: interaction.target.identityKind === 'dynamic' ? 'unknown' : 'resolved',
      impact,
      evidenceIds: interaction.evidenceIds,
    };
  }
  if (interaction?.kind === 'job_queue') {
    return {
      id,
      label: jobQueueTargetLabel(interaction.target),
      kind: 'interaction',
      uncertainty:
        interaction.target.queue.resolution === 'dynamic' ||
        interaction.target.job.resolution === 'dynamic'
          ? 'unknown'
          : 'resolved',
      impact,
      evidenceIds: interaction.evidenceIds,
    };
  }
  if (interaction?.kind === 'microservice_message') {
    return {
      id,
      label: microserviceMessageTargetLabel(interaction.target),
      kind: 'interaction',
      uncertainty:
        interaction.target.patternKind === 'dynamic' ||
        interaction.target.clientToken.resolution === 'dynamic' ||
        interaction.target.transport === null
          ? 'unknown'
          : 'resolved',
      impact,
      evidenceIds: interaction.evidenceIds,
    };
  }
  const interactionHandler = indexes.interactionHandlers.get(id);
  if (interactionHandler?.kind === 'in_process_event') {
    return {
      id,
      label: `@OnEvent ${inProcessEventTargetLabel(interactionHandler.target)} [${interactionHandler.registrationState}]`,
      kind: 'interaction_handler',
      uncertainty:
        interactionHandler.target.identityKind === 'dynamic' ||
        interactionHandler.registrationState === 'registration_unknown'
          ? 'unknown'
          : 'resolved',
      impact,
      evidenceIds: [interactionHandler.handlerEvidenceId],
    };
  }
  if (interactionHandler?.kind === 'job_queue') {
    return {
      id,
      label: `@Processor ${jobQueueTargetLabel(interactionHandler.target)} [${interactionHandler.registrationState}]`,
      kind: 'interaction_handler',
      uncertainty:
        interactionHandler.target.queue.resolution === 'dynamic' ||
        interactionHandler.registrationState === 'registration_unknown'
          ? 'unknown'
          : 'resolved',
      impact,
      evidenceIds: [interactionHandler.handlerEvidenceId],
    };
  }
  if (interactionHandler?.kind === 'microservice_message') {
    const decorator =
      interactionHandler.target.mode === 'event' ? '@EventPattern' : '@MessagePattern';
    return {
      id,
      label: `${decorator} ${microserviceMessageTargetLabel(interactionHandler.target)} [${interactionHandler.registrationState}]`,
      kind: 'interaction_handler',
      uncertainty:
        interactionHandler.target.patternKind === 'dynamic' ||
        interactionHandler.target.transport === null ||
        interactionHandler.registrationState === 'registration_unknown'
          ? 'unknown'
          : 'resolved',
      impact,
      evidenceIds: [interactionHandler.handlerEvidenceId],
    };
  }
  return {
    id,
    label: id,
    kind: 'gap',
    uncertainty: 'unknown',
    impact,
    evidenceIds: [],
  };
}

function interactionHandlerTargetLabel(handler: InteractionHandlerRecord): string {
  switch (handler.kind) {
    case 'in_process_event':
      return inProcessEventTargetLabel(handler.target);
    case 'job_queue':
      return jobQueueTargetLabel(handler.target);
    case 'microservice_message':
      return microserviceMessageTargetLabel(handler.target);
  }
}

function handlerCausalClass(
  handler: InteractionHandlerRecord,
): GraphReportInteractionHandler['causalClass'] {
  if (handler.kind === 'job_queue' || handler.kind === 'microservice_message') {
    return 'distributed_conditional';
  }
  if (handler.ruleId.includes('.async.')) return 'local_interaction_asynchronous';
  if (handler.ruleId.includes('.sync.')) return 'local_interaction_synchronous';
  return 'unknown';
}

function interactionPresentationElements(input: {
  readonly interaction: InteractionRecord;
  readonly impact: GraphImpactState;
  readonly nodes: Map<string, GraphReportNode>;
  readonly edges: GraphReportEdge[];
}): void {
  const { interaction, impact, nodes, edges } = input;
  const boundaryId = `boundary:${interaction.id}`;
  addNode(nodes, {
    id: boundaryId,
    label:
      interaction.boundary === 'in_process'
        ? 'in-process event boundary'
        : interaction.boundary === 'broker_or_worker_boundary'
          ? 'broker or worker boundary'
          : 'external or unobserved boundary',
    kind: 'boundary',
    uncertainty: interaction.boundary === 'unknown' ? 'unknown' : 'resolved',
    impact,
    evidenceIds: interaction.evidenceIds,
  });
  edges.push({
    id: `interaction-edge:${interaction.id}:dispatches`,
    source: interaction.id,
    target: boundaryId,
    label: 'dispatches',
    kind: 'interaction',
    relation: null,
    uncertainty: interaction.boundary === 'unknown' ? 'unknown' : 'resolved',
    impact,
    evidenceIds: interaction.evidenceIds,
  });
  if (
    interaction.kind !== 'outbound_http' &&
    interaction.kind !== 'job_queue' &&
    interaction.kind !== 'microservice_message'
  )
    return;
  const targetId = `external-target:${interaction.id}`;
  const targetLabel =
    interaction.kind === 'outbound_http'
      ? `${outboundHttpTargetLabel(interaction.target)} [${interaction.target.url.resolution}]`
      : interaction.kind === 'job_queue'
        ? jobQueueTargetLabel(interaction.target)
        : microserviceMessageTargetLabel(interaction.target);
  const targetUnknown =
    interaction.kind === 'outbound_http'
      ? interaction.target.url.resolution === 'dynamic' || interaction.target.method === 'UNKNOWN'
      : interaction.kind === 'job_queue'
        ? interaction.target.queue.resolution === 'dynamic' ||
          interaction.target.job.resolution === 'dynamic'
        : interaction.target.patternKind === 'dynamic' ||
          interaction.target.clientToken.resolution === 'dynamic' ||
          interaction.target.transport === null;
  addNode(nodes, {
    id: targetId,
    label: targetLabel,
    kind: 'external_target',
    uncertainty: targetUnknown ? 'unknown' : 'resolved',
    impact,
    evidenceIds: interaction.evidenceIds,
  });
  edges.push({
    id: `interaction-edge:${interaction.id}:targets`,
    source: boundaryId,
    target: targetId,
    label: 'targets',
    kind: 'interaction',
    relation: null,
    uncertainty: targetUnknown ? 'unknown' : 'resolved',
    impact,
    evidenceIds: interaction.evidenceIds,
  });
}

function provenanceElements(input: {
  readonly analysis: AnalysisDocument;
  readonly handlerMethodId: string | null;
  readonly nodes: Map<string, GraphReportNode>;
  readonly edges: GraphReportEdge[];
}): void {
  if (input.analysis.schemaVersion === '1.0.0' || input.handlerMethodId === null) return;
  const parameters = new Map(input.analysis.requestParameters.map((record) => [record.id, record]));
  const origins = new Map(input.analysis.requestFieldOrigins.map((record) => [record.id, record]));
  const columns = new Map(input.analysis.entityColumns.map((record) => [record.id, record]));
  const entities = new Map(input.analysis.entities.map((record) => [record.id, record]));
  const assertions = new Map(input.analysis.assertions.map((record) => [record.id, record]));
  const assertionByTuple = new Map(
    input.analysis.assertions.map((assertion) => [
      `${assertion.subjectId}\u0000${assertion.predicate}\u0000${assertion.objectId ?? ''}`,
      assertion,
    ]),
  );

  for (const influence of input.analysis.columnInfluences) {
    const origin = origins.get(influence.originId);
    const parameter = origin === undefined ? undefined : parameters.get(origin.requestParameterId);
    const column = columns.get(influence.columnId);
    if (
      origin === undefined ||
      parameter === undefined ||
      column === undefined ||
      parameter.methodId !== input.handlerMethodId
    ) {
      continue;
    }
    const selector =
      parameter.selectorState === 'literal' && parameter.selector !== null
        ? parameter.selector
        : origin.propertyPath.join('.');
    const originLabel = `${parameter.sourceKind}.${selector}`;
    const entity = entities.get(column.entityId);
    addNode(input.nodes, {
      id: parameter.id,
      label: `${parameter.sourceKind} ${parameter.parameterName}`,
      kind: 'request_parameter',
      uncertainty: parameter.selectorState === 'unknown' ? 'unknown' : 'resolved',
      impact: 'none',
      evidenceIds: [parameter.declarationEvidenceId, parameter.decoratorEvidenceId],
    });
    addNode(input.nodes, {
      id: origin.id,
      label: originLabel,
      kind: 'request_origin',
      uncertainty: origin.resolution,
      impact: 'none',
      evidenceIds: [origin.originEvidenceId],
    });
    addNode(input.nodes, {
      id: column.id,
      label: `${entity?.displayName ?? column.entityId}.${column.propertyName}`,
      kind: 'entity_column',
      uncertainty: column.databaseNameSource === 'unknown' ? 'unknown' : 'resolved',
      impact: 'none',
      evidenceIds: [column.declarationEvidenceId, column.decoratorEvidenceId],
    });

    const declaration = assertionByTuple.get(
      `${parameter.methodId}\u0000METHOD_DECLARES_REQUEST_PARAMETER\u0000${parameter.id}`,
    );
    const originAssertion = assertionByTuple.get(
      `${parameter.id}\u0000REQUEST_PARAMETER_HAS_FIELD_ORIGIN\u0000${origin.id}`,
    );
    const influenceAssertion = assertions.get(influence.assertionId);
    for (const assertion of [declaration, originAssertion, influenceAssertion]) {
      if (assertion?.objectId === null || assertion === undefined) continue;
      input.edges.push({
        id: assertion.id,
        source: assertion.subjectId,
        target: assertion.objectId,
        label:
          assertion.predicate === 'REQUEST_FIELD_MAY_FLOW_TO_COLUMN'
            ? `may flow (${influence.state})`
            : edgeLabel(assertion.predicate),
        kind: 'provenance',
        relation: assertion.predicate,
        uncertainty:
          assertion.predicate === 'REQUEST_FIELD_MAY_FLOW_TO_COLUMN' &&
          influence.state === 'unknown'
            ? 'unknown'
            : graphUncertaintyFromAssertion(assertion.status),
        impact: 'none',
        evidenceIds: sortedUnique([
          ...assertion.evidenceIds,
          ...(assertion.id === influence.assertionId
            ? [
                influence.sinkEvidenceId,
                influence.operationEvidenceId,
                ...influence.propagationEvidenceIds,
                ...influence.callPath.map(({ callEvidenceId }) => callEvidenceId),
              ]
            : []),
        ]),
      });
    }
  }
}

function selectScene(input: {
  readonly rootId: string;
  readonly nodes: ReadonlyMap<string, GraphReportNode>;
  readonly edges: readonly GraphReportEdge[];
  readonly extraEvidenceIds: readonly string[];
  readonly analysis: AnalysisDocument;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxEvidence: number;
}): GraphReportScene {
  const selectedNodeIds = new Set([input.rootId]);
  const selectedEdges: GraphReportEdge[] = [];
  const edgeCandidates = [...input.edges].sort((left, right) => {
    const rank: Record<GraphReportEdge['kind'], number> = {
      assertion: 0,
      interaction: 1,
      guard: 2,
      provenance: 3,
      architecture: 4,
    };
    return rank[left.kind] - rank[right.kind] || left.id.localeCompare(right.id);
  });
  for (const edge of edgeCandidates) {
    if (selectedEdges.length >= input.maxEdges) break;
    const additional = [edge.source, edge.target].filter((id) => !selectedNodeIds.has(id)).length;
    if (selectedNodeIds.size + additional > input.maxNodes) continue;
    selectedNodeIds.add(edge.source);
    selectedNodeIds.add(edge.target);
    selectedEdges.push(edge);
  }
  const selectedNodes = [...selectedNodeIds]
    .map((id) => input.nodes.get(id))
    .filter((node): node is GraphReportNode => node !== undefined);
  const referencedEvidence = sortedUnique([
    ...selectedNodes.flatMap(({ evidenceIds }) => evidenceIds),
    ...selectedEdges.flatMap(({ evidenceIds }) => evidenceIds),
    ...input.extraEvidenceIds,
  ]);
  const mandatoryEvidence = sortedUnique([
    ...selectedNodes.flatMap(({ evidenceIds }) => evidenceIds.slice(0, 1)),
    ...selectedEdges.flatMap(({ evidenceIds }) => evidenceIds.slice(0, 1)),
  ]);
  const selectedEvidenceIds = new Set(mandatoryEvidence.slice(0, input.maxEvidence));
  for (const id of referencedEvidence) {
    if (selectedEvidenceIds.size >= input.maxEvidence) break;
    selectedEvidenceIds.add(id);
  }
  const evidenceById = new Map(input.analysis.evidence.map((record) => [record.id, record]));
  const sourcesById = new Map(input.analysis.sourceFiles.map((record) => [record.id, record]));
  const evidence: GraphReportEvidence[] = [...selectedEvidenceIds].flatMap((id) => {
    const record = evidenceById.get(id);
    const source = record === undefined ? undefined : sourcesById.get(record.fileId);
    return record === undefined || source === undefined
      ? []
      : [
          {
            id,
            path: source.path,
            startLine: record.startLine,
            startColumn: record.startColumn,
            endLine: record.endLine,
            endColumn: record.endColumn,
            role: record.role,
            snippet: record.snippet ?? null,
          },
        ];
  });
  const retainedEvidenceIds = new Set(evidence.map(({ id }) => id));
  const trim = (values: readonly string[]): string[] =>
    sortedUnique(values.filter((id) => retainedEvidenceIds.has(id)));
  return {
    nodes: selectedNodes.map((node) => ({ ...node, evidenceIds: trim(node.evidenceIds) })),
    edges: selectedEdges.map((edge) => ({ ...edge, evidenceIds: trim(edge.evidenceIds) })),
    evidence,
    omitted: {
      nodes: Math.max(0, input.nodes.size - selectedNodes.length),
      edges: Math.max(0, edgeCandidates.length - selectedEdges.length),
      evidence: Math.max(0, referencedEvidence.length - evidence.length),
    },
  };
}

export function buildGraphReportDocument(input: {
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
  readonly impact?: ImpactDocument | undefined;
  readonly options?: GraphReportBuildOptions | undefined;
}): GraphReportDocument {
  const { analysis, policyResults, impact } = input;
  if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
    throw new GraphReportInputStateError(
      `Analysis state ${analysis.resultState} cannot produce an offline graph report.`,
    );
  }
  if (
    policyResults !== undefined &&
    policyResults.analysis.analysisId !== analysis.analysisRun.id
  ) {
    throw new GraphReportInputStateError('Policy results refer to a different analysis snapshot.');
  }
  const impactSide = graphImpactSide(analysis, impact);
  if (impact !== undefined && impactSide === null) {
    throw new GraphReportInputStateError('Impact results do not contain this analysis snapshot.');
  }
  const maxNodes = normalizeLimit(
    input.options?.maxNodesPerEndpoint,
    DEFAULT_GRAPH_NODE_LIMIT,
    MAX_GRAPH_NODE_LIMIT,
    'Maximum graph nodes',
  );
  const maxEdges = normalizeLimit(
    input.options?.maxEdgesPerEndpoint,
    DEFAULT_GRAPH_EDGE_LIMIT,
    MAX_GRAPH_EDGE_LIMIT,
    'Maximum graph edges',
  );
  const maxEvidence = maxNodes + maxEdges + 100;
  const facts = buildEndpointExportFacts({
    analysis,
    ...(policyResults === undefined ? {} : { policyResults }),
  });
  const indexes: ProjectionIndexes = {
    methods: new Map(analysis.methods.map((record) => [record.id, record])),
    tables: new Map(analysis.tables.map((record) => [record.id, record])),
    guards: new Map(analysis.guards.map((record) => [record.id, record])),
    classes: new Map(analysis.classes.map((record) => [record.id, record])),
    assertions: new Map(
      analysis.assertions.map((assertion) => [
        assertionKey({
          fromId: assertion.subjectId,
          relation: assertion.predicate,
          toId: assertion.objectId,
          status: assertion.status,
          ruleId: assertion.ruleId,
        }),
        assertion,
      ]),
    ),
    interactions: analysisHasInteractionFacts(analysis)
      ? new Map(analysis.interactions.map((record) => [record.id, record]))
      : new Map(),
    interactionHandlers: analysisHasInteractionFacts(analysis)
      ? new Map(analysis.interactionHandlers.map((record) => [record.id, record]))
      : new Map(),
    resourceAccesses: analysisHasResourceAccessFacts(analysis)
      ? new Map(analysis.resourceAccesses.map((record) => [record.id, record]))
      : new Map(),
    criticalSections: analysisHasCriticalSectionFacts(analysis)
      ? new Map(analysis.criticalSections.map((record) => [record.id, record]))
      : new Map(),
    criticalSectionByEffectAssertionId: analysisHasCriticalSectionFacts(analysis)
      ? new Map(
          analysis.criticalSections.flatMap((section) =>
            section.effectAssertionIds.map((assertionId) => [assertionId, section] as const),
          ),
        )
      : new Map(),
  };

  const endpoints: GraphReportEndpoint[] = [];
  for (const endpointFacts of facts.values()) {
    const endpoint = endpointFacts.endpoint;
    const impactEndpoint = impactForCanonicalEndpoint(impact, impactSide, endpoint.endpointId);
    const endpointImpact = impactStateForEndpoint(impactEndpoint);
    const impactedAssertions = impactedAssertionIds(impactEndpoint, impactSide);
    const nodes = new Map<string, GraphReportNode>();
    addNode(nodes, {
      id: endpoint.endpointId,
      label: `${endpoint.httpMethod} ${endpoint.path}`,
      kind: 'endpoint',
      uncertainty: endpoint.selectionStatus,
      impact: endpointImpact,
      evidenceIds: endpointFacts.evidenceIds,
    });
    const edges: GraphReportEdge[] = [];
    if (endpoint.selectionStatus === 'resolved') {
      const trace = buildEndpointTrace(analysis, {
        httpMethod: endpoint.httpMethod,
        path: endpoint.path,
      });
      if (trace.status === 'resolved') {
        for (const step of trace.trace.steps) {
          const assertion = assertionForStep(step, indexes.assertions);
          const edgeImpact = impactedAssertions.has(assertion.id) ? endpointImpact : 'none';
          addNode(nodes, canonicalNode(step.fromId, indexes, edgeImpact));
          const targetId = step.toId ?? `gap:${assertion.id}`;
          if (step.toId === null) {
            addNode(nodes, {
              id: targetId,
              label: `${step.status}: ${edgeLabel(assertion.predicate)}`,
              kind: 'gap',
              uncertainty: graphUncertaintyFromAssertion(step.status),
              impact: edgeImpact,
              evidenceIds: step.evidenceIds,
            });
          } else {
            addNode(nodes, canonicalNode(step.toId, indexes, edgeImpact));
          }
          const edgeSource = scopedAssertionSource({
            assertion,
            indexes,
            nodes,
            edges,
            impact: edgeImpact,
          });
          edges.push({
            id: assertion.id,
            source: edgeSource,
            target: targetId,
            label: edgeLabel(assertion.predicate),
            kind: 'assertion',
            relation: assertion.predicate,
            uncertainty: graphUncertaintyFromAssertion(step.status),
            impact: edgeImpact,
            evidenceIds: step.evidenceIds,
          });
          if (
            assertion.predicate === 'METHOD_INITIATES_INTERACTION' &&
            assertion.objectId !== null
          ) {
            const interaction = indexes.interactions.get(assertion.objectId);
            if (interaction !== undefined) {
              interactionPresentationElements({
                interaction,
                impact: edgeImpact,
                nodes,
                edges,
              });
            }
          }
        }
        for (const [guardIndex, guard] of trace.trace.guards.entries()) {
          addNode(nodes, canonicalNode(guard.guardId, indexes, 'none'));
          edges.push({
            id: `guard:${endpoint.endpointId}:${guard.scope}:${guard.guardId}:${guardIndex}`,
            source: endpoint.endpointId,
            target: guard.guardId,
            label: `${guard.scope.replaceAll('_', ' ')} guard`,
            kind: 'guard',
            relation: null,
            uncertainty: graphUncertaintyFromAssertion(guard.status),
            impact: 'none',
            evidenceIds: guard.evidenceIds,
          });
        }
      }
    }
    provenanceElements({ analysis, handlerMethodId: endpoint.handlerMethodId, nodes, edges });
    const diagnostics = endpointFacts.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      evidenceIds: diagnostic.evidenceIds,
    }));
    const policyOutcomes = endpointFacts.policyOutcomes;
    const scene = selectScene({
      rootId: endpoint.endpointId,
      nodes,
      edges,
      extraEvidenceIds: [
        ...diagnostics.flatMap(({ evidenceIds }) => evidenceIds),
        ...policyOutcomes.flatMap(({ evidenceIds }) => evidenceIds),
        ...endpointFacts.localCausalEffects.flatMap(({ evidenceIds }) => evidenceIds),
        ...endpointFacts.distributedConditionalEffects.flatMap(({ evidenceIds }) => evidenceIds),
        ...endpointFacts.authorizationRequirements.flatMap(({ evidenceIds }) => evidenceIds),
      ],
      analysis,
      maxNodes,
      maxEdges,
      maxEvidence,
    });
    const retainedEvidence = new Set(scene.evidence.map(({ id }) => id));
    endpoints.push({
      endpointId: endpoint.endpointId,
      httpMethod: endpoint.httpMethod,
      path: endpoint.path,
      handler: endpoint.handlerQualifiedName,
      selectionStatus: endpoint.selectionStatus,
      directGuardState: endpoint.directGuardState,
      globalGuardState: endpoint.globalGuardState,
      effectiveGuardState: endpoint.effectiveGuardState,
      guards: endpoint.guards.map(({ name }) => name),
      mutationClassification: endpointFacts.mutationClassification,
      dbReads: endpointFacts.dbReads,
      dbWrites: endpointFacts.dbWrites,
      ...(analysisHasInteractionFacts(analysis)
        ? {
            localCausalEffects: endpointFacts.localCausalEffects.map((effect) => ({
              ...effect,
              evidenceIds: effect.evidenceIds.filter((id) => retainedEvidence.has(id)),
            })),
            ...(endpointFacts.distributedConditionalEffects.length === 0
              ? {}
              : {
                  distributedConditionalEffects: endpointFacts.distributedConditionalEffects.map(
                    (effect) => ({
                      ...effect,
                      evidenceIds: effect.evidenceIds.filter((id) => retainedEvidence.has(id)),
                    }),
                  ),
                }),
          }
        : {}),
      ...(analysisHasJobQueueBranchFacts(analysis)
        ? { jobQueueBranchIds: endpointFacts.jobQueueBranchIds }
        : {}),
      ...(analysisHasAuthorizationFacts(analysis)
        ? {
            authorizationRequirements: endpointFacts.authorizationRequirements.map(
              (requirement) => ({
                ...requirement,
                evidenceIds: requirement.evidenceIds.filter((id) => retainedEvidence.has(id)),
              }),
            ),
          }
        : {}),
      diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic,
        evidenceIds: diagnostic.evidenceIds.filter((id) => retainedEvidence.has(id)),
      })),
      policyOutcomes: policyOutcomes.map((outcome) => ({
        ...outcome,
        evidenceIds: outcome.evidenceIds.filter((id) => retainedEvidence.has(id)),
      })),
      impact: endpointImpact,
      impactReasons:
        impactEndpoint?.reasons.map((reason) => ({
          category: reason.category,
          reasonCode: reason.reasonCode,
          subject: reason.subject.displayName,
          sourceChangePath: reason.sourceChangePath,
        })) ?? [],
      scene,
    });
  }

  const interactionHandlers: GraphReportInteractionHandler[] = [];
  if (analysisHasInteractionFacts(analysis)) {
    for (const handler of analysis.interactionHandlers) {
      const trace = buildInteractionHandlerTrace(analysis, handler.id);
      if (trace.status !== 'resolved') {
        throw new GraphReportInputStateError(
          `Canonical interaction handler ${handler.id} did not produce a handler-rooted trace.`,
        );
      }
      const nodes = new Map<string, GraphReportNode>();
      addNode(nodes, canonicalNode(handler.id, indexes, 'none'));
      const edges: GraphReportEdge[] = [];
      for (const step of trace.trace.steps) {
        const assertion = assertionForStep(step, indexes.assertions);
        addNode(nodes, canonicalNode(step.fromId, indexes, 'none'));
        const targetId = step.toId ?? `gap:${assertion.id}`;
        if (step.toId === null) {
          addNode(nodes, {
            id: targetId,
            label: `${step.status}: ${edgeLabel(assertion.predicate)}`,
            kind: 'gap',
            uncertainty: graphUncertaintyFromAssertion(step.status),
            impact: 'none',
            evidenceIds: step.evidenceIds,
          });
        } else {
          addNode(nodes, canonicalNode(step.toId, indexes, 'none'));
        }
        const edgeSource = scopedAssertionSource({
          assertion,
          indexes,
          nodes,
          edges,
          impact: 'none',
        });
        edges.push({
          id: assertion.id,
          source: edgeSource,
          target: targetId,
          label: edgeLabel(assertion.predicate),
          kind: 'assertion',
          relation: assertion.predicate,
          uncertainty: graphUncertaintyFromAssertion(step.status),
          impact: 'none',
          evidenceIds: step.evidenceIds,
        });
        if (assertion.predicate === 'METHOD_INITIATES_INTERACTION' && assertion.objectId !== null) {
          const interaction = indexes.interactions.get(assertion.objectId);
          if (interaction !== undefined) {
            interactionPresentationElements({ interaction, impact: 'none', nodes, edges });
          }
        }
      }
      const diagnostics = trace.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        evidenceIds: diagnostic.evidenceIds,
      }));
      let jobQueueDispatch: GraphReportInteractionHandler['jobQueueDispatch'] = null;
      if (analysisHasJobQueueBranchFacts(analysis)) {
        const dispatch = analysis.interactionHandlerDispatches.find(
          ({ handlerId }) => handlerId === handler.id,
        );
        if (dispatch !== undefined) {
          const branches = dispatch.branchIds.flatMap((branchId) => {
            const branch = analysis.interactionHandlerBranches.find(({ id }) => id === branchId);
            if (branch === undefined) return [];
            const branchEffects = analysis.interactionHandlerBranchEffects.filter(
              ({ branchId: effectBranchId }) => effectBranchId === branch.id,
            );
            addNode(nodes, {
              id: branch.id,
              label: `${branch.controlFlow}: ${JSON.stringify(branch.selector)}`,
              kind: 'interaction_branch',
              uncertainty: branch.selector.kind === 'unknown' ? 'unknown' : 'resolved',
              impact: 'none',
              evidenceIds: branch.evidenceIds,
            });
            edges.push({
              id: `branch-link:${branch.id}`,
              source: handler.id,
              target: branch.id,
              label: 'dispatch branch',
              kind: 'interaction',
              relation: 'JOB_QUEUE_DISPATCH_BRANCH',
              uncertainty: branch.selector.kind === 'unknown' ? 'unknown' : 'resolved',
              impact: 'none',
              evidenceIds: branch.evidenceIds,
            });
            for (const effect of branchEffects) {
              addNode(nodes, canonicalNode(effect.targetId, indexes, 'none'));
              edges.push({
                id: effect.id,
                source: branch.id,
                target: effect.targetId,
                label: effect.kind.replaceAll('_', ' '),
                kind: 'interaction',
                relation: `JOB_QUEUE_BRANCH_${effect.kind.toUpperCase()}`,
                uncertainty: graphUncertaintyFromAssertion(effect.status),
                impact: 'none',
                evidenceIds: effect.evidenceIds,
              });
            }
            return [
              {
                branchId: branch.id,
                selector: branch.selector,
                controlFlow: branch.controlFlow,
                effects: branchEffects.map((effect) => ({
                  effectId: effect.id,
                  kind: effect.kind,
                  targetId: effect.targetId,
                })),
              },
            ];
          });
          jobQueueDispatch = { state: dispatch.state, branches };
        }
      }
      const scene = selectScene({
        rootId: handler.id,
        nodes,
        edges,
        extraEvidenceIds: diagnostics.flatMap(({ evidenceIds }) => evidenceIds),
        analysis,
        maxNodes,
        maxEdges,
        maxEvidence,
      });
      const retainedEvidence = new Set(scene.evidence.map(({ id }) => id));
      const method = indexes.methods.get(handler.methodId);
      const producerInteractionIds = analysis.assertions
        .filter(
          (assertion) =>
            assertion.predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER' &&
            assertion.objectId === handler.id,
        )
        .map(({ subjectId }) => subjectId);
      interactionHandlers.push({
        handlerId: handler.id,
        kind: handler.kind,
        target: interactionHandlerTargetLabel(handler),
        method: method?.qualifiedName ?? handler.methodId,
        registrationState: handler.registrationState,
        boundary: handler.kind === 'in_process_event' ? 'in_process' : 'broker_or_worker_boundary',
        causalClass: handlerCausalClass(handler),
        dbReads: sortedUnique(
          trace.trace.terminals
            .filter(({ direction }) => direction === 'READ')
            .map(({ tableName }) => tableName),
        ),
        dbWrites: sortedUnique(
          trace.trace.terminals
            .filter(({ direction }) => direction === 'WRITE')
            .map(({ tableName }) => tableName),
        ),
        diagnostics: diagnostics.map((diagnostic) => ({
          ...diagnostic,
          evidenceIds: diagnostic.evidenceIds.filter((id) => retainedEvidence.has(id)),
        })),
        producerInteractionIds,
        ...(analysisHasJobQueueBranchFacts(analysis) ? { jobQueueDispatch } : {}),
        scene,
      });
    }
  }

  const limits = {
    maxNodesPerEndpoint: maxNodes,
    maxEdgesPerEndpoint: maxEdges,
    maxEvidencePerEndpoint: maxEvidence,
  };
  const architecture = analysisHasAuthorizationFacts(analysis)
    ? buildGraphArchitectureOverview({
        analysis,
        overview: buildArchitectureOverview(analysis),
        maxNodes,
        maxEdges,
        maxEvidence,
      })
    : undefined;
  const reportScenes = [
    ...endpoints.map(({ scene }) => scene),
    ...interactionHandlers.map(({ scene }) => scene),
    ...(architecture === undefined ? [] : [architecture.scene]),
  ];
  const document = canonicalizeGraphReportDocument({
    schemaVersion: analysisHasCriticalSectionFacts(analysis)
      ? GRAPH_REPORT_SCHEMA_V9_VERSION
      : analysisHasResourceAccessFacts(analysis)
        ? GRAPH_REPORT_SCHEMA_V8_VERSION
        : analysisHasAuthorizationFacts(analysis)
          ? GRAPH_REPORT_SCHEMA_V7_VERSION
          : analysisHasJobQueueBranchFacts(analysis)
            ? GRAPH_REPORT_SCHEMA_V5_VERSION
            : analysisHasInteractionFacts(analysis)
              ? GRAPH_REPORT_SCHEMA_V4_VERSION
              : GRAPH_REPORT_SCHEMA_VERSION,
    analysis: {
      id: analysis.analysisRun.id,
      schemaVersion: analysis.schemaVersion,
      resultState: analysis.resultState,
      repositoryRevision: analysis.analysisRun.repositoryRevision,
      toolName: analysis.analysisRun.tool.name,
      toolVersion: analysis.analysisRun.tool.version,
    },
    policy: {
      state: policyResults === undefined ? 'not_supplied' : 'supplied',
      schemaVersion: policyResults?.schemaVersion ?? null,
    },
    impact: {
      state: impact === undefined ? 'not_supplied' : 'supplied',
      schemaVersion: impact?.schemaVersion ?? null,
      side: impactSide,
    },
    limits,
    summary: {
      endpoints: endpoints.length,
      endpointsWithGuards: endpoints.filter(({ guards }) => guards.length > 0).length,
      endpointsWithDiagnostics: endpoints.filter(({ diagnostics }) => diagnostics.length > 0)
        .length,
      endpointsWithWrites: endpoints.filter(({ dbWrites }) => dbWrites.length > 0).length,
      impactedEndpoints: endpoints.filter(({ impact: state }) => state !== 'none').length,
      omittedNodes: reportScenes.reduce((total, scene) => total + scene.omitted.nodes, 0),
      omittedEdges: reportScenes.reduce((total, scene) => total + scene.omitted.edges, 0),
      omittedEvidence: reportScenes.reduce((total, scene) => total + scene.omitted.evidence, 0),
      ...(analysisHasInteractionFacts(analysis)
        ? {
            interactionHandlers: interactionHandlers.length,
            handlersWithDiagnostics: interactionHandlers.filter(
              ({ diagnostics }) => diagnostics.length > 0,
            ).length,
            handlersWithWrites: interactionHandlers.filter(({ dbWrites }) => dbWrites.length > 0)
              .length,
          }
        : {}),
      ...(architecture === undefined
        ? {}
        : {
            architectureRecords: architecture.summary.metricRecords,
            notReachedFromSupportedRoots: architecture.summary.notReachedFromSupportedRoots,
            uniquelyOwnedClasses: architecture.summary.uniquelyOwnedClasses,
            multipleOwnerClasses: architecture.summary.multipleOwnerClasses,
          }),
    },
    endpoints,
    ...(analysisHasInteractionFacts(analysis) ? { interactionHandlers } : {}),
    ...(architecture === undefined ? {} : { architecture }),
  });
  return assertValidGraphReportDocument({
    document,
    analysis,
    ...(policyResults === undefined ? {} : { policyResults }),
    ...(impact === undefined ? {} : { impact }),
  });
}
