import {
  analysisHasInteractionFacts,
  analysisHasResourceAccessFacts,
  type AnalysisDocument,
  type EndpointTraceStep,
} from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../tracing/interaction-handler-trace.js';
import {
  ARCHITECTURE_METRIC_KINDS,
  type ArchitectureHeatBand,
  type ArchitectureMetricKind,
  type ArchitectureMetricLegend,
  type ArchitectureMetricRecord,
  type ArchitectureOverview,
  type ModuleOwnershipRecord,
  type ModuleOwnershipState,
} from './model.js';

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)]!;
}

function legend(
  metric: ArchitectureMetricKind,
  values: readonly number[],
): ArchitectureMetricLegend {
  return {
    metric,
    eligibleRecords: values.length,
    maximum: values.length === 0 ? 0 : Math.max(...values),
    percentiles: {
      p50: nearestRank(values, 0.5),
      p75: nearestRank(values, 0.75),
      p90: nearestRank(values, 0.9),
    },
  };
}

function heat(value: number, metricLegend: ArchitectureMetricLegend): ArchitectureHeatBand {
  if (value === 0) return 'zero';
  if (value <= metricLegend.percentiles.p50) return 'low';
  if (value <= metricLegend.percentiles.p75) return 'medium';
  if (value <= metricLegend.percentiles.p90) return 'high';
  return 'very_high';
}

function resolvedReachableIds(rootId: string, steps: readonly EndpointTraceStep[]): Set<string> {
  const targetsBySource = new Map<string, string[]>();
  for (const step of steps) {
    if (step.status !== 'resolved' || step.toId === null) continue;
    targetsBySource.set(step.fromId, [...(targetsBySource.get(step.fromId) ?? []), step.toId]);
  }
  const reached = new Set([rootId]);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const target of targetsBySource.get(queue[cursor]!) ?? []) {
      if (reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

function incrementRootReach(
  target: Map<string, Set<string>>,
  rootId: string,
  reachableIds: ReadonlySet<string>,
  eligibleIds: ReadonlySet<string>,
): void {
  for (const recordId of reachableIds) {
    if (!eligibleIds.has(recordId)) continue;
    target.set(recordId, new Set([...(target.get(recordId) ?? []), rootId]));
  }
}

function classOwnership(input: {
  readonly analysis: AnalysisDocument;
  readonly classId: string;
  readonly modulesByClass: ReadonlyMap<string, readonly string[]>;
  readonly uncertainClassIds: ReadonlySet<string>;
}): { readonly state: ModuleOwnershipState; readonly moduleIds: readonly string[] } {
  if (input.analysis.schemaVersion === '1.0.0') {
    return { state: 'unavailable', moduleIds: [] };
  }
  const moduleIds = sortedUnique(input.modulesByClass.get(input.classId) ?? []);
  if (input.uncertainClassIds.has(input.classId)) {
    return { state: 'ownership_unknown', moduleIds };
  }
  if (moduleIds.length === 1) return { state: 'uniquely_owned', moduleIds };
  if (moduleIds.length > 1) return { state: 'multiple_owners', moduleIds };
  return {
    state: input.analysis.modules.some(
      ({ metadataCompleteness }) => metadataCompleteness === 'incomplete',
    )
      ? 'ownership_unknown'
      : 'not_declared_by_supported_modules',
    moduleIds: [],
  };
}

function resolvedCallAssertions(assertions: readonly AssertionRecord[]): AssertionRecord[] {
  return assertions.filter(
    (assertion) =>
      assertion.predicate === 'METHOD_CALLS_METHOD' &&
      assertion.status === 'resolved' &&
      assertion.objectId !== null,
  );
}

export function buildArchitectureOverview(analysis: AnalysisDocument): ArchitectureOverview {
  const methodIds = new Set(analysis.methods.map(({ id }) => id));
  const tableIds = new Set(analysis.tables.map(({ id }) => id));
  const interactionIds = new Set(
    analysisHasInteractionFacts(analysis) ? analysis.interactions.map(({ id }) => id) : [],
  );
  const resourceAccessIds = new Set(
    analysisHasResourceAccessFacts(analysis) ? analysis.resourceAccesses.map(({ id }) => id) : [],
  );
  const eligibleIds = new Set([...methodIds, ...tableIds, ...interactionIds, ...resourceAccessIds]);
  const endpointRootsByRecord = new Map<string, Set<string>>();
  for (const endpoint of analysis.endpoints) {
    const trace = buildEndpointTrace(analysis, {
      httpMethod: endpoint.httpMethod,
      path: endpoint.path,
    });
    if (trace.status !== 'resolved') continue;
    incrementRootReach(
      endpointRootsByRecord,
      endpoint.id,
      resolvedReachableIds(endpoint.id, trace.trace.steps),
      eligibleIds,
    );
  }

  const handlerRootsByRecord = new Map<string, Set<string>>();
  if (analysisHasInteractionFacts(analysis)) {
    for (const handler of analysis.interactionHandlers) {
      const trace = buildInteractionHandlerTrace(analysis, handler.id);
      if (trace.status !== 'resolved') continue;
      incrementRootReach(
        handlerRootsByRecord,
        handler.id,
        resolvedReachableIds(handler.id, trace.trace.steps),
        eligibleIds,
      );
    }
  }

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const assertion of resolvedCallAssertions(analysis.assertions)) {
    if (!methodIds.has(assertion.subjectId) || !methodIds.has(assertion.objectId!)) continue;
    fanOut.set(assertion.subjectId, (fanOut.get(assertion.subjectId) ?? 0) + 1);
    fanIn.set(assertion.objectId!, (fanIn.get(assertion.objectId!) ?? 0) + 1);
  }

  const rawRecords: {
    readonly recordId: string;
    readonly recordKind: ArchitectureMetricRecord['recordKind'];
    readonly values: readonly { metric: ArchitectureMetricKind; value: number }[];
  }[] = [
    ...analysis.methods.map(({ id }) => ({
      recordId: id,
      recordKind: 'method' as const,
      values: [
        { metric: 'direct_call_fan_in' as const, value: fanIn.get(id) ?? 0 },
        { metric: 'direct_call_fan_out' as const, value: fanOut.get(id) ?? 0 },
        {
          metric: 'endpoint_reach_count' as const,
          value: endpointRootsByRecord.get(id)?.size ?? 0,
        },
        { metric: 'handler_reach_count' as const, value: handlerRootsByRecord.get(id)?.size ?? 0 },
        {
          metric: 'supported_root_reach_count' as const,
          value:
            (endpointRootsByRecord.get(id)?.size ?? 0) + (handlerRootsByRecord.get(id)?.size ?? 0),
        },
      ],
    })),
    ...analysis.tables.map(({ id }) => ({
      recordId: id,
      recordKind: 'table' as const,
      values: [
        {
          metric: 'endpoint_reach_count' as const,
          value: endpointRootsByRecord.get(id)?.size ?? 0,
        },
        { metric: 'handler_reach_count' as const, value: handlerRootsByRecord.get(id)?.size ?? 0 },
        {
          metric: 'supported_root_reach_count' as const,
          value:
            (endpointRootsByRecord.get(id)?.size ?? 0) + (handlerRootsByRecord.get(id)?.size ?? 0),
        },
      ],
    })),
    ...(analysisHasInteractionFacts(analysis)
      ? analysis.interactions.map(({ id }) => ({
          recordId: id,
          recordKind: 'interaction' as const,
          values: [
            {
              metric: 'endpoint_reach_count' as const,
              value: endpointRootsByRecord.get(id)?.size ?? 0,
            },
            {
              metric: 'handler_reach_count' as const,
              value: handlerRootsByRecord.get(id)?.size ?? 0,
            },
            {
              metric: 'supported_root_reach_count' as const,
              value:
                (endpointRootsByRecord.get(id)?.size ?? 0) +
                (handlerRootsByRecord.get(id)?.size ?? 0),
            },
          ],
        }))
      : []),
    ...(analysisHasResourceAccessFacts(analysis)
      ? analysis.resourceAccesses.map(({ id }) => ({
          recordId: id,
          recordKind: 'resource_access' as const,
          values: [
            {
              metric: 'endpoint_reach_count' as const,
              value: endpointRootsByRecord.get(id)?.size ?? 0,
            },
            {
              metric: 'handler_reach_count' as const,
              value: handlerRootsByRecord.get(id)?.size ?? 0,
            },
            {
              metric: 'supported_root_reach_count' as const,
              value:
                (endpointRootsByRecord.get(id)?.size ?? 0) +
                (handlerRootsByRecord.get(id)?.size ?? 0),
            },
          ],
        }))
      : []),
  ];
  const metricLegends = ARCHITECTURE_METRIC_KINDS.map((metric) =>
    legend(
      metric,
      rawRecords.flatMap(({ values }) =>
        values.filter((value) => value.metric === metric).map(({ value }) => value),
      ),
    ),
  );
  const legendByMetric = new Map(metricLegends.map((record) => [record.metric, record]));
  const records: ArchitectureMetricRecord[] = rawRecords
    .map((record) => {
      const metrics = record.values.map((metric) => ({
        ...metric,
        heat: heat(metric.value, legendByMetric.get(metric.metric)!),
      }));
      const supportedReach = metrics.find(
        ({ metric }) => metric === 'supported_root_reach_count',
      )!.value;
      return {
        recordId: record.recordId,
        recordKind: record.recordKind,
        metrics,
        reachability:
          supportedReach === 0
            ? ('not_reached_from_supported_roots' as const)
            : ('reached_from_supported_root' as const),
      };
    })
    .sort((left, right) =>
      `${left.recordKind}:${left.recordId}`.localeCompare(`${right.recordKind}:${right.recordId}`),
    );

  const modulesByClass = new Map<string, string[]>();
  const uncertainClassIds = new Set<string>();
  if (analysis.schemaVersion !== '1.0.0') {
    for (const assertion of analysis.assertions) {
      if (
        assertion.predicate !== 'MODULE_PROVIDES_CLASS' &&
        assertion.predicate !== 'MODULE_DECLARES_CONTROLLER'
      ) {
        continue;
      }
      if (assertion.objectId === null) continue;
      if (assertion.status === 'resolved') {
        modulesByClass.set(assertion.objectId, [
          ...(modulesByClass.get(assertion.objectId) ?? []),
          assertion.subjectId,
        ]);
      } else {
        uncertainClassIds.add(assertion.objectId);
      }
    }
  }
  const ownershipByClass = new Map(
    analysis.classes.map(({ id }) => [
      id,
      classOwnership({ analysis, classId: id, modulesByClass, uncertainClassIds }),
    ]),
  );
  const moduleOwnership: ModuleOwnershipRecord[] = [
    ...analysis.classes.map(({ id }) => ({
      recordId: id,
      recordKind: 'class' as const,
      ...ownershipByClass.get(id)!,
    })),
    ...analysis.methods.map(({ id, classId }) => ({
      recordId: id,
      recordKind: 'method' as const,
      ...ownershipByClass.get(classId)!,
    })),
  ].sort((left, right) =>
    `${left.recordKind}:${left.recordId}`.localeCompare(`${right.recordKind}:${right.recordId}`),
  );
  const classOwnershipRecords = moduleOwnership.filter(({ recordKind }) => recordKind === 'class');

  return {
    rootCapabilities: {
      endpoints: 'available',
      interactionHandlers: analysisHasInteractionFacts(analysis) ? 'available' : 'unavailable',
    },
    supportedRoots: {
      endpoints: analysis.endpoints.length,
      interactionHandlers: analysisHasInteractionFacts(analysis)
        ? analysis.interactionHandlers.length
        : 0,
    },
    summary: {
      metricRecords: records.length,
      notReachedFromSupportedRoots: records.filter(
        ({ reachability }) => reachability === 'not_reached_from_supported_roots',
      ).length,
      uniquelyOwnedClasses: classOwnershipRecords.filter(({ state }) => state === 'uniquely_owned')
        .length,
      multipleOwnerClasses: classOwnershipRecords.filter(({ state }) => state === 'multiple_owners')
        .length,
      ownershipUnknownClasses: classOwnershipRecords.filter(
        ({ state }) => state === 'ownership_unknown' || state === 'unavailable',
      ).length,
    },
    metricLegends,
    records,
    moduleOwnership,
  };
}
