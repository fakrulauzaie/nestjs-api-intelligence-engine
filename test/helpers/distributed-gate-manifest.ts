import { z } from 'zod';
import {
  INTERACTION_ACTIVATION_STATES,
  INTERACTION_BOUNDARY_STATES,
} from '../../src/model/interactions.js';

export const DISTRIBUTED_GATE_MANIFEST_SCHEMA_VERSION = '1.0.0' as const;
export const DISTRIBUTED_GATE_TECHNOLOGIES = ['bullmq', 'nest_microservices'] as const;
export const DISTRIBUTED_GATE_TOPOLOGIES = [
  'colocated',
  'producer_only',
  'consumer_only',
  'not_applicable',
] as const;
export const DISTRIBUTED_GATE_CLASSIFICATIONS = ['positive', 'negative', 'unsupported'] as const;
export const DISTRIBUTED_GATE_MUST_NOT_INFER = [
  'branch_write_overattribution',
  'broker_delivery_guaranteed',
  'dynamic_identity_resolved',
  'job_specific_branch_proven',
  'local_handler_reachability_without_module_visibility',
  'missing_consumer_as_failure',
  'pattern_match_implies_delivery',
  'request_response_fan_out',
  'same_repository_implies_same_deployment',
  'single_consumer_selected',
  'transport_equivalence',
  'unsupported_provider_registered',
] as const;

const identifier = z.string().regex(/^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/u);
const caseId = z.string().regex(/^(?:bullmq|microservices)-[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const fixtureName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.ts\.txt$/u);
const sourceMarker = z.string().regex(/^D0_CASE:(?:bullmq|microservices)-[a-z0-9-]+$/u);

const expectationSchema = z
  .object({
    producer: z.enum(['exact', 'dynamic', 'unknown', 'absent', 'unsupported', 'not_applicable']),
    handler: z.enum([
      'proven_registered',
      'declared_candidate',
      'registration_unknown',
      'multiple_candidates',
      'absent',
      'unsupported',
      'not_applicable',
    ]),
    match: z.enum([
      'exact',
      'queue_wide',
      'multiple_candidates',
      'no_local_candidate',
      'unknown',
      'not_applicable',
    ]),
    activation: z.enum([...INTERACTION_ACTIVATION_STATES, 'not_applicable']),
    boundary: z.enum([...INTERACTION_BOUNDARY_STATES, 'not_applicable']),
    causalClass: z.enum(['distributed_conditional', 'none', 'unknown', 'not_applicable']),
  })
  .strict();

const packageContractSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
    sourceUrl: z.string().url(),
    declarationSurface: z.array(z.string().min(1)).min(1),
  })
  .strict();

const fixtureCaseSchema = z
  .object({
    caseId,
    fixture: fixtureName,
    classification: z.enum(DISTRIBUTED_GATE_CLASSIFICATIONS),
    topology: z.enum(DISTRIBUTED_GATE_TOPOLOGIES),
    sourceMarkers: z.array(sourceMarker).min(1),
    expectation: expectationSchema,
    mustEmit: z.array(identifier).min(1),
    mustNotEmit: z.array(identifier).min(1),
    mustNotInfer: z.array(z.enum(DISTRIBUTED_GATE_MUST_NOT_INFER)).min(1),
    counterpartCaseIds: z.array(caseId).min(1),
    rationale: z.string().min(20),
  })
  .strict();

export const distributedGateManifestSchema = z
  .object({
    schemaVersion: z.literal(DISTRIBUTED_GATE_MANIFEST_SCHEMA_VERSION),
    technology: z.enum(DISTRIBUTED_GATE_TECHNOLOGIES),
    compatibilityTarget: z
      .object({
        verifiedOn: z.iso.date(),
        packages: z.array(packageContractSchema).min(1),
      })
      .strict(),
    requiredTopologies: z.array(z.enum(DISTRIBUTED_GATE_TOPOLOGIES)).min(3),
    globalMustNotInfer: z.array(z.enum(DISTRIBUTED_GATE_MUST_NOT_INFER)).min(1),
    cases: z.array(fixtureCaseSchema).min(1),
    review: z
      .object({
        semanticStatus: z.literal('approved'),
        valueStatus: z.literal('approved'),
        reviewedOn: z.iso.date(),
        extractorImplementationPresent: z.literal(false),
        phaseRecommendation: z.literal('eligible_after_d0'),
        estimatedPhaseHours: z
          .object({ minimum: z.number().int().positive(), maximum: z.number().int().positive() })
          .strict(),
        bases: z.array(z.string().url()).min(1),
        decisions: z.array(z.string().min(20)).min(1),
        rationale: z.string().min(40),
      })
      .strict(),
  })
  .strict();

export type DistributedGateManifest = z.infer<typeof distributedGateManifestSchema>;

const topologyOrder = new Map(
  DISTRIBUTED_GATE_TOPOLOGIES.map((topology, index) => [topology, index]),
);

function sortedStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalizeDistributedGateManifest(
  manifest: DistributedGateManifest,
): DistributedGateManifest {
  return {
    ...manifest,
    compatibilityTarget: {
      ...manifest.compatibilityTarget,
      packages: [...manifest.compatibilityTarget.packages]
        .sort(({ name: left }, { name: right }) => left.localeCompare(right))
        .map((entry) => ({
          ...entry,
          declarationSurface: sortedStrings(entry.declarationSurface),
        })),
    },
    requiredTopologies: [...new Set(manifest.requiredTopologies)].sort(
      (left, right) => topologyOrder.get(left)! - topologyOrder.get(right)!,
    ),
    globalMustNotInfer: sortedStrings(manifest.globalMustNotInfer),
    cases: [...manifest.cases]
      .sort(({ caseId: left }, { caseId: right }) => left.localeCompare(right))
      .map((entry) => ({
        ...entry,
        sourceMarkers: sortedStrings(entry.sourceMarkers),
        mustEmit: sortedStrings(entry.mustEmit),
        mustNotEmit: sortedStrings(entry.mustNotEmit),
        mustNotInfer: sortedStrings(entry.mustNotInfer),
        counterpartCaseIds: sortedStrings(entry.counterpartCaseIds),
      })),
    review: {
      ...manifest.review,
      bases: sortedStrings(manifest.review.bases),
      decisions: sortedStrings(manifest.review.decisions),
    },
  };
}

export function parseDistributedGateManifest(value: unknown): DistributedGateManifest {
  return canonicalizeDistributedGateManifest(distributedGateManifestSchema.parse(value));
}

export function serializeDistributedGateManifest(manifest: DistributedGateManifest): string {
  return `${JSON.stringify(canonicalizeDistributedGateManifest(manifest), null, 2)}\n`;
}
