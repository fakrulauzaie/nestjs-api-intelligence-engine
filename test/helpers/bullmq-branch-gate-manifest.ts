import { z } from 'zod';
import {
  JOB_QUEUE_BRANCH_CONTROL_FLOWS,
  JOB_QUEUE_BRANCH_EFFECT_KINDS,
  JOB_QUEUE_HANDLER_DISPATCH_STATES,
  canonicalizeJobQueueBranchSelector,
  jobQueueBranchSelectorKey,
} from '../../src/model/job-queue-branches.js';
import { jobQueueBranchSelectorSchema } from '../../src/model/schemas.js';

type ManifestBranchSelector = z.infer<typeof jobQueueBranchSelectorSchema>;

export const BULLMQ_BRANCH_GATE_MANIFEST_SCHEMA_VERSION = '1.0.0' as const;
export const BULLMQ_BRANCH_GATE_CLASSIFICATIONS = ['positive', 'partial', 'unsupported'] as const;
export const BULLMQ_BRANCH_GATE_MUST_NOT_INFER = [
  'aliased_discriminant_trusted',
  'branch_write_overattribution',
  'broker_delivery_guaranteed',
  'common_effect_omitted',
  'compound_predicate_sliced',
  'default_effect_applied_to_excluded_job',
  'dynamic_case_resolved',
  'exact_job_implies_worker_execution',
  'fallthrough_treated_as_grouped_label',
  'finally_completion_guaranteed',
  'mutated_discriminant_trusted',
  'unsupported_effect_dropped',
] as const;

const caseId = z.string().regex(/^b0-[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const fixtureName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.ts\.txt$/u);
const sourceMarker = z.string().regex(/^B0_(?:CASE|BRANCH|NEGATIVE):[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const semanticName = z.string().regex(/^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/u);
const qualifiedMethod = z.string().regex(/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/u);

const expectedEffectSchema = z
  .object({
    kind: z.enum(JOB_QUEUE_BRANCH_EFFECT_KINDS),
    target: qualifiedMethod,
  })
  .strict();

const expectedBranchSchema = z
  .object({
    selector: jobQueueBranchSelectorSchema,
    controlFlow: z.enum(JOB_QUEUE_BRANCH_CONTROL_FLOWS),
    effects: z.array(expectedEffectSchema),
  })
  .strict();

const branchCaseSchema = z
  .object({
    caseId,
    fixture: fixtureName,
    classification: z.enum(BULLMQ_BRANCH_GATE_CLASSIFICATIONS),
    sourceMarkers: z.array(sourceMarker).min(1),
    dispatchState: z.enum(JOB_QUEUE_HANDLER_DISPATCH_STATES),
    expectedBranches: z.array(expectedBranchSchema).min(1),
    mustEmit: z.array(semanticName).min(1),
    mustNotEmit: z.array(semanticName).min(1),
    mustNotInfer: z.array(z.enum(BULLMQ_BRANCH_GATE_MUST_NOT_INFER)).min(1),
    counterpartCaseIds: z.array(caseId).min(1),
    rationale: z.string().min(20),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedState =
      value.classification === 'positive'
        ? 'complete'
        : value.classification === 'partial'
          ? 'partial'
          : 'unsupported';
    if (value.dispatchState !== expectedState) {
      context.addIssue({
        code: 'custom',
        path: ['dispatchState'],
        message: `${value.classification} cases require ${expectedState} dispatch state.`,
      });
    }
  });

export const bullMqBranchGateManifestSchema = z
  .object({
    schemaVersion: z.literal(BULLMQ_BRANCH_GATE_MANIFEST_SCHEMA_VERSION),
    compatibilityTarget: z
      .object({
        verifiedOn: z.iso.date(),
        packages: z
          .array(
            z
              .object({
                name: z.enum(['@nestjs/common', '@nestjs/bullmq', 'bullmq']),
                version: z.string().regex(/^\d+\.\d+\.\d+$/u),
              })
              .strict(),
          )
          .length(3),
      })
      .strict(),
    schemaDecision: z
      .object({
        currentAnalysisVersion: z.literal('3.0.0'),
        targetAnalysisVersion: z.literal('4.0.0'),
        v3Frozen: z.literal(true),
        phase39PublishesBranchFacts: z.literal(false),
      })
      .strict(),
    globalMustNotInfer: z.array(z.enum(BULLMQ_BRANCH_GATE_MUST_NOT_INFER)).min(1),
    cases: z.array(branchCaseSchema).min(1),
    review: z
      .object({
        semanticStatus: z.literal('approved'),
        reviewedOn: z.iso.date(),
        extractorImplementationPresent: z.literal(false),
        phaseRecommendation: z.literal('eligible_after_b0'),
        decisions: z.array(z.string().min(20)).min(1),
        rationale: z.string().min(40),
      })
      .strict(),
  })
  .strict();

export type BullMqBranchGateManifest = z.infer<typeof bullMqBranchGateManifestSchema>;

function sortedStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalizeManifestBranchSelector(
  selector: ManifestBranchSelector,
): ManifestBranchSelector {
  const canonical = canonicalizeJobQueueBranchSelector(selector);
  if (canonical.kind === 'exact_jobs') {
    return { kind: canonical.kind, jobs: [...canonical.jobs] };
  }
  if (canonical.kind === 'unmatched_jobs') {
    return { kind: canonical.kind, excludedJobs: [...canonical.excludedJobs] };
  }
  return canonical;
}

export function canonicalizeBullMqBranchGateManifest(
  manifest: BullMqBranchGateManifest,
): BullMqBranchGateManifest {
  return {
    ...manifest,
    compatibilityTarget: {
      ...manifest.compatibilityTarget,
      packages: [...manifest.compatibilityTarget.packages].sort(({ name: left }, { name: right }) =>
        left.localeCompare(right),
      ),
    },
    globalMustNotInfer: sortedStrings(manifest.globalMustNotInfer),
    cases: [...manifest.cases]
      .sort(({ caseId: left }, { caseId: right }) => left.localeCompare(right))
      .map((entry) => ({
        ...entry,
        sourceMarkers: sortedStrings(entry.sourceMarkers),
        expectedBranches: [...entry.expectedBranches]
          .map((branch) => ({
            ...branch,
            selector: canonicalizeManifestBranchSelector(branch.selector),
            effects: [...branch.effects].sort((left, right) =>
              `${left.kind}:${left.target}`.localeCompare(`${right.kind}:${right.target}`),
            ),
          }))
          .sort((left, right) =>
            `${jobQueueBranchSelectorKey(left.selector)}:${left.controlFlow}`.localeCompare(
              `${jobQueueBranchSelectorKey(right.selector)}:${right.controlFlow}`,
            ),
          ),
        mustEmit: sortedStrings(entry.mustEmit),
        mustNotEmit: sortedStrings(entry.mustNotEmit),
        mustNotInfer: sortedStrings(entry.mustNotInfer),
        counterpartCaseIds: sortedStrings(entry.counterpartCaseIds),
      })),
    review: {
      ...manifest.review,
      decisions: sortedStrings(manifest.review.decisions),
    },
  };
}

export function parseBullMqBranchGateManifest(value: unknown): BullMqBranchGateManifest {
  return canonicalizeBullMqBranchGateManifest(bullMqBranchGateManifestSchema.parse(value));
}

export function serializeBullMqBranchGateManifest(manifest: BullMqBranchGateManifest): string {
  return `${JSON.stringify(canonicalizeBullMqBranchGateManifest(manifest), null, 2)}\n`;
}
