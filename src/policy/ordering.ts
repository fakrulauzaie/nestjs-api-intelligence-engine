import { canonicalStringify } from '../model/ordering.js';
import type { PolicyResultsDocument } from './model.js';
import { assertValidPolicyResultsDocument } from './validate.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function canonicalizePolicyResults(document: PolicyResultsDocument): PolicyResultsDocument {
  return {
    ...document,
    configuration: {
      ...document.configuration,
      rules: [...document.configuration.rules].sort((left, right) =>
        compareStrings(left.ruleId, right.ruleId),
      ),
    },
    results: [...document.results]
      .map((result) => ({
        ...result,
        subject: {
          ...result.subject,
          canonicalIds: [...new Set(result.subject.canonicalIds)].sort(compareStrings),
        },
        evidenceIds: [...new Set(result.evidenceIds)].sort(compareStrings),
      }))
      .sort((left, right) =>
        compareStrings(
          `${left.ruleId}:${left.subject.semanticKey.encoded}`,
          `${right.ruleId}:${right.subject.semanticKey.encoded}`,
        ),
      ),
  };
}

export function serializePolicyResults(document: PolicyResultsDocument): string {
  const canonical = canonicalizePolicyResults(document);
  return canonicalStringify(assertValidPolicyResultsDocument(canonical));
}
