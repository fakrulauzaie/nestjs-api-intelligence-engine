import type { AnalysisDocument } from '../model/analysis.js';
import type { ImpactDocument, ImpactGraphSide } from '../impact/model.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import type { GraphReportDocument } from './model.js';
import { GRAPH_REPORT_SCHEMA_VERSION, GRAPH_REPORT_SCHEMA_V3_VERSION } from './model.js';
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
  return {
    endpoints: document.endpoints.length,
    endpointsWithGuards: document.endpoints.filter(({ guards }) => guards.length > 0).length,
    endpointsWithDiagnostics: document.endpoints.filter(({ diagnostics }) => diagnostics.length > 0)
      .length,
    endpointsWithWrites: document.endpoints.filter(({ dbWrites }) => dbWrites.length > 0).length,
    impactedEndpoints: document.endpoints.filter(({ impact }) => impact !== 'none').length,
    omittedNodes: document.endpoints.reduce(
      (total, endpoint) => total + endpoint.scene.omitted.nodes,
      0,
    ),
    omittedEdges: document.endpoints.reduce(
      (total, endpoint) => total + endpoint.scene.omitted.edges,
      0,
    ),
    omittedEvidence: document.endpoints.reduce(
      (total, endpoint) => total + endpoint.scene.omitted.evidence,
      0,
    ),
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
  const expectedSchemaVersion =
    input.analysis.schemaVersion === '3.0.0'
      ? GRAPH_REPORT_SCHEMA_V3_VERSION
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
    input.analysis.schemaVersion === '3.0.0'
      ? [
          ...input.analysis.interactions.map(({ id }) => id),
          ...input.analysis.interactionHandlers.map(({ id }) => id),
        ]
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
    const sceneEvidence = new Set(evidenceIds);
    const referencedEvidence = [
      ...endpoint.scene.nodes.flatMap(({ evidenceIds: ids }) => ids),
      ...endpoint.scene.edges.flatMap(({ evidenceIds: ids }) => ids),
      ...endpoint.diagnostics.flatMap(({ evidenceIds: ids }) => ids),
      ...endpoint.policyOutcomes.flatMap(({ evidenceIds: ids }) => ids),
      ...(endpoint.localCausalEffects ?? []).flatMap(({ evidenceIds: ids }) => ids),
      ...(endpoint.distributedConditionalEffects ?? []).flatMap(({ evidenceIds: ids }) => ids),
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
      ...endpoint.scene.nodes.map(({ evidenceIds: ids }) => ids),
      ...endpoint.scene.edges.map(({ evidenceIds: ids }) => ids),
      ...(endpoint.localCausalEffects ?? []).map(({ evidenceIds: ids }) => ids),
      ...(endpoint.distributedConditionalEffects ?? []).map(({ evidenceIds: ids }) => ids),
    ]) {
      if (values.join('|') !== sortedUnique(values).join('|')) {
        issues.push(`Endpoint ${endpoint.endpointId} contains a non-canonical string set.`);
        break;
      }
    }
  }

  const summary = expectedSummary(document);
  for (const [field, value] of Object.entries(summary)) {
    if (document.summary[field as keyof typeof summary] !== value) {
      issues.push(`Graph report summary.${field} does not match endpoint views.`);
    }
  }
  if (issues.length > 0) throw new GraphReportIntegrityError(sortedUnique(issues));
  return document;
}
