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
import { IMPACT_CATEGORIES, IMPACT_GRAPH_SIDES, IMPACT_REASON_CODES } from '../impact/model.js';
import {
  POLICY_OUTCOMES,
  POLICY_REASON_CODES,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
} from '../policy/model.js';
import { MUTATION_CLASSIFICATIONS } from '../structured-exports/model.js';
import {
  GRAPH_EDGE_KINDS,
  GRAPH_EDGE_KINDS_V2,
  GRAPH_IMPACT_STATES,
  GRAPH_NODE_KINDS,
  GRAPH_NODE_KINDS_V1,
  GRAPH_NODE_KINDS_V2,
  GRAPH_REPORT_SCHEMA_VERSION,
  GRAPH_REPORT_SCHEMA_V2_VERSION,
  GRAPH_REPORT_SCHEMA_V3_VERSION,
  GRAPH_UNCERTAINTY_STATES,
  type GraphReportDocument,
} from './model.js';

const nonEmpty = z.string().min(1);
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

const nodeSchema = z
  .object({
    id: nonEmpty,
    label: nonEmpty,
    kind: z.enum(GRAPH_NODE_KINDS),
    uncertainty: z.enum(GRAPH_UNCERTAINTY_STATES),
    impact: z.enum(GRAPH_IMPACT_STATES),
    evidenceIds: z.array(nonEmpty),
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

export const graphReportDocumentSchema: z.ZodType<GraphReportDocument> = z
  .object({
    schemaVersion: z.enum([
      GRAPH_REPORT_SCHEMA_VERSION,
      GRAPH_REPORT_SCHEMA_V2_VERSION,
      GRAPH_REPORT_SCHEMA_V3_VERSION,
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
          diagnostics: z.array(diagnosticSchema),
          policyOutcomes: z.array(policyOutcomeSchema),
          impact: z.enum(GRAPH_IMPACT_STATES),
          impactReasons: z.array(impactReasonSchema),
          scene: z
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
            .strict(),
        })
        .strict(),
    ),
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
      const expectsLocalEffects = document.schemaVersion === GRAPH_REPORT_SCHEMA_V3_VERSION;
      if (expectsLocalEffects !== (endpoint.localCausalEffects !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['endpoints', index, 'localCausalEffects'],
          message: 'Graph v3 requires local causal effects; graph v1/v2 must omit them.',
        });
      }
    }
  }) as z.ZodType<GraphReportDocument>;
