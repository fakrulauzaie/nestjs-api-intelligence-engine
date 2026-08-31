import { z } from 'zod';
import {
  ANALYSIS_RESULT_STATES,
  GUARD_SCOPES,
  TABLE_ACCESS_DIRECTIONS,
  TRACE_CAUSAL_CLASSES,
} from '../model/analysis.js';
import { ASSERTION_PREDICATES, ASSERTION_STATUSES } from '../model/assertions.js';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITIES } from '../model/diagnostics.js';
import { HTTP_METHODS } from '../model/entities.js';
import {
  AUTHORIZATION_ENFORCEMENT_STATES,
  AUTHORIZATION_METADATA_SOURCES,
} from '../model/authorization.js';
import {
  HANDLER_REGISTRATION_STATES,
  INTERACTION_ACTIVATION_STATES,
  INTERACTION_BOUNDARY_STATES,
  INTERACTION_DISPATCH_TIMINGS,
  INTERACTION_KINDS,
} from '../model/interactions.js';
import {
  JOB_QUEUE_BRANCH_CONTROL_FLOWS,
  JOB_QUEUE_BRANCH_EFFECT_KINDS,
  JOB_QUEUE_HANDLER_DISPATCH_STATES,
} from '../model/job-queue-branches.js';
import {
  RESOURCE_KINDS,
  RESOURCE_OPERATIONS,
  RESOURCE_TECHNOLOGIES,
} from '../model/resource-access.js';
import {
  authorizationValueShapeSchema,
  jobQueueBranchSelectorSchema,
  stableIdSchema,
} from '../model/schemas.js';
import {
  DIAGNOSTIC_CHANGE_KINDS,
  DIAGNOSTIC_CHANGE_REASONS,
  DIFF_AMBIGUITY_KINDS,
  DIFF_AMBIGUITY_SIDES,
  DIFF_SCHEMA_VERSION,
  DIFF_SCHEMA_V2_VERSION,
  DIFF_SCHEMA_V3_VERSION,
  DIFF_SCHEMA_V4_VERSION,
  DIFF_SCHEMA_V5_VERSION,
  ENDPOINT_CHANGE_KINDS,
  ENDPOINT_CHANGE_REASONS,
  FACT_AVAILABILITY_STATES,
  INTERACTION_CHANGE_KINDS,
  INTERACTION_CHANGE_REASONS,
  INTERACTION_HANDLER_CHANGE_REASONS,
  JOB_QUEUE_BRANCH_FACT_CHANGE_REASONS,
  type DiffDocument,
} from './model.js';
import { SEMANTIC_KEY_KINDS, semanticKeyIsCanonical, type SemanticKey } from './semantic-key.js';

const nonEmptyStringSchema = z.string().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const semanticKeySchema: z.ZodType<SemanticKey> = z
  .object({
    kind: z.enum(SEMANTIC_KEY_KINDS),
    components: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    encoded: nonEmptyStringSchema,
  })
  .strict()
  .refine(semanticKeyIsCanonical, 'Semantic key encoding does not match its tuple.');

const factAvailabilitySchema = z.enum(FACT_AVAILABILITY_STATES);
export const diffInputSnapshotSchema = z
  .object({
    analysisId: stableIdSchema,
    analysisSchemaVersion: nonEmptyStringSchema,
    resultState: z
      .enum(ANALYSIS_RESULT_STATES)
      .refine(
        (state) => state === 'completed' || state === 'completed_with_gaps',
        'Diff inputs must be completed analyses.',
      ),
    configuration: z
      .object({
        maxCallDepth: z.number().int().min(1).max(3),
        maxSourceFileBytes: z.number().int().positive(),
        evidenceSnippetLimit: z.number().int().positive(),
      })
      .strict(),
    facts: z
      .object({
        directGuards: factAvailabilitySchema,
        effectiveGuards: factAvailabilitySchema,
        terminals: factAvailabilitySchema,
        assertions: factAvailabilitySchema,
        diagnostics: factAvailabilitySchema,
        authorization: factAvailabilitySchema.optional(),
        resourceAccesses: factAvailabilitySchema.optional(),
      })
      .strict(),
  })
  .strict();

const handlerFactSchema = z
  .object({
    methodId: stableIdSchema.nullable(),
    methodKey: semanticKeySchema.nullable(),
    qualifiedName: nonEmptyStringSchema.nullable(),
    status: z.enum(ASSERTION_STATUSES),
    ruleId: nonEmptyStringSchema,
    assertionId: stableIdSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const guardFactSchema = z
  .object({
    guardId: stableIdSchema,
    guardKey: semanticKeySchema,
    name: nonEmptyStringSchema,
    scope: z.enum(GUARD_SCOPES),
    status: z.enum(ASSERTION_STATUSES),
    ruleId: nonEmptyStringSchema,
    assertionId: stableIdSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const terminalContributorSchema = z
  .object({
    methodId: stableIdSchema,
    methodKey: semanticKeySchema,
    assertionId: stableIdSchema,
    status: z.enum(ASSERTION_STATUSES),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const terminalFactSchema = z
  .object({
    key: semanticKeySchema,
    direction: z.enum(TABLE_ACCESS_DIRECTIONS),
    tableId: stableIdSchema,
    tableKey: semanticKeySchema,
    tableName: nonEmptyStringSchema,
    status: z.enum(['resolved', 'ambiguous']),
    contributors: z.array(terminalContributorSchema).min(1),
  })
  .strict();

const resourceAccessFactSchema = z
  .object({
    resourceAccessId: stableIdSchema,
    key: semanticKeySchema,
    resourceKind: z.enum(RESOURCE_KINDS),
    operation: z.enum(RESOURCE_OPERATIONS),
    technology: z.enum(RESOURCE_TECHNOLOGIES),
    api: nonEmptyStringSchema,
    targetKey: nonEmptyStringSchema,
    selectorKey: nonEmptyStringSchema.nullable(),
    causalClass: z.enum(TRACE_CAUSAL_CLASSES),
  })
  .strict();

const authorizationFactSchema = z
  .object({
    metadataId: stableIdSchema,
    enforcementId: stableIdSchema,
    metadataKey: nonEmptyStringSchema,
    scope: z.enum(['controller', 'method']),
    source: z.enum(AUTHORIZATION_METADATA_SOURCES),
    valueShape: authorizationValueShapeSchema,
    enforcementState: z.enum(AUTHORIZATION_ENFORCEMENT_STATES),
    guardKey: semanticKeySchema.nullable(),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const endpointSnapshotSchema = z
  .object({
    endpointId: stableIdSchema,
    httpMethod: z.enum(HTTP_METHODS),
    path: z.string().startsWith('/'),
    routeSlotKey: semanticKeySchema,
    exactKey: semanticKeySchema.nullable(),
    identityStatus: z.enum(['resolved', 'ambiguous', 'unresolved']),
    handlers: z.array(handlerFactSchema),
    directGuards: z
      .object({ availability: factAvailabilitySchema, guards: z.array(guardFactSchema) })
      .strict(),
    effectiveGuards: z
      .object({ availability: factAvailabilitySchema, guards: z.array(guardFactSchema) })
      .strict(),
    terminals: z
      .object({ availability: factAvailabilitySchema, values: z.array(terminalFactSchema) })
      .strict(),
    authorization: z
      .object({
        availability: factAvailabilitySchema,
        requirements: z.array(authorizationFactSchema),
      })
      .strict()
      .optional(),
    resourceAccesses: z
      .object({
        availability: factAvailabilitySchema,
        values: z.array(resourceAccessFactSchema),
      })
      .strict()
      .optional(),
  })
  .strict();

const endpointChangeSchema = z
  .object({
    change: z.enum(ENDPOINT_CHANGE_KINDS),
    routeSlotKey: semanticKeySchema,
    reasons: z.array(z.enum(ENDPOINT_CHANGE_REASONS)).min(1),
    before: endpointSnapshotSchema.nullable(),
    after: endpointSnapshotSchema.nullable(),
  })
  .strict();

const assertionSnapshotSchema = z
  .object({
    assertionId: stableIdSchema,
    key: semanticKeySchema,
    subjectKey: semanticKeySchema,
    predicate: z.enum(ASSERTION_PREDICATES),
    objectKey: semanticKeySchema.nullable(),
    status: z.enum(ASSERTION_STATUSES),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const assertionStatusChangeSchema = z
  .object({
    key: semanticKeySchema,
    before: assertionSnapshotSchema,
    after: assertionSnapshotSchema,
  })
  .strict();

const diagnosticSnapshotSchema = z
  .object({
    diagnosticId: stableIdSchema,
    key: semanticKeySchema,
    code: z.enum(DIAGNOSTIC_CODES),
    severity: z.enum(DIAGNOSTIC_SEVERITIES),
    message: nonEmptyStringSchema,
    subjectKey: semanticKeySchema.nullable(),
    evidenceIds: z.array(stableIdSchema),
    evidenceKeys: z.array(semanticKeySchema),
  })
  .strict();

const diagnosticChangeSchema = z
  .object({
    change: z.enum(DIAGNOSTIC_CHANGE_KINDS),
    key: semanticKeySchema,
    reasons: z.array(z.enum(DIAGNOSTIC_CHANGE_REASONS)).min(1),
    before: diagnosticSnapshotSchema.nullable(),
    after: diagnosticSnapshotSchema.nullable(),
  })
  .strict();

const interactionSnapshotSchema = z
  .object({
    interactionId: stableIdSchema,
    key: semanticKeySchema,
    kind: z.enum(INTERACTION_KINDS),
    sourceMethodKey: semanticKeySchema,
    targetKey: nonEmptyStringSchema,
    applicationKey: semanticKeySchema.nullable(),
    activation: z.enum(INTERACTION_ACTIVATION_STATES),
    boundary: z.enum(INTERACTION_BOUNDARY_STATES),
    dispatchTiming: z.enum(INTERACTION_DISPATCH_TIMINGS),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const interactionHandlerSnapshotSchema = z
  .object({
    handlerId: stableIdSchema,
    key: semanticKeySchema,
    kind: z.enum(['in_process_event', 'job_queue', 'microservice_message']),
    methodKey: semanticKeySchema,
    targetKey: nonEmptyStringSchema,
    applicationKey: semanticKeySchema.nullable(),
    registrationState: z.enum(HANDLER_REGISTRATION_STATES),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const interactionChangeSchema = z
  .object({
    change: z.enum(INTERACTION_CHANGE_KINDS),
    key: semanticKeySchema,
    reasons: z.array(z.enum(INTERACTION_CHANGE_REASONS)).min(1),
    before: interactionSnapshotSchema.nullable(),
    after: interactionSnapshotSchema.nullable(),
  })
  .strict();

const interactionHandlerChangeSchema = z
  .object({
    change: z.enum(INTERACTION_CHANGE_KINDS),
    key: semanticKeySchema,
    reasons: z.array(z.enum(INTERACTION_HANDLER_CHANGE_REASONS)).min(1),
    before: interactionHandlerSnapshotSchema.nullable(),
    after: interactionHandlerSnapshotSchema.nullable(),
  })
  .strict();

const jobQueueDispatchSnapshotSchema = z
  .object({
    dispatchId: stableIdSchema,
    key: semanticKeySchema,
    handlerKey: semanticKeySchema,
    state: z.enum(JOB_QUEUE_HANDLER_DISPATCH_STATES),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const jobQueueBranchSnapshotSchema = z
  .object({
    branchId: stableIdSchema,
    key: semanticKeySchema,
    dispatchKey: semanticKeySchema,
    selector: jobQueueBranchSelectorSchema,
    controlFlow: z.enum(JOB_QUEUE_BRANCH_CONTROL_FLOWS),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const jobQueueBranchEffectSnapshotSchema = z
  .object({
    effectId: stableIdSchema,
    key: semanticKeySchema,
    branchKey: semanticKeySchema,
    kind: z.enum(JOB_QUEUE_BRANCH_EFFECT_KINDS),
    targetKey: semanticKeySchema,
    sourceAssertionKey: semanticKeySchema,
    status: z.enum(['resolved', 'ambiguous']),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

function jobQueueFactChangeSchema<T extends z.ZodTypeAny>(snapshot: T) {
  return z
    .object({
      change: z.enum(INTERACTION_CHANGE_KINDS),
      key: semanticKeySchema,
      reasons: z.array(z.enum(JOB_QUEUE_BRANCH_FACT_CHANGE_REASONS)).min(1),
      before: snapshot.nullable(),
      after: snapshot.nullable(),
    })
    .strict();
}

const jobQueueDispatchChangeSchema = jobQueueFactChangeSchema(jobQueueDispatchSnapshotSchema);
const jobQueueBranchChangeSchema = jobQueueFactChangeSchema(jobQueueBranchSnapshotSchema);
const jobQueueBranchEffectChangeSchema = jobQueueFactChangeSchema(
  jobQueueBranchEffectSnapshotSchema,
);

const ambiguitySchema = z
  .object({
    kind: z.enum(DIFF_AMBIGUITY_KINDS),
    side: z.enum(DIFF_AMBIGUITY_SIDES),
    recordKind: nonEmptyStringSchema,
    key: semanticKeySchema,
    beforeCandidateIds: z.array(stableIdSchema),
    afterCandidateIds: z.array(stableIdSchema),
  })
  .strict();

const summarySchema = z
  .object({
    endpointsAdded: nonNegativeIntegerSchema,
    endpointsRemoved: nonNegativeIntegerSchema,
    endpointsModified: nonNegativeIntegerSchema,
    assertionStatusChanged: nonNegativeIntegerSchema,
    diagnosticsNew: nonNegativeIntegerSchema,
    diagnosticsResolved: nonNegativeIntegerSchema,
    diagnosticsChanged: nonNegativeIntegerSchema,
    ambiguities: nonNegativeIntegerSchema,
    interactionsAdded: nonNegativeIntegerSchema.optional(),
    interactionsRemoved: nonNegativeIntegerSchema.optional(),
    interactionsModified: nonNegativeIntegerSchema.optional(),
    interactionHandlersAdded: nonNegativeIntegerSchema.optional(),
    interactionHandlersRemoved: nonNegativeIntegerSchema.optional(),
    interactionHandlersModified: nonNegativeIntegerSchema.optional(),
    jobQueueDispatchesAdded: nonNegativeIntegerSchema.optional(),
    jobQueueDispatchesRemoved: nonNegativeIntegerSchema.optional(),
    jobQueueDispatchesModified: nonNegativeIntegerSchema.optional(),
    jobQueueBranchesAdded: nonNegativeIntegerSchema.optional(),
    jobQueueBranchesRemoved: nonNegativeIntegerSchema.optional(),
    jobQueueBranchesModified: nonNegativeIntegerSchema.optional(),
    jobQueueBranchEffectsAdded: nonNegativeIntegerSchema.optional(),
    jobQueueBranchEffectsRemoved: nonNegativeIntegerSchema.optional(),
    jobQueueBranchEffectsModified: nonNegativeIntegerSchema.optional(),
  })
  .strict();

export const diffDocumentSchema: z.ZodType<DiffDocument> = z
  .object({
    schemaVersion: z.enum([
      DIFF_SCHEMA_VERSION,
      DIFF_SCHEMA_V2_VERSION,
      DIFF_SCHEMA_V3_VERSION,
      DIFF_SCHEMA_V4_VERSION,
      DIFF_SCHEMA_V5_VERSION,
    ]),
    before: diffInputSnapshotSchema,
    after: diffInputSnapshotSchema,
    summary: summarySchema,
    endpointChanges: z.array(endpointChangeSchema),
    assertionStatusChanges: z.array(assertionStatusChangeSchema),
    diagnosticChanges: z.array(diagnosticChangeSchema),
    interactionChanges: z.array(interactionChangeSchema).optional(),
    interactionHandlerChanges: z.array(interactionHandlerChangeSchema).optional(),
    jobQueueDispatchChanges: z.array(jobQueueDispatchChangeSchema).optional(),
    jobQueueBranchChanges: z.array(jobQueueBranchChangeSchema).optional(),
    jobQueueBranchEffectChanges: z.array(jobQueueBranchEffectChangeSchema).optional(),
    ambiguities: z.array(ambiguitySchema),
  })
  .strict()
  .superRefine((document, context) => {
    const v2Fields = [
      document.interactionChanges,
      document.interactionHandlerChanges,
      document.summary.interactionsAdded,
      document.summary.interactionsRemoved,
      document.summary.interactionsModified,
      document.summary.interactionHandlersAdded,
      document.summary.interactionHandlersRemoved,
      document.summary.interactionHandlersModified,
    ];
    const hasInteractionDiff =
      document.schemaVersion === DIFF_SCHEMA_V2_VERSION ||
      document.schemaVersion === DIFF_SCHEMA_V3_VERSION ||
      document.schemaVersion === DIFF_SCHEMA_V4_VERSION ||
      document.schemaVersion === DIFF_SCHEMA_V5_VERSION;
    if (
      hasInteractionDiff
        ? v2Fields.some((value) => value === undefined)
        : v2Fields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Diff schema v2-v5 requires interaction changes; schema v1 must omit them.',
      });
    }
    if (
      document.schemaVersion !== DIFF_SCHEMA_V5_VERSION &&
      document.jobQueueBranchEffectChanges?.some((change) =>
        [change.before, change.after].some((snapshot) => snapshot?.kind === 'accesses_resource'),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only diff schema v5 may contain resource-access branch effects.',
      });
    }
    const v3Fields = [
      document.jobQueueDispatchChanges,
      document.jobQueueBranchChanges,
      document.jobQueueBranchEffectChanges,
      document.summary.jobQueueDispatchesAdded,
      document.summary.jobQueueDispatchesRemoved,
      document.summary.jobQueueDispatchesModified,
      document.summary.jobQueueBranchesAdded,
      document.summary.jobQueueBranchesRemoved,
      document.summary.jobQueueBranchesModified,
      document.summary.jobQueueBranchEffectsAdded,
      document.summary.jobQueueBranchEffectsRemoved,
      document.summary.jobQueueBranchEffectsModified,
    ];
    if (
      document.schemaVersion === DIFF_SCHEMA_V3_VERSION ||
      document.schemaVersion === DIFF_SCHEMA_V4_VERSION ||
      document.schemaVersion === DIFF_SCHEMA_V5_VERSION
        ? v3Fields.some((value) => value === undefined)
        : v3Fields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Diff schema v3-v5 requires branch changes; schema v1/v2 must omit them.',
      });
    }
    const hasAuthorizationDiff =
      document.schemaVersion === DIFF_SCHEMA_V4_VERSION ||
      document.schemaVersion === DIFF_SCHEMA_V5_VERSION;
    const authorizationFields = [
      document.before.facts.authorization,
      document.after.facts.authorization,
    ];
    const endpointAuthorizationMismatch = document.endpointChanges.some((change) =>
      hasAuthorizationDiff
        ? (change.before !== null && change.before.authorization === undefined) ||
          (change.after !== null && change.after.authorization === undefined)
        : change.before?.authorization !== undefined || change.after?.authorization !== undefined,
    );
    if (
      (hasAuthorizationDiff
        ? authorizationFields.some((value) => value === undefined)
        : authorizationFields.some((value) => value !== undefined)) ||
      endpointAuthorizationMismatch
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Diff schema v4 requires authorization availability and endpoint facts; earlier schemas must omit them.',
      });
    }
    const hasResourceAccessDiff = document.schemaVersion === DIFF_SCHEMA_V5_VERSION;
    const resourceAvailabilityFields = [
      document.before.facts.resourceAccesses,
      document.after.facts.resourceAccesses,
    ];
    const endpointResourceMismatch = document.endpointChanges.some((change) =>
      hasResourceAccessDiff
        ? (change.before !== null && change.before.resourceAccesses === undefined) ||
          (change.after !== null && change.after.resourceAccesses === undefined)
        : change.before?.resourceAccesses !== undefined ||
          change.after?.resourceAccesses !== undefined,
    );
    if (
      (hasResourceAccessDiff
        ? resourceAvailabilityFields.some((value) => value === undefined)
        : resourceAvailabilityFields.some((value) => value !== undefined)) ||
      endpointResourceMismatch
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Diff schema v5 requires resource-access availability and endpoint facts; earlier schemas must omit them.',
      });
    }
  }) as z.ZodType<DiffDocument>;
