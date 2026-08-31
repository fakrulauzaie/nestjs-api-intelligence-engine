import type {
  AnalysisDocumentV4,
  AnalysisDocumentV5,
  AnalysisDocumentV6,
  AnalysisDocumentV7,
} from '../model/analysis.js';
import type { TextInteractionTarget } from '../model/interactions.js';
import { matchJobQueueBranchSelector } from '../model/job-queue-branches.js';

export interface SelectedJobQueueBranches {
  readonly dispatchState: 'complete' | 'partial' | 'unsupported';
  readonly branchIds: readonly string[];
  readonly sourceAssertionIds: ReadonlySet<string>;
}

export function selectJobQueueBranches(input: {
  readonly analysis:
    | AnalysisDocumentV4
    | AnalysisDocumentV5
    | AnalysisDocumentV6
    | AnalysisDocumentV7;
  readonly handlerId: string;
  readonly producerJob: TextInteractionTarget;
}): SelectedJobQueueBranches | null {
  if (input.producerJob.resolution !== 'exact' || input.producerJob.value === null) return null;
  const dispatch = input.analysis.interactionHandlerDispatches.find(
    ({ handlerId }) => handlerId === input.handlerId,
  );
  if (dispatch === undefined) return null;
  const branchesById = new Map(
    input.analysis.interactionHandlerBranches.map((branch) => [branch.id, branch]),
  );
  const selectedBranches = dispatch.branchIds
    .flatMap((id) => {
      const branch = branchesById.get(id);
      return branch === undefined ? [] : [branch];
    })
    .filter(
      ({ selector }) => matchJobQueueBranchSelector(selector, input.producerJob) === 'matches',
    );
  const selectedIds = new Set(selectedBranches.map(({ id }) => id));
  return {
    dispatchState: dispatch.state,
    branchIds: [...selectedIds].sort(),
    sourceAssertionIds: new Set(
      input.analysis.interactionHandlerBranchEffects
        .filter(({ branchId }) => selectedIds.has(branchId))
        .map(({ sourceAssertionId }) => sourceAssertionId),
    ),
  };
}
