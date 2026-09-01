import { canonicalStringify } from '../model/ordering.js';
import type { SystemAnalysisDocument } from './model.js';
import { assertValidSystemAnalysisDocument } from './validate.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function canonicalizeSystemAnalysisDocument(
  input: SystemAnalysisDocument,
): SystemAnalysisDocument {
  const document = assertValidSystemAnalysisDocument(input);
  return {
    ...document,
    services: [...document.services].sort((left, right) =>
      compareStrings(left.namespace, right.namespace),
    ),
    brokerRealms: [...document.brokerRealms].sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    interactionEndpoints: [...document.interactionEndpoints].sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    correlations: [...document.correlations]
      .map((correlation) => ({
        ...correlation,
        consumerEndpointIds: [...correlation.consumerEndpointIds].sort(compareStrings),
        diagnosticIds: [...correlation.diagnosticIds].sort(compareStrings),
      }))
      .sort((left, right) => compareStrings(left.id, right.id)),
    diagnostics: [...document.diagnostics].sort((left, right) => compareStrings(left.id, right.id)),
  };
}

export function serializeCanonicalSystemAnalysis(document: SystemAnalysisDocument): string {
  return canonicalStringify(canonicalizeSystemAnalysisDocument(document));
}
