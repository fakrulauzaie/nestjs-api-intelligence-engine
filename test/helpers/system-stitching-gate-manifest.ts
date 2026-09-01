import { z } from 'zod';
import {
  SYSTEM_BROKER_TRANSPORTS,
  SYSTEM_CORRELATION_AMBIGUITY_REASONS,
  SYSTEM_CORRELATION_STATES,
  SYSTEM_UNMATCHED_REASONS,
} from '../../src/system-analysis/model.js';

export const SYSTEM_STITCHING_GATE_SCHEMA_VERSION = '1.0.0' as const;
export const SYSTEM_STITCHING_GATE_TECHNOLOGIES = ['bullmq', 'nest_microservices'] as const;
export const SYSTEM_STITCHING_GATE_TOPOLOGIES = [
  'colocated',
  'producer_only',
  'consumer_only',
  'multi_service',
  'collision',
  'missing_topology',
  'ambiguous',
] as const;
export const SYSTEM_STITCHING_MUST_NOT_INFER = [
  'broker_delivery_guaranteed',
  'cross_service_causal_path',
  'environment_from_repository_path',
  'pattern_equality_proves_realm',
  'remote_handler_execution',
  'target_only_candidate_as_edge',
] as const;

const identifier = z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u);
const fixturePath = z.string().regex(/^(?:bullmq|microservices)\/[a-z0-9-]+\.ts\.txt$/u);
const caseId = z.string().regex(/^(?:bullmq|microservices)-[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const sourceRoleSchema = z
  .object({
    serviceNamespace: identifier,
    role: z.enum(['producer', 'consumer']),
    fixture: fixturePath,
  })
  .strict();

const realmBindingSchema = z
  .object({
    serviceNamespace: identifier,
    role: z.enum(['producer', 'consumer']),
    brokerAlias: identifier,
    environmentAlias: identifier,
    transport: z.enum(SYSTEM_BROKER_TRANSPORTS),
    destinationKind: z.enum(['queue', 'topic', 'pattern']),
    destinationValue: z.string().min(1),
  })
  .strict();

const expectedSchema = z
  .object({
    state: z.enum(SYSTEM_CORRELATION_STATES),
    unmatchedReason: z.enum(SYSTEM_UNMATCHED_REASONS).nullable(),
    ambiguityReason: z.enum(SYSTEM_CORRELATION_AMBIGUITY_REASONS).nullable(),
    provenCrossServiceEdge: z.literal(false),
  })
  .strict();

const caseSchema = z
  .object({
    caseId,
    technology: z.enum(SYSTEM_STITCHING_GATE_TECHNOLOGIES),
    topology: z.enum(SYSTEM_STITCHING_GATE_TOPOLOGIES),
    sources: z.array(sourceRoleSchema).min(1),
    contractKey: z.string().min(1),
    realmBindings: z.array(realmBindingSchema),
    expected: expectedSchema,
    mustNotInfer: z.array(z.enum(SYSTEM_STITCHING_MUST_NOT_INFER)).min(1),
    rationale: z.string().min(30),
  })
  .strict();

export const systemStitchingGateManifestSchema = z
  .object({
    schemaVersion: z.literal(SYSTEM_STITCHING_GATE_SCHEMA_VERSION),
    requiredTechnologies: z.array(z.enum(SYSTEM_STITCHING_GATE_TECHNOLOGIES)).length(2),
    requiredTopologies: z.array(z.enum(SYSTEM_STITCHING_GATE_TOPOLOGIES)).length(7),
    globalMustNotInfer: z.array(z.enum(SYSTEM_STITCHING_MUST_NOT_INFER)).min(1),
    cases: z.array(caseSchema).min(14),
    realWorldBasis: z
      .object({
        producerService: z.literal('ticket-service-example'),
        consumerService: z.literal('ctt-queue-service-example'),
        transport: z.literal('rmq'),
        queue: z.literal('intt_ctt_queue'),
        pattern: z.literal('tmf-update-ctt-list'),
        producerToken: z.literal('MESSAGE_QUEUE_SERVICE'),
        producerApis: z.tuple([z.literal('ClientProxy.emit'), z.literal('ClientProxy.send')]),
        producerSourceFiles: z.tuple([
          z.literal('src/modules/ctt/ctt.service.ts'),
          z.literal('src/modules/ntt/ntt.service.ts'),
          z.literal('src/modules/ntt/ntt.module.ts'),
        ]),
        consumerDecorator: z.literal('MessagePattern'),
        consumerSourceFiles: z.tuple([
          z.literal('src/main.ts'),
          z.literal('src/modules/ctt/ctt.controller.ts'),
        ]),
      })
      .strict(),
  })
  .strict();

export type SystemStitchingGateManifest = z.infer<typeof systemStitchingGateManifestSchema>;

function sortedStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalizeSystemStitchingGateManifest(
  manifest: SystemStitchingGateManifest,
): SystemStitchingGateManifest {
  const topologyOrder = new Map(
    SYSTEM_STITCHING_GATE_TOPOLOGIES.map((topology, index) => [topology, index]),
  );
  return {
    ...manifest,
    requiredTechnologies: [...manifest.requiredTechnologies].sort((left, right) =>
      left.localeCompare(right),
    ),
    requiredTopologies: [...manifest.requiredTopologies].sort(
      (left, right) => topologyOrder.get(left)! - topologyOrder.get(right)!,
    ),
    globalMustNotInfer: sortedStrings(manifest.globalMustNotInfer),
    cases: [...manifest.cases]
      .sort(({ caseId: left }, { caseId: right }) => left.localeCompare(right))
      .map((entry) => ({
        ...entry,
        sources: [...entry.sources].sort((left, right) =>
          `${left.serviceNamespace}:${left.role}:${left.fixture}`.localeCompare(
            `${right.serviceNamespace}:${right.role}:${right.fixture}`,
          ),
        ),
        realmBindings: [...entry.realmBindings].sort((left, right) =>
          `${left.serviceNamespace}:${left.role}:${left.brokerAlias}`.localeCompare(
            `${right.serviceNamespace}:${right.role}:${right.brokerAlias}`,
          ),
        ),
        mustNotInfer: sortedStrings(entry.mustNotInfer),
      })),
  };
}

export function parseSystemStitchingGateManifest(value: unknown): SystemStitchingGateManifest {
  return canonicalizeSystemStitchingGateManifest(systemStitchingGateManifestSchema.parse(value));
}

export function serializeSystemStitchingGateManifest(
  manifest: SystemStitchingGateManifest,
): string {
  return `${JSON.stringify(canonicalizeSystemStitchingGateManifest(manifest), null, 2)}\n`;
}
