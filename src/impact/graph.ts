import type { AnalysisSemanticProjection } from '../comparison/projection.js';
import type { SemanticKey } from '../comparison/semantic-key.js';
import {
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticCode } from '../model/diagnostics.js';
import {
  matchJobQueueBranchSelector,
  type JobQueueHandlerBranchRecord,
} from '../model/job-queue-branches.js';
import type { ImpactGraphSide, ImpactPath, ImpactPathStep } from './model.js';

const REVERSE_PATH_PREDICATES = new Set<AssertionRecord['predicate']>([
  'ENDPOINT_IMPLEMENTED_BY',
  'METHOD_CALLS_METHOD',
  'METHOD_READS_TABLE',
  'METHOD_WRITES_TABLE',
  'METHOD_INITIATES_INTERACTION',
  'METHOD_ACCESSES_RESOURCE',
  'INTERACTION_MATCHES_LOCAL_HANDLER',
  'HANDLER_IMPLEMENTED_BY',
]);

const INCOMPLETE_TRACE_CODES = new Set<DiagnosticCode>([
  'CALL_TARGET_UNRESOLVED',
  'CALL_DEPTH_LIMIT',
  'TYPEORM_ENTITY_UNRESOLVED',
  'TYPEORM_OPERATION_UNSUPPORTED',
  'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS',
  'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED',
  'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED',
  'TYPEORM_QUERY_BUILDER_TERMINAL_MISSING',
  'TYPEORM_RAW_SQL_DIALECT_UNSELECTED',
  'TYPEORM_RAW_SQL_RECEIVER_AMBIGUOUS',
  'TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED',
  'TYPEORM_RAW_SQL_LIMIT_EXCEEDED',
  'TYPEORM_RAW_SQL_PARSE_FAILED',
  'TYPEORM_RAW_SQL_STATEMENT_UNSUPPORTED',
  'INTERACTION_RECEIVER_AMBIGUOUS',
  'INTERACTION_TARGET_DYNAMIC',
  'INTERACTION_TRACE_LIMIT_REACHED',
  'EVENT_EMITTER_CONFIGURATION_UNKNOWN',
  'EVENT_HANDLER_REGISTRATION_UNKNOWN',
  'JOB_QUEUE_HANDLER_REGISTRATION_UNKNOWN',
  'JOB_QUEUE_FILTER_UNPROVEN',
  'JOB_QUEUE_FILTER_PARTIAL',
  'MICROSERVICE_TRANSPORT_UNKNOWN',
  'MICROSERVICE_ACTIVATION_UNKNOWN',
  'MICROSERVICE_HANDLER_REGISTRATION_UNKNOWN',
  'MICROSERVICE_REQUEST_HANDLER_AMBIGUOUS',
  'RESOURCE_ACCESS_TARGET_DYNAMIC',
  'RESOURCE_ACCESS_TARGET_LIMIT_EXCEEDED',
  'RESOURCE_ACCESS_OPERATION_UNSUPPORTED',
]);

export interface ImpactGraph {
  readonly side: ImpactGraphSide;
  readonly analysis: AnalysisDocument;
  readonly projection: AnalysisSemanticProjection;
  readonly assertionsById: ReadonlyMap<string, AssertionRecord>;
  readonly incomingByObject: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly endpointIds: ReadonlySet<string>;
  readonly incompleteSubjectIds: ReadonlySet<string>;
  readonly branchIdsByAssertionId: ReadonlyMap<string, readonly string[]>;
  readonly branchById: ReadonlyMap<string, JobQueueHandlerBranchRecord>;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function buildImpactGraph(
  side: ImpactGraphSide,
  analysis: AnalysisDocument,
  projection: AnalysisSemanticProjection,
): ImpactGraph {
  const incoming = new Map<string, AssertionRecord[]>();
  const branchIdsByAssertionId = new Map<string, string[]>();
  const branchById = new Map<string, JobQueueHandlerBranchRecord>();
  if (analysisHasJobQueueBranchFacts(analysis)) {
    for (const branch of analysis.interactionHandlerBranches) branchById.set(branch.id, branch);
    for (const effect of analysis.interactionHandlerBranchEffects) {
      branchIdsByAssertionId.set(effect.sourceAssertionId, [
        ...(branchIdsByAssertionId.get(effect.sourceAssertionId) ?? []),
        effect.branchId,
      ]);
    }
  }
  const interactionById = new Map(
    analysisHasInteractionFacts(analysis)
      ? analysis.interactions.map((interaction) => [interaction.id, interaction] as const)
      : [],
  );
  for (const assertion of analysis.assertions) {
    const interaction = interactionById.get(assertion.subjectId);
    if (
      assertion.objectId === null ||
      (assertion.status !== 'resolved' && assertion.status !== 'ambiguous') ||
      (assertion.predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER' &&
        assertion.status === 'ambiguous' &&
        interaction?.kind === 'microservice_message' &&
        interaction.target.mode === 'request_response')
    ) {
      continue;
    }
    incoming.set(assertion.objectId, [...(incoming.get(assertion.objectId) ?? []), assertion]);
  }
  for (const values of incoming.values())
    values.sort((left, right) => compareStrings(left.id, right.id));

  return {
    side,
    analysis,
    projection,
    assertionsById: new Map(analysis.assertions.map((assertion) => [assertion.id, assertion])),
    incomingByObject: incoming,
    endpointIds: new Set(analysis.endpoints.map(({ id }) => id)),
    incompleteSubjectIds: new Set(
      analysis.diagnostics.flatMap((diagnostic) =>
        diagnostic.subjectId !== undefined && INCOMPLETE_TRACE_CODES.has(diagnostic.code)
          ? [diagnostic.subjectId]
          : [],
      ),
    ),
    branchIdsByAssertionId,
    branchById,
  };
}

export function assertionStep(graph: ImpactGraph, assertion: AssertionRecord): ImpactPathStep {
  const fromKey = graph.projection.semanticKeyById.get(assertion.subjectId);
  const toKey =
    assertion.objectId === null
      ? null
      : (graph.projection.semanticKeyById.get(assertion.objectId) ?? null);
  if (fromKey === undefined) throw new Error(`Missing semantic subject for ${assertion.id}.`);
  return {
    assertionId: assertion.id,
    fromId: assertion.subjectId,
    fromKey,
    predicate: assertion.predicate,
    toId: assertion.objectId,
    toKey,
    status: assertion.status,
    ruleId: assertion.ruleId,
    evidenceIds: [...new Set(assertion.evidenceIds)].sort(compareStrings),
  };
}

interface ReverseState {
  readonly currentId: string;
  readonly reversedSteps: readonly ImpactPathStep[];
  readonly callDepth: number;
  readonly interactionHops: number;
  readonly visited: ReadonlySet<string>;
  readonly branchIds: readonly string[];
}

export function pathsFromEndpoints(graph: ImpactGraph, targetId: string): ImpactPath[] {
  const targetKey = graph.projection.semanticKeyById.get(targetId);
  if (targetKey === undefined) return [];
  if (graph.endpointIds.has(targetId)) {
    return [{ side: graph.side, endpointId: targetId, targetKey, steps: [] }];
  }

  const paths: ImpactPath[] = [];
  const queue: ReverseState[] = [
    {
      currentId: targetId,
      reversedSteps: [],
      callDepth: 0,
      interactionHops: 0,
      visited: new Set([targetId]),
      branchIds: [],
    },
  ];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    for (const assertion of graph.incomingByObject.get(current.currentId) ?? []) {
      if (!REVERSE_PATH_PREDICATES.has(assertion.predicate)) continue;
      const branchIds = [
        ...new Set([
          ...current.branchIds,
          ...(graph.branchIdsByAssertionId.get(assertion.id) ?? []),
        ]),
      ];
      if (assertion.predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER' && branchIds.length > 0) {
        const interaction = analysisHasInteractionFacts(graph.analysis)
          ? graph.analysis.interactions.find(({ id }) => id === assertion.subjectId)
          : undefined;
        if (interaction?.kind === 'job_queue') {
          const applicability = branchIds.flatMap((branchId) => {
            const branch = graph.branchById.get(branchId);
            return branch === undefined
              ? []
              : [matchJobQueueBranchSelector(branch.selector, interaction.target.job)];
          });
          if (
            applicability.length > 0 &&
            applicability.every((state) => state === 'does_not_match')
          ) {
            continue;
          }
        }
      }
      const nextDepth = current.callDepth + (assertion.predicate === 'METHOD_CALLS_METHOD' ? 1 : 0);
      if (nextDepth > graph.analysis.analysisRun.configuration.maxCallDepth) continue;
      const nextInteractionHops =
        current.interactionHops +
        (assertion.predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER' ? 1 : 0);
      const maximumInteractionHops = analysisHasInteractionFacts(graph.analysis)
        ? (graph.analysis.analysisRun.configuration.interactions?.maxInteractionHops ?? 2)
        : 0;
      if (nextInteractionHops > maximumInteractionHops) continue;
      if (current.visited.has(assertion.subjectId)) continue;
      const step = assertionStep(graph, assertion);
      const reversedSteps = [...current.reversedSteps, step];
      if (graph.endpointIds.has(assertion.subjectId)) {
        paths.push({
          side: graph.side,
          endpointId: assertion.subjectId,
          targetKey,
          steps: [...reversedSteps].reverse(),
        });
        continue;
      }
      queue.push({
        currentId: assertion.subjectId,
        reversedSteps,
        callDepth: nextDepth,
        interactionHops: nextInteractionHops,
        visited: new Set([...current.visited, assertion.subjectId]),
        branchIds,
      });
    }
  }

  const unique = new Map<string, ImpactPath>();
  for (const path of paths) {
    const key = `${path.endpointId}:${path.steps.map(({ assertionId }) => assertionId).join(':')}`;
    unique.set(key, path);
  }
  return [...unique.values()].sort((left, right) =>
    `${left.endpointId}:${left.steps.map(({ assertionId }) => assertionId).join(':')}`.localeCompare(
      `${right.endpointId}:${right.steps.map(({ assertionId }) => assertionId).join(':')}`,
    ),
  );
}

export function appendAssertionToPaths(
  graph: ImpactGraph,
  paths: readonly ImpactPath[],
  assertion: AssertionRecord,
): ImpactPath[] {
  const step = assertionStep(graph, assertion);
  const targetKey = step.toKey ?? step.fromKey;
  return paths.map((path) => ({ ...path, targetKey, steps: [...path.steps, step] }));
}

export function pathHasIncompleteTrace(graph: ImpactGraph, path: ImpactPath): boolean {
  if (path.steps.some(({ status }) => status !== 'resolved')) return true;
  return path.steps.some(
    ({ fromId, toId }) =>
      graph.incompleteSubjectIds.has(fromId) ||
      (toId !== null && graph.incompleteSubjectIds.has(toId)),
  );
}

export function semanticKeyForId(graph: ImpactGraph, id: string): SemanticKey | undefined {
  return graph.projection.semanticKeyById.get(id);
}
