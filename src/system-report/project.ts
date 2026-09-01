import {
  analysisHasInteractionFacts,
  type AnalysisDocument,
  type EndpointTraceView,
  type InteractionHandlerTraceView,
} from '../model/analysis.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import {
  makeNamespacedAnalysisRecordId,
  makeSystemConditionalPathId,
  makeSystemReportDiagnosticId,
  makeSystemReportEdgeId,
  makeSystemReportId,
  makeSystemReportNodeId,
} from '../system-analysis/ids.js';
import type {
  BrokerRealmRecord,
  SystemAnalysisDocument,
  SystemAnalysisRecordReference,
  SystemInteractionContractTarget,
} from '../system-analysis/model.js';
import { systemCorrelationHasDeclaredRealmCandidate } from '../system-analysis/model.js';
import type { StitchServiceAnalysisInput } from '../system-analysis/stitch.js';
import { assertValidSystemAnalysisDocument } from '../system-analysis/validate.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../tracing/interaction-handler-trace.js';
import {
  DEFAULT_SYSTEM_REPORT_EDGE_LIMIT,
  DEFAULT_SYSTEM_REPORT_NODE_LIMIT,
  SYSTEM_REPORT_SCHEMA_VERSION,
  type SystemConditionalPath,
  type SystemReportCertaintyState,
  type SystemReportCorrelation,
  type SystemReportDiagnostic,
  type SystemReportDocument,
  type SystemReportEdge,
  type SystemReportNode,
} from './model.js';
import { evaluateSystemPolicies } from './policy.js';
import { assertValidSystemReportDocument } from './validate.js';

export interface BuildSystemReportInput {
  readonly system: SystemAnalysisDocument;
  readonly services: readonly StitchServiceAnalysisInput[];
  readonly maxNodes?: number | undefined;
  readonly maxEdges?: number | undefined;
}

export class SystemReportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemReportInputError';
  }
}

interface ServiceContext {
  readonly namespace: string;
  readonly serviceId: string;
  readonly analysis: AnalysisDocument;
}

interface HttpRoot {
  readonly nodeId: string;
  readonly endpointRecord: SystemAnalysisRecordReference;
  readonly label: string;
  readonly trace: EndpointTraceView;
  readonly initiationCertainty: 'resolved' | 'ambiguous';
  readonly diagnostics: readonly DiagnosticRecord[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function reference(
  context: ServiceContext,
  analysisRecordId: string,
): SystemAnalysisRecordReference {
  return {
    serviceId: context.serviceId,
    analysisRecordId,
    namespacedId: makeNamespacedAnalysisRecordId({
      serviceNamespace: context.namespace,
      analysisRecordId,
    }),
  };
}

function contractLabel(contract: SystemInteractionContractTarget): string {
  if (contract.targetKind === 'job_queue') {
    return `${contract.technology} ${contract.queue ?? '<dynamic>'} / ${contract.job ?? '<queue-wide or dynamic>'}`;
  }
  return `${contract.mode.replace('_', ' ')} ${contract.canonicalPattern ?? '<dynamic>'}`;
}

function destinationNodeId(realm: BrokerRealmRecord): string {
  return makeSystemReportNodeId(['broker_destination', realm.id]);
}

function certaintyRank(value: SystemReportCertaintyState): number {
  return { resolved: 0, conditional_candidate: 1, ambiguous: 2, unknown: 3 }[value];
}

function lessCertain(
  left: SystemReportCertaintyState,
  right: SystemReportCertaintyState,
): SystemReportCertaintyState {
  return certaintyRank(left) >= certaintyRank(right) ? left : right;
}

function validateInputs(
  system: SystemAnalysisDocument,
  inputs: readonly StitchServiceAnalysisInput[],
): Map<string, ServiceContext> {
  const byNamespace = new Map<string, ServiceContext>();
  for (const input of inputs) {
    if (byNamespace.has(input.namespace)) {
      throw new SystemReportInputError(`Duplicate source analysis namespace ${input.namespace}.`);
    }
    const service = system.services.find(({ namespace }) => namespace === input.namespace);
    if (service === undefined) {
      throw new SystemReportInputError(
        `Source analysis namespace ${input.namespace} is not present in the system document.`,
      );
    }
    if (service.analysisId !== input.analysis.analysisRun.id) {
      throw new SystemReportInputError(
        `Source analysis ${input.namespace} does not match system snapshot ${service.analysisId}.`,
      );
    }
    byNamespace.set(input.namespace, {
      namespace: input.namespace,
      serviceId: service.id,
      analysis: input.analysis,
    });
  }
  const missing = system.services.filter(({ namespace }) => !byNamespace.has(namespace));
  if (missing.length > 0) {
    throw new SystemReportInputError(
      `System report requires the exact source artifacts for: ${missing.map(({ namespace }) => namespace).join(', ')}.`,
    );
  }
  return byNamespace;
}

function sourceDiagnostic(
  context: ServiceContext,
  diagnostic: DiagnosticRecord,
  subjectId: string,
): SystemReportDiagnostic {
  return {
    id: makeSystemReportDiagnosticId([
      'source_analysis',
      context.namespace,
      diagnostic.id,
      subjectId,
    ]),
    origin: 'source_analysis',
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    subjectId,
    serviceId: context.serviceId,
    sourceDiagnosticId: diagnostic.id,
  };
}

function rootsByInteraction(context: ServiceContext): Map<string, HttpRoot[]> {
  const roots = new Map<string, HttpRoot[]>();
  if (!analysisHasInteractionFacts(context.analysis)) return roots;
  for (const endpoint of context.analysis.endpoints) {
    const built = buildEndpointTrace(context.analysis, {
      httpMethod: endpoint.httpMethod,
      path: endpoint.path,
    });
    if (built.status !== 'resolved') continue;
    for (const interactionId of built.trace.causalSummary?.distributedInteractionIds ?? []) {
      const initiationSteps = built.trace.steps.filter(
        ({ relation, toId }) =>
          relation === 'METHOD_INITIATES_INTERACTION' && toId === interactionId,
      );
      if (initiationSteps.length === 0) continue;
      const root: HttpRoot = {
        nodeId: makeSystemReportNodeId(['http_endpoint', context.namespace, endpoint.id]),
        endpointRecord: reference(context, endpoint.id),
        label: `${endpoint.httpMethod} ${endpoint.path}`,
        trace: built.trace,
        initiationCertainty: initiationSteps.some(({ status }) => status === 'ambiguous')
          ? 'ambiguous'
          : 'resolved',
        diagnostics: built.diagnostics,
      };
      roots.set(interactionId, [...(roots.get(interactionId) ?? []), root]);
    }
  }
  for (const values of roots.values())
    values.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  return roots;
}

function nodePriority(node: SystemReportNode, pathNodeIds: ReadonlySet<string>): number {
  if (pathNodeIds.has(node.id))
    return node.kind === 'service' || node.kind === 'broker_realm' ? 0 : 1;
  if (node.kind === 'service' || node.kind === 'broker_realm') return 2;
  if (node.kind === 'broker_destination') return 3;
  return 4;
}

export function buildSystemReportDocument(input: BuildSystemReportInput): SystemReportDocument {
  const system = assertValidSystemAnalysisDocument(input.system);
  const contexts = validateInputs(system, input.services);
  const contextsByServiceId = new Map(
    [...contexts.values()].map((context) => [context.serviceId, context]),
  );
  const endpoints = new Map(system.interactionEndpoints.map((endpoint) => [endpoint.id, endpoint]));
  const realms = new Map(system.brokerRealms.map((realm) => [realm.id, realm]));
  const nodes = new Map<string, SystemReportNode>();
  const edges = new Map<string, SystemReportEdge>();
  const diagnostics = new Map<string, SystemReportDiagnostic>();
  const paths: SystemConditionalPath[] = [];

  const addNode = (node: SystemReportNode): void => {
    const prior = nodes.get(node.id);
    nodes.set(
      node.id,
      prior === undefined
        ? node
        : {
            ...prior,
            certainty: lessCertain(prior.certainty, node.certainty),
            analysisRecords: [...prior.analysisRecords, ...node.analysisRecords].filter(
              (record, index, values) =>
                values.findIndex(({ namespacedId }) => namespacedId === record.namespacedId) ===
                index,
            ),
            correlationIds: sortedUnique([...prior.correlationIds, ...node.correlationIds]),
            diagnosticIds: sortedUnique([...prior.diagnosticIds, ...node.diagnosticIds]),
          },
    );
  };
  const addEdge = (edge: SystemReportEdge): void => {
    if (!edges.has(edge.id)) edges.set(edge.id, edge);
  };

  for (const service of system.services) {
    addNode({
      id: service.id,
      label: service.displayName,
      kind: 'service',
      parentId: null,
      serviceId: service.id,
      certainty: service.analysisResultState === 'completed' ? 'resolved' : 'unknown',
      analysisRecords: [],
      correlationIds: [],
      diagnosticIds: [],
    });
  }
  for (const realm of system.brokerRealms) {
    addNode({
      id: realm.id,
      label: `${realm.environmentAlias} / ${realm.brokerAlias}`,
      kind: 'broker_realm',
      parentId: null,
      serviceId: null,
      certainty: 'resolved',
      analysisRecords: [],
      correlationIds: [],
      diagnosticIds: [],
    });
    addNode({
      id: destinationNodeId(realm),
      label: `${realm.transport} ${realm.destination.kind}: ${realm.destination.value}`,
      kind: 'broker_destination',
      parentId: realm.id,
      serviceId: null,
      certainty: 'resolved',
      analysisRecords: [],
      correlationIds: [],
      diagnosticIds: [],
    });
  }

  for (const endpoint of system.interactionEndpoints) {
    addNode({
      id: endpoint.id,
      label: `${endpoint.role}: ${contractLabel(endpoint.contract)}`,
      kind: endpoint.role,
      parentId: endpoint.serviceId,
      serviceId: endpoint.serviceId,
      certainty: endpoint.brokerRealmId === null ? 'unknown' : 'conditional_candidate',
      analysisRecords: [endpoint.analysisRecord],
      correlationIds: [],
      diagnosticIds: [],
    });
  }

  const reportDiagnosticIdBySystemId = new Map<string, string>();
  for (const diagnostic of system.diagnostics) {
    const reportDiagnostic: SystemReportDiagnostic = {
      id: makeSystemReportDiagnosticId(['system_analysis', diagnostic.id]),
      origin: 'system_analysis',
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      subjectId: diagnostic.subjectId,
      serviceId: null,
      sourceDiagnosticId: null,
    };
    diagnostics.set(reportDiagnostic.id, reportDiagnostic);
    reportDiagnosticIdBySystemId.set(diagnostic.id, reportDiagnostic.id);
    const node = nodes.get(diagnostic.subjectId);
    if (node !== undefined)
      addNode({ ...node, diagnosticIds: [...node.diagnosticIds, reportDiagnostic.id] });
  }

  const correlationViews: SystemReportCorrelation[] = system.correlations.map((correlation) => {
    const producer =
      correlation.producerEndpointId === null
        ? undefined
        : endpoints.get(correlation.producerEndpointId);
    const contract =
      producer?.contract ?? endpoints.get(correlation.consumerEndpointIds[0] ?? '')?.contract;
    return {
      id: correlation.id,
      state: correlation.state,
      kind: correlation.kind,
      contractLabel: contract === undefined ? correlation.contractKey : contractLabel(contract),
      producerEndpointId: correlation.producerEndpointId,
      consumerEndpointIds: [...correlation.consumerEndpointIds].sort((left, right) =>
        left.localeCompare(right),
      ),
      brokerRealmId: correlation.brokerRealmId,
      reason: correlation.unmatchedReason ?? correlation.ambiguityReason,
      diagnosticIds: correlation.diagnosticIds.flatMap((id) => {
        const mapped = reportDiagnosticIdBySystemId.get(id);
        return mapped === undefined ? [] : [mapped];
      }),
    };
  });

  const rootsCache = new Map<string, Map<string, HttpRoot[]>>();
  const handlerCache = new Map<
    string,
    { trace: InteractionHandlerTraceView; diagnostics: readonly DiagnosticRecord[] } | null
  >();
  for (const correlation of system.correlations) {
    if (!systemCorrelationHasDeclaredRealmCandidate(correlation)) continue;
    const producer = endpoints.get(correlation.producerEndpointId)!;
    const producerContext = contextsByServiceId.get(producer.serviceId)!;
    let roots = rootsCache.get(producer.serviceId);
    if (roots === undefined) {
      roots = rootsByInteraction(producerContext);
      rootsCache.set(producer.serviceId, roots);
    }
    const producerRoots = roots.get(producer.analysisRecord.analysisRecordId) ?? [];
    const realm = realms.get(correlation.brokerRealmId)!;
    const brokerDestinationId = destinationNodeId(realm);

    addNode({
      ...nodes.get(producer.id)!,
      certainty: 'conditional_candidate',
      correlationIds: [correlation.id],
    });
    addEdge({
      id: makeSystemReportEdgeId(['route', correlation.id, producer.id, brokerDestinationId]),
      source: producer.id,
      target: brokerDestinationId,
      label: 'conditional route candidate',
      kind: 'conditional_route',
      certainty: 'conditional_candidate',
      correlationId: correlation.id,
      diagnosticIds: [],
    });

    for (const root of producerRoots) {
      const rootDiagnosticIds = root.diagnostics.map((diagnostic) => {
        const projected = sourceDiagnostic(producerContext, diagnostic, root.nodeId);
        diagnostics.set(projected.id, projected);
        return projected.id;
      });
      addNode({
        id: root.nodeId,
        label: root.label,
        kind: 'http_endpoint',
        parentId: producer.serviceId,
        serviceId: producer.serviceId,
        certainty: root.initiationCertainty,
        analysisRecords: [root.endpointRecord],
        correlationIds: [correlation.id],
        diagnosticIds: rootDiagnosticIds,
      });
      addEdge({
        id: makeSystemReportEdgeId(['initiates', correlation.id, root.nodeId, producer.id]),
        source: root.nodeId,
        target: producer.id,
        label: 'initiates in source artifact',
        kind: 'initiates',
        certainty: root.initiationCertainty,
        correlationId: correlation.id,
        diagnosticIds: rootDiagnosticIds,
      });
    }

    for (const consumerId of correlation.consumerEndpointIds) {
      const consumer = endpoints.get(consumerId)!;
      const consumerContext = contextsByServiceId.get(consumer.serviceId)!;
      addNode({
        ...nodes.get(consumer.id)!,
        certainty: 'conditional_candidate',
        correlationIds: [correlation.id],
      });
      addEdge({
        id: makeSystemReportEdgeId(['candidate', correlation.id, brokerDestinationId, consumer.id]),
        source: brokerDestinationId,
        target: consumer.id,
        label: 'candidate handler; delivery not proven',
        kind: 'conditional_candidate',
        certainty: 'conditional_candidate',
        correlationId: correlation.id,
        diagnosticIds: [],
      });

      let built = handlerCache.get(consumer.analysisRecord.namespacedId);
      if (built === undefined) {
        const result = buildInteractionHandlerTrace(
          consumerContext.analysis,
          consumer.analysisRecord.analysisRecordId,
        );
        built =
          result.status === 'resolved'
            ? { trace: result.trace, diagnostics: result.diagnostics }
            : null;
        handlerCache.set(consumer.analysisRecord.namespacedId, built);
      }
      const effectNodeIds: string[] = [];
      const handlerDiagnosticIds = (built?.diagnostics ?? []).map((diagnostic) => {
        const projected = sourceDiagnostic(consumerContext, diagnostic, consumer.id);
        diagnostics.set(projected.id, projected);
        return projected.id;
      });
      if (handlerDiagnosticIds.length > 0) {
        addNode({ ...nodes.get(consumer.id)!, diagnosticIds: handlerDiagnosticIds });
      }
      const traceAmbiguous =
        built?.trace.steps.some(({ status }) => status === 'ambiguous') ?? true;
      for (const terminal of built?.trace.terminals ?? []) {
        const effectId = makeSystemReportNodeId([
          'table_effect',
          consumer.analysisRecord.namespacedId,
          terminal.methodId,
          terminal.direction,
          terminal.tableId,
          terminal.causalClass ?? null,
        ]);
        effectNodeIds.push(effectId);
        addNode({
          id: effectId,
          label: `${terminal.direction} table ${terminal.tableName}`,
          kind: 'table_effect',
          parentId: consumer.serviceId,
          serviceId: consumer.serviceId,
          certainty: traceAmbiguous ? 'ambiguous' : 'conditional_candidate',
          analysisRecords: [reference(consumerContext, terminal.tableId)],
          correlationIds: [correlation.id],
          diagnosticIds: handlerDiagnosticIds,
        });
      }
      for (const terminal of built?.trace.resourceTerminals ?? []) {
        const effectId = makeSystemReportNodeId([
          'resource_effect',
          consumer.analysisRecord.namespacedId,
          terminal.methodId,
          terminal.resourceAccessId,
          terminal.causalClass,
        ]);
        effectNodeIds.push(effectId);
        addNode({
          id: effectId,
          label: `${terminal.technology} ${terminal.operation} ${terminal.resourceKind}`,
          kind: 'resource_effect',
          parentId: consumer.serviceId,
          serviceId: consumer.serviceId,
          certainty: traceAmbiguous ? 'ambiguous' : 'conditional_candidate',
          analysisRecords: [reference(consumerContext, terminal.resourceAccessId)],
          correlationIds: [correlation.id],
          diagnosticIds: handlerDiagnosticIds,
        });
      }
      for (const effectId of sortedUnique(effectNodeIds)) {
        addEdge({
          id: makeSystemReportEdgeId(['effect', correlation.id, consumer.id, effectId]),
          source: consumer.id,
          target: effectId,
          label: 'conditional worker-side effect',
          kind: 'conditional_effect',
          certainty: 'conditional_candidate',
          correlationId: correlation.id,
          diagnosticIds: handlerDiagnosticIds,
        });
      }
      const rootVariants = producerRoots.length === 0 ? [null] : producerRoots;
      for (const root of rootVariants) {
        const rootDiagnosticIds =
          root === null
            ? []
            : root.diagnostics.map(
                (diagnostic) => sourceDiagnostic(producerContext, diagnostic, root.nodeId).id,
              );
        const diagnosticIds = sortedUnique([...rootDiagnosticIds, ...handlerDiagnosticIds]);
        const seed = [
          correlation.id,
          root?.nodeId ?? null,
          producer.id,
          brokerDestinationId,
          consumer.id,
          ...sortedUnique(effectNodeIds),
        ];
        paths.push({
          id: makeSystemConditionalPathId(seed),
          correlationId: correlation.id,
          httpRootNodeId: root?.nodeId ?? null,
          producerNodeId: producer.id,
          brokerDestinationNodeId: brokerDestinationId,
          consumerNodeId: consumer.id,
          effectNodeIds: sortedUnique(effectNodeIds),
          boundary: 'conditional_candidate',
          completeness:
            built === null ||
            root?.initiationCertainty === 'ambiguous' ||
            traceAmbiguous ||
            diagnosticIds.length > 0
              ? 'incomplete'
              : 'complete',
          diagnosticIds,
        });
      }
    }
  }

  const policies = evaluateSystemPolicies(system);
  const orderedPaths = paths.sort((left, right) => left.id.localeCompare(right.id));
  const pathNodeIds = new Set(
    orderedPaths.flatMap((path) => [
      ...(path.httpRootNodeId === null ? [] : [path.httpRootNodeId]),
      path.producerNodeId,
      path.brokerDestinationNodeId,
      path.consumerNodeId,
      ...path.effectNodeIds,
      ...(nodes.get(path.producerNodeId)?.parentId === null
        ? []
        : [nodes.get(path.producerNodeId)!.parentId!]),
      ...(nodes.get(path.consumerNodeId)?.parentId === null
        ? []
        : [nodes.get(path.consumerNodeId)!.parentId!]),
      ...(nodes.get(path.brokerDestinationNodeId)?.parentId === null
        ? []
        : [nodes.get(path.brokerDestinationNodeId)!.parentId!]),
    ]),
  );
  const allNodes = [...nodes.values()].sort(
    (left, right) =>
      nodePriority(left, pathNodeIds) - nodePriority(right, pathNodeIds) ||
      left.id.localeCompare(right.id),
  );
  const maxNodes = input.maxNodes ?? DEFAULT_SYSTEM_REPORT_NODE_LIMIT;
  const maxEdges = input.maxEdges ?? DEFAULT_SYSTEM_REPORT_EDGE_LIMIT;
  const initiallySelected = allNodes.slice(0, maxNodes);
  const selectedIds = new Set(initiallySelected.map(({ id }) => id));
  const displayedNodes = initiallySelected.filter(
    ({ parentId }) => parentId === null || selectedIds.has(parentId),
  );
  const displayedNodeIds = new Set(displayedNodes.map(({ id }) => id));
  const allEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  const eligibleEdges = allEdges.filter(
    ({ source, target }) => displayedNodeIds.has(source) && displayedNodeIds.has(target),
  );
  const displayedEdges = eligibleEdges.slice(0, maxEdges);
  const orderedDiagnostics = [...diagnostics.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const orderedCorrelations = correlationViews.sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const workerEffects = allNodes.filter(
    ({ kind }) => kind === 'table_effect' || kind === 'resource_effect',
  ).length;
  const reportId = makeSystemReportId([
    system.systemId,
    maxNodes,
    maxEdges,
    ...displayedNodes.map(({ id }) => id).sort(),
    ...displayedEdges.map(({ id }) => id).sort(),
    ...orderedCorrelations.map(({ id }) => id),
    ...orderedPaths.map(({ id }) => id),
    ...policies.results.map(({ id }) => id),
    ...orderedDiagnostics.map(({ id }) => id),
  ]);
  return assertValidSystemReportDocument({
    schemaVersion: SYSTEM_REPORT_SCHEMA_VERSION,
    reportId,
    system: { id: system.systemId, name: system.systemName, schemaVersion: system.schemaVersion },
    sourceDocumentsEmbedded: false,
    limits: { maxNodes, maxEdges },
    summary: {
      services: system.services.length,
      brokerRealms: system.brokerRealms.length,
      correlations: system.correlations.length,
      declaredRealmCandidates: system.correlations.filter(
        ({ state }) => state === 'declared_realm_candidate',
      ).length,
      conditionalPaths: orderedPaths.length,
      workerEffects,
      policyFailures: policies.summary.failed,
      diagnostics: orderedDiagnostics.length,
      totalNodes: allNodes.length,
      displayedNodes: displayedNodes.length,
      omittedNodes: allNodes.length - displayedNodes.length,
      totalEdges: allEdges.length,
      displayedEdges: displayedEdges.length,
      omittedEdges: allEdges.length - displayedEdges.length,
    },
    correlations: orderedCorrelations,
    conditionalPaths: orderedPaths,
    policies,
    diagnostics: orderedDiagnostics,
    graph: {
      nodes: displayedNodes.sort((left, right) => left.id.localeCompare(right.id)),
      edges: displayedEdges.sort((left, right) => left.id.localeCompare(right.id)),
    },
  });
}
