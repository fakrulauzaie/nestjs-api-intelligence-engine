import { canonicalStringify } from '../model/ordering.js';
import {
  DIAGNOSTIC_CHANGE_REASONS,
  ENDPOINT_CHANGE_REASONS,
  INTERACTION_CHANGE_REASONS,
  INTERACTION_HANDLER_CHANGE_REASONS,
  type DiagnosticSnapshot,
  type DiffDocument,
  type EndpointSnapshot,
} from './model.js';
import { assertValidDiffDocument } from './validate.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function orderByVocabulary<T extends string>(values: readonly T[], vocabulary: readonly T[]): T[] {
  const rank = new Map(vocabulary.map((value, index) => [value, index]));
  return [...values].sort((left, right) => rank.get(left)! - rank.get(right)!);
}

function canonicalizeEndpoint(snapshot: EndpointSnapshot | null): EndpointSnapshot | null {
  if (snapshot === null) return null;
  const canonicalizeGuards = (guards: EndpointSnapshot['directGuards']) => ({
    ...guards,
    guards: [...guards.guards]
      .map((guard) => ({ ...guard, evidenceIds: [...guard.evidenceIds].sort(compareStrings) }))
      .sort((left, right) =>
        `${left.guardKey.encoded}:${left.scope}:${left.ruleId}:${left.assertionId}`.localeCompare(
          `${right.guardKey.encoded}:${right.scope}:${right.ruleId}:${right.assertionId}`,
        ),
      ),
  });
  return {
    ...snapshot,
    handlers: [...snapshot.handlers]
      .map((handler) => ({
        ...handler,
        evidenceIds: [...handler.evidenceIds].sort(compareStrings),
      }))
      .sort((left, right) =>
        `${left.methodKey?.encoded ?? ''}:${left.ruleId}:${left.assertionId}`.localeCompare(
          `${right.methodKey?.encoded ?? ''}:${right.ruleId}:${right.assertionId}`,
        ),
      ),
    directGuards: canonicalizeGuards(snapshot.directGuards),
    effectiveGuards: canonicalizeGuards(snapshot.effectiveGuards),
    terminals: {
      ...snapshot.terminals,
      values: [...snapshot.terminals.values]
        .map((terminal) => ({
          ...terminal,
          contributors: [...terminal.contributors]
            .map((contributor) => ({
              ...contributor,
              evidenceIds: [...contributor.evidenceIds].sort(compareStrings),
            }))
            .sort((left, right) =>
              `${left.methodKey.encoded}:${left.assertionId}`.localeCompare(
                `${right.methodKey.encoded}:${right.assertionId}`,
              ),
            ),
        }))
        .sort((left, right) => compareStrings(left.key.encoded, right.key.encoded)),
    },
  };
}

function canonicalizeDiagnostic(snapshot: DiagnosticSnapshot | null): DiagnosticSnapshot | null {
  return snapshot === null
    ? null
    : {
        ...snapshot,
        evidenceIds: [...snapshot.evidenceIds].sort(compareStrings),
        evidenceKeys: [...snapshot.evidenceKeys].sort((left, right) =>
          compareStrings(left.encoded, right.encoded),
        ),
      };
}

export function canonicalizeDiffDocument(input: DiffDocument): DiffDocument {
  const diff = assertValidDiffDocument(input);
  return {
    ...diff,
    endpointChanges: [...diff.endpointChanges]
      .map((change) => ({
        ...change,
        reasons: orderByVocabulary(change.reasons, ENDPOINT_CHANGE_REASONS),
        before: canonicalizeEndpoint(change.before),
        after: canonicalizeEndpoint(change.after),
      }))
      .sort((left, right) =>
        `${left.routeSlotKey.encoded}:${left.change}:${left.before?.endpointId ?? ''}:${left.after?.endpointId ?? ''}`.localeCompare(
          `${right.routeSlotKey.encoded}:${right.change}:${right.before?.endpointId ?? ''}:${right.after?.endpointId ?? ''}`,
        ),
      ),
    assertionStatusChanges: [...diff.assertionStatusChanges]
      .map((change) => ({
        ...change,
        before: {
          ...change.before,
          evidenceIds: [...change.before.evidenceIds].sort(compareStrings),
        },
        after: {
          ...change.after,
          evidenceIds: [...change.after.evidenceIds].sort(compareStrings),
        },
      }))
      .sort((left, right) => compareStrings(left.key.encoded, right.key.encoded)),
    diagnosticChanges: [...diff.diagnosticChanges]
      .map((change) => ({
        ...change,
        reasons: orderByVocabulary(change.reasons, DIAGNOSTIC_CHANGE_REASONS),
        before: canonicalizeDiagnostic(change.before),
        after: canonicalizeDiagnostic(change.after),
      }))
      .sort((left, right) =>
        `${left.key.encoded}:${left.change}`.localeCompare(`${right.key.encoded}:${right.change}`),
      ),
    ...(diff.interactionChanges === undefined
      ? {}
      : {
          interactionChanges: [...diff.interactionChanges]
            .map((change) => ({
              ...change,
              reasons: orderByVocabulary(change.reasons, INTERACTION_CHANGE_REASONS),
              before:
                change.before === null
                  ? null
                  : {
                      ...change.before,
                      evidenceIds: [...change.before.evidenceIds].sort(compareStrings),
                    },
              after:
                change.after === null
                  ? null
                  : {
                      ...change.after,
                      evidenceIds: [...change.after.evidenceIds].sort(compareStrings),
                    },
            }))
            .sort((left, right) =>
              `${left.key.encoded}:${left.change}`.localeCompare(
                `${right.key.encoded}:${right.change}`,
              ),
            ),
        }),
    ...(diff.interactionHandlerChanges === undefined
      ? {}
      : {
          interactionHandlerChanges: [...diff.interactionHandlerChanges]
            .map((change) => ({
              ...change,
              reasons: orderByVocabulary(change.reasons, INTERACTION_HANDLER_CHANGE_REASONS),
              before:
                change.before === null
                  ? null
                  : {
                      ...change.before,
                      evidenceIds: [...change.before.evidenceIds].sort(compareStrings),
                    },
              after:
                change.after === null
                  ? null
                  : {
                      ...change.after,
                      evidenceIds: [...change.after.evidenceIds].sort(compareStrings),
                    },
            }))
            .sort((left, right) =>
              `${left.key.encoded}:${left.change}`.localeCompare(
                `${right.key.encoded}:${right.change}`,
              ),
            ),
        }),
    ambiguities: [...diff.ambiguities]
      .map((ambiguity) => ({
        ...ambiguity,
        beforeCandidateIds: [...ambiguity.beforeCandidateIds].sort(compareStrings),
        afterCandidateIds: [...ambiguity.afterCandidateIds].sort(compareStrings),
      }))
      .sort((left, right) =>
        `${left.kind}:${left.recordKind}:${left.key.encoded}`.localeCompare(
          `${right.kind}:${right.recordKind}:${right.key.encoded}`,
        ),
      ),
  };
}

export function serializeDiffDocument(diff: DiffDocument): string {
  return canonicalStringify(canonicalizeDiffDocument(diff));
}
