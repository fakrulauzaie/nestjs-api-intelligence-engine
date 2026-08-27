import { z } from 'zod';
import {
  DIRECT_GUARD_STATES,
  EFFECTIVE_GUARD_STATES,
  GLOBAL_GUARD_STATES,
  GUARD_SCOPES,
  TABLE_ACCESS_DIRECTIONS,
  TRACE_CAUSAL_CLASSES,
} from '../model/analysis.js';
import { ASSERTION_STATUSES } from '../model/assertions.js';
import { COLUMN_INFLUENCE_STATES, HTTP_METHODS } from '../model/entities.js';
import { stableIdSchema } from '../model/schemas.js';
import {
  HANDLER_REGISTRATION_STATES,
  INTERACTION_ACTIVATION_STATES,
  INTERACTION_BOUNDARY_STATES,
  INTERACTION_DISPATCH_TIMINGS,
} from '../model/interactions.js';
import {
  POLICY_OUTCOMES,
  POLICY_REASON_CODES,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
} from '../policy/model.js';
import {
  CONTROL_EVIDENCE_SCHEMA_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V2_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V3_VERSION,
  MUTATION_CLASSIFICATIONS,
  OPENAPI_ENRICHMENT_SCHEMA_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION,
  OPENAPI_MATCH_RESOLUTIONS,
  type ControlEvidenceDocument,
  type OpenApiEnrichmentResultDocument,
  type OpenApiIntelExtension,
} from './model.js';

const nonEmptyString = z.string().min(1);
const stringArray = z.array(nonEmptyString);

const interactionSummarySchema = z
  .object({
    interactionId: stableIdSchema,
    kind: z.enum(['outbound_http', 'in_process_event', 'job_queue', 'microservice_message']),
    target: nonEmptyString,
    activation: z.enum(INTERACTION_ACTIVATION_STATES),
    boundary: z.enum(INTERACTION_BOUNDARY_STATES),
    dispatchTiming: z.enum(INTERACTION_DISPATCH_TIMINGS),
    handlerStates: z.array(z.enum(HANDLER_REGISTRATION_STATES)),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const localCausalEffectSchema = z
  .object({
    direction: z.enum(TABLE_ACCESS_DIRECTIONS),
    table: nonEmptyString,
    causalClass: z.enum([TRACE_CAUSAL_CLASSES[1], TRACE_CAUSAL_CLASSES[2]]),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const distributedCausalEffectSchema = z
  .object({
    direction: z.enum(TABLE_ACCESS_DIRECTIONS),
    table: nonEmptyString,
    causalClass: z.literal('distributed_conditional'),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

const resolvedExtensionSchema = z
  .object({
    schemaVersion: z.enum([
      OPENAPI_ENRICHMENT_SCHEMA_VERSION,
      OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION,
      OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION,
    ]),
    resolution: z.literal('resolved'),
    analysisId: stableIdSchema,
    endpointId: stableIdSchema,
    guards: z
      .object({
        direct: stringArray,
        global: stringArray,
        directState: z.enum(DIRECT_GUARD_STATES),
        globalState: z.enum(GLOBAL_GUARD_STATES),
        effectiveState: z.enum(EFFECTIVE_GUARD_STATES),
      })
      .strict(),
    dbReads: stringArray,
    dbWrites: stringArray,
    diagnosticCodes: stringArray,
    evidenceIds: z.array(stableIdSchema),
    outboundInteractions: z.array(interactionSummarySchema).optional(),
    localInteractions: z.array(interactionSummarySchema).optional(),
    localCausalEffects: z.array(localCausalEffectSchema).optional(),
    distributedInteractions: z.array(interactionSummarySchema).optional(),
    distributedConditionalEffects: z.array(distributedCausalEffectSchema).optional(),
  })
  .strict()
  .superRefine((extension, context) => {
    const localFields = [
      extension.outboundInteractions,
      extension.localInteractions,
      extension.localCausalEffects,
    ];
    if (
      extension.schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_VERSION
        ? localFields.some((value) => value !== undefined)
        : localFields.some((value) => value === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Resolved OpenAPI schema v2 requires interaction summaries; v1 must omit them.',
      });
    }
    const distributedFields = [
      extension.distributedInteractions,
      extension.distributedConditionalEffects,
    ];
    if (
      extension.schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION
        ? distributedFields.some((value) => value === undefined)
        : distributedFields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Resolved OpenAPI schema v3 requires distributed summaries; v1/v2 must omit them.',
      });
    }
  });

const nonResolvedExtensionSchema = z
  .object({
    schemaVersion: z.enum([
      OPENAPI_ENRICHMENT_SCHEMA_VERSION,
      OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION,
      OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION,
    ]),
    resolution: z.enum(['ambiguous', 'unresolved', 'unmatched']),
    analysisId: stableIdSchema,
    candidateEndpointIds: z.array(stableIdSchema),
    diagnosticCodes: stringArray,
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

export const openApiIntelExtensionSchema: z.ZodType<OpenApiIntelExtension> = z.discriminatedUnion(
  'resolution',
  [resolvedExtensionSchema, nonResolvedExtensionSchema],
);

export const openApiEnrichmentResultSchema: z.ZodType<OpenApiEnrichmentResultDocument> = z
  .object({
    schemaVersion: z.enum([
      OPENAPI_ENRICHMENT_SCHEMA_VERSION,
      OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION,
      OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION,
    ]),
    analysisId: stableIdSchema,
    analysisSchemaVersion: nonEmptyString,
    openApiVersion: nonEmptyString,
    pathPrefix: z.string().startsWith('/'),
    extensionEvidence: z.enum(['included', 'sidecar_only']),
    summary: z
      .object({
        operations: z.number().int().nonnegative(),
        resolved: z.number().int().nonnegative(),
        ambiguous: z.number().int().nonnegative(),
        unresolved: z.number().int().nonnegative(),
        unmatched: z.number().int().nonnegative(),
        unmatchedAnalysisEndpoints: z.number().int().nonnegative(),
      })
      .strict(),
    operations: z.array(
      z
        .object({
          openApiPath: z.string().startsWith('/'),
          normalizedPath: z.string().startsWith('/'),
          httpMethod: nonEmptyString,
          resolution: z.enum(OPENAPI_MATCH_RESOLUTIONS),
          analysisEndpointIds: z.array(stableIdSchema),
          evidenceIds: z.array(stableIdSchema),
        })
        .strict(),
    ),
    unmatchedAnalysisEndpoints: z.array(
      z
        .object({
          endpointId: stableIdSchema,
          httpMethod: z.enum(HTTP_METHODS),
          path: z.string().startsWith('/'),
          mappedOpenApiPath: z.string().startsWith('/'),
        })
        .strict(),
    ),
  })
  .strict();

const guardSchema = z
  .object({
    name: nonEmptyString,
    scope: z.enum(GUARD_SCOPES),
    status: z.enum(ASSERTION_STATUSES),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

export const controlEvidenceDocumentSchema: z.ZodType<ControlEvidenceDocument> = z
  .object({
    schemaVersion: z.enum([
      CONTROL_EVIDENCE_SCHEMA_VERSION,
      CONTROL_EVIDENCE_SCHEMA_V2_VERSION,
      CONTROL_EVIDENCE_SCHEMA_V3_VERSION,
    ]),
    analysis: z
      .object({
        id: stableIdSchema,
        schemaVersion: nonEmptyString,
        resultState: z.enum(['completed', 'completed_with_gaps']),
        repositoryRevision: nonEmptyString.nullable(),
        toolName: nonEmptyString,
        toolVersion: nonEmptyString,
        typescriptVersion: nonEmptyString,
      })
      .strict(),
    policy: z
      .object({
        state: z.enum(['not_supplied', 'supplied']),
        schemaVersion: nonEmptyString.nullable(),
      })
      .strict(),
    rows: z.array(
      z
        .object({
          analysisId: stableIdSchema,
          analysisSchemaVersion: nonEmptyString,
          toolName: nonEmptyString,
          toolVersion: nonEmptyString,
          endpointId: stableIdSchema,
          httpMethod: z.enum(HTTP_METHODS),
          path: z.string().startsWith('/'),
          handler: nonEmptyString.nullable(),
          selectionStatus: z.enum(['resolved', 'ambiguous', 'unresolved']),
          directGuardState: z.enum(DIRECT_GUARD_STATES),
          globalGuardState: z.enum(GLOBAL_GUARD_STATES),
          effectiveGuardState: z.enum(EFFECTIVE_GUARD_STATES),
          directGuards: z.array(guardSchema),
          globalGuards: z.array(guardSchema),
          mutationClassification: z.enum(MUTATION_CLASSIFICATIONS),
          dbReads: stringArray,
          dbWrites: stringArray,
          outboundInteractions: z.array(interactionSummarySchema).optional(),
          localInteractions: z.array(interactionSummarySchema).optional(),
          localCausalEffects: z.array(localCausalEffectSchema).optional(),
          distributedInteractions: z.array(interactionSummarySchema).optional(),
          distributedConditionalEffects: z.array(distributedCausalEffectSchema).optional(),
          requestColumnInfluences: z.array(
            z
              .object({
                origin: nonEmptyString,
                column: nonEmptyString,
                state: z.enum(COLUMN_INFLUENCE_STATES),
                sinkMethod: nonEmptyString,
                callDepth: z.number().int().nonnegative(),
                evidenceIds: z.array(stableIdSchema),
              })
              .strict(),
          ),
          diagnosticCodes: stringArray,
          incompletenessCodes: stringArray,
          policyOutcomes: z.array(
            z
              .object({
                ruleId: z.enum(POLICY_RULE_IDS),
                outcome: z.enum(POLICY_OUTCOMES),
                severity: z.enum(POLICY_SEVERITIES),
                blocking: z.boolean(),
                reasonCode: z.enum(POLICY_REASON_CODES),
                evidenceIds: z.array(stableIdSchema),
              })
              .strict(),
          ),
          evidenceIds: z.array(stableIdSchema),
          sourceLocations: stringArray,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((document, context) => {
    for (const [index, row] of document.rows.entries()) {
      const localFields = [row.outboundInteractions, row.localInteractions, row.localCausalEffects];
      if (
        document.schemaVersion === CONTROL_EVIDENCE_SCHEMA_VERSION
          ? localFields.some((value) => value !== undefined)
          : localFields.some((value) => value === undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: 'Control schema v2 requires interaction summaries; v1 must omit them.',
        });
      }
      const distributedFields = [row.distributedInteractions, row.distributedConditionalEffects];
      if (
        document.schemaVersion === CONTROL_EVIDENCE_SCHEMA_V3_VERSION
          ? distributedFields.some((value) => value === undefined)
          : distributedFields.some((value) => value !== undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: 'Control evidence v3 requires distributed summaries; v1/v2 must omit them.',
        });
      }
    }
  });
