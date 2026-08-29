import type { DiffDocument } from './model.js';
import { diffDocumentSchema } from './schemas.js';

export const DIFF_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'SUMMARY_MISMATCH',
  'CHANGE_SHAPE_INVALID',
  'DUPLICATE_DIFF_RECORD',
] as const;
export type DiffIntegrityIssueCode = (typeof DIFF_INTEGRITY_ISSUE_CODES)[number];

export interface DiffIntegrityIssue {
  readonly code: DiffIntegrityIssueCode;
  readonly message: string;
  readonly path?: string;
}

export type DiffValidationResult =
  | { readonly success: true; readonly data: DiffDocument }
  | { readonly success: false; readonly issues: readonly DiffIntegrityIssue[] };

function addShapeIssues(diff: DiffDocument, issues: DiffIntegrityIssue[]): void {
  const addIssue = (path: string, message: string): void => {
    issues.push({ code: 'CHANGE_SHAPE_INVALID', path, message });
  };

  for (const [index, change] of diff.endpointChanges.entries()) {
    const valid =
      (change.change === 'added' && change.before === null && change.after !== null) ||
      (change.change === 'removed' && change.before !== null && change.after === null) ||
      (change.change === 'modified' && change.before !== null && change.after !== null);
    if (!valid) {
      addIssue(
        `endpointChanges.${index}`,
        `Endpoint ${change.change} change has incompatible before/after values.`,
      );
    }
    const requiredReason =
      change.change === 'added'
        ? 'endpoint_added'
        : change.change === 'removed'
          ? 'endpoint_removed'
          : undefined;
    if (requiredReason !== undefined && !change.reasons.includes(requiredReason)) {
      addIssue(
        `endpointChanges.${index}.reasons`,
        `Endpoint ${change.change} change is missing ${requiredReason}.`,
      );
    }
    for (const [side, snapshot, facts] of [
      ['before', change.before, diff.before.facts] as const,
      ['after', change.after, diff.after.facts] as const,
    ]) {
      if (snapshot === null) continue;
      if (snapshot.routeSlotKey.encoded !== change.routeSlotKey.encoded) {
        addIssue(
          `endpointChanges.${index}.${side}.routeSlotKey`,
          'Endpoint snapshot route key differs from its change key.',
        );
      }
      if (
        (snapshot.identityStatus === 'resolved' && snapshot.exactKey === null) ||
        (snapshot.identityStatus !== 'resolved' && snapshot.exactKey !== null)
      ) {
        addIssue(
          `endpointChanges.${index}.${side}.exactKey`,
          'Endpoint exact key is inconsistent with identity status.',
        );
      }
      for (const [family, availability, values] of [
        ['directGuards', snapshot.directGuards.availability, snapshot.directGuards.guards],
        ['effectiveGuards', snapshot.effectiveGuards.availability, snapshot.effectiveGuards.guards],
        ['terminals', snapshot.terminals.availability, snapshot.terminals.values],
      ] as const) {
        if (availability !== facts[family]) {
          addIssue(
            `endpointChanges.${index}.${side}.${family}.availability`,
            `${family} availability differs from the input snapshot declaration.`,
          );
        }
        if (availability === 'unavailable' && values.length > 0) {
          addIssue(
            `endpointChanges.${index}.${side}.${family}`,
            `Unavailable ${family} cannot contain facts.`,
          );
        }
      }
    }
  }

  for (const [index, change] of diff.assertionStatusChanges.entries()) {
    if (
      change.key.encoded !== change.before.key.encoded ||
      change.key.encoded !== change.after.key.encoded ||
      change.before.status === change.after.status
    ) {
      addIssue(
        `assertionStatusChanges.${index}`,
        'Assertion status change must retain one semantic key and change status.',
      );
    }
  }

  for (const [index, change] of diff.diagnosticChanges.entries()) {
    const valid =
      (change.change === 'new' && change.before === null && change.after !== null) ||
      (change.change === 'resolved' && change.before !== null && change.after === null) ||
      (change.change === 'changed' && change.before !== null && change.after !== null);
    if (!valid) {
      addIssue(
        `diagnosticChanges.${index}`,
        `Diagnostic ${change.change} change has incompatible before/after values.`,
      );
    }
    if (
      (change.before !== null && change.before.key.encoded !== change.key.encoded) ||
      (change.after !== null && change.after.key.encoded !== change.key.encoded)
    ) {
      addIssue(
        `diagnosticChanges.${index}.key`,
        'Diagnostic snapshots must retain the change semantic key.',
      );
    }
    const requiredReason =
      change.change === 'new'
        ? 'diagnostic_added'
        : change.change === 'resolved'
          ? 'diagnostic_resolved'
          : undefined;
    if (requiredReason !== undefined && !change.reasons.includes(requiredReason)) {
      addIssue(
        `diagnosticChanges.${index}.reasons`,
        `Diagnostic ${change.change} change is missing ${requiredReason}.`,
      );
    }
  }

  for (const [collection, changes] of [
    ['interactionChanges', diff.interactionChanges ?? []] as const,
    ['interactionHandlerChanges', diff.interactionHandlerChanges ?? []] as const,
    ['jobQueueDispatchChanges', diff.jobQueueDispatchChanges ?? []] as const,
    ['jobQueueBranchChanges', diff.jobQueueBranchChanges ?? []] as const,
    ['jobQueueBranchEffectChanges', diff.jobQueueBranchEffectChanges ?? []] as const,
  ]) {
    for (const [index, change] of changes.entries()) {
      const valid =
        (change.change === 'added' && change.before === null && change.after !== null) ||
        (change.change === 'removed' && change.before !== null && change.after === null) ||
        (change.change === 'modified' && change.before !== null && change.after !== null);
      if (!valid) {
        addIssue(
          `${collection}.${index}`,
          `${change.change} change has incompatible before/after values.`,
        );
      }
      if (
        (change.before !== null && change.before.key.encoded !== change.key.encoded) ||
        (change.after !== null && change.after.key.encoded !== change.key.encoded)
      ) {
        addIssue(`${collection}.${index}.key`, 'Snapshots must retain the change semantic key.');
      }
    }
  }

  for (const [index, ambiguity] of diff.ambiguities.entries()) {
    const validSide =
      (ambiguity.side === 'before' && ambiguity.beforeCandidateIds.length > 0) ||
      (ambiguity.side === 'after' && ambiguity.afterCandidateIds.length > 0) ||
      (ambiguity.side === 'both' &&
        ambiguity.beforeCandidateIds.length > 0 &&
        ambiguity.afterCandidateIds.length > 0);
    if (!validSide) {
      addIssue(
        `ambiguities.${index}.side`,
        'Ambiguity side is inconsistent with its candidate collections.',
      );
    }
  }
}

function addSummaryIssues(diff: DiffDocument, issues: DiffIntegrityIssue[]): void {
  const expected = {
    endpointsAdded: diff.endpointChanges.filter(({ change }) => change === 'added').length,
    endpointsRemoved: diff.endpointChanges.filter(({ change }) => change === 'removed').length,
    endpointsModified: diff.endpointChanges.filter(({ change }) => change === 'modified').length,
    assertionStatusChanged: diff.assertionStatusChanges.length,
    diagnosticsNew: diff.diagnosticChanges.filter(({ change }) => change === 'new').length,
    diagnosticsResolved: diff.diagnosticChanges.filter(({ change }) => change === 'resolved')
      .length,
    diagnosticsChanged: diff.diagnosticChanges.filter(({ change }) => change === 'changed').length,
    ambiguities: diff.ambiguities.length,
    ...(diff.interactionChanges === undefined
      ? {}
      : {
          interactionsAdded: diff.interactionChanges.filter(({ change }) => change === 'added')
            .length,
          interactionsRemoved: diff.interactionChanges.filter(({ change }) => change === 'removed')
            .length,
          interactionsModified: diff.interactionChanges.filter(
            ({ change }) => change === 'modified',
          ).length,
        }),
    ...(diff.interactionHandlerChanges === undefined
      ? {}
      : {
          interactionHandlersAdded: diff.interactionHandlerChanges.filter(
            ({ change }) => change === 'added',
          ).length,
          interactionHandlersRemoved: diff.interactionHandlerChanges.filter(
            ({ change }) => change === 'removed',
          ).length,
          interactionHandlersModified: diff.interactionHandlerChanges.filter(
            ({ change }) => change === 'modified',
          ).length,
        }),
    ...(diff.jobQueueDispatchChanges === undefined
      ? {}
      : {
          jobQueueDispatchesAdded: diff.jobQueueDispatchChanges.filter(
            ({ change }) => change === 'added',
          ).length,
          jobQueueDispatchesRemoved: diff.jobQueueDispatchChanges.filter(
            ({ change }) => change === 'removed',
          ).length,
          jobQueueDispatchesModified: diff.jobQueueDispatchChanges.filter(
            ({ change }) => change === 'modified',
          ).length,
        }),
    ...(diff.jobQueueBranchChanges === undefined
      ? {}
      : {
          jobQueueBranchesAdded: diff.jobQueueBranchChanges.filter(
            ({ change }) => change === 'added',
          ).length,
          jobQueueBranchesRemoved: diff.jobQueueBranchChanges.filter(
            ({ change }) => change === 'removed',
          ).length,
          jobQueueBranchesModified: diff.jobQueueBranchChanges.filter(
            ({ change }) => change === 'modified',
          ).length,
        }),
    ...(diff.jobQueueBranchEffectChanges === undefined
      ? {}
      : {
          jobQueueBranchEffectsAdded: diff.jobQueueBranchEffectChanges.filter(
            ({ change }) => change === 'added',
          ).length,
          jobQueueBranchEffectsRemoved: diff.jobQueueBranchEffectChanges.filter(
            ({ change }) => change === 'removed',
          ).length,
          jobQueueBranchEffectsModified: diff.jobQueueBranchEffectChanges.filter(
            ({ change }) => change === 'modified',
          ).length,
        }),
  };

  for (const [field, value] of Object.entries(expected)) {
    if (diff.summary[field as keyof typeof expected] !== value) {
      issues.push({
        code: 'SUMMARY_MISMATCH',
        path: `summary.${field}`,
        message: `Summary ${field} does not match the corresponding record count.`,
      });
    }
  }
}

function addDuplicateIssues(diff: DiffDocument, issues: DiffIntegrityIssue[]): void {
  const collections: readonly [string, readonly string[]][] = [
    [
      'endpointChanges',
      diff.endpointChanges.map(
        ({ change, routeSlotKey, before, after }) =>
          `${change}:${routeSlotKey.encoded}:${before?.endpointId ?? ''}:${after?.endpointId ?? ''}`,
      ),
    ],
    ['assertionStatusChanges', diff.assertionStatusChanges.map(({ key }) => key.encoded)],
    [
      'diagnosticChanges',
      diff.diagnosticChanges.map(({ change, key }) => `${change}:${key.encoded}`),
    ],
    [
      'interactionChanges',
      (diff.interactionChanges ?? []).map(({ change, key }) => `${change}:${key.encoded}`),
    ],
    [
      'interactionHandlerChanges',
      (diff.interactionHandlerChanges ?? []).map(({ change, key }) => `${change}:${key.encoded}`),
    ],
    [
      'jobQueueDispatchChanges',
      (diff.jobQueueDispatchChanges ?? []).map(({ change, key }) => `${change}:${key.encoded}`),
    ],
    [
      'jobQueueBranchChanges',
      (diff.jobQueueBranchChanges ?? []).map(({ change, key }) => `${change}:${key.encoded}`),
    ],
    [
      'jobQueueBranchEffectChanges',
      (diff.jobQueueBranchEffectChanges ?? []).map(({ change, key }) => `${change}:${key.encoded}`),
    ],
    [
      'ambiguities',
      diff.ambiguities.map(({ kind, recordKind, key }) => `${kind}:${recordKind}:${key.encoded}`),
    ],
  ];

  for (const [path, keys] of collections) {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        issues.push({
          code: 'DUPLICATE_DIFF_RECORD',
          path,
          message: `${path} repeats semantic record ${key}.`,
        });
      }
      seen.add(key);
    }
  }
}

export function validateDiffDocument(input: unknown): DiffValidationResult {
  const parsed = diffDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const issues: DiffIntegrityIssue[] = [];
  addShapeIssues(parsed.data, issues);
  addSummaryIssues(parsed.data, issues);
  addDuplicateIssues(parsed.data, issues);
  return issues.length === 0
    ? { success: true, data: parsed.data }
    : {
        success: false,
        issues: issues.sort((left, right) =>
          `${left.code}:${left.path ?? ''}`.localeCompare(`${right.code}:${right.path ?? ''}`),
        ),
      };
}

export class DiffIntegrityError extends Error {
  readonly issues: readonly DiffIntegrityIssue[];

  constructor(issues: readonly DiffIntegrityIssue[]) {
    super(`Diff integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'DiffIntegrityError';
    this.issues = issues;
  }
}

export function assertValidDiffDocument(input: unknown): DiffDocument {
  const result = validateDiffDocument(input);
  if (!result.success) throw new DiffIntegrityError(result.issues);
  return result.data;
}
