import { z } from 'zod';
import {
  ANALYSIS_RESULT_STATES,
  GUARD_SCOPES,
  TABLE_ACCESS_DIRECTIONS,
} from '../model/analysis.js';
import { ASSERTION_PREDICATES, ASSERTION_STATUSES } from '../model/assertions.js';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITIES } from '../model/diagnostics.js';
import { HTTP_METHODS } from '../model/entities.js';
import {
  HANDLER_REGISTRATION_STATES,
  INTERACTION_ACTIVATION_STATES,
  INTERACTION_BOUNDARY_STATES,
  INTERACTION_DISPATCH_TIMINGS,
  INTERACTION_KINDS,
} from '../model/interactions.js';
import { stableIdSchema } from '../model/schemas.js';
import {
  DIAGNOSTIC_CHANGE_KINDS,
  DIAGNOSTIC_CHANGE_REASONS,
  DIFF_AMBIGUITY_KINDS,
  DIFF_AMBIGUITY_SIDES,
  DIFF_SCHEMA_VERSION,
  DIFF_SCHEMA_V2_VERSION,
  ENDPOINT_CHANGE_KINDS,
  ENDPOINT_CHANGE_REASONS,
  FACT_AVAILABILITY_STATES,
  INTERACTION_CHANGE_KINDS,
  INTERACTION_CHANGE_REASONS,
  INTERACTION_HANDLER_CHANGE_REASONS,
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
  })
  .strict();

export const diffDocumentSchema: z.ZodType<DiffDocument> = z
  .object({
    schemaVersion: z.enum([DIFF_SCHEMA_VERSION, DIFF_SCHEMA_V2_VERSION]),
    before: diffInputSnapshotSchema,
    after: diffInputSnapshotSchema,
    summary: summarySchema,
    endpointChanges: z.array(endpointChangeSchema),
    assertionStatusChanges: z.array(assertionStatusChangeSchema),
    diagnosticChanges: z.array(diagnosticChangeSchema),
    interactionChanges: z.array(interactionChangeSchema).optional(),
    interactionHandlerChanges: z.array(interactionHandlerChangeSchema).optional(),
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
    if (
      document.schemaVersion === DIFF_SCHEMA_V2_VERSION
        ? v2Fields.some((value) => value === undefined)
        : v2Fields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Diff schema v2 requires interaction changes; schema v1 must omit them.',
      });
    }
  }) as z.ZodType<DiffDocument>;
