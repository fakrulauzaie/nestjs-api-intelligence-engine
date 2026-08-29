import { describe, expect, it } from 'vitest';
import {
  canonicalizeJobQueueBranchSelector,
  jobQueueBranchSelectorKey,
  matchJobQueueBranchSelector,
  type JobQueueBranchContract,
} from '../../../src/model/job-queue-branches.js';
import {
  createStableId,
  makeJobQueueHandlerBranchEffectId,
  makeJobQueueHandlerBranchId,
  makeJobQueueHandlerDispatchId,
} from '../../../src/model/ids.js';
import { jobQueueBranchContractSchema } from '../../../src/model/schemas.js';

function validContract(): JobQueueBranchContract {
  const handlerId = createStableId('interaction_handler', ['handler']);
  const dispatchEvidenceId = createStableId('evidence', ['dispatch']);
  const branchEvidenceId = createStableId('evidence', ['branch']);
  const effectEvidenceId = createStableId('evidence', ['effect']);
  const sourceAssertionId = createStableId('assertion', ['source']);
  const methodId = createStableId('method', ['target']);
  const selector = { kind: 'exact_jobs', jobs: ['generate-pdf'] } as const;
  const dispatchId = makeJobQueueHandlerDispatchId({
    handlerId,
    discriminantEvidenceId: dispatchEvidenceId,
    ruleId: 'queue.bullmq.dispatch.switch.v1',
  });
  const branchId = makeJobQueueHandlerBranchId({
    dispatchId,
    selectorKey: jobQueueBranchSelectorKey(selector),
    controlFlow: 'switch_case',
    branchEvidenceId,
    ruleId: 'queue.bullmq.dispatch.switch-case.v1',
  });
  const effectId = makeJobQueueHandlerBranchEffectId({
    branchId,
    kind: 'calls_method',
    targetId: methodId,
    sourceAssertionId,
    effectEvidenceId,
    ruleId: 'queue.bullmq.dispatch.branch-effect.v1',
  });
  return {
    dispatches: [
      {
        id: dispatchId,
        handlerId,
        state: 'complete',
        branchIds: [branchId],
        ruleId: 'queue.bullmq.dispatch.switch.v1',
        evidenceIds: [dispatchEvidenceId],
      },
    ],
    branches: [
      {
        id: branchId,
        dispatchId,
        selector,
        controlFlow: 'switch_case',
        ruleId: 'queue.bullmq.dispatch.switch-case.v1',
        evidenceIds: [branchEvidenceId],
      },
    ],
    effects: [
      {
        id: effectId,
        branchId,
        kind: 'calls_method',
        targetId: methodId,
        sourceAssertionId,
        status: 'resolved',
        ruleId: 'queue.bullmq.dispatch.branch-effect.v1',
        evidenceIds: [effectEvidenceId],
      },
    ],
  };
}

describe('BullMQ handler branch contract', () => {
  it('canonicalizes selector identities and matches only job applicability', () => {
    expect(
      canonicalizeJobQueueBranchSelector({
        kind: 'exact_jobs',
        jobs: ['generate-pdf', 'archive-pdf', 'generate-pdf'],
      }),
    ).toEqual({ kind: 'exact_jobs', jobs: ['archive-pdf', 'generate-pdf'] });
    expect(
      jobQueueBranchSelectorKey({
        kind: 'unmatched_jobs',
        excludedJobs: ['cleanup', 'generate-pdf'],
      }),
    ).toBe('{"kind":"unmatched_jobs","excludedJobs":["cleanup","generate-pdf"]}');

    expect(
      matchJobQueueBranchSelector(
        { kind: 'exact_jobs', jobs: ['generate-pdf'] },
        { resolution: 'exact', value: 'generate-pdf' },
      ),
    ).toBe('matches');
    expect(
      matchJobQueueBranchSelector(
        { kind: 'exact_jobs', jobs: ['generate-pdf'] },
        { resolution: 'exact', value: 'cleanup' },
      ),
    ).toBe('does_not_match');
    expect(
      matchJobQueueBranchSelector(
        { kind: 'unmatched_jobs', excludedJobs: ['generate-pdf'] },
        { resolution: 'exact', value: 'cleanup' },
      ),
    ).toBe('matches');
    expect(
      matchJobQueueBranchSelector(
        { kind: 'unmatched_jobs', excludedJobs: ['generate-pdf'] },
        { resolution: 'exact', value: 'generate-pdf' },
      ),
    ).toBe('does_not_match');
    expect(
      matchJobQueueBranchSelector({ kind: 'all_jobs' }, { resolution: 'dynamic', value: null }),
    ).toBe('matches');
    expect(
      matchJobQueueBranchSelector(
        { kind: 'unknown' },
        { resolution: 'exact', value: 'generate-pdf' },
      ),
    ).toBe('unknown');
  });

  it('validates complete dispatches and branch-scoped source assertion projections', () => {
    expect(jobQueueBranchContractSchema.safeParse(validContract())).toMatchObject({
      success: true,
    });
  });

  it('rejects incompatible selector/control-flow pairs and invalid target kinds', () => {
    const contract = validContract();
    expect(
      jobQueueBranchContractSchema.safeParse({
        ...contract,
        branches: [
          {
            ...contract.branches[0],
            selector: { kind: 'all_jobs' },
            controlFlow: 'switch_case',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      jobQueueBranchContractSchema.safeParse({
        ...contract,
        effects: [
          {
            ...contract.effects[0],
            kind: 'writes_table',
            targetId: createStableId('method', ['not-a-table']),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('enforces complete, partial, and unsupported residual semantics', () => {
    const contract = validContract();
    const unknownBranch = {
      ...contract.branches[0]!,
      selector: { kind: 'unknown' } as const,
      controlFlow: 'unsupported_region' as const,
    };
    expect(
      jobQueueBranchContractSchema.safeParse({ ...contract, branches: [unknownBranch] }).success,
    ).toBe(false);
    expect(
      jobQueueBranchContractSchema.safeParse({
        ...contract,
        dispatches: [{ ...contract.dispatches[0], state: 'partial' }],
      }).success,
    ).toBe(false);
    expect(
      jobQueueBranchContractSchema.safeParse({
        ...contract,
        dispatches: [{ ...contract.dispatches[0], state: 'unsupported' }],
      }).success,
    ).toBe(false);
    expect(
      jobQueueBranchContractSchema.safeParse({
        ...contract,
        dispatches: [{ ...contract.dispatches[0], branchIds: [] }],
      }).success,
    ).toBe(false);
  });
});
