import { z } from 'zod';
import { diffInputSnapshotSchema, semanticKeySchema } from '../comparison/schemas.js';
import { ASSERTION_PREDICATES, ASSERTION_STATUSES } from '../model/assertions.js';
import { HTTP_METHODS } from '../model/entities.js';
import {
  contentHashSchema,
  repositoryRelativePathSchema,
  stableIdSchema,
} from '../model/schemas.js';
import { SEMANTIC_KEY_KINDS } from '../comparison/semantic-key.js';
import {
  IMPACT_CATEGORIES,
  IMPACT_GRAPH_SIDES,
  IMPACT_REASON_CODES,
  IMPACT_SCHEMA_VERSION,
  SOURCE_CHANGE_KINDS,
  UNREACHABLE_REASON_CODES,
  type ImpactDocument,
} from './model.js';

const nonEmptyStringSchema = z.string().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();

const sourceSnapshotSchema = z
  .object({
    sourceFileId: stableIdSchema,
    path: repositoryRelativePathSchema,
    contentHash: contentHashSchema,
  })
  .strict();

const sourceChangeSchema = z
  .object({
    change: z.enum(SOURCE_CHANGE_KINDS),
    path: repositoryRelativePathSchema,
    before: sourceSnapshotSchema.nullable(),
    after: sourceSnapshotSchema.nullable(),
  })
  .strict();

const subjectSchema = z
  .object({
    kind: z.enum(SEMANTIC_KEY_KINDS),
    key: semanticKeySchema,
    displayName: nonEmptyStringSchema,
    sourcePath: repositoryRelativePathSchema.nullable(),
  })
  .strict();

const pathStepSchema = z
  .object({
    assertionId: stableIdSchema,
    fromId: stableIdSchema,
    fromKey: semanticKeySchema,
    predicate: z.enum(ASSERTION_PREDICATES),
    toId: stableIdSchema.nullable(),
    toKey: semanticKeySchema.nullable(),
    status: z.enum(ASSERTION_STATUSES),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const pathSchema = z
  .object({
    side: z.enum(IMPACT_GRAPH_SIDES),
    endpointId: stableIdSchema,
    targetKey: semanticKeySchema,
    steps: z.array(pathStepSchema),
  })
  .strict();

const reasonSchema = z
  .object({
    category: z.enum(IMPACT_CATEGORIES),
    reasonCode: z.enum(IMPACT_REASON_CODES),
    subject: subjectSchema,
    sourceChangePath: repositoryRelativePathSchema.nullable(),
    beforeEvidenceIds: z.array(stableIdSchema),
    afterEvidenceIds: z.array(stableIdSchema),
    paths: z.array(pathSchema).min(1),
  })
  .strict();

const impactedEndpointSchema = z
  .object({
    routeSlotKey: semanticKeySchema,
    httpMethod: z.enum(HTTP_METHODS),
    path: z.string().startsWith('/'),
    beforeEndpointIds: z.array(stableIdSchema),
    afterEndpointIds: z.array(stableIdSchema),
    direct: z.boolean(),
    reasons: z.array(reasonSchema).min(1),
  })
  .strict();

const unreachableSchema = z
  .object({
    path: repositoryRelativePathSchema,
    change: z.enum(SOURCE_CHANGE_KINDS),
    beforeSubjectKeys: z.array(semanticKeySchema),
    afterSubjectKeys: z.array(semanticKeySchema),
    reasonCodes: z.array(z.enum(UNREACHABLE_REASON_CODES)).min(1),
  })
  .strict();

const categoryCountsSchema = z
  .object({
    direct_endpoint_change: nonNegativeIntegerSchema,
    reachable_method_file_change: nonNegativeIntegerSchema,
    entity_declaration_file_change: nonNegativeIntegerSchema,
    table_access_fact_change: nonNegativeIntegerSchema,
    diagnostic_or_resolution_change: nonNegativeIntegerSchema,
    unknown_due_to_incomplete_trace: nonNegativeIntegerSchema,
  })
  .strict();

export const impactDocumentSchema: z.ZodType<ImpactDocument> = z
  .object({
    schemaVersion: z.literal(IMPACT_SCHEMA_VERSION),
    before: diffInputSnapshotSchema,
    after: diffInputSnapshotSchema,
    summary: z
      .object({
        sourceFilesAdded: nonNegativeIntegerSchema,
        sourceFilesRemoved: nonNegativeIntegerSchema,
        sourceFilesModified: nonNegativeIntegerSchema,
        impactedEndpointSlots: nonNegativeIntegerSchema,
        directlyChangedEndpointSlots: nonNegativeIntegerSchema,
        transitivelyImpactedEndpointSlots: nonNegativeIntegerSchema,
        unreachableSourceChanges: nonNegativeIntegerSchema,
        reasonsByCategory: categoryCountsSchema,
      })
      .strict(),
    sourceChanges: z.array(sourceChangeSchema),
    impactedEndpoints: z.array(impactedEndpointSchema),
    unreachableSourceChanges: z.array(unreachableSchema),
  })
  .strict() as z.ZodType<ImpactDocument>;
