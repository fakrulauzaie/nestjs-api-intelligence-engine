import { z } from 'zod';
import {
  ANALYSIS_RESULT_STATES,
  ANALYSIS_SCHEMA_V1_VERSION,
  ANALYSIS_SCHEMA_V2_VERSION,
  ANALYSIS_SCHEMA_V3_VERSION,
  DIRECT_GUARD_STATES,
  EFFECTIVE_GUARD_STATES,
  GLOBAL_ANALYSIS_COMPLETENESS_STATES,
  GLOBAL_GUARD_STATES,
  GUARD_SCOPES,
  PROJECT_CONFIGURATION_SOURCE_KINDS,
  TABLE_ACCESS_DIRECTIONS,
  TRACE_CAUSAL_CLASSES,
  type AnalysisDocument,
  type EndpointTraceView,
  type InteractionHandlerTraceView,
  type RunDocument,
} from './analysis.js';
import {
  ASSERTION_PREDICATES,
  ASSERTION_PREDICATES_V1,
  ASSERTION_PREDICATES_V2,
  ASSERTION_STATUSES,
} from './assertions.js';
import {
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_CODES_V1,
  DIAGNOSTIC_CODES_V2,
  DIAGNOSTIC_SEVERITIES,
} from './diagnostics.js';
import {
  CLASS_ROLES,
  CLASS_ROLES_V1,
  COLUMN_INFLUENCE_SINK_KINDS,
  COLUMN_INFLUENCE_STATES,
  CONTRACT_DECLARATION_KINDS,
  CONTRACT_SHAPE_SOURCES,
  DATABASE_COLUMN_NAME_SOURCES,
  DECLARED_TYPE_KINDS,
  DECLARED_TYPE_SOURCES,
  ENTITY_COLUMN_KINDS,
  GLOBAL_GUARD_REGISTRATION_KINDS,
  HTTP_METHODS,
  MODULE_METADATA_COMPLETENESS_STATES,
  RAW_SQL_DIALECTS,
  REQUEST_SELECTOR_STATES,
  REQUEST_FIELD_ORIGIN_RESOLUTIONS,
  REQUEST_SOURCE_KINDS,
  RESPONSE_HANDLING_KINDS,
  TABLE_NAME_SOURCES,
  TABLE_NAME_SOURCES_V1,
  TRANSFORMER_PRESENCE_STATES,
} from './entities.js';
import { EVIDENCE_ROLES } from './evidence.js';
import {
  APPLICATION_KINDS,
  APPLICATION_ROOT_RESOLUTIONS,
  APPLICATION_TRANSPORT_STATES,
  EVENT_IDENTITY_KINDS,
  HANDLER_REGISTRATION_STATES,
  INTERACTION_ACTIVATION_STATES,
  INTERACTION_ANALYSIS_STATES,
  INTERACTION_BOUNDARY_STATES,
  INTERACTION_DISPATCH_TIMINGS,
  INTERACTION_KINDS,
  JOB_QUEUE_TECHNOLOGIES,
  MICROSERVICE_MESSAGE_MODES,
  MICROSERVICE_PATTERN_KINDS,
  NEST_MICROSERVICE_TRANSPORTS,
  OUTBOUND_HTTP_METHODS,
  TEXT_TARGET_RESOLUTIONS,
  validInProcessEventPattern,
} from './interactions.js';
import { isNormalizedRepositoryRelativePath } from './paths.js';
import { normalizedPolicyRuleConfigurationSchema } from '../policy/rule-config.js';

export const stableIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*:[a-f0-9]{32}$/, 'Expected a stable kind-prefixed ID.');

export const contentHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'Expected a SHA-256 content hash.');

export const repositoryRelativePathSchema = z
  .string()
  .refine(isNormalizedRepositoryRelativePath, 'Expected a normalized repository-relative path.');

const nonEmptyStringSchema = z.string().min(1);
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const toolMetadataSchema = z
  .object({
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
    typescriptVersion: nonEmptyStringSchema,
  })
  .strict();

const analysisConfigurationV1Schema = z
  .object({
    maxCallDepth: z.number().int().min(1).max(3),
    maxSourceFileBytes: positiveIntegerSchema,
    evidenceSnippetLimit: positiveIntegerSchema,
  })
  .strict();

const rawSqlAnalysisConfigurationSchema = z
  .object({
    dialect: z.enum(RAW_SQL_DIALECTS),
    parserName: z.literal('libpg-query'),
    parserVersion: z.literal('18.1.2'),
    maxSqlBytes: z.number().int().min(256).max(262_144),
    maxStatements: z.number().int().min(1).max(32),
    maxParseTimeMs: z.number().int().min(10).max(5_000),
    maxAstNodes: z.number().int().min(100).max(100_000),
  })
  .strict();

const analysisConfigurationV2Schema = analysisConfigurationV1Schema.extend({
  rawSql: rawSqlAnalysisConfigurationSchema.optional(),
});

export const interactionTraversalConfigurationSchema = z
  .object({
    maxInteractionHops: z.number().int().min(0).max(8),
    maxFanOutPerInteraction: z.number().int().min(1).max(1_000),
    maxInteractionTraceStates: z.number().int().min(10).max(10_000),
  })
  .strict();

export const analysisConfigurationSchema = analysisConfigurationV2Schema.extend({
  interactions: interactionTraversalConfigurationSchema,
});

const analysisRunRecordV1Schema = z
  .object({
    id: stableIdSchema,
    repositoryRevision: z.string().min(1).nullable(),
    tsconfigPath: repositoryRelativePathSchema,
    tool: toolMetadataSchema,
    configuration: analysisConfigurationV1Schema,
  })
  .strict();

const analysisRunRecordV2Schema = z
  .object({
    id: stableIdSchema,
    repositoryRevision: z.string().min(1).nullable(),
    tsconfigPath: repositoryRelativePathSchema,
    tool: toolMetadataSchema,
    configuration: analysisConfigurationV2Schema,
  })
  .strict();

export const analysisRunRecordSchema = analysisRunRecordV2Schema.extend({
  configuration: analysisConfigurationSchema,
});

export const sourceFileRecordSchema = z
  .object({
    id: stableIdSchema,
    path: repositoryRelativePathSchema,
    contentHash: contentHashSchema,
    byteLength: nonNegativeIntegerSchema,
  })
  .strict();

export const classRecordSchema = z
  .object({
    id: stableIdSchema,
    sourceFileId: stableIdSchema,
    qualifiedName: nonEmptyStringSchema,
    displayName: nonEmptyStringSchema,
    roles: z.array(z.enum(CLASS_ROLES)),
    declarationEvidenceId: stableIdSchema,
  })
  .strict();

const classRecordV1Schema = classRecordSchema.extend({ roles: z.array(z.enum(CLASS_ROLES_V1)) });

export const methodRecordSchema = z
  .object({
    id: stableIdSchema,
    classId: stableIdSchema,
    qualifiedName: nonEmptyStringSchema,
    displayName: nonEmptyStringSchema,
    signature: nonEmptyStringSchema,
    declarationEvidenceId: stableIdSchema,
  })
  .strict();

export const endpointRecordSchema = z
  .object({
    id: stableIdSchema,
    httpMethod: z.enum(HTTP_METHODS),
    path: z.string().startsWith('/'),
  })
  .strict();

export const guardRecordSchema = z
  .object({
    id: stableIdSchema,
    classId: stableIdSchema,
    displayName: nonEmptyStringSchema,
  })
  .strict();

export const repositoryBindingRecordSchema = z
  .object({
    id: stableIdSchema,
    ownerClassId: stableIdSchema,
    memberName: nonEmptyStringSchema,
    declarationEvidenceId: stableIdSchema,
  })
  .strict();

export const typeOrmEntityRecordSchema = z
  .object({
    id: stableIdSchema,
    classId: stableIdSchema,
    displayName: nonEmptyStringSchema,
  })
  .strict();

export const tableRecordSchema = z
  .object({
    id: stableIdSchema,
    name: nonEmptyStringSchema,
    nameSource: z.enum(TABLE_NAME_SOURCES),
  })
  .strict();

const tableRecordV1Schema = tableRecordSchema.extend({
  nameSource: z.enum(TABLE_NAME_SOURCES_V1),
});

export const assertionRecordSchema = z
  .object({
    id: stableIdSchema,
    subjectId: stableIdSchema,
    predicate: z.enum(ASSERTION_PREDICATES),
    objectId: stableIdSchema.nullable(),
    status: z.enum(ASSERTION_STATUSES),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const assertionRecordV1Schema = assertionRecordSchema.extend({
  predicate: z.enum(ASSERTION_PREDICATES_V1),
});

const assertionRecordV2Schema = assertionRecordSchema.extend({
  predicate: z.enum(ASSERTION_PREDICATES_V2),
});

export const evidenceRecordSchema = z
  .object({
    id: stableIdSchema,
    fileId: stableIdSchema,
    startLine: positiveIntegerSchema,
    startColumn: positiveIntegerSchema,
    endLine: positiveIntegerSchema,
    endColumn: positiveIntegerSchema,
    role: z.enum(EVIDENCE_ROLES),
    snippet: z.string().optional(),
    contentHash: contentHashSchema,
  })
  .strict();

export const diagnosticRecordSchema = z
  .object({
    id: stableIdSchema,
    code: z.enum(DIAGNOSTIC_CODES),
    severity: z.enum(DIAGNOSTIC_SEVERITIES),
    message: nonEmptyStringSchema,
    subjectId: stableIdSchema.optional(),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const diagnosticRecordV1Schema = diagnosticRecordSchema.extend({
  code: z.enum(DIAGNOSTIC_CODES_V1),
});

const diagnosticRecordV2Schema = diagnosticRecordSchema.extend({
  code: z.enum(DIAGNOSTIC_CODES_V2),
});

export const moduleRecordSchema = z
  .object({
    id: stableIdSchema,
    classId: stableIdSchema,
    isGlobal: z.boolean(),
    metadataCompleteness: z.enum(MODULE_METADATA_COMPLETENESS_STATES),
    declarationEvidenceId: stableIdSchema,
  })
  .strict();

export const globalGuardRegistrationRecordSchema = z
  .object({
    id: stableIdSchema,
    guardId: stableIdSchema,
    moduleId: stableIdSchema,
    kind: z.enum(GLOBAL_GUARD_REGISTRATION_KINDS),
    order: nonNegativeIntegerSchema,
    assertionId: stableIdSchema,
    registrationEvidenceId: stableIdSchema,
  })
  .strict();

export const contractTypeRecordSchema = z
  .object({
    id: stableIdSchema,
    sourceFileId: stableIdSchema,
    qualifiedName: nonEmptyStringSchema,
    displayName: nonEmptyStringSchema,
    declarationKind: z.enum(CONTRACT_DECLARATION_KINDS),
    shapeSource: z.enum(CONTRACT_SHAPE_SOURCES),
    declarationEvidenceId: stableIdSchema,
  })
  .strict();

const declaredConstraintSchema = z
  .object({
    name: nonEmptyStringSchema,
    argumentTexts: z.array(z.string()),
    decoratorEvidenceId: stableIdSchema,
  })
  .strict();

export const contractFieldRecordSchema = z
  .object({
    id: stableIdSchema,
    contractTypeId: stableIdSchema,
    declaringContractTypeId: stableIdSchema.nullable(),
    name: nonEmptyStringSchema,
    typeText: nonEmptyStringSchema,
    optional: z.boolean(),
    readonly: z.boolean(),
    inherited: z.boolean(),
    shapeSource: z.enum(CONTRACT_SHAPE_SOURCES),
    declarationEvidenceId: stableIdSchema.nullable(),
    declaredConstraints: z.array(declaredConstraintSchema),
  })
  .strict();

const declaredTypeShapeSchema = z
  .object({
    typeText: nonEmptyStringSchema,
    kind: z.enum(DECLARED_TYPE_KINDS),
    source: z.enum(DECLARED_TYPE_SOURCES),
    alternatives: z.array(nonEmptyStringSchema),
    contractTypeIds: z.array(stableIdSchema),
  })
  .strict();

export const requestParameterRecordSchema = z
  .object({
    id: stableIdSchema,
    methodId: stableIdSchema,
    parameterIndex: nonNegativeIntegerSchema,
    parameterName: nonEmptyStringSchema,
    sourceKind: z.enum(REQUEST_SOURCE_KINDS),
    selector: z.string().nullable(),
    selectorState: z.enum(REQUEST_SELECTOR_STATES),
    optional: z.boolean(),
    declaredType: declaredTypeShapeSchema,
    declarationEvidenceId: stableIdSchema,
    decoratorEvidenceId: stableIdSchema,
  })
  .strict();

export const responseContractRecordSchema = z
  .object({
    id: stableIdSchema,
    methodId: stableIdSchema,
    handling: z.enum(RESPONSE_HANDLING_KINDS),
    outerTypeText: nonEmptyStringSchema,
    promiseUnwrapped: z.boolean(),
    declaredType: declaredTypeShapeSchema,
    declarationEvidenceId: stableIdSchema,
    manualResponseEvidenceId: stableIdSchema.nullable(),
  })
  .strict();

export const entityColumnRecordSchema = z
  .object({
    id: stableIdSchema,
    entityId: stableIdSchema,
    declaringClassId: stableIdSchema,
    propertyName: nonEmptyStringSchema,
    databaseName: nonEmptyStringSchema.nullable(),
    databaseNameSource: z.enum(DATABASE_COLUMN_NAME_SOURCES),
    columnKind: z.enum(ENTITY_COLUMN_KINDS),
    insert: z.boolean().nullable(),
    update: z.boolean().nullable(),
    transformer: z.enum(TRANSFORMER_PRESENCE_STATES),
    inherited: z.boolean(),
    declarationEvidenceId: stableIdSchema,
    decoratorEvidenceId: stableIdSchema,
  })
  .strict();

export const requestFieldOriginRecordSchema = z
  .object({
    id: stableIdSchema,
    requestParameterId: stableIdSchema,
    propertyPath: z.array(nonEmptyStringSchema).min(1).max(1),
    contractFieldIds: z.array(stableIdSchema),
    resolution: z.enum(REQUEST_FIELD_ORIGIN_RESOLUTIONS),
    originEvidenceId: stableIdSchema,
  })
  .strict();

export const columnInfluenceRecordSchema = z
  .object({
    id: stableIdSchema,
    methodId: stableIdSchema,
    originId: stableIdSchema,
    columnId: stableIdSchema,
    state: z.enum(COLUMN_INFLUENCE_STATES),
    sinkKind: z.enum(COLUMN_INFLUENCE_SINK_KINDS),
    sinkPropertyName: nonEmptyStringSchema,
    assertionId: stableIdSchema,
    sinkEvidenceId: stableIdSchema,
    operationEvidenceId: stableIdSchema,
    propagationEvidenceIds: z.array(stableIdSchema),
    callPath: z.array(
      z
        .object({
          callerMethodId: stableIdSchema,
          calleeMethodId: stableIdSchema,
          callEvidenceId: stableIdSchema,
        })
        .strict(),
    ),
  })
  .strict();

const textInteractionTargetSchema = z
  .object({
    resolution: z.enum(TEXT_TARGET_RESOLUTIONS),
    value: nonEmptyStringSchema.nullable(),
  })
  .strict()
  .superRefine((target, context) => {
    if ((target.resolution === 'dynamic') !== (target.value === null)) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Only a dynamic text target may have a null value.',
      });
    }
  });

export const outboundHttpTargetSchema = z
  .object({
    targetKind: z.literal('http'),
    method: z.enum(OUTBOUND_HTTP_METHODS),
    url: textInteractionTargetSchema,
    queryKeys: z.array(nonEmptyStringSchema),
  })
  .strict();

export const inProcessEventTargetSchema = z
  .object({
    targetKind: z.literal('event'),
    identityKind: z.enum(EVENT_IDENTITY_KINDS),
    value: nonEmptyStringSchema.nullable(),
    pattern: z
      .object({
        kind: z.literal('wildcard'),
        delimiter: nonEmptyStringSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((target, context) => {
    if ((target.identityKind === 'dynamic') !== (target.value === null)) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Only a dynamic event identity may have a null value.',
      });
    }
    if (target.pattern !== undefined && target.identityKind !== 'string') {
      context.addIssue({
        code: 'custom',
        path: ['pattern'],
        message: 'Only a string event identity may carry a wildcard pattern.',
      });
    }
    if (
      target.pattern !== undefined &&
      target.value !== null &&
      !validInProcessEventPattern(target.value, target.pattern.delimiter)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pattern'],
        message: 'Wildcard event patterns must use complete * or ** namespace segments.',
      });
    }
  });

export const jobQueueTargetSchema = z
  .object({
    targetKind: z.literal('queue'),
    technology: z.enum(JOB_QUEUE_TECHNOLOGIES),
    queue: textInteractionTargetSchema,
    job: textInteractionTargetSchema,
  })
  .strict();

export const microserviceMessageTargetSchema = z
  .object({
    targetKind: z.literal('message'),
    mode: z.enum(MICROSERVICE_MESSAGE_MODES),
    patternKind: z.enum(MICROSERVICE_PATTERN_KINDS),
    canonicalPattern: nonEmptyStringSchema.nullable(),
    clientToken: textInteractionTargetSchema,
    transport: z.enum(NEST_MICROSERVICE_TRANSPORTS).nullable(),
  })
  .strict()
  .superRefine((target, context) => {
    if ((target.patternKind === 'dynamic') !== (target.canonicalPattern === null)) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalPattern'],
        message: 'Only a dynamic message pattern may have a null canonical pattern.',
      });
    }
  });

export const applicationRecordSchema = z
  .object({
    id: stableIdSchema,
    kind: z.enum(APPLICATION_KINDS),
    rootModuleId: stableIdSchema.nullable(),
    rootResolution: z.enum(APPLICATION_ROOT_RESOLUTIONS),
    transportState: z.enum(APPLICATION_TRANSPORT_STATES),
    transport: z.enum(NEST_MICROSERVICE_TRANSPORTS).nullable(),
    bootstrapEvidenceId: stableIdSchema,
  })
  .strict();

const interactionRecordBaseShape = {
  id: stableIdSchema,
  sourceMethodId: stableIdSchema,
  applicationId: stableIdSchema.nullable(),
  direction: z.literal('outbound'),
  activation: z.enum(INTERACTION_ACTIVATION_STATES),
  boundary: z.enum(INTERACTION_BOUNDARY_STATES),
  dispatchTiming: z.enum(INTERACTION_DISPATCH_TIMINGS),
  ruleId: nonEmptyStringSchema,
  evidenceIds: z.array(stableIdSchema).min(1),
} as const;

export const interactionRecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...interactionRecordBaseShape,
      kind: z.literal('outbound_http'),
      target: outboundHttpTargetSchema,
    })
    .strict(),
  z
    .object({
      ...interactionRecordBaseShape,
      kind: z.literal('in_process_event'),
      target: inProcessEventTargetSchema,
    })
    .strict(),
  z
    .object({
      ...interactionRecordBaseShape,
      kind: z.literal('job_queue'),
      target: jobQueueTargetSchema,
    })
    .strict(),
  z
    .object({
      ...interactionRecordBaseShape,
      kind: z.literal('microservice_message'),
      target: microserviceMessageTargetSchema,
    })
    .strict(),
]);

const interactionHandlerBaseShape = {
  id: stableIdSchema,
  methodId: stableIdSchema,
  applicationId: stableIdSchema.nullable(),
  registrationState: z.enum(HANDLER_REGISTRATION_STATES),
  ruleId: nonEmptyStringSchema,
  handlerEvidenceId: stableIdSchema,
} as const;

export const interactionHandlerRecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...interactionHandlerBaseShape,
      kind: z.literal('in_process_event'),
      target: inProcessEventTargetSchema,
      configurationEvidenceIds: z.array(stableIdSchema).min(1).optional(),
    })
    .strict(),
  z
    .object({
      ...interactionHandlerBaseShape,
      kind: z.literal('job_queue'),
      target: jobQueueTargetSchema,
    })
    .strict(),
  z
    .object({
      ...interactionHandlerBaseShape,
      kind: z.literal('microservice_message'),
      target: microserviceMessageTargetSchema,
    })
    .strict(),
]);

export const interactionAnalysisMetadataSchema = z
  .object({
    schemaKinds: z.array(z.enum(INTERACTION_KINDS)),
    supportedKinds: z.array(z.enum(INTERACTION_KINDS)),
    enabledKinds: z.array(z.enum(INTERACTION_KINDS)),
    state: z.enum(INTERACTION_ANALYSIS_STATES),
  })
  .strict();

const commonAnalysisShape = {
  resultState: z.enum(ANALYSIS_RESULT_STATES),
  sourceFiles: z.array(sourceFileRecordSchema),
  methods: z.array(methodRecordSchema),
  endpoints: z.array(endpointRecordSchema),
  guards: z.array(guardRecordSchema),
  repositoryBindings: z.array(repositoryBindingRecordSchema),
  entities: z.array(typeOrmEntityRecordSchema),
  evidence: z.array(evidenceRecordSchema),
} as const;

export const analysisDocumentV1Schema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_V1_VERSION),
    ...commonAnalysisShape,
    analysisRun: analysisRunRecordV1Schema,
    classes: z.array(classRecordV1Schema),
    tables: z.array(tableRecordV1Schema),
    assertions: z.array(assertionRecordV1Schema),
    diagnostics: z.array(diagnosticRecordV1Schema),
  })
  .strict();

export const analysisDocumentV2Schema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_V2_VERSION),
    ...commonAnalysisShape,
    analysisRun: analysisRunRecordV2Schema,
    classes: z.array(classRecordSchema),
    tables: z.array(tableRecordSchema),
    assertions: z.array(assertionRecordV2Schema),
    diagnostics: z.array(diagnosticRecordV2Schema),
    modules: z.array(moduleRecordSchema),
    globalGuardRegistrations: z.array(globalGuardRegistrationRecordSchema),
    contractTypes: z.array(contractTypeRecordSchema),
    contractFields: z.array(contractFieldRecordSchema),
    requestParameters: z.array(requestParameterRecordSchema),
    responseContracts: z.array(responseContractRecordSchema),
    entityColumns: z.array(entityColumnRecordSchema),
    requestFieldOrigins: z.array(requestFieldOriginRecordSchema),
    columnInfluences: z.array(columnInfluenceRecordSchema),
    globalGuardAnalysis: z
      .object({
        completeness: z.enum(GLOBAL_ANALYSIS_COMPLETENESS_STATES),
        state: z.enum(GLOBAL_GUARD_STATES),
      })
      .strict(),
  })
  .strict();

export const analysisDocumentV3Schema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_V3_VERSION),
    ...commonAnalysisShape,
    analysisRun: analysisRunRecordSchema,
    classes: z.array(classRecordSchema),
    tables: z.array(tableRecordSchema),
    assertions: z.array(assertionRecordSchema),
    diagnostics: z.array(diagnosticRecordSchema),
    modules: z.array(moduleRecordSchema),
    globalGuardRegistrations: z.array(globalGuardRegistrationRecordSchema),
    contractTypes: z.array(contractTypeRecordSchema),
    contractFields: z.array(contractFieldRecordSchema),
    requestParameters: z.array(requestParameterRecordSchema),
    responseContracts: z.array(responseContractRecordSchema),
    entityColumns: z.array(entityColumnRecordSchema),
    requestFieldOrigins: z.array(requestFieldOriginRecordSchema),
    columnInfluences: z.array(columnInfluenceRecordSchema),
    globalGuardAnalysis: z
      .object({
        completeness: z.enum(GLOBAL_ANALYSIS_COMPLETENESS_STATES),
        state: z.enum(GLOBAL_GUARD_STATES),
      })
      .strict(),
    applications: z.array(applicationRecordSchema),
    interactions: z.array(interactionRecordSchema),
    interactionHandlers: z.array(interactionHandlerRecordSchema),
    interactionAnalysis: interactionAnalysisMetadataSchema,
  })
  .strict();

export const analysisDocumentSchema: z.ZodType<AnalysisDocument> = z.discriminatedUnion(
  'schemaVersion',
  [analysisDocumentV1Schema, analysisDocumentV2Schema, analysisDocumentV3Schema],
) as z.ZodType<AnalysisDocument>;

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /[zZ]|[+-]\d{2}:\d{2}$/.test(value);
}

const commonRunShape = {
  analysisId: stableIdSchema,
  repositoryPath: nonEmptyStringSchema,
  repositoryRevision: z.string().min(1).nullable(),
  startedAt: z.string().refine(isIsoTimestamp, 'Expected an ISO-8601 timestamp with a zone.'),
  endedAt: z
    .string()
    .refine(isIsoTimestamp, 'Expected an ISO-8601 timestamp with a zone.')
    .optional(),
  durationMs: nonNegativeIntegerSchema.optional(),
  resultState: z.enum(ANALYSIS_RESULT_STATES),
  tool: toolMetadataSchema,
} as const;

const effectiveProjectConfigurationV2Schema = z
  .object({
    source: z.union([
      z
        .object({
          kind: z.literal('none'),
          path: z.null(),
          fileVersion: z.null(),
        })
        .strict(),
      z
        .object({
          kind: z.enum(PROJECT_CONFIGURATION_SOURCE_KINDS).exclude(['none']),
          path: nonEmptyStringSchema,
          fileVersion: z.union([z.literal(1), z.literal(2)]),
        })
        .strict(),
    ]),
    analysis: z
      .object({
        maxCallDepth: z.number().int().min(1).max(3),
        rawSqlDialect: z.enum(RAW_SQL_DIALECTS).nullable(),
      })
      .strict(),
    output: z.object({ directory: nonEmptyStringSchema }).strict(),
    rules: z.array(normalizedPolicyRuleConfigurationSchema),
    reports: z
      .object({
        policy: z.object({ enabled: z.boolean() }).strict(),
        graph: z
          .object({
            enabled: z.boolean(),
            maxNodesPerEndpoint: z.number().int().min(10).max(500),
            maxEdgesPerEndpoint: z.number().int().min(10).max(1_000),
          })
          .strict(),
        controls: z.object({ enabled: z.boolean() }).strict(),
        openapi: z
          .object({
            enabled: z.boolean(),
            documentPath: nonEmptyStringSchema.nullable(),
            pathPrefix: z.string(),
            includeEvidence: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const effectiveProjectConfigurationV3Schema = effectiveProjectConfigurationV2Schema.extend({
  source: z.union([
    z
      .object({
        kind: z.literal('none'),
        path: z.null(),
        fileVersion: z.null(),
      })
      .strict(),
    z
      .object({
        kind: z.enum(PROJECT_CONFIGURATION_SOURCE_KINDS).exclude(['none']),
        path: nonEmptyStringSchema,
        fileVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      })
      .strict(),
  ]),
  analysis: z
    .object({
      maxCallDepth: z.number().int().min(1).max(3),
      rawSqlDialect: z.enum(RAW_SQL_DIALECTS).nullable(),
      interactions: interactionTraversalConfigurationSchema,
    })
    .strict(),
});

const runDocumentV1Schema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_V1_VERSION),
    ...commonRunShape,
    configuration: analysisConfigurationV1Schema,
    diagnostics: z.array(diagnosticRecordV1Schema),
  })
  .strict();

const runDocumentV2Schema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_V2_VERSION),
    ...commonRunShape,
    configuration: analysisConfigurationV2Schema,
    projectConfiguration: effectiveProjectConfigurationV2Schema.optional(),
    diagnostics: z.array(diagnosticRecordV2Schema),
  })
  .strict();

const runDocumentV3Schema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_V3_VERSION),
    ...commonRunShape,
    configuration: analysisConfigurationSchema,
    projectConfiguration: effectiveProjectConfigurationV3Schema.optional(),
    diagnostics: z.array(diagnosticRecordSchema),
  })
  .strict();

export const runDocumentSchema: z.ZodType<RunDocument> = z.discriminatedUnion('schemaVersion', [
  runDocumentV1Schema,
  runDocumentV2Schema,
  runDocumentV3Schema,
]) as z.ZodType<RunDocument>;

const endpointTraceGuardSchema = z
  .object({
    guardId: stableIdSchema,
    name: nonEmptyStringSchema,
    scope: z.enum(GUARD_SCOPES),
    status: z.enum(ASSERTION_STATUSES),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const endpointTraceStepSchema = z
  .object({
    fromId: stableIdSchema,
    relation: z.enum(ASSERTION_PREDICATES),
    toId: stableIdSchema.nullable(),
    status: z.enum(ASSERTION_STATUSES),
    ruleId: nonEmptyStringSchema,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const endpointTraceTerminalSchema = z
  .object({
    methodId: stableIdSchema,
    direction: z.enum(TABLE_ACCESS_DIRECTIONS),
    tableId: stableIdSchema,
    tableName: nonEmptyStringSchema,
    causalClass: z.enum(TRACE_CAUSAL_CLASSES).optional(),
  })
  .strict();

export const endpointTraceViewSchema: z.ZodType<EndpointTraceView> = z
  .object({
    schemaVersion: z.enum([
      ANALYSIS_SCHEMA_V1_VERSION,
      ANALYSIS_SCHEMA_V2_VERSION,
      ANALYSIS_SCHEMA_V3_VERSION,
    ]),
    analysisId: stableIdSchema,
    endpoint: z
      .object({
        id: stableIdSchema,
        httpMethod: z.enum(HTTP_METHODS),
        path: z.string().startsWith('/'),
      })
      .strict(),
    directGuardState: z.enum(DIRECT_GUARD_STATES),
    globalGuardState: z.enum(GLOBAL_GUARD_STATES),
    effectiveGuardState: z.enum(EFFECTIVE_GUARD_STATES),
    guards: z.array(endpointTraceGuardSchema),
    steps: z.array(endpointTraceStepSchema),
    terminals: z.array(endpointTraceTerminalSchema),
    diagnosticIds: z.array(stableIdSchema),
    causalSummary: z
      .object({
        synchronousEffects: z.array(endpointTraceTerminalSchema),
        localInteractionEffects: z.array(endpointTraceTerminalSchema),
        distributedConditionalEffects: z.array(endpointTraceTerminalSchema),
        outboundInteractionIds: z.array(stableIdSchema),
        localInteractionIds: z.array(stableIdSchema),
        distributedInteractionIds: z.array(stableIdSchema).optional(),
        completeness: z
          .object({
            state: z.enum(['complete', 'incomplete']),
            diagnosticCodes: z.array(z.enum(DIAGNOSTIC_CODES)),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((trace, context) => {
    if (
      (trace.schemaVersion === ANALYSIS_SCHEMA_V3_VERSION) !==
      (trace.causalSummary !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['causalSummary'],
        message: 'Only v3 endpoint traces must carry an explicit causal summary.',
      });
    }
  });

export const interactionHandlerTraceViewSchema: z.ZodType<InteractionHandlerTraceView> = z
  .object({
    schemaVersion: z.enum([
      ANALYSIS_SCHEMA_V1_VERSION,
      ANALYSIS_SCHEMA_V2_VERSION,
      ANALYSIS_SCHEMA_V3_VERSION,
    ]),
    analysisId: stableIdSchema,
    handler: interactionHandlerRecordSchema,
    steps: z.array(endpointTraceStepSchema),
    terminals: z.array(endpointTraceTerminalSchema),
    diagnosticIds: z.array(stableIdSchema),
  })
  .strict();
