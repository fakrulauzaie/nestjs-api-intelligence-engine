import type { ArchitectureOverview, ModuleOwnershipRecord } from '../architecture/model.js';
import {
  analysisHasInteractionFacts,
  analysisHasResourceAccessFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import type { AssertionPredicate } from '../model/assertions.js';
import { hashContent } from '../model/hashing.js';
import {
  inProcessEventTargetLabel,
  jobQueueTargetLabel,
  microserviceMessageTargetLabel,
  outboundHttpTargetLabel,
} from '../reporting/interaction-labels.js';
import type { InteractionHandlerRecord, InteractionRecord } from '../model/interactions.js';
import { resourceAccessLabel } from '../model/resource-access.js';
import type {
  GraphReportArchitectureOverview,
  GraphReportEdge,
  GraphReportEvidence,
  GraphReportNode,
  GraphReportScene,
} from './model.js';

const ARCHITECTURE_ASSERTION_PREDICATES = new Set<AssertionPredicate>([
  'ENDPOINT_IMPLEMENTED_BY',
  'METHOD_CALLS_METHOD',
  'METHOD_READS_TABLE',
  'METHOD_WRITES_TABLE',
  'METHOD_INITIATES_INTERACTION',
  'INTERACTION_MATCHES_LOCAL_HANDLER',
  'HANDLER_IMPLEMENTED_BY',
  'METHOD_ACCESSES_RESOURCE',
]);

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function architectureId(kind: 'root' | 'edge', parts: readonly string[]): string {
  return `architecture-${kind}:${hashContent(JSON.stringify(parts)).slice(0, 32)}`;
}

function interactionLabel(interaction: InteractionRecord): string {
  switch (interaction.kind) {
    case 'outbound_http':
      return outboundHttpTargetLabel(interaction.target);
    case 'in_process_event':
      return `event ${inProcessEventTargetLabel(interaction.target)}`;
    case 'job_queue':
      return jobQueueTargetLabel(interaction.target);
    case 'microservice_message':
      return microserviceMessageTargetLabel(interaction.target);
  }
}

function handlerLabel(handler: InteractionHandlerRecord): string {
  switch (handler.kind) {
    case 'in_process_event':
      return `@OnEvent ${inProcessEventTargetLabel(handler.target)}`;
    case 'job_queue':
      return `@Processor ${jobQueueTargetLabel(handler.target)}`;
    case 'microservice_message':
      return `${handler.target.mode === 'event' ? '@EventPattern' : '@MessagePattern'} ${microserviceMessageTargetLabel(handler.target)}`;
  }
}

function assertionLabel(predicate: AssertionPredicate): string {
  const labels: Partial<Record<AssertionPredicate, string>> = {
    ENDPOINT_IMPLEMENTED_BY: 'implemented by',
    METHOD_CALLS_METHOD: 'calls',
    METHOD_READS_TABLE: 'reads',
    METHOD_WRITES_TABLE: 'writes',
    METHOD_INITIATES_INTERACTION: 'initiates',
    INTERACTION_MATCHES_LOCAL_HANDLER: 'matches local handler',
    HANDLER_IMPLEMENTED_BY: 'implemented by',
    METHOD_ACCESSES_RESOURCE: 'accesses resource',
  };
  return labels[predicate] ?? predicate.toLowerCase().replaceAll('_', ' ');
}

function architectureEdge(input: {
  readonly rootId: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly evidenceIds: readonly string[];
}): GraphReportEdge {
  return {
    id: architectureId('edge', [input.rootId, input.source, input.target, input.label]),
    source: input.source,
    target: input.target,
    label: input.label,
    kind: 'architecture',
    relation: null,
    uncertainty: 'resolved',
    impact: 'none',
    evidenceIds: sortedUnique(input.evidenceIds),
  };
}

function heatRank(node: GraphReportNode): number {
  const ranks = { very_high: 0, high: 1, medium: 2, low: 3, zero: 4 } as const;
  const values = node.architectureMetrics ?? [];
  if (values.length === 0) return 5;
  return Math.min(...values.map(({ heat }) => ranks[heat]));
}

function selectArchitectureScene(input: {
  readonly analysis: AnalysisDocument;
  readonly rootId: string;
  readonly nodes: ReadonlyMap<string, GraphReportNode>;
  readonly edges: readonly GraphReportEdge[];
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxEvidence: number;
}): GraphReportScene {
  const selectedIds = new Set([input.rootId]);
  const addWithParents = (node: GraphReportNode): boolean => {
    const additions: GraphReportNode[] = [];
    let current: GraphReportNode | undefined = node;
    const seen = new Set<string>();
    while (current !== undefined && !selectedIds.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id);
      additions.push(current);
      current =
        current.parentId === undefined || current.parentId === null
          ? undefined
          : input.nodes.get(current.parentId);
    }
    if (selectedIds.size + additions.length > input.maxNodes) return false;
    for (const addition of additions) selectedIds.add(addition.id);
    return true;
  };
  const nodeKindRank: Record<GraphReportNode['kind'], number> = {
    repository: 0,
    endpoint: 1,
    interaction_handler: 1,
    method: 2,
    table: 3,
    interaction: 3,
    resource_access: 3,
    critical_section: 3,
    module: 4,
    class: 5,
    guard: 6,
    request_parameter: 6,
    request_origin: 6,
    entity_column: 6,
    external_target: 6,
    boundary: 6,
    interaction_branch: 6,
    gap: 6,
  };
  for (const node of [...input.nodes.values()].sort(
    (left, right) =>
      nodeKindRank[left.kind] - nodeKindRank[right.kind] ||
      heatRank(left) - heatRank(right) ||
      left.id.localeCompare(right.id),
  )) {
    addWithParents(node);
  }
  const selectedEdges = input.edges
    .filter(({ source, target }) => selectedIds.has(source) && selectedIds.has(target))
    .sort((left, right) => {
      const leftRank = left.kind === 'assertion' ? 0 : 1;
      const rightRank = right.kind === 'assertion' ? 0 : 1;
      return leftRank - rightRank || left.id.localeCompare(right.id);
    })
    .slice(0, input.maxEdges);
  const selectedNodes = [...selectedIds]
    .map((id) => input.nodes.get(id))
    .filter((node): node is GraphReportNode => node !== undefined);
  const allReferencedEvidenceIds = sortedUnique([
    ...selectedNodes.flatMap(({ evidenceIds }) => evidenceIds),
    ...selectedEdges.flatMap(({ evidenceIds }) => evidenceIds),
  ]);
  const referencedEvidenceIds = allReferencedEvidenceIds.slice(0, input.maxEvidence);
  const evidenceById = new Map(input.analysis.evidence.map((record) => [record.id, record]));
  const sourceById = new Map(input.analysis.sourceFiles.map((record) => [record.id, record]));
  const evidence: GraphReportEvidence[] = referencedEvidenceIds.flatMap((id) => {
    const record = evidenceById.get(id);
    const source = record === undefined ? undefined : sourceById.get(record.fileId);
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
  const retainedEvidence = new Set(evidence.map(({ id }) => id));
  const trim = (values: readonly string[]): string[] =>
    sortedUnique(values.filter((id) => retainedEvidence.has(id)));
  return {
    nodes: selectedNodes.map((node) => ({
      ...node,
      evidenceIds: trim(node.evidenceIds),
      ...(node.moduleOwnership === undefined
        ? {}
        : {
            moduleOwnership: {
              ...node.moduleOwnership,
              moduleIds: sortedUnique(node.moduleOwnership.moduleIds),
            },
          }),
    })),
    edges: selectedEdges.map((edge) => ({ ...edge, evidenceIds: trim(edge.evidenceIds) })),
    evidence,
    omitted: {
      nodes: Math.max(0, input.nodes.size - selectedNodes.length),
      edges: Math.max(0, input.edges.length - selectedEdges.length),
      evidence: Math.max(0, allReferencedEvidenceIds.length - evidence.length),
    },
  };
}

function ownershipFor(
  ownershipById: ReadonlyMap<string, ModuleOwnershipRecord>,
  recordId: string,
): GraphReportNode['moduleOwnership'] {
  const ownership = ownershipById.get(recordId);
  return ownership === undefined
    ? undefined
    : { state: ownership.state, moduleIds: ownership.moduleIds };
}

export function buildGraphArchitectureOverview(input: {
  readonly analysis: AnalysisDocument;
  readonly overview: ArchitectureOverview;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxEvidence: number;
}): GraphReportArchitectureOverview {
  const { analysis, overview } = input;
  const rootId = architectureId('root', [analysis.analysisRun.id]);
  const metricsById = new Map(overview.records.map((record) => [record.recordId, record]));
  const ownershipById = new Map(
    overview.moduleOwnership.map((record) => [record.recordId, record]),
  );
  const nodes = new Map<string, GraphReportNode>();
  const add = (node: GraphReportNode): void => {
    nodes.set(node.id, node);
  };
  add({
    id: rootId,
    label: 'Repository architecture overview',
    kind: 'repository',
    uncertainty: 'resolved',
    impact: 'none',
    evidenceIds: [],
  });
  const moduleClassIds = new Set<string>();
  if (analysis.schemaVersion !== '1.0.0') {
    for (const moduleRecord of analysis.modules) {
      moduleClassIds.add(moduleRecord.classId);
      const moduleClass = analysis.classes.find(({ id }) => id === moduleRecord.classId);
      add({
        id: moduleRecord.id,
        label: moduleClass?.displayName ?? moduleRecord.id,
        kind: 'module',
        uncertainty: moduleRecord.metadataCompleteness === 'complete' ? 'resolved' : 'unknown',
        impact: 'none',
        evidenceIds: [moduleRecord.declarationEvidenceId],
      });
    }
  }
  for (const classRecord of analysis.classes) {
    if (moduleClassIds.has(classRecord.id)) continue;
    const ownership = ownershipFor(ownershipById, classRecord.id);
    add({
      id: classRecord.id,
      label: classRecord.qualifiedName,
      kind: 'class',
      uncertainty:
        ownership?.state === 'multiple_owners'
          ? 'ambiguous'
          : ownership?.state === 'ownership_unknown' || ownership?.state === 'unavailable'
            ? 'unknown'
            : 'resolved',
      impact: 'none',
      evidenceIds: [classRecord.declarationEvidenceId],
      ...(ownership?.state === 'uniquely_owned' ? { parentId: ownership.moduleIds[0]! } : {}),
      ...(ownership === undefined ? {} : { moduleOwnership: ownership }),
    });
  }
  for (const method of analysis.methods) {
    const metrics = metricsById.get(method.id);
    const ownership = ownershipFor(ownershipById, method.id);
    add({
      id: method.id,
      label: method.qualifiedName,
      kind: 'method',
      uncertainty: 'resolved',
      impact: 'none',
      evidenceIds: [method.declarationEvidenceId],
      ...(nodes.has(method.classId) ? { parentId: method.classId } : {}),
      ...(metrics === undefined
        ? {}
        : {
            architectureMetrics: metrics.metrics,
            architectureReachability: metrics.reachability,
          }),
      ...(ownership === undefined ? {} : { moduleOwnership: ownership }),
    });
  }
  const implementationEvidenceByEndpoint = new Map(
    analysis.assertions
      .filter(({ predicate }) => predicate === 'ENDPOINT_IMPLEMENTED_BY')
      .map((assertion) => [assertion.subjectId, assertion.evidenceIds]),
  );
  for (const endpoint of analysis.endpoints) {
    add({
      id: endpoint.id,
      label: `${endpoint.httpMethod} ${endpoint.path}`,
      kind: 'endpoint',
      uncertainty: 'resolved',
      impact: 'none',
      evidenceIds: implementationEvidenceByEndpoint.get(endpoint.id) ?? [],
    });
  }
  for (const table of analysis.tables) {
    const metrics = metricsById.get(table.id);
    add({
      id: table.id,
      label: table.name,
      kind: 'table',
      uncertainty: 'resolved',
      impact: 'none',
      evidenceIds: [],
      ...(metrics === undefined
        ? {}
        : {
            architectureMetrics: metrics.metrics,
            architectureReachability: metrics.reachability,
          }),
    });
  }
  if (analysisHasInteractionFacts(analysis)) {
    for (const interaction of analysis.interactions) {
      const metrics = metricsById.get(interaction.id);
      add({
        id: interaction.id,
        label: interactionLabel(interaction),
        kind: 'interaction',
        uncertainty:
          interaction.kind === 'outbound_http' &&
          (interaction.target.url.resolution === 'dynamic' ||
            interaction.target.method === 'UNKNOWN')
            ? 'unknown'
            : 'resolved',
        impact: 'none',
        evidenceIds: interaction.evidenceIds,
        ...(metrics === undefined
          ? {}
          : {
              architectureMetrics: metrics.metrics,
              architectureReachability: metrics.reachability,
            }),
      });
    }
    for (const handler of analysis.interactionHandlers) {
      add({
        id: handler.id,
        label: handlerLabel(handler),
        kind: 'interaction_handler',
        uncertainty: handler.registrationState === 'proven_registered' ? 'resolved' : 'unknown',
        impact: 'none',
        evidenceIds: [handler.handlerEvidenceId],
      });
    }
  }
  if (analysisHasResourceAccessFacts(analysis)) {
    for (const access of analysis.resourceAccesses) {
      const metrics = metricsById.get(access.id);
      add({
        id: access.id,
        label: resourceAccessLabel(access),
        kind: 'resource_access',
        uncertainty: access.target.kind === 'dynamic' ? 'unknown' : 'resolved',
        impact: 'none',
        evidenceIds: access.evidenceIds,
        ...(metrics === undefined
          ? {}
          : {
              architectureMetrics: metrics.metrics,
              architectureReachability: metrics.reachability,
            }),
      });
    }
  }

  const edges: GraphReportEdge[] = [];
  const addArchitectureEdge = (
    source: string,
    target: string,
    label: string,
    evidenceIds: readonly string[],
  ): void => {
    if (!nodes.has(source) || !nodes.has(target)) return;
    edges.push(architectureEdge({ rootId, source, target, label, evidenceIds }));
  };
  if (analysis.schemaVersion !== '1.0.0') {
    for (const moduleRecord of analysis.modules) {
      addArchitectureEdge(rootId, moduleRecord.id, 'contains module', [
        moduleRecord.declarationEvidenceId,
      ]);
    }
  }
  for (const endpoint of analysis.endpoints) {
    addArchitectureEdge(rootId, endpoint.id, 'supports endpoint root', []);
  }
  if (analysisHasInteractionFacts(analysis)) {
    for (const handler of analysis.interactionHandlers) {
      addArchitectureEdge(rootId, handler.id, 'supports handler root', [handler.handlerEvidenceId]);
    }
  }
  for (const classRecord of analysis.classes) {
    if (!nodes.has(classRecord.id)) continue;
    const ownership = ownershipById.get(classRecord.id);
    if (ownership?.state === 'uniquely_owned') {
      addArchitectureEdge(ownership.moduleIds[0]!, classRecord.id, 'uniquely declares', [
        classRecord.declarationEvidenceId,
      ]);
    } else if (ownership?.state === 'multiple_owners') {
      for (const moduleId of ownership.moduleIds) {
        addArchitectureEdge(moduleId, classRecord.id, 'multiple module declarations', [
          classRecord.declarationEvidenceId,
        ]);
      }
    } else {
      addArchitectureEdge(rootId, classRecord.id, ownership?.state ?? 'contains class', [
        classRecord.declarationEvidenceId,
      ]);
    }
  }
  for (const method of analysis.methods) {
    addArchitectureEdge(method.classId, method.id, 'declares method', [
      method.declarationEvidenceId,
    ]);
  }
  for (const record of overview.records) {
    if (record.reachability === 'not_reached_from_supported_roots') {
      addArchitectureEdge(rootId, record.recordId, 'not reached from supported roots', []);
    }
  }
  for (const assertion of analysis.assertions) {
    if (
      assertion.status !== 'resolved' ||
      assertion.objectId === null ||
      !ARCHITECTURE_ASSERTION_PREDICATES.has(assertion.predicate) ||
      !nodes.has(assertion.subjectId) ||
      !nodes.has(assertion.objectId)
    ) {
      continue;
    }
    edges.push({
      id: assertion.id,
      source: assertion.subjectId,
      target: assertion.objectId,
      label: assertionLabel(assertion.predicate),
      kind: 'assertion',
      relation: assertion.predicate,
      uncertainty: 'resolved',
      impact: 'none',
      evidenceIds: assertion.evidenceIds,
    });
  }

  return {
    ...overview,
    rootId,
    scene: selectArchitectureScene({
      analysis,
      rootId,
      nodes,
      edges,
      maxNodes: input.maxNodes,
      maxEdges: input.maxEdges,
      maxEvidence: input.maxEvidence,
    }),
  };
}
