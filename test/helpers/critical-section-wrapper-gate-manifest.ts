import { z } from 'zod';

export const CRITICAL_SECTION_WRAPPER_GATE_SCHEMA_VERSION = '1.0.0' as const;
export const CRITICAL_SECTION_WRAPPER_CASE_CLASSIFICATIONS = ['eligible', 'unsupported'] as const;
export const CRITICAL_SECTION_WRAPPER_FLOW_RELATIONS = [
  'forwarded_unchanged',
  'invoked_in_proven_section',
] as const;
export const CRITICAL_SECTION_WRAPPER_MUST_NOT_INFER = [
  'callback_invocation_guaranteed',
  'configured_name_proves_wrapper_identity',
  'critical_section_entered',
  'delayed_callback_runs_under_lock',
  'lock_acquired',
  'lock_release_completed',
  'method_reference_invoked',
  'mutual_exclusion_guaranteed',
  'outside_invocation_is_lock_scoped',
  'spread_argument_mapping',
  'technology_from_configuration',
  'transformed_callback_forwarding',
  'wrapper_cycle_reaches_terminal',
] as const;

const caseIdSchema = z.string().regex(/^csw0-[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const fixtureNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.ts\.txt$/u);
const sourceMarkerSchema = z
  .string()
  .regex(/^CSW0_(?:CASE|FLOW|NEGATIVE):[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const qualifiedMethodSchema = z.string().regex(/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/u);

const flowStepSchema = z
  .object({
    method: qualifiedMethodSchema,
    callbackParameterIndex: z.number().int().min(0).max(8),
    relation: z.enum(CRITICAL_SECTION_WRAPPER_FLOW_RELATIONS),
  })
  .strict();

const wrapperCaseSchema = z
  .object({
    caseId: caseIdSchema,
    fixture: fixtureNameSchema,
    classification: z.enum(CRITICAL_SECTION_WRAPPER_CASE_CLASSIFICATIONS),
    sourceMarkers: z.array(sourceMarkerSchema).min(1),
    entryMethod: qualifiedMethodSchema,
    callbackArgumentIndex: z.number().int().min(0).max(8),
    expectedFlow: z.array(flowStepSchema),
    expectedEffects: z.array(qualifiedMethodSchema),
    derivedTechnology: z.literal('redlock').nullable(),
    terminalApi: z.literal('Redlock.using').nullable(),
    diagnostic: z
      .enum(['CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN', 'CRITICAL_SECTION_WRAPPER_CYCLE_TRUNCATED'])
      .nullable(),
    counterpartCaseIds: z.array(caseIdSchema).min(1),
    mustNotInfer: z.array(z.enum(CRITICAL_SECTION_WRAPPER_MUST_NOT_INFER)).min(1),
    rationale: z.string().min(30),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.classification === 'eligible') {
      if (
        entry.expectedFlow.length === 0 ||
        entry.expectedEffects.length === 0 ||
        entry.derivedTechnology !== 'redlock' ||
        entry.terminalApi !== 'Redlock.using' ||
        entry.diagnostic !== null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['classification'],
          message: 'Eligible cases require a proven flow, effects, and Redlock terminal.',
        });
      }
    } else if (
      entry.expectedFlow.length !== 0 ||
      entry.expectedEffects.length !== 0 ||
      entry.derivedTechnology !== null ||
      entry.terminalApi !== null ||
      entry.diagnostic === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['classification'],
        message: 'Unsupported cases must remain effect-free and carry a diagnostic contract.',
      });
    }
  });

export const criticalSectionWrapperGateManifestSchema = z
  .object({
    schemaVersion: z.literal(CRITICAL_SECTION_WRAPPER_GATE_SCHEMA_VERSION),
    verifiedOn: z.iso.date(),
    compatibilityTarget: z
      .object({
        packages: z
          .array(
            z
              .object({
                name: z.enum(['@nestjs/common', '@nestjs/typeorm', 'redlock', 'typeorm']),
                version: z.string().min(1),
              })
              .strict(),
          )
          .length(4),
      })
      .strict(),
    schemaDecision: z
      .object({
        currentAnalysisVersion: z.literal('7.0.0'),
        targetAnalysisVersion: z.literal('8.0.0'),
        v7Frozen: z.literal(true),
        phaseW0PublishesWrapperFacts: z.literal(false),
      })
      .strict(),
    bounds: z
      .object({
        maxForwardingHops: z.number().int().min(1).max(8),
        unchangedPositionalParametersOnly: z.literal(true),
        inlineCallSiteCallbacksOnly: z.literal(true),
      })
      .strict(),
    requiredEvidenceRoles: z
      .array(
        z.enum([
          'call_site',
          'callback_argument',
          'callback_parameter',
          'parameter_forwarding',
          'callback_invocation',
          'redlock_terminal',
        ]),
      )
      .length(6),
    globalMustNotInfer: z.array(z.enum(CRITICAL_SECTION_WRAPPER_MUST_NOT_INFER)).min(1),
    cases: z.array(wrapperCaseSchema).min(2),
    realWorldBasis: z
      .object({
        repository: z.literal('ticket-service-example'),
        callerSourceFile: z.literal('src/modules/ntt/ntt.service.ts'),
        wrapperSourceFile: z.literal('src/modules/redis/redis-lock.service.ts'),
        entryMethod: z.literal('NttService.resolveTicket'),
        wrapperChain: z.tuple([
          z.literal('RedisLockService.executeWithNttLock'),
          z.literal('RedisLockService.executeWithLock'),
          z.literal('Redlock.using'),
        ]),
        callbackArgumentIndex: z.literal(1),
      })
      .strict(),
    review: z
      .object({
        semanticStatus: z.literal('approved'),
        extractorImplementationPresent: z.literal(false),
        nextPhase: z.literal('W1'),
        decisions: z.array(z.string().min(30)).min(1),
      })
      .strict(),
  })
  .strict();

export type CriticalSectionWrapperGateManifest = z.infer<
  typeof criticalSectionWrapperGateManifestSchema
>;

function sortedStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalizeCriticalSectionWrapperGateManifest(
  manifest: CriticalSectionWrapperGateManifest,
): CriticalSectionWrapperGateManifest {
  return {
    ...manifest,
    compatibilityTarget: {
      packages: [...manifest.compatibilityTarget.packages].sort(({ name: left }, { name: right }) =>
        left.localeCompare(right),
      ),
    },
    requiredEvidenceRoles: sortedStrings(manifest.requiredEvidenceRoles),
    globalMustNotInfer: sortedStrings(manifest.globalMustNotInfer),
    cases: [...manifest.cases]
      .sort(({ caseId: left }, { caseId: right }) => left.localeCompare(right))
      .map((entry) => ({
        ...entry,
        sourceMarkers: sortedStrings(entry.sourceMarkers),
        expectedEffects: sortedStrings(entry.expectedEffects),
        counterpartCaseIds: sortedStrings(entry.counterpartCaseIds),
        mustNotInfer: sortedStrings(entry.mustNotInfer),
      })),
    review: {
      ...manifest.review,
      decisions: sortedStrings(manifest.review.decisions),
    },
  };
}

export function parseCriticalSectionWrapperGateManifest(
  value: unknown,
): CriticalSectionWrapperGateManifest {
  return canonicalizeCriticalSectionWrapperGateManifest(
    criticalSectionWrapperGateManifestSchema.parse(value),
  );
}

export function serializeCriticalSectionWrapperGateManifest(
  manifest: CriticalSectionWrapperGateManifest,
): string {
  return `${JSON.stringify(canonicalizeCriticalSectionWrapperGateManifest(manifest), null, 2)}\n`;
}
