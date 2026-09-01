import { makeSystemReportId } from '../system-analysis/ids.js';
import type { SystemReportDocument } from './model.js';
import { systemReportDocumentSchema } from './schemas.js';

export type SystemReportValidationResult =
  | { readonly success: true; readonly data: SystemReportDocument }
  | { readonly success: false; readonly issues: readonly string[] };

function expectedReportId(document: SystemReportDocument): string {
  return makeSystemReportId([
    document.system.id,
    document.limits.maxNodes,
    document.limits.maxEdges,
    ...document.graph.nodes.map(({ id }) => id).sort(),
    ...document.graph.edges.map(({ id }) => id).sort(),
    ...document.correlations.map(({ id }) => id).sort(),
    ...document.conditionalPaths.map(({ id }) => id).sort(),
    ...document.policies.results.map(({ id }) => id).sort(),
    ...document.diagnostics.map(({ id }) => id).sort(),
  ]);
}

export function validateSystemReportDocument(input: unknown): SystemReportValidationResult {
  const parsed = systemReportDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
      ),
    };
  }
  const document = parsed.data;
  const issues: string[] = [];
  const collections: readonly [string, readonly { readonly id: string }[]][] = [
    ['correlations', document.correlations],
    ['conditionalPaths', document.conditionalPaths],
    ['policies.results', document.policies.results],
    ['diagnostics', document.diagnostics],
    ['graph.nodes', document.graph.nodes],
    ['graph.edges', document.graph.edges],
  ];
  for (const [name, records] of collections) {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) issues.push(`${name}: duplicate ID ${record.id}.`);
      seen.add(record.id);
    }
  }
  const nodes = new Map(document.graph.nodes.map((node) => [node.id, node]));
  const correlations = new Map(document.correlations.map((record) => [record.id, record]));
  const diagnostics = new Set(document.diagnostics.map(({ id }) => id));
  for (const node of document.graph.nodes) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      issues.push(`graph.nodes: ${node.id} has missing displayed parent ${node.parentId}.`);
    }
    for (const correlationId of node.correlationIds) {
      if (!correlations.has(correlationId))
        issues.push(`graph.nodes: ${node.id} references unknown correlation ${correlationId}.`);
    }
    for (const diagnosticId of node.diagnosticIds) {
      if (!diagnostics.has(diagnosticId))
        issues.push(`graph.nodes: ${node.id} references unknown diagnostic ${diagnosticId}.`);
    }
  }
  for (const edge of document.graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      issues.push(`graph.edges: ${edge.id} has a missing displayed endpoint.`);
    }
    if (edge.correlationId !== null) {
      const correlation = correlations.get(edge.correlationId);
      if (correlation === undefined) {
        issues.push(
          `graph.edges: ${edge.id} references unknown correlation ${edge.correlationId}.`,
        );
      } else if (edge.kind !== 'initiates' && correlation.state !== 'declared_realm_candidate') {
        issues.push(`graph.edges: ${edge.id} turns a non-declared correlation into a graph edge.`);
      }
    }
  }
  for (const path of document.conditionalPaths) {
    if (correlations.get(path.correlationId)?.state !== 'declared_realm_candidate') {
      issues.push(`conditionalPaths: ${path.id} does not reference a declared-realm candidate.`);
    }
    for (const diagnosticId of path.diagnosticIds) {
      if (!diagnostics.has(diagnosticId))
        issues.push(`conditionalPaths: ${path.id} references unknown diagnostic ${diagnosticId}.`);
    }
  }
  for (const policy of document.policies.results) {
    if (!correlations.has(policy.subjectCorrelationId)) {
      issues.push(
        `policies.results: ${policy.id} references unknown correlation ${policy.subjectCorrelationId}.`,
      );
    }
  }
  const summaryChecks: readonly [string, number, number][] = [
    ['correlations', document.summary.correlations, document.correlations.length],
    ['conditionalPaths', document.summary.conditionalPaths, document.conditionalPaths.length],
    ['diagnostics', document.summary.diagnostics, document.diagnostics.length],
    ['displayedNodes', document.summary.displayedNodes, document.graph.nodes.length],
    ['displayedEdges', document.summary.displayedEdges, document.graph.edges.length],
    [
      'omittedNodes',
      document.summary.omittedNodes,
      document.summary.totalNodes - document.summary.displayedNodes,
    ],
    [
      'omittedEdges',
      document.summary.omittedEdges,
      document.summary.totalEdges - document.summary.displayedEdges,
    ],
    ['policyFailures', document.summary.policyFailures, document.policies.summary.failed],
  ];
  for (const [name, actual, expected] of summaryChecks) {
    if (actual !== expected)
      issues.push(`summary.${name}: expected ${expected}, received ${actual}.`);
  }
  const outcomeCount = (outcome: string): number =>
    document.policies.results.filter((result) => result.outcome === outcome).length;
  if (
    document.policies.summary.passed !== outcomeCount('pass') ||
    document.policies.summary.failed !== outcomeCount('fail') ||
    document.policies.summary.unknown !== outcomeCount('unknown') ||
    document.policies.summary.notApplicable !== outcomeCount('not_applicable')
  ) {
    issues.push('policies.summary does not match the typed policy results.');
  }
  const expected = expectedReportId(document);
  if (document.reportId !== expected)
    issues.push(`reportId: expected ${expected}, received ${document.reportId}.`);
  return issues.length === 0
    ? { success: true, data: document }
    : { success: false, issues: issues.sort() };
}

export class SystemReportIntegrityError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`System report integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'SystemReportIntegrityError';
  }
}

export function assertValidSystemReportDocument(input: unknown): SystemReportDocument {
  const result = validateSystemReportDocument(input);
  if (!result.success) throw new SystemReportIntegrityError(result.issues);
  return result.data;
}
