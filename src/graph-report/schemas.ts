import { z } from 'zod';
import {
  ANALYSIS_RESULT_STATES,
  DIRECT_GUARD_STATES,
  EFFECTIVE_GUARD_STATES,
  GLOBAL_GUARD_STATES,
  TABLE_ACCESS_DIRECTIONS,
} from '../model/analysis.js';
import { DIAGNOSTIC_SEVERITIES } from '../model/diagnostics.js';
import { EVIDENCE_ROLES } from '../model/evidence.js';
import { HTTP_METHODS } from '../model/entities.js';
import {
  AUTHORIZATION_ENFORCEMENT_STATES,
  AUTHORIZATION_METADATA_SOURCES,
} from '../model/authorization.js';
import {
  HANDLER_REGISTRATION_STATES,
  INTERACTION_BOUNDARY_STATES,
  INTERACTION_KINDS,
} from '../model/interactions.js';
import {
  JOB_QUEUE_BRANCH_CONTROL_FLOWS,
  JOB_QUEUE_BRANCH_EFFECT_KINDS,
  JOB_QUEUE_HANDLER_DISPATCH_STATES,
} from '../model/job-queue-branches.js';
import { authorizationValueShapeSchema, jobQueueBranchSelectorSchema } from '../model/schemas.js';
import { IMPACT_CATEGORIES, IMPACT_GRAPH_SIDES, IMPACT_REASON_CODES } from '../impact/model.js';
import {
  POLICY_OUTCOMES,
  POLICY_REASON_CODES,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
} from '../policy/model.js';
import { MUTATION_CLASSIFICATIONS } from '../structured-exports/model.js';
import {
  ARCHITECTURE_HEAT_BANDS,
  ARCHITECTURE_METRIC_KINDS,
  ARCHITECTURE_REACHABILITY_STATES,
  ARCHITECTURE_RECORD_KINDS,
  MODULE_OWNERSHIP_STATES,
} from '../architecture/model.js';
import {
  GRAPH_EDGE_KINDS,
  GRAPH_EDGE_KINDS_V2,
  GRAPH_IMPACT_STATES,
  GRAPH_NODE_KINDS,
  GRAPH_NODE_KINDS_V1,
  GRAPH_NODE_KINDS_V2,
  GRAPH_NODE_KINDS_V7,
  GRAPH_NODE_KINDS_V8,
  GRAPH_REPORT_SCHEMA_VERSION,
  GRAPH_REPORT_SCHEMA_V2_VERSION,
  GRAPH_REPORT_SCHEMA_V3_VERSION,
  GRAPH_REPORT_SCHEMA_V4_VERSION,
  GRAPH_REPORT_SCHEMA_V5_VERSION,
  GRAPH_REPORT_SCHEMA_V6_VERSION,
  GRAPH_REPORT_SCHEMA_V7_VERSION,
  GRAPH_REPORT_SCHEMA_V8_VERSION,
  GRAPH_REPORT_SCHEMA_V9_VERSION,
  GRAPH_UNCERTAINTY_STATES,
  type GraphReportDocument,
} from './model.js';

const nonEmpty = z.string().min(1);
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

const jobQueueDispatchSchema = z
  .object({
    state: z.enum(JOB_QUEUE_HANDLER_DISPATCH_STATES),
    branches: z.array(
      z
        .object({
          branchId: nonEmpty,
          selector: jobQueueBranchSelectorSchema,
          controlFlow: z.enum(JOB_QUEUE_BRANCH_CONTROL_FLOWS),
          effects: z.array(
            z
              .object({
                effectId: nonEmpty,
                kind: z.enum(JOB_QUEUE_BRANCH_EFFECT_KINDS),
                targetId: nonEmpty,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

const nodeSchema = z
  .object({
    id: nonEmpty,
    label: nonEmpty,
    kind: z.enum(GRAPH_NODE_KINDS),
    uncertainty: z.enum(GRAPH_UNCERTAINTY_STATES),
    impact: z.enum(GRAPH_IMPACT_STATES),
    evidenceIds: z.array(nonEmpty),
    parentId: nonEmpty.nullable().optional(),
    architectureMetrics: z
      .array(
        z
          .object({
            metric: z.enum(ARCHITECTURE_METRIC_KINDS),
            value: nonNegativeInteger,
            heat: z.enum(ARCHITECTURE_HEAT_BANDS),
          })
          .strict(),
      )
      .optional(),
    architectureReachability: z.enum(ARCHITECTURE_REACHABILITY_STATES).optional(),
    moduleOwnership: z
      .object({
        state: z.enum(MODULE_OWNERSHIP_STATES),
        moduleIds: z.array(nonEmpty),
      })
      .strict()
      .optional(),
  })
  .strict();

const edgeSchema = z
  .object({
    id: nonEmpty,
    source: nonEmpty,
    target: nonEmpty,
    label: nonEmpty,
    kind: z.enum(GRAPH_EDGE_KINDS),
    relation: nonEmpty.nullable(),
    uncertainty: z.enum(GRAPH_UNCERTAINTY_STATES),
    impact: z.enum(GRAPH_IMPACT_STATES),
    evidenceIds: z.array(nonEmpty),
  })
  .strict();

const evidenceSchema = z
  .object({
    id: nonEmpty,
    path: nonEmpty,
    startLine: positiveInteger,
    startColumn: positiveInteger,
    endLine: positiveInteger,
    endColumn: positiveInteger,
    role: z.enum(EVIDENCE_ROLES),
    snippet: z.string().nullable(),
  })
  .strict();

const diagnosticSchema = z
  .object({
    code: nonEmpty,
    severity: z.enum(DIAGNOSTIC_SEVERITIES),
    message: nonEmpty,
    evidenceIds: z.array(nonEmpty),
  })
  .strict();

const policyOutcomeSchema = z
  .object({
    ruleId: z.enum(POLICY_RULE_IDS),
    outcome: z.enum(POLICY_OUTCOMES),
    severity: z.enum(POLICY_SEVERITIES),
    blocking: z.boolean(),
    reasonCode: z.enum(POLICY_REASON_CODES),
    evidenceIds: z.array(nonEmpty),
  })
  .strict();

const impactReasonSchema = z
  .object({
    category: z.enum(IMPACT_CATEGORIES),
    reasonCode: z.enum(IMPACT_REASON_CODES),
    subject: nonEmpty,
    sourceChangePath: nonEmpty.nullable(),
  })
  .strict();

const localCausalEffectSchema = z
  .object({
    direction: z.enum(TABLE_ACCESS_DIRECTIONS),
    table: nonEmpty,
    causalClass: z.enum(['local_interaction_synchronous', 'local_interaction_asynchronous']),
    evidenceIds: z.array(nonEmpty),
  })
  .strict();

const distributedCausalEffectSchema = z
  .object({
    direction: z.enum(TABLE_ACCESS_DIRECTIONS),
    table: nonEmpty,
    causalClass: z.literal('distributed_conditional'),
    evidenceIds: z.array(nonEmpty),
  })
  .strict();

const authorizationSummarySchema = z
  .object({
    metadataKey: nonEmpty,
    scope: z.enum(['controller', 'method']),
    source: z.enum(AUTHORIZATION_METADATA_SOURCES),
    valueShape: authorizationValueShapeSchema,
    enforcementState: z.enum(AUTHORIZATION_ENFORCEMENT_STATES),
    guardName: nonEmpty.nullable(),
    evidenceIds: z.array(nonEmpty),
  })
  .strict();

const sceneSchema = z
  .object({
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
    evidence: z.array(evidenceSchema),
    omitted: z
      .object({
        nodes: nonNegativeInteger,
        edges: nonNegativeInteger,
        evidence: nonNegativeInteger,
      })
      .strict(),
  })
  .strict();

const architectureOverviewSchema = z
  .object({
    rootId: nonEmpty,
    rootCapabilities: z
      .object({
        endpoints: z.literal('available'),
        interactionHandlers: z.enum(['available', 'unavailable']),
      })
      .strict(),
    supportedRoots: z
      .object({
        endpoints: nonNegativeInteger,
        interactionHandlers: nonNegativeInteger,
      })
      .strict(),
    summary: z
      .object({
        metricRecords: nonNegativeInteger,
        notReachedFromSupportedRoots: nonNegativeInteger,
        uniquelyOwnedClasses: nonNegativeInteger,
        multipleOwnerClasses: nonNegativeInteger,
        ownershipUnknownClasses: nonNegativeInteger,
      })
      .strict(),
    metricLegends: z.array(
      z
        .object({
          metric: z.enum(ARCHITECTURE_METRIC_KINDS),
          eligibleRecords: nonNegativeInteger,
          maximum: nonNegativeInteger,
          percentiles: z
            .object({
              p50: nonNegativeInteger,
              p75: nonNegativeInteger,
              p90: nonNegativeInteger,
            })
            .strict(),
        })
        .strict(),
    ),
    records: z.array(
      z
        .object({
          recordId: nonEmpty,
          recordKind: z.enum(ARCHITECTURE_RECORD_KINDS),
          metrics: z.array(
            z
              .object({
                metric: z.enum(ARCHITECTURE_METRIC_KINDS),
                value: nonNegativeInteger,
                heat: z.enum(ARCHITECTURE_HEAT_BANDS),
              })
              .strict(),
          ),
          reachability: z.enum(ARCHITECTURE_REACHABILITY_STATES),
        })
        .strict(),
    ),
    moduleOwnership: z.array(
      z
        .object({
          recordId: nonEmpty,
          recordKind: z.enum(['class', 'method']),
          state: z.enum(MODULE_OWNERSHIP_STATES),
          moduleIds: z.array(nonEmpty),
        })
        .strict(),
    ),
    scene: sceneSchema,
  })
  .strict();

export const graphReportDocumentSchema: z.ZodType<GraphReportDocument> = z
  .object({
    schemaVersion: z.enum([
      GRAPH_REPORT_SCHEMA_VERSION,
      GRAPH_REPORT_SCHEMA_V2_VERSION,
      GRAPH_REPORT_SCHEMA_V3_VERSION,
      GRAPH_REPORT_SCHEMA_V4_VERSION,
      GRAPH_REPORT_SCHEMA_V5_VERSION,
      GRAPH_REPORT_SCHEMA_V6_VERSION,
      GRAPH_REPORT_SCHEMA_V7_VERSION,
      GRAPH_REPORT_SCHEMA_V8_VERSION,
      GRAPH_REPORT_SCHEMA_V9_VERSION,
    ]),
    analysis: z
      .object({
        id: nonEmpty,
        schemaVersion: nonEmpty,
        resultState: z
          .enum(ANALYSIS_RESULT_STATES)
          .refine((state) => state === 'completed' || state === 'completed_with_gaps'),
        repositoryRevision: z.string().nullable(),
        toolName: nonEmpty,
        toolVersion: nonEmpty,
      })
      .strict(),
    policy: z
      .object({
        state: z.enum(['not_supplied', 'supplied']),
        schemaVersion: z.string().nullable(),
      })
      .strict(),
    impact: z
      .object({
        state: z.enum(['not_supplied', 'supplied']),
        schemaVersion: z.string().nullable(),
        side: z.enum(IMPACT_GRAPH_SIDES).nullable(),
      })
      .strict(),
    limits: z
      .object({
        maxNodesPerEndpoint: positiveInteger,
        maxEdgesPerEndpoint: positiveInteger,
        maxEvidencePerEndpoint: positiveInteger,
      })
      .strict(),
    summary: z
      .object({
        endpoints: nonNegativeInteger,
        endpointsWithGuards: nonNegativeInteger,
        endpointsWithDiagnostics: nonNegativeInteger,
        endpointsWithWrites: nonNegativeInteger,
        impactedEndpoints: nonNegativeInteger,
        omittedNodes: nonNegativeInteger,
        omittedEdges: nonNegativeInteger,
        omittedEvidence: nonNegativeInteger,
        interactionHandlers: nonNegativeInteger.optional(),
        handlersWithDiagnostics: nonNegativeInteger.optional(),
        handlersWithWrites: nonNegativeInteger.optional(),
        architectureRecords: nonNegativeInteger.optional(),
        notReachedFromSupportedRoots: nonNegativeInteger.optional(),
        uniquelyOwnedClasses: nonNegativeInteger.optional(),
        multipleOwnerClasses: nonNegativeInteger.optional(),
      })
      .strict(),
    endpoints: z.array(
      z
        .object({
          endpointId: nonEmpty,
          httpMethod: z.enum(HTTP_METHODS),
          path: z.string().startsWith('/'),
          handler: z.string().nullable(),
          selectionStatus: z.enum(['resolved', 'ambiguous', 'unresolved']),
          directGuardState: z.enum(DIRECT_GUARD_STATES),
          globalGuardState: z.enum(GLOBAL_GUARD_STATES),
          effectiveGuardState: z.enum(EFFECTIVE_GUARD_STATES),
          guards: z.array(nonEmpty),
          mutationClassification: z.enum(MUTATION_CLASSIFICATIONS),
          dbReads: z.array(nonEmpty),
          dbWrites: z.array(nonEmpty),
          localCausalEffects: z.array(localCausalEffectSchema).optional(),
          distributedConditionalEffects: z.array(distributedCausalEffectSchema).optional(),
          jobQueueBranchIds: z.array(nonEmpty).optional(),
          authorizationRequirements: z.array(authorizationSummarySchema).optional(),
          diagnostics: z.array(diagnosticSchema),
          policyOutcomes: z.array(policyOutcomeSchema),
          impact: z.enum(GRAPH_IMPACT_STATES),
          impactReasons: z.array(impactReasonSchema),
          scene: sceneSchema,
        })
        .strict(),
    ),
    interactionHandlers: z
      .array(
        z
          .object({
            handlerId: nonEmpty,
            kind: z.enum(INTERACTION_KINDS).refine((kind) => kind !== 'outbound_http'),
            target: nonEmpty,
            method: nonEmpty,
            registrationState: z.enum(HANDLER_REGISTRATION_STATES),
            boundary: z.enum(INTERACTION_BOUNDARY_STATES),
            causalClass: z.enum([
              'local_interaction_synchronous',
              'local_interaction_asynchronous',
              'distributed_conditional',
              'unknown',
            ]),
            dbReads: z.array(nonEmpty),
            dbWrites: z.array(nonEmpty),
            diagnostics: z.array(diagnosticSchema),
            producerInteractionIds: z.array(nonEmpty),
            jobQueueDispatch: jobQueueDispatchSchema.nullable().optional(),
            scene: sceneSchema,
          })
          .strict(),
      )
      .optional(),
    architecture: architectureOverviewSchema.optional(),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      document.schemaVersion === GRAPH_REPORT_SCHEMA_VERSION &&
      document.endpoints.some(
        (endpoint) =>
          endpoint.scene.nodes.some(
            (node) => !(GRAPH_NODE_KINDS_V1 as readonly string[]).includes(node.kind),
          ) ||
          endpoint.scene.edges.some(
            (edge) => !(GRAPH_EDGE_KINDS_V2 as readonly string[]).includes(edge.kind),
          ),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endpoints'],
        message: 'Graph schema 1.0.0 cannot contain interaction presentation kinds.',
      });
    }
    if (
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V2_VERSION &&
      document.endpoints.some(
        (endpoint) =>
          endpoint.scene.nodes.some(
            (node) => !(GRAPH_NODE_KINDS_V2 as readonly string[]).includes(node.kind),
          ) ||
          endpoint.scene.edges.some(
            (edge) => !(GRAPH_EDGE_KINDS_V2 as readonly string[]).includes(edge.kind),
          ),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endpoints'],
        message: 'Graph schema 2.0.0 cannot contain Phase 34 interaction presentation kinds.',
      });
    }
    for (const [index, endpoint] of document.endpoints.entries()) {
      const expectsLocalEffects =
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V3_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V4_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V5_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V6_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION;
      if (expectsLocalEffects !== (endpoint.localCausalEffects !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['endpoints', index, 'localCausalEffects'],
          message: 'Graph v3/v4 require local causal effects; graph v1/v2 must omit them.',
        });
      }
    }
    const expectsHandlerScenes =
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V4_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V5_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V6_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION;
    if (expectsHandlerScenes !== (document.interactionHandlers !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['interactionHandlers'],
        message: 'Graph v4 requires handler scenes; graph v1-v3 must omit them.',
      });
    }
    for (const [index, endpoint] of document.endpoints.entries()) {
      if (
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V5_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V6_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION
          ? endpoint.jobQueueBranchIds === undefined
          : endpoint.jobQueueBranchIds !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['endpoints', index, 'jobQueueBranchIds'],
          message: 'Graph v5 requires selected job-queue branch IDs; v1-v4 must omit them.',
        });
      }
      if (
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V6_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION
          ? endpoint.authorizationRequirements === undefined
          : endpoint.authorizationRequirements !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['endpoints', index, 'authorizationRequirements'],
          message: 'Graph v6-v7 require authorization requirements; graph v1-v5 must omit them.',
        });
      }
    }
    for (const [index, handler] of (document.interactionHandlers ?? []).entries()) {
      if (
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V5_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V6_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
        document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION
          ? handler.jobQueueDispatch === undefined
          : handler.jobQueueDispatch !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['interactionHandlers', index, 'jobQueueDispatch'],
          message: 'Graph v5 requires branch capability on handler views; graph v4 must omit it.',
        });
      }
    }
    if (
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V5_VERSION &&
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V6_VERSION &&
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V7_VERSION &&
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V8_VERSION &&
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V9_VERSION &&
      [...document.endpoints, ...(document.interactionHandlers ?? [])].some((view) =>
        view.scene.nodes.some(({ kind }) => kind === 'interaction_branch'),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endpoints'],
        message: 'Only graph v5-v7 may contain interaction-branch nodes.',
      });
    }
    for (const field of [
      'interactionHandlers',
      'handlersWithDiagnostics',
      'handlersWithWrites',
    ] as const) {
      if (expectsHandlerScenes !== (document.summary[field] !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['summary', field],
          message: 'Graph v4 requires handler summary fields; graph v1-v3 must omit them.',
        });
      }
    }
    const expectsArchitecture =
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V7_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V8_VERSION ||
      document.schemaVersion === GRAPH_REPORT_SCHEMA_V9_VERSION;
    if (expectsArchitecture !== (document.architecture !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['architecture'],
        message: 'Graph v7 requires one architecture overview; graph v1-v6 must omit it.',
      });
    }
    for (const field of [
      'architectureRecords',
      'notReachedFromSupportedRoots',
      'uniquelyOwnedClasses',
      'multipleOwnerClasses',
    ] as const) {
      if (expectsArchitecture !== (document.summary[field] !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['summary', field],
          message: 'Graph v7 requires architecture summary fields; graph v1-v6 must omit them.',
        });
      }
    }
    const nonArchitectureViews = [...document.endpoints, ...(document.interactionHandlers ?? [])];
    if (
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V8_VERSION &&
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V9_VERSION &&
      [
        ...nonArchitectureViews,
        ...(document.architecture === undefined ? [] : [document.architecture]),
      ].some((view) =>
        view.scene.nodes.some(
          (node) => !(GRAPH_NODE_KINDS_V7 as readonly string[]).includes(node.kind),
        ),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endpoints'],
        message: 'Only graph v8 may contain resource-access nodes.',
      });
    }
    if (
      document.schemaVersion !== GRAPH_REPORT_SCHEMA_V9_VERSION &&
      nonArchitectureViews.some((view) =>
        view.scene.nodes.some(
          (node) => !(GRAPH_NODE_KINDS_V8 as readonly string[]).includes(node.kind),
        ),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endpoints'],
        message: 'Only graph v9 may contain critical-section nodes.',
      });
    }
    if (
      nonArchitectureViews.some((view) =>
        view.scene.nodes.some(
          (node) =>
            node.parentId !== undefined ||
            node.architectureMetrics !== undefined ||
            node.architectureReachability !== undefined ||
            node.moduleOwnership !== undefined,
        ),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endpoints'],
        message: 'Architecture-only node fields cannot appear in endpoint or handler scenes.',
      });
    }
  }) as z.ZodType<GraphReportDocument>;
