import { IMPACT_CATEGORIES, type ImpactDocument, type ImpactSummary } from './model.js';
import { impactDocumentSchema } from './schemas.js';

export const IMPACT_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'SUMMARY_MISMATCH',
  'CHANGE_SHAPE_INVALID',
  'PATH_INVALID',
  'DUPLICATE_IMPACT_RECORD',
] as const;
export type ImpactIntegrityIssueCode = (typeof IMPACT_INTEGRITY_ISSUE_CODES)[number];

export interface ImpactIntegrityIssue {
  readonly code: ImpactIntegrityIssueCode;
  readonly message: string;
  readonly path?: string;
}

export type ImpactValidationResult =
  | { readonly success: true; readonly data: ImpactDocument }
  | { readonly success: false; readonly issues: readonly ImpactIntegrityIssue[] };

function expectedSummary(document: ImpactDocument): ImpactSummary {
  const reasons = document.impactedEndpoints.flatMap(({ reasons }) => reasons);
  return {
    sourceFilesAdded: document.sourceChanges.filter(({ change }) => change === 'added').length,
    sourceFilesRemoved: document.sourceChanges.filter(({ change }) => change === 'removed').length,
    sourceFilesModified: document.sourceChanges.filter(({ change }) => change === 'modified')
      .length,
    impactedEndpointSlots: document.impactedEndpoints.length,
    directlyChangedEndpointSlots: document.impactedEndpoints.filter(({ direct }) => direct).length,
    transitivelyImpactedEndpointSlots: document.impactedEndpoints.filter(({ reasons: values }) =>
      values.some(({ category }) =>
        ['reachable_method_file_change', 'entity_declaration_file_change'].includes(category),
      ),
    ).length,
    unreachableSourceChanges: document.unreachableSourceChanges.length,
    reasonsByCategory: Object.fromEntries(
      IMPACT_CATEGORIES.map((category) => [
        category,
        reasons.filter((reason) => reason.category === category).length,
      ]),
    ) as ImpactSummary['reasonsByCategory'],
  };
}

function addSummaryIssues(document: ImpactDocument, issues: ImpactIntegrityIssue[]): void {
  const expected = expectedSummary(document);
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'reasonsByCategory') continue;
    if (document.summary[key as keyof Omit<ImpactSummary, 'reasonsByCategory'>] !== value) {
      issues.push({
        code: 'SUMMARY_MISMATCH',
        path: `summary.${key}`,
        message: `Summary ${key} does not match its records.`,
      });
    }
  }
  for (const category of IMPACT_CATEGORIES) {
    if (document.summary.reasonsByCategory[category] !== expected.reasonsByCategory[category]) {
      issues.push({
        code: 'SUMMARY_MISMATCH',
        path: `summary.reasonsByCategory.${category}`,
        message: `Category count for ${category} does not match its reasons.`,
      });
    }
  }
}

function addShapeIssues(document: ImpactDocument, issues: ImpactIntegrityIssue[]): void {
  for (const [index, change] of document.sourceChanges.entries()) {
    const valid =
      (change.change === 'added' && change.before === null && change.after !== null) ||
      (change.change === 'removed' && change.before !== null && change.after === null) ||
      (change.change === 'modified' && change.before !== null && change.after !== null);
    if (
      !valid ||
      (change.before !== null && change.before.path !== change.path) ||
      (change.after !== null && change.after.path !== change.path)
    ) {
      issues.push({
        code: 'CHANGE_SHAPE_INVALID',
        path: `sourceChanges.${index}`,
        message: `Source ${change.change} change has inconsistent path or snapshots.`,
      });
    }
    if (change.change === 'modified' && change.before?.contentHash === change.after?.contentHash) {
      issues.push({
        code: 'CHANGE_SHAPE_INVALID',
        path: `sourceChanges.${index}`,
        message: 'A modified source change must have different content hashes.',
      });
    }
  }

  const sourceByPath = new Map(document.sourceChanges.map((change) => [change.path, change]));
  for (const [index, unreachable] of document.unreachableSourceChanges.entries()) {
    const change = sourceByPath.get(unreachable.path);
    if (change === undefined || change.change !== unreachable.change) {
      issues.push({
        code: 'CHANGE_SHAPE_INVALID',
        path: `unreachableSourceChanges.${index}`,
        message: 'Unreachable source must reference one declared source change.',
      });
    }
  }
}

function addPathIssues(document: ImpactDocument, issues: ImpactIntegrityIssue[]): void {
  for (const [endpointIndex, endpoint] of document.impactedEndpoints.entries()) {
    const expectedDirect = endpoint.reasons.some(
      ({ category }) => category === 'direct_endpoint_change',
    );
    if (endpoint.direct !== expectedDirect) {
      issues.push({
        code: 'PATH_INVALID',
        path: `impactedEndpoints.${endpointIndex}.direct`,
        message: 'Direct marker does not match direct endpoint reasons.',
      });
    }
    for (const [reasonIndex, reason] of endpoint.reasons.entries()) {
      for (const [pathIndex, path] of reason.paths.entries()) {
        const endpointIds =
          path.side === 'before' ? endpoint.beforeEndpointIds : endpoint.afterEndpointIds;
        const issuePath = `impactedEndpoints.${endpointIndex}.reasons.${reasonIndex}.paths.${pathIndex}`;
        if (!endpointIds.includes(path.endpointId)) {
          issues.push({
            code: 'PATH_INVALID',
            path: issuePath,
            message: `Path endpoint is not listed on its ${path.side} endpoint side.`,
          });
        }
        if (path.steps[0] !== undefined && path.steps[0].fromId !== path.endpointId) {
          issues.push({
            code: 'PATH_INVALID',
            path: issuePath,
            message: 'The first path step must start at the endpoint.',
          });
        }
        for (let index = 1; index < path.steps.length; index += 1) {
          if (path.steps[index - 1]!.toId !== path.steps[index]!.fromId) {
            issues.push({
              code: 'PATH_INVALID',
              path: issuePath,
              message: 'Path steps are not contiguous.',
            });
            break;
          }
        }
        const finalStep = path.steps.at(-1);
        if (
          finalStep !== undefined &&
          finalStep.toKey?.encoded !== path.targetKey.encoded &&
          finalStep.fromKey.encoded !== path.targetKey.encoded
        ) {
          issues.push({
            code: 'PATH_INVALID',
            path: issuePath,
            message: 'Path target key is not represented by its final step.',
          });
        }
      }
    }
  }
}

function addDuplicateIssues(document: ImpactDocument, issues: ImpactIntegrityIssue[]): void {
  const collections: readonly [string, readonly string[]][] = [
    ['sourceChanges', document.sourceChanges.map(({ path }) => path)],
    [
      'impactedEndpoints',
      document.impactedEndpoints.map(({ routeSlotKey }) => routeSlotKey.encoded),
    ],
    ['unreachableSourceChanges', document.unreachableSourceChanges.map(({ path }) => path)],
  ];
  for (const [path, keys] of collections) {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        issues.push({
          code: 'DUPLICATE_IMPACT_RECORD',
          path,
          message: `${path} repeats ${key}.`,
        });
      }
      seen.add(key);
    }
  }

  for (const [endpointIndex, endpoint] of document.impactedEndpoints.entries()) {
    const seen = new Set<string>();
    for (const reason of endpoint.reasons) {
      const key = `${reason.category}:${reason.reasonCode}:${reason.subject.key.encoded}:${reason.sourceChangePath ?? ''}`;
      if (seen.has(key)) {
        issues.push({
          code: 'DUPLICATE_IMPACT_RECORD',
          path: `impactedEndpoints.${endpointIndex}.reasons`,
          message: `Endpoint repeats impact reason ${key}.`,
        });
      }
      seen.add(key);
    }
  }
}

export function validateImpactDocument(input: unknown): ImpactValidationResult {
  const parsed = impactDocumentSchema.safeParse(input);
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
  const issues: ImpactIntegrityIssue[] = [];
  addShapeIssues(parsed.data, issues);
  addPathIssues(parsed.data, issues);
  addSummaryIssues(parsed.data, issues);
  addDuplicateIssues(parsed.data, issues);
  return issues.length === 0
    ? { success: true, data: parsed.data }
    : {
        success: false,
        issues: issues.sort((left, right) =>
          `${left.code}:${left.path ?? ''}:${left.message}`.localeCompare(
            `${right.code}:${right.path ?? ''}:${right.message}`,
          ),
        ),
      };
}

export class ImpactIntegrityError extends Error {
  readonly issues: readonly ImpactIntegrityIssue[];

  constructor(issues: readonly ImpactIntegrityIssue[]) {
    super(`Impact integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'ImpactIntegrityError';
    this.issues = issues;
  }
}

export function assertValidImpactDocument(input: unknown): ImpactDocument {
  const result = validateImpactDocument(input);
  if (!result.success) throw new ImpactIntegrityError(result.issues);
  return result.data;
}
