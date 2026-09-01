import { z } from 'zod';
import {
  MAX_GRAPH_EDGE_LIMIT,
  MAX_GRAPH_NODE_LIMIT,
  MIN_GRAPH_DISPLAY_LIMIT,
} from '../graph-report/model.js';
import { stableIdSchema } from '../model/schemas.js';
import {
  SYSTEM_ANALYSIS_SCHEMA_VERSION,
  SYSTEM_CORRELATION_STATES,
} from '../system-analysis/model.js';
import {
  SYSTEM_POLICY_OUTCOMES,
  SYSTEM_POLICY_REASON_CODES,
  SYSTEM_POLICY_RULE_IDS,
  SYSTEM_REPORT_CERTAINTY_STATES,
  SYSTEM_REPORT_EDGE_KINDS,
  SYSTEM_REPORT_NODE_KINDS,
  SYSTEM_REPORT_SCHEMA_VERSION,
} from './model.js';

const nonEmptyText = z.string().min(1).max(1024);
const idFor = (prefix: string) =>
  stableIdSchema.refine((value) => value.startsWith(`${prefix}:`), {
    message: `Expected a ${prefix} ID.`,
  });

const analysisRecordSchema = z
  .object({
    serviceId: idFor('system_service'),
    analysisRecordId: stableIdSchema,
    namespacedId: idFor('system_record'),
  })
  .strict();

const nodeSchema = z
  .object({
    id: stableIdSchema,
    label: nonEmptyText,
    kind: z.enum(SYSTEM_REPORT_NODE_KINDS),
    parentId: stableIdSchema.nullable(),
    serviceId: idFor('system_service').nullable(),
    certainty: z.enum(SYSTEM_REPORT_CERTAINTY_STATES),
    analysisRecords: z.array(analysisRecordSchema),
    correlationIds: z.array(idFor('system_correlation')),
    diagnosticIds: z.array(idFor('system_report_diagnostic')),
  })
  .strict();

const edgeSchema = z
  .object({
    id: idFor('system_graph_edge'),
    source: stableIdSchema,
    target: stableIdSchema,
    label: nonEmptyText,
    kind: z.enum(SYSTEM_REPORT_EDGE_KINDS),
    certainty: z.enum(SYSTEM_REPORT_CERTAINTY_STATES),
    correlationId: idFor('system_correlation').nullable(),
    diagnosticIds: z.array(idFor('system_report_diagnostic')),
  })
  .strict();

const diagnosticSchema = z
  .object({
    id: idFor('system_report_diagnostic'),
    origin: z.enum(['system_analysis', 'source_analysis']),
    code: nonEmptyText,
    severity: z.enum(['info', 'warning', 'error']),
    message: nonEmptyText,
    subjectId: stableIdSchema,
    serviceId: idFor('system_service').nullable(),
    sourceDiagnosticId: stableIdSchema.nullable(),
  })
  .strict();

const correlationSchema = z
  .object({
    id: idFor('system_correlation'),
    state: z.enum(SYSTEM_CORRELATION_STATES),
    kind: z.enum(['job_queue', 'microservice_message']),
    contractLabel: nonEmptyText,
    producerEndpointId: idFor('system_endpoint').nullable(),
    consumerEndpointIds: z.array(idFor('system_endpoint')),
    brokerRealmId: idFor('broker_realm').nullable(),
    reason: nonEmptyText.nullable(),
    diagnosticIds: z.array(idFor('system_report_diagnostic')),
  })
  .strict();

const pathSchema = z
  .object({
    id: idFor('system_path'),
    correlationId: idFor('system_correlation'),
    httpRootNodeId: stableIdSchema.nullable(),
    producerNodeId: idFor('system_endpoint'),
    brokerDestinationNodeId: idFor('system_graph_node'),
    consumerNodeId: idFor('system_endpoint'),
    effectNodeIds: z.array(idFor('system_graph_node')),
    boundary: z.literal('conditional_candidate'),
    completeness: z.enum(['complete', 'incomplete']),
    diagnosticIds: z.array(idFor('system_report_diagnostic')),
  })
  .strict();

const policyResultSchema = z
  .object({
    id: idFor('system_policy_result'),
    ruleId: z.enum(SYSTEM_POLICY_RULE_IDS),
    outcome: z.enum(SYSTEM_POLICY_OUTCOMES),
    reasonCode: z.enum(SYSTEM_POLICY_REASON_CODES),
    message: nonEmptyText,
    subjectCorrelationId: idFor('system_correlation'),
  })
  .strict();

const nonNegative = z.number().int().nonnegative();

export const systemReportDocumentSchema = z
  .object({
    schemaVersion: z.literal(SYSTEM_REPORT_SCHEMA_VERSION),
    reportId: idFor('system_report'),
    system: z
      .object({
        id: idFor('system_analysis'),
        name: nonEmptyText,
        schemaVersion: z.literal(SYSTEM_ANALYSIS_SCHEMA_VERSION),
      })
      .strict(),
    sourceDocumentsEmbedded: z.literal(false),
    limits: z
      .object({
        maxNodes: z.number().int().min(MIN_GRAPH_DISPLAY_LIMIT).max(MAX_GRAPH_NODE_LIMIT),
        maxEdges: z.number().int().min(MIN_GRAPH_DISPLAY_LIMIT).max(MAX_GRAPH_EDGE_LIMIT),
      })
      .strict(),
    summary: z
      .object({
        services: nonNegative,
        brokerRealms: nonNegative,
        correlations: nonNegative,
        declaredRealmCandidates: nonNegative,
        conditionalPaths: nonNegative,
        workerEffects: nonNegative,
        policyFailures: nonNegative,
        diagnostics: nonNegative,
        totalNodes: nonNegative,
        displayedNodes: nonNegative,
        omittedNodes: nonNegative,
        totalEdges: nonNegative,
        displayedEdges: nonNegative,
        omittedEdges: nonNegative,
      })
      .strict(),
    correlations: z.array(correlationSchema),
    conditionalPaths: z.array(pathSchema),
    policies: z
      .object({
        results: z.array(policyResultSchema),
        summary: z
          .object({
            passed: nonNegative,
            failed: nonNegative,
            unknown: nonNegative,
            notApplicable: nonNegative,
          })
          .strict(),
      })
      .strict(),
    diagnostics: z.array(diagnosticSchema),
    graph: z.object({ nodes: z.array(nodeSchema), edges: z.array(edgeSchema) }).strict(),
  })
  .strict();
