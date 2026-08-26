import { canonicalStringify } from '../model/ordering.js';
import {
  IMPACT_CATEGORIES,
  IMPACT_REASON_CODES,
  UNREACHABLE_REASON_CODES,
  type ImpactDocument,
  type ImpactPath,
} from './model.js';
import { assertValidImpactDocument } from './validate.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function rank<T extends string>(value: T, vocabulary: readonly T[]): number {
  return vocabulary.indexOf(value);
}

function pathKey(path: ImpactPath): string {
  return `${path.side}:${path.endpointId}:${path.steps.map(({ assertionId }) => assertionId).join(':')}:${path.targetKey.encoded}`;
}

export function canonicalizeImpactDocument(input: ImpactDocument): ImpactDocument {
  const document = assertValidImpactDocument(input);
  return {
    ...document,
    sourceChanges: [...document.sourceChanges].sort((left, right) =>
      compareStrings(left.path, right.path),
    ),
    impactedEndpoints: [...document.impactedEndpoints]
      .map((endpoint) => ({
        ...endpoint,
        beforeEndpointIds: [...endpoint.beforeEndpointIds].sort(compareStrings),
        afterEndpointIds: [...endpoint.afterEndpointIds].sort(compareStrings),
        reasons: [...endpoint.reasons]
          .map((reason) => ({
            ...reason,
            beforeEvidenceIds: [...reason.beforeEvidenceIds].sort(compareStrings),
            afterEvidenceIds: [...reason.afterEvidenceIds].sort(compareStrings),
            paths: [...reason.paths]
              .map((path) => ({
                ...path,
                steps: path.steps.map((step) => ({
                  ...step,
                  evidenceIds: [...step.evidenceIds].sort(compareStrings),
                })),
              }))
              .sort((left, right) => compareStrings(pathKey(left), pathKey(right))),
          }))
          .sort((left, right) => {
            const categoryOrder =
              rank(left.category, IMPACT_CATEGORIES) - rank(right.category, IMPACT_CATEGORIES);
            if (categoryOrder !== 0) return categoryOrder;
            const reasonOrder =
              rank(left.reasonCode, IMPACT_REASON_CODES) -
              rank(right.reasonCode, IMPACT_REASON_CODES);
            return reasonOrder !== 0
              ? reasonOrder
              : compareStrings(left.subject.key.encoded, right.subject.key.encoded);
          }),
      }))
      .sort((left, right) => compareStrings(left.routeSlotKey.encoded, right.routeSlotKey.encoded)),
    unreachableSourceChanges: [...document.unreachableSourceChanges]
      .map((change) => ({
        ...change,
        beforeSubjectKeys: [...change.beforeSubjectKeys].sort((left, right) =>
          compareStrings(left.encoded, right.encoded),
        ),
        afterSubjectKeys: [...change.afterSubjectKeys].sort((left, right) =>
          compareStrings(left.encoded, right.encoded),
        ),
        reasonCodes: [...change.reasonCodes].sort(
          (left, right) =>
            rank(left, UNREACHABLE_REASON_CODES) - rank(right, UNREACHABLE_REASON_CODES),
        ),
      }))
      .sort((left, right) => compareStrings(left.path, right.path)),
  };
}

export function serializeImpactDocument(document: ImpactDocument): string {
  return canonicalStringify(canonicalizeImpactDocument(document));
}
