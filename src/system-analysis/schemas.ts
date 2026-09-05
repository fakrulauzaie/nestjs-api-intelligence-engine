import { z } from 'zod';
import { stableIdSchema } from '../model/schemas.js';
import {
  JOB_QUEUE_TECHNOLOGIES,
  MICROSERVICE_MESSAGE_MODES,
  MICROSERVICE_PATTERN_KINDS,
} from '../model/interactions.js';
import {
  SYSTEM_ANALYSIS_SCHEMA_VERSION,
  SYSTEM_BROKER_DESTINATION_KINDS,
  SYSTEM_BROKER_TECHNOLOGIES,
  SYSTEM_BROKER_TRANSPORTS,
  SYSTEM_CORRELATABLE_INTERACTION_KINDS,
  SYSTEM_CORRELATION_AMBIGUITY_REASONS,
  SYSTEM_CORRELATION_STATES,
  SYSTEM_DIAGNOSTIC_CODES,
  SYSTEM_ENDPOINT_ROLES,
  SYSTEM_TOPOLOGY_SCHEMA_VERSION,
  SYSTEM_UNMATCHED_REASONS,
} from './model.js';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u);
const nonEmptyText = z.string().min(1).max(512);
const idFor = (kind: string) =>
  stableIdSchema.refine((value) => value.startsWith(`${kind}:`), {
    message: `Expected a ${kind} ID.`,
  });

const serviceSchema = z
  .object({
    id: idFor('system_service'),
    namespace: identifier,
    displayName: nonEmptyText,
    analysisId: idFor('analysis'),
    analysisSchemaVersion: z.enum(['3.0.0', '4.0.0', '5.0.0', '6.0.0', '7.0.0', '8.0.0']),
    analysisResultState: z.enum(['completed', 'completed_with_gaps']),
    artifactLabel: nonEmptyText,
  })
  .strict();

const brokerRealmSchema = z
  .object({
    id: idFor('broker_realm'),
    brokerAlias: identifier,
    environmentAlias: identifier,
    technology: z.enum(SYSTEM_BROKER_TECHNOLOGIES),
    transport: z.enum(SYSTEM_BROKER_TRANSPORTS),
    destination: z
      .object({ kind: z.enum(SYSTEM_BROKER_DESTINATION_KINDS), value: nonEmptyText })
      .strict(),
    prefix: identifier.nullable(),
    namespace: identifier.nullable(),
    declarationSource: z.literal('topology_manifest'),
  })
  .strict();

const analysisRecordReferenceSchema = z
  .object({
    serviceId: idFor('system_service'),
    analysisRecordId: stableIdSchema,
    namespacedId: idFor('system_record'),
  })
  .strict();

const jobQueueContractSchema = z
  .object({
    targetKind: z.literal('job_queue'),
    technology: z.enum(JOB_QUEUE_TECHNOLOGIES),
    queue: nonEmptyText.nullable(),
    job: nonEmptyText.nullable(),
  })
  .strict();

const microserviceContractSchema = z
  .object({
    targetKind: z.literal('microservice_message'),
    mode: z.enum(MICROSERVICE_MESSAGE_MODES),
    patternKind: z.enum(MICROSERVICE_PATTERN_KINDS),
    canonicalPattern: nonEmptyText.nullable(),
  })
  .strict();

const endpointSchema = z
  .object({
    id: idFor('system_endpoint'),
    serviceId: idFor('system_service'),
    role: z.enum(SYSTEM_ENDPOINT_ROLES),
    kind: z.enum(SYSTEM_CORRELATABLE_INTERACTION_KINDS),
    analysisRecord: analysisRecordReferenceSchema,
    contract: z.discriminatedUnion('targetKind', [
      jobQueueContractSchema,
      microserviceContractSchema,
    ]),
    contractKey: nonEmptyText,
    sourceTransport: z.enum(SYSTEM_BROKER_TRANSPORTS).nullable(),
    brokerRealmId: idFor('broker_realm').nullable(),
  })
  .strict();

const correlationBase = z.object({
  id: idFor('system_correlation'),
  kind: z.enum(SYSTEM_CORRELATABLE_INTERACTION_KINDS),
  contractKey: nonEmptyText,
  producerEndpointId: idFor('system_endpoint').nullable(),
  consumerEndpointIds: z.array(idFor('system_endpoint')),
  brokerRealmId: idFor('broker_realm').nullable(),
  diagnosticIds: z.array(idFor('system_diagnostic')),
});

const correlationSchema = z.discriminatedUnion('state', [
  correlationBase
    .extend({
      state: z.literal('declared_realm_candidate'),
      producerEndpointId: idFor('system_endpoint'),
      consumerEndpointIds: z.array(idFor('system_endpoint')).min(1),
      brokerRealmId: idFor('broker_realm'),
      unmatchedReason: z.null(),
      ambiguityReason: z.null(),
    })
    .strict(),
  correlationBase
    .extend({
      state: z.literal('target_only_candidate'),
      producerEndpointId: idFor('system_endpoint'),
      consumerEndpointIds: z.array(idFor('system_endpoint')).min(1),
      brokerRealmId: z.null(),
      diagnosticIds: z.array(idFor('system_diagnostic')).min(1),
      unmatchedReason: z.null(),
      ambiguityReason: z.null(),
    })
    .strict(),
  correlationBase
    .extend({
      state: z.literal('ambiguous'),
      producerEndpointId: idFor('system_endpoint'),
      consumerEndpointIds: z.array(idFor('system_endpoint')).min(2),
      diagnosticIds: z.array(idFor('system_diagnostic')).min(1),
      unmatchedReason: z.null(),
      ambiguityReason: z.enum(SYSTEM_CORRELATION_AMBIGUITY_REASONS),
    })
    .strict(),
  correlationBase
    .extend({
      state: z.literal('unmatched'),
      diagnosticIds: z.array(idFor('system_diagnostic')).min(1),
      unmatchedReason: z.enum(SYSTEM_UNMATCHED_REASONS),
      ambiguityReason: z.null(),
    })
    .strict(),
]);

const diagnosticSchema = z
  .object({
    id: idFor('system_diagnostic'),
    code: z.enum(SYSTEM_DIAGNOSTIC_CODES),
    severity: z.enum(['warning', 'error']),
    message: nonEmptyText,
    subjectId: stableIdSchema,
  })
  .strict();

export const systemAnalysisDocumentSchema = z
  .object({
    schemaVersion: z.literal(SYSTEM_ANALYSIS_SCHEMA_VERSION),
    systemId: idFor('system_analysis'),
    systemName: identifier,
    sourceDocumentsEmbedded: z.literal(false),
    services: z.array(serviceSchema).min(1),
    brokerRealms: z.array(brokerRealmSchema),
    interactionEndpoints: z.array(endpointSchema),
    correlations: z.array(correlationSchema),
    diagnostics: z.array(diagnosticSchema),
  })
  .strict();

const topologyRealmSchema = brokerRealmSchema.omit({ id: true, declarationSource: true });

const topologyBindingSchema = z
  .object({
    serviceNamespace: identifier,
    role: z.enum(SYSTEM_ENDPOINT_ROLES),
    contract: z.discriminatedUnion('targetKind', [
      jobQueueContractSchema,
      microserviceContractSchema,
    ]),
    analysisRecordId: stableIdSchema.nullable(),
    brokerAlias: identifier,
    environmentAlias: identifier,
  })
  .strict();

export const systemTopologyManifestSchema = z
  .object({
    schemaVersion: z.literal(SYSTEM_TOPOLOGY_SCHEMA_VERSION),
    systemName: identifier,
    brokerRealms: z.array(topologyRealmSchema),
    bindings: z.array(topologyBindingSchema),
  })
  .strict();

// Keep the state vocabulary imported and checked by TypeScript even though the
// discriminated union spells out each member for state-specific strictness.
void SYSTEM_CORRELATION_STATES;
