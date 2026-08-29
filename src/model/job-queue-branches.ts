import type { AssertionStatus } from './assertions.js';
import type { RecordId } from './entities.js';
import type { TextInteractionTarget } from './interactions.js';

export const JOB_QUEUE_HANDLER_DISPATCH_STATES = ['complete', 'partial', 'unsupported'] as const;
export type JobQueueHandlerDispatchState = (typeof JOB_QUEUE_HANDLER_DISPATCH_STATES)[number];

export const JOB_QUEUE_BRANCH_SELECTOR_KINDS = [
  'exact_jobs',
  'all_jobs',
  'unmatched_jobs',
  'unknown',
] as const;
export type JobQueueBranchSelectorKind = (typeof JOB_QUEUE_BRANCH_SELECTOR_KINDS)[number];

export interface ExactJobsBranchSelector {
  readonly kind: 'exact_jobs';
  readonly jobs: readonly string[];
}

export interface AllJobsBranchSelector {
  readonly kind: 'all_jobs';
}

export interface UnmatchedJobsBranchSelector {
  readonly kind: 'unmatched_jobs';
  /** Exact job names excluded by preceding supported branches. */
  readonly excludedJobs: readonly string[];
}

export interface UnknownJobsBranchSelector {
  readonly kind: 'unknown';
}

export type JobQueueBranchSelector =
  | ExactJobsBranchSelector
  | AllJobsBranchSelector
  | UnmatchedJobsBranchSelector
  | UnknownJobsBranchSelector;

export const JOB_QUEUE_BRANCH_CONTROL_FLOWS = [
  'switch_case',
  'if_branch',
  'common_prelude',
  'common_finally',
  'default_branch',
  'unmatched_fallthrough',
  'unsupported_region',
] as const;
export type JobQueueBranchControlFlow = (typeof JOB_QUEUE_BRANCH_CONTROL_FLOWS)[number];

export const JOB_QUEUE_BRANCH_EFFECT_KINDS = [
  'calls_method',
  'reads_table',
  'writes_table',
  'initiates_interaction',
] as const;
export type JobQueueBranchEffectKind = (typeof JOB_QUEUE_BRANCH_EFFECT_KINDS)[number];

export interface JobQueueHandlerDispatchRecord {
  readonly id: RecordId;
  readonly handlerId: RecordId;
  readonly state: JobQueueHandlerDispatchState;
  readonly branchIds: readonly RecordId[];
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}

export interface JobQueueHandlerBranchRecord {
  readonly id: RecordId;
  readonly dispatchId: RecordId;
  readonly selector: JobQueueBranchSelector;
  readonly controlFlow: JobQueueBranchControlFlow;
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}

/**
 * A source-range-specific projection of an existing canonical method assertion.
 * The source assertion remains the canonical call/table/interaction fact; this
 * record proves only that its call-site evidence belongs to one dispatch branch.
 */
export interface JobQueueHandlerBranchEffectRecord {
  readonly id: RecordId;
  readonly branchId: RecordId;
  readonly kind: JobQueueBranchEffectKind;
  readonly targetId: RecordId;
  readonly sourceAssertionId: RecordId;
  readonly status: Extract<AssertionStatus, 'resolved' | 'ambiguous'>;
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}

export interface JobQueueBranchContract {
  readonly dispatches: readonly JobQueueHandlerDispatchRecord[];
  readonly branches: readonly JobQueueHandlerBranchRecord[];
  readonly effects: readonly JobQueueHandlerBranchEffectRecord[];
}

export const JOB_QUEUE_BRANCH_MATCH_STATES = ['matches', 'does_not_match', 'unknown'] as const;
export type JobQueueBranchMatchState = (typeof JOB_QUEUE_BRANCH_MATCH_STATES)[number];

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalizeJobQueueBranchSelector(
  selector: JobQueueBranchSelector,
): JobQueueBranchSelector {
  switch (selector.kind) {
    case 'exact_jobs':
      return { kind: selector.kind, jobs: sortedUnique(selector.jobs) };
    case 'unmatched_jobs':
      return { kind: selector.kind, excludedJobs: sortedUnique(selector.excludedJobs) };
    case 'all_jobs':
    case 'unknown':
      return selector;
  }
}

export function jobQueueBranchSelectorKey(selector: JobQueueBranchSelector): string {
  return JSON.stringify(canonicalizeJobQueueBranchSelector(selector));
}

/** Compare branch applicability to a producer job identity without implying delivery. */
export function matchJobQueueBranchSelector(
  selector: JobQueueBranchSelector,
  producerJob: TextInteractionTarget,
): JobQueueBranchMatchState {
  if (selector.kind === 'all_jobs') return 'matches';
  if (selector.kind === 'unknown') return 'unknown';
  if (producerJob.resolution !== 'exact' || producerJob.value === null) return 'unknown';
  if (selector.kind === 'exact_jobs') {
    return selector.jobs.includes(producerJob.value) ? 'matches' : 'does_not_match';
  }
  return selector.excludedJobs.includes(producerJob.value) ? 'does_not_match' : 'matches';
}
