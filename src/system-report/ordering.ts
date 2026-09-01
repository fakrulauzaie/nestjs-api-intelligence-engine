import { canonicalStringify } from '../model/ordering.js';
import type { SystemReportDocument } from './model.js';
import { assertValidSystemReportDocument } from './validate.js';

function sortIds<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

export function canonicalizeSystemReportDocument(
  input: SystemReportDocument,
): SystemReportDocument {
  const document = assertValidSystemReportDocument(input);
  return {
    ...document,
    correlations: sortIds(document.correlations).map((record) => ({
      ...record,
      consumerEndpointIds: [...record.consumerEndpointIds].sort(),
      diagnosticIds: [...record.diagnosticIds].sort(),
    })),
    conditionalPaths: sortIds(document.conditionalPaths).map((record) => ({
      ...record,
      effectNodeIds: [...record.effectNodeIds].sort(),
      diagnosticIds: [...record.diagnosticIds].sort(),
    })),
    policies: { ...document.policies, results: sortIds(document.policies.results) },
    diagnostics: sortIds(document.diagnostics),
    graph: {
      nodes: sortIds(document.graph.nodes).map((record) => ({
        ...record,
        analysisRecords: [...record.analysisRecords].sort((left, right) =>
          left.namespacedId.localeCompare(right.namespacedId),
        ),
        correlationIds: [...record.correlationIds].sort(),
        diagnosticIds: [...record.diagnosticIds].sort(),
      })),
      edges: sortIds(document.graph.edges).map((record) => ({
        ...record,
        diagnosticIds: [...record.diagnosticIds].sort(),
      })),
    },
  };
}

export function serializeCanonicalSystemReport(document: SystemReportDocument): string {
  return canonicalStringify(canonicalizeSystemReportDocument(document));
}
