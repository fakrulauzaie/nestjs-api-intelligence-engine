import {
  analysisHasAuthorizationFacts,
  analysisHasCriticalSectionFacts,
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  analysisHasResourceAccessFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import type { ImpactDocument, ImpactGraphSide } from '../impact/model.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import type { GraphReportDocument } from './model.js';
import { buildArchitectureOverview } from '../architecture/overview.js';
import {
  GRAPH_REPORT_SCHEMA_VERSION,
  GRAPH_REPORT_SCHEMA_V4_VERSION,
  GRAPH_REPORT_SCHEMA_V5_VERSION,
  GRAPH_REPORT_SCHEMA_V6_VERSION,
  GRAPH_REPORT_SCHEMA_V7_VERSION,
  GRAPH_REPORT_SCHEMA_V8_VERSION,
  GRAPH_REPORT_SCHEMA_V9_VERSION,
} from './model.js';
import { graphReportDocumentSchema } from './schemas.js';

export class GraphReportIntegrityError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Graph report integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'GraphReportIntegrityError';
    this.issues = issues;
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function graphImpactSide(
  analysis: AnalysisDocument,
  impact: ImpactDocument | undefined,
): ImpactGraphSide | null {
  if (impact === undefined) return null;
  if (impact.after.analysisId === analysis.analysisRun.id) return 'after';
  if (impact.before.analysisId === analysis.analysisRun.id) return 'before';
  return null;
}

function expectedSummary(document: GraphReportDocument): GraphReportDocument['summary'] {
  const handlers = document.interactionHandlers ?? [];
  const scenes = [
    ...document.endpoints.map(({ scene }) => scene),
    ...handlers.map(({ scene }) => scene),
    ...(document.architecture === undefined ? [] : [document.architecture.scene]),
  ];
  return {
    endpoints: document.endpoints.length,
    endpointsWithGuards: document.endpoints.filter(({ guards }) => guards.length > 0).length,
    endpointsWithDiagnostics: document.endpoints.filter(({ diagnostics }) => diagnostics.length > 0)
      .length,
    endpointsWithWrites: document.endpoints.filter(({ dbWrites }) => dbWrites.length > 0).length,
    impactedEndpoints: document.endpoints.filter(({ impact }) => impact !== 'none').length,
    omittedNodes: scenes.reduce((total, scene) => total + scene.omitted.nodes, 0),
    omittedEdges: scenes.reduce((total, scene) => total + scene.omitted.edges, 0),
    omittedEvidence: scenes.reduce((total, scene) => total + scene.omitted.evidence, 0),
    ...(document.schemaVersion === GRAPH_REPORT_SCHEMA_V4_VERSION ||
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V5_VERSION ||
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V6_VERSION ||
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION
      ? {
          interactionHandlers: handlers.length,
          handlersWithDiagnostics: handlers.filter(({ diagnostics }) => diagnostics.length > 0)
            .length,
          handlersWithWrites: handlers.filter(({ dbWrites }) => dbWrites.length > 0).length,
        }
      : {}),
    ...((document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION) &&
    document.architecture !== undefined
      ? {
          architectureRecords: document.architecture.summary.metricRecords,
          notReachedFromSupportedRoots: document.architecture.summary.notReachedFromSupportedRoots,
          uniquelyOwnedClasses: document.architecture.summary.uniquelyOwnedClasses,
          multipleOwnerClasses: document.architecture.summary.multipleOwnerClasses,
        }
      : {}),
  };
}

export function assertValidGraphReportDocument(input: {
  readonly document: unknown;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
  readonly impact?: ImpactDocument | undefined;
}): GraphReportDocument {
  const document = graphReportDocumentSchema.parse(input.document);
  const issues: string[] = [];
  const expectedSchemaVersion = analysisHasCriticalSectionFacts(input.analysis)
    ? GRAPH_REPORT_SCHEMA_V9_VERSION
    : analysisHasResourceAccessFacts(input.analysis)
      ? GRAPH_REPORT_SCHEMA_V8_VERSION
      : analysisHasAuthorizationFacts(input.analysis)
        ? GRAPH_REPORT_SCHEMA_V7_VERSION
        : analysisHasJobQueueBranchFacts(input.analysis)
          ? GRAPH_REPORT_SCHEMA_V5_VERSION
          : analysisHasInteractionFacts(input.analysis)
            ? GRAPH_REPORT_SCHEMA_V4_VERSION
            : GRAPH_REPORT_SCHEMA_VERSION;
  if (document.schemaVersion !== expectedSchemaVersion) {
    issues.push('The graph report schema version does not match its interaction content.');
  }
  if (
    document.analysis.id !== input.analysis.analysisRun.id ||
    document.analysis.schemaVersion !== input.analysis.schemaVersion ||
    document.analysis.resultState !== input.analysis.resultState
  ) {
    issues.push('The graph report snapshot does not match the canonical analysis.');
  }

  const expectedPolicyState = input.policyResults === undefined ? 'not_supplied' : 'supplied';
  if (
    document.policy.state !== expectedPolicyState ||
    document.policy.schemaVersion !== (input.policyResults?.schemaVersion ?? null) ||
    (input.policyResults !== undefined &&
      input.policyResults.analysis.analysisId !== input.analysis.analysisRun.id)
  ) {
    issues.push('The graph report policy input does not match the canonical snapshot.');
  }

  const impactSide = graphImpactSide(input.analysis, input.impact);
  const expectedImpactState = input.impact === undefined ? 'not_supplied' : 'supplied';
  if (
    document.impact.state !== expectedImpactState ||
    document.impact.schemaVersion !== (input.impact?.schemaVersion ?? null) ||
    document.impact.side !== impactSide ||
    (input.impact !== undefined && impactSide === null)
  ) {
    issues.push('The graph report impact input does not contain the canonical snapshot.');
  }

  const endpointIds = input.analysis.endpoints.map(({ id }) => id).sort();
  const reportEndpointIds = document.endpoints.map(({ endpointId }) => endpointId).sort();
  if (
    new Set(reportEndpointIds).size !== reportEndpointIds.length ||
    endpointIds.join('|') !== reportEndpointIds.join('|')
  ) {
    issues.push('The graph report must contain exactly one view for every canonical endpoint.');
  }

  const canonicalEvidence = new Set(input.analysis.evidence.map(({ id }) => id));
  const canonicalTables = new Set(input.analysis.tables.map(({ name }) => name));
  const canonicalInteractions = new Set(
    analysisHasInteractionFacts(input.analysis)
      ? [
          ...input.analysis.interactions.map(({ id }) => id),
          ...input.analysis.interactionHandlers.map(({ id }) => id),
        ]
      : [],
  );
  const canonicalBranchIds = new Set(
    analysisHasJobQueueBranchFacts(input.analysis)
      ? input.analysis.interactionHandlerBranches.map(({ id }) => id)
      : [],
  );
  for (const endpoint of document.endpoints) {
    const nodeIds = endpoint.scene.nodes.map(({ id }) => id);
    const edgeIds = endpoint.scene.edges.map(({ id }) => id);
    const evidenceIds = endpoint.scene.evidence.map(({ id }) => id);
    if (new Set(nodeIds).size !== nodeIds.length) {
      issues.push(`Endpoint ${endpoint.endpointId} repeats a graph node ID.`);
    }
    if (new Set(edgeIds).size !== edgeIds.length) {
      issues.push(`Endpoint ${endpoint.endpointId} repeats a graph edge ID.`);
    }
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      issues.push(`Endpoint ${endpoint.endpointId} repeats graph evidence.`);
    }
    const nodes = new Set(nodeIds);
    if (!nodes.has(endpoint.endpointId)) {
      issues.push(`Endpoint ${endpoint.endpointId} is missing its root graph node.`);
    }
    for (const edge of endpoint.scene.edges) {
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
        issues.push(`Endpoint ${endpoint.endpointId} has an edge with a missing node.`);
      }
    }
    if (
      endpoint.scene.nodes.some(
        (node) =>
          (node.kind === 'interaction' || node.kind === 'interaction_handler') &&
          !canonicalInteractions.has(node.id),
      )
    ) {
      issues.push(`Endpoint ${endpoint.endpointId} contains a non-canonical interaction node.`);
    }
    if ((endpoint.jobQueueBranchIds ?? []).some((id) => !canonicalBranchIds.has(id))) {
      issues.push(`Endpoint ${endpoint.endpointId} references a non-canonical job-queue branch.`);
    }
    const sceneEvidence = new Set(evidenceIds);
    const referencedEvidence = [
      ...endpoint.scene.nodes.flatMap(({ evidenceIds: ids }) => ids),
      ...endpoint.scene.edges.flatMap(({ evidenceIds: ids }) => ids),
      ...endpoint.diagnostics.flatMap(({ evidenceIds: ids }) => ids),
      ...endpoint.policyOutcomes.flatMap(({ evidenceIds: ids }) => ids),
      ...(endpoint.localCausalEffects ?? []).flatMap(({ evidenceIds: ids }) => ids),
      ...(endpoint.distributedConditionalEffects ?? []).flatMap(({ evidenceIds: ids }) => ids),
      ...(endpoint.authorizationRequirements ?? []).flatMap(({ evidenceIds: ids }) => ids),
    ];
    if (referencedEvidence.some((id) => !canonicalEvidence.has(id) || !sceneEvidence.has(id))) {
      issues.push(`Endpoint ${endpoint.endpointId} has incomplete canonical evidence closure.`);
    }
    if ((endpoint.localCausalEffects ?? []).some(({ table }) => !canonicalTables.has(table))) {
      issues.push(`Endpoint ${endpoint.endpointId} has a non-canonical local causal table.`);
    }
    if (
      (endpoint.distributedConditionalEffects ?? []).some(
        ({ table }) => !canonicalTables.has(table),
      )
    ) {
      issues.push(`Endpoint ${endpoint.endpointId} has a non-canonical distributed table.`);
    }
    if (
      endpoint.scene.nodes.length > document.limits.maxNodesPerEndpoint ||
      endpoint.scene.edges.length > document.limits.maxEdgesPerEndpoint ||
      endpoint.scene.evidence.length > document.limits.maxEvidencePerEndpoint
    ) {
      issues.push(`Endpoint ${endpoint.endpointId} exceeds the declared display limits.`);
    }
    for (const values of [
      endpoint.guards,
      endpoint.dbReads,
      endpoint.dbWrites,
      endpoint.jobQueueBranchIds ?? [],
      ...endpoint.scene.nodes.map(({ evidenceIds: ids }) => ids),
      ...endpoint.scene.edges.map(({ evidenceIds: ids }) => ids),
      ...(endpoint.localCausalEffects ?? []).map(({ evidenceIds: ids }) => ids),
      ...(endpoint.distributedConditionalEffects ?? []).map(({ evidenceIds: ids }) => ids),
      ...(endpoint.authorizationRequirements ?? []).map(({ evidenceIds: ids }) => ids),
    ]) {
      if (values.join('|') !== sortedUnique(values).join('|')) {
        issues.push(`Endpoint ${endpoint.endpointId} contains a non-canonical string set.`);
        break;
      }
    }
  }

  const canonicalHandlerIds = new Set(
    analysisHasInteractionFacts(input.analysis)
      ? input.analysis.interactionHandlers.map(({ id }) => id)
      : [],
  );
  const canonicalInteractionIds = new Set(
    analysisHasInteractionFacts(input.analysis)
      ? input.analysis.interactions.map(({ id }) => id)
      : [],
  );
  const handlerViews = document.interactionHandlers ?? [];
  const reportHandlerIds = handlerViews.map(({ handlerId }) => handlerId);
  if (
    new Set(reportHandlerIds).size !== reportHandlerIds.length ||
    reportHandlerIds.toSorted().join('|') !== [...canonicalHandlerIds].sort().join('|')
  ) {
    issues.push('The graph report must contain exactly one view for every canonical handler.');
  }
  for (const handler of handlerViews) {
    const nodeIds = handler.scene.nodes.map(({ id }) => id);
    const edgeIds = handler.scene.edges.map(({ id }) => id);
    const evidenceIds = handler.scene.evidence.map(({ id }) => id);
    const nodes = new Set(nodeIds);
    if (!nodes.has(handler.handlerId)) {
      issues.push(`Handler ${handler.handlerId} is missing its root graph node.`);
    }
    if (new Set(nodeIds).size !== nodeIds.length || new Set(edgeIds).size !== edgeIds.length) {
      issues.push(`Handler ${handler.handlerId} repeats a graph node or edge ID.`);
    }
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      issues.push(`Handler ${handler.handlerId} repeats graph evidence.`);
    }
    if (handler.scene.edges.some((edge) => !nodes.has(edge.source) || !nodes.has(edge.target))) {
      issues.push(`Handler ${handler.handlerId} has an edge with a missing node.`);
    }
    if (
      handler.producerInteractionIds.some((id) => !canonicalInteractionIds.has(id)) ||
      handler.scene.nodes.some(
        (node) =>
          (node.kind === 'interaction' || node.kind === 'interaction_handler') &&
          !canonicalInteractions.has(node.id),
      )
    ) {
      issues.push(`Handler ${handler.handlerId} contains a non-canonical interaction reference.`);
    }
    if (analysisHasJobQueueBranchFacts(input.analysis)) {
      const canonicalDispatch = input.analysis.interactionHandlerDispatches.find(
        ({ handlerId }) => handlerId === handler.handlerId,
      );
      if ((canonicalDispatch === undefined) !== (handler.jobQueueDispatch === null)) {
        issues.push(`Handler ${handler.handlerId} has inconsistent branch capability.`);
      }
      if (canonicalDispatch !== undefined && handler.jobQueueDispatch !== null) {
        const branchIds = handler.jobQueueDispatch?.branches.map(({ branchId }) => branchId) ?? [];
        if (
          handler.jobQueueDispatch?.state !== canonicalDispatch.state ||
          branchIds.toSorted().join('|') !== canonicalDispatch.branchIds.toSorted().join('|')
        ) {
          issues.push(`Handler ${handler.handlerId} has an inconsistent dispatch projection.`);
        }
        for (const branch of handler.jobQueueDispatch?.branches ?? []) {
          const canonicalBranch = input.analysis.interactionHandlerBranches.find(
            ({ id }) => id === branch.branchId,
          );
          const canonicalEffectIds = input.analysis.interactionHandlerBranchEffects
            .filter(({ branchId }) => branchId === branch.branchId)
            .map(({ id }) => id)
            .sort();
          if (
            canonicalBranch === undefined ||
            branch.effects
              .map(({ effectId }) => effectId)
              .sort()
              .join('|') !== canonicalEffectIds.join('|')
          ) {
            issues.push(`Handler ${handler.handlerId} has a non-canonical branch projection.`);
          }
        }
      }
    }
    if (
      handler.scene.nodes.some(
        (node) => node.kind === 'interaction_branch' && !canonicalBranchIds.has(node.id),
      )
    ) {
      issues.push(`Handler ${handler.handlerId} contains a non-canonical branch node.`);
    }
    const sceneEvidence = new Set(evidenceIds);
    const referencedEvidence = [
      ...handler.scene.nodes.flatMap(({ evidenceIds: ids }) => ids),
      ...handler.scene.edges.flatMap(({ evidenceIds: ids }) => ids),
      ...handler.diagnostics.flatMap(({ evidenceIds: ids }) => ids),
    ];
    if (referencedEvidence.some((id) => !canonicalEvidence.has(id) || !sceneEvidence.has(id))) {
      issues.push(`Handler ${handler.handlerId} has incomplete canonical evidence closure.`);
    }
    if (
      handler.scene.nodes.length > document.limits.maxNodesPerEndpoint ||
      handler.scene.edges.length > document.limits.maxEdgesPerEndpoint ||
      handler.scene.evidence.length > document.limits.maxEvidencePerEndpoint
    ) {
      issues.push(`Handler ${handler.handlerId} exceeds the declared display limits.`);
    }
    for (const values of [
      handler.dbReads,
      handler.dbWrites,
      handler.producerInteractionIds,
      ...handler.scene.nodes.map(({ evidenceIds: ids }) => ids),
      ...handler.scene.edges.map(({ evidenceIds: ids }) => ids),
    ]) {
      if (values.join('|') !== sortedUnique(values).join('|')) {
        issues.push(`Handler ${handler.handlerId} contains a non-canonical string set.`);
        break;
      }
    }
  }

  if (
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
    document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION
  ) {
    const architecture = document.architecture;
    if (architecture === undefined) {
      issues.push('Graph v7 is missing its architecture overview.');
    } else {
      const expected = buildArchitectureOverview(input.analysis);
      const expectedRecordById = new Map(
        expected.records.map((record) => [record.recordId, record]),
      );
      const reportRecordById = new Map(
        architecture.records.map((record) => [record.recordId, record]),
      );
      const expectedOwnershipById = new Map(
        expected.moduleOwnership.map((record) => [
          `${record.recordKind}:${record.recordId}`,
          record,
        ]),
      );
      const reportOwnershipById = new Map(
        architecture.moduleOwnership.map((record) => [
          `${record.recordKind}:${record.recordId}`,
          record,
        ]),
      );
      if (
        expected.records.length !== reportRecordById.size ||
        [...expectedRecordById].some(
          ([id, record]) => JSON.stringify(reportRecordById.get(id)) !== JSON.stringify(record),
        )
      ) {
        issues.push('The architecture metric projection does not match canonical trace facts.');
      }
      if (
        expected.moduleOwnership.length !== reportOwnershipById.size ||
        [...expectedOwnershipById].some(
          ([id, record]) => JSON.stringify(reportOwnershipById.get(id)) !== JSON.stringify(record),
        )
      ) {
        issues.push('The architecture ownership projection does not match module facts.');
      }
      if (
        JSON.stringify(architecture.rootCapabilities) !==
          JSON.stringify(expected.rootCapabilities) ||
        JSON.stringify(architecture.supportedRoots) !== JSON.stringify(expected.supportedRoots) ||
        JSON.stringify(architecture.summary) !== JSON.stringify(expected.summary) ||
        JSON.stringify(architecture.metricLegends) !== JSON.stringify(expected.metricLegends)
      ) {
        issues.push('The architecture overview summary or legend is inconsistent.');
      }
      const nodeIds = architecture.scene.nodes.map(({ id }) => id);
      const edgeIds = architecture.scene.edges.map(({ id }) => id);
      const evidenceIds = architecture.scene.evidence.map(({ id }) => id);
      const nodes = new Set(nodeIds);
      if (
        new Set(nodeIds).size !== nodeIds.length ||
        new Set(edgeIds).size !== edgeIds.length ||
        new Set(evidenceIds).size !== evidenceIds.length
      ) {
        issues.push('The architecture scene repeats a node, edge, or evidence ID.');
      }
      if (!nodes.has(architecture.rootId)) {
        issues.push('The architecture scene is missing its repository root node.');
      }
      const rootNode = architecture.scene.nodes.find(({ id }) => id === architecture.rootId);
      if (rootNode?.kind !== 'repository') {
        issues.push('The architecture root node must retain repository kind.');
      }
      const canonicalArchitectureIds = new Set([
        architecture.rootId,
        ...input.analysis.classes.map(({ id }) => id),
        ...input.analysis.methods.map(({ id }) => id),
        ...input.analysis.endpoints.map(({ id }) => id),
        ...input.analysis.tables.map(({ id }) => id),
        ...(input.analysis.schemaVersion === '1.0.0'
          ? []
          : input.analysis.modules.map(({ id }) => id)),
        ...(analysisHasInteractionFacts(input.analysis)
          ? [
              ...input.analysis.interactions.map(({ id }) => id),
              ...input.analysis.interactionHandlers.map(({ id }) => id),
            ]
          : []),
        ...(analysisHasResourceAccessFacts(input.analysis)
          ? input.analysis.resourceAccesses.map(({ id }) => id)
          : []),
      ]);
      if (architecture.scene.nodes.some(({ id }) => !canonicalArchitectureIds.has(id))) {
        issues.push('The architecture scene contains a non-canonical record node.');
      }
      if (
        architecture.scene.edges.some(
          ({ source, target }) => !nodes.has(source) || !nodes.has(target),
        ) ||
        architecture.scene.nodes.some(
          ({ parentId }) => parentId !== undefined && parentId !== null && !nodes.has(parentId),
        )
      ) {
        issues.push('The architecture scene has an edge or cluster parent with a missing node.');
      }
      for (const node of architecture.scene.nodes) {
        const expectedRecord = expectedRecordById.get(node.id);
        if (
          (expectedRecord !== undefined &&
            (JSON.stringify(node.architectureMetrics) !== JSON.stringify(expectedRecord.metrics) ||
              node.architectureReachability !== expectedRecord.reachability)) ||
          (expectedRecord === undefined &&
            (node.architectureMetrics !== undefined || node.architectureReachability !== undefined))
        ) {
          issues.push(`Architecture node ${node.id} has inconsistent metric facts.`);
        }
        if (node.kind === 'class' || node.kind === 'method') {
          const expectedOwnership = expectedOwnershipById.get(`${node.kind}:${node.id}`);
          if (
            expectedOwnership === undefined ||
            node.moduleOwnership === undefined ||
            JSON.stringify(node.moduleOwnership) !==
              JSON.stringify({
                state: expectedOwnership.state,
                moduleIds: expectedOwnership.moduleIds,
              })
          ) {
            issues.push(`Architecture node ${node.id} has inconsistent module ownership.`);
          }
        }
      }
      const sceneEvidence = new Set(evidenceIds);
      if (
        architecture.scene.nodes
          .flatMap(({ evidenceIds: ids }) => ids)
          .concat(architecture.scene.edges.flatMap(({ evidenceIds: ids }) => ids))
          .some((id) => !canonicalEvidence.has(id) || !sceneEvidence.has(id))
      ) {
        issues.push('The architecture scene has incomplete canonical evidence closure.');
      }
      if (
        architecture.scene.nodes.length > document.limits.maxNodesPerEndpoint ||
        architecture.scene.edges.length > document.limits.maxEdgesPerEndpoint ||
        architecture.scene.evidence.length > document.limits.maxEvidencePerEndpoint
      ) {
        issues.push('The architecture scene exceeds the declared display limits.');
      }
      const canonicalModules = new Set(
        input.analysis.schemaVersion === '1.0.0' ? [] : input.analysis.modules.map(({ id }) => id),
      );
      if (
        architecture.moduleOwnership.some(({ moduleIds }) =>
          moduleIds.some((id) => !canonicalModules.has(id)),
        )
      ) {
        issues.push('The architecture overview references a non-canonical module.');
      }
    }
  }

  const summary = expectedSummary(document);
  for (const [field, value] of Object.entries(summary)) {
    if (document.summary[field as keyof typeof summary] !== value) {
      issues.push(`Graph report summary.${field} does not match report views.`);
    }
  }
  if (issues.length > 0) throw new GraphReportIntegrityError(sortedUnique(issues));
  return document;
}
