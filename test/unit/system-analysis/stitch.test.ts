import { describe, expect, it } from 'vitest';
import { createStableId } from '../../../src/model/ids.js';
import type { AnalysisDocumentV3 } from '../../../src/model/analysis.js';
import type {
  InteractionHandlerRecord,
  InteractionRecord,
} from '../../../src/model/interactions.js';
import {
  assertValidSystemTopologyManifest,
  serializeCanonicalSystemAnalysis,
  stitchSystemAnalyses,
  validateSystemAnalysisDocument,
  validateSystemTopologyManifest,
  type SystemTopologyManifest,
} from '../../../src/system-analysis/index.js';
import { createMinimalAnalysisDocumentV3 } from '../../helpers/minimal-analysis.js';

function analysis(input: {
  readonly namespace: string;
  readonly interactions?: readonly InteractionRecord[];
  readonly handlers?: readonly InteractionHandlerRecord[];
}): AnalysisDocumentV3 {
  const base = createMinimalAnalysisDocumentV3();
  return {
    ...base,
    resultState: 'completed',
    analysisRun: {
      ...base.analysisRun,
      id: createStableId('analysis', [input.namespace]),
    },
    interactions: input.interactions ?? [],
    interactionHandlers: input.handlers ?? [],
    interactionAnalysis: {
      schemaKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      supportedKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      enabledKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      state: 'complete',
    },
  };
}

function microProducer(input: {
  readonly namespace: string;
  readonly mode?: 'event' | 'request_response';
  readonly pattern?: string | null;
  readonly activation?: 'eager' | 'constructed_cold';
  readonly transport?: 'rmq' | 'kafka';
}): InteractionRecord {
  const pattern = input.pattern === undefined ? '"tmf-update-ctt-list"' : input.pattern;
  return {
    id: createStableId('interaction', [input.namespace, input.mode ?? 'request_response', pattern]),
    sourceMethodId: createStableId('method', [input.namespace, 'produce']),
    applicationId: null,
    direction: 'outbound',
    activation: input.activation ?? 'proven_activated',
    boundary: 'external_or_unobserved',
    dispatchTiming: 'asynchronous',
    ruleId: 'test.micro.producer',
    evidenceIds: [],
    kind: 'microservice_message',
    target: {
      targetKind: 'message',
      mode: input.mode ?? 'request_response',
      patternKind: pattern === null ? 'dynamic' : 'scalar',
      canonicalPattern: pattern,
      clientToken: { resolution: 'exact', value: 'MESSAGE_QUEUE_SERVICE' },
      transport: input.transport ?? 'rmq',
    },
  };
}

function microConsumer(namespace: string): InteractionHandlerRecord {
  return {
    id: createStableId('interaction_handler', [namespace, 'tmf-update-ctt-list']),
    methodId: createStableId('method', [namespace, 'consume']),
    applicationId: null,
    registrationState: 'proven_registered',
    ruleId: 'test.micro.consumer',
    handlerEvidenceId: createStableId('evidence', [namespace, 'handler']),
    kind: 'microservice_message',
    target: {
      targetKind: 'message',
      mode: 'request_response',
      patternKind: 'scalar',
      canonicalPattern: '"tmf-update-ctt-list"',
      clientToken: { resolution: 'dynamic', value: null },
      transport: 'rmq',
    },
  };
}

function bullProducer(namespace: string): InteractionRecord {
  return {
    id: createStableId('interaction', [namespace, 'reports', 'generate-pdf']),
    sourceMethodId: createStableId('method', [namespace, 'enqueue']),
    applicationId: null,
    direction: 'outbound',
    activation: 'eager',
    boundary: 'broker_or_worker_boundary',
    dispatchTiming: 'asynchronous',
    ruleId: 'test.bull.producer',
    evidenceIds: [],
    kind: 'job_queue',
    target: {
      targetKind: 'queue',
      technology: 'bullmq',
      queue: { resolution: 'exact', value: 'reports' },
      job: { resolution: 'exact', value: 'generate-pdf' },
    },
  };
}

function bullConsumer(namespace: string): InteractionHandlerRecord {
  return {
    id: createStableId('interaction_handler', [namespace, 'reports']),
    methodId: createStableId('method', [namespace, 'process']),
    applicationId: null,
    registrationState: 'proven_registered',
    ruleId: 'test.bull.consumer',
    handlerEvidenceId: createStableId('evidence', [namespace, 'processor']),
    kind: 'job_queue',
    target: {
      targetKind: 'queue',
      technology: 'bullmq',
      queue: { resolution: 'exact', value: 'reports' },
      job: { resolution: 'dynamic', value: null },
    },
  };
}

function topology(input?: {
  readonly consumerNamespaces?: readonly string[];
  readonly consumerBrokerAlias?: string;
}): SystemTopologyManifest {
  const consumerNamespaces = input?.consumerNamespaces ?? ['ctt-queue-service'];
  const realm = (brokerAlias: string) => ({
    brokerAlias,
    environmentAlias: 'test',
    technology: 'nest_microservices' as const,
    transport: 'rmq' as const,
    destination: { kind: 'queue' as const, value: 'intt_ctt_queue' },
    prefix: null,
    namespace: null,
  });
  const contract = {
    targetKind: 'microservice_message' as const,
    mode: 'request_response' as const,
    patternKind: 'scalar' as const,
    canonicalPattern: '"tmf-update-ctt-list"',
  };
  return assertValidSystemTopologyManifest({
    schemaVersion: '1.0.0',
    systemName: 'ticket-ctt-system',
    brokerRealms: [
      realm('primary-rmq'),
      ...(input?.consumerBrokerAlias === undefined ? [] : [realm(input.consumerBrokerAlias)]),
    ],
    bindings: [
      {
        serviceNamespace: 'ticket-service',
        role: 'producer',
        contract,
        analysisRecordId: null,
        brokerAlias: 'primary-rmq',
        environmentAlias: 'test',
      },
      ...consumerNamespaces.map((serviceNamespace) => ({
        serviceNamespace,
        role: 'consumer' as const,
        contract,
        analysisRecordId: null,
        brokerAlias: input?.consumerBrokerAlias ?? 'primary-rmq',
        environmentAlias: 'test',
      })),
    ],
  });
}

function stitch(input: {
  readonly consumers?: readonly string[];
  readonly topology?: SystemTopologyManifest;
  readonly producer?: InteractionRecord;
}) {
  const consumerNamespaces = input.consumers ?? ['ctt-queue-service'];
  return stitchSystemAnalyses({
    systemName: 'ticket-ctt-system',
    services: [
      {
        namespace: 'ticket-service',
        artifactLabel: 'ticket-service-analysis.json',
        analysis: analysis({
          namespace: 'ticket-service',
          interactions: [input.producer ?? microProducer({ namespace: 'ticket-service' })],
        }),
      },
      ...consumerNamespaces.map((namespace) => ({
        namespace,
        artifactLabel: `${namespace}-analysis.json`,
        analysis: analysis({ namespace, handlers: [microConsumer(namespace)] }),
      })),
    ],
    ...(input.topology === undefined ? {} : { topology: input.topology }),
  });
}

describe('Phase 46 artifact-only stitch engine', () => {
  it('correlates the ticket/CTT request only as a declared-realm candidate', () => {
    const document = stitch({ topology: topology() });
    expect(document.correlations).toEqual([
      expect.objectContaining({
        state: 'declared_realm_candidate',
        brokerRealmId: document.brokerRealms[0]?.id,
        unmatchedReason: null,
      }),
    ]);
    expect(validateSystemAnalysisDocument(document)).toMatchObject({ success: true });
    expect(document.sourceDocumentsEmbedded).toBe(false);
  });

  it('keeps matching targets without topology non-traversable and deterministic', () => {
    const forward = stitch({});
    const reversed = stitchSystemAnalyses({
      systemName: forward.systemName,
      services: [
        {
          namespace: 'ctt-queue-service',
          artifactLabel: 'ctt-queue-service-analysis.json',
          analysis: analysis({
            namespace: 'ctt-queue-service',
            handlers: [microConsumer('ctt-queue-service')],
          }),
        },
        {
          namespace: 'ticket-service',
          artifactLabel: 'ticket-service-analysis.json',
          analysis: analysis({
            namespace: 'ticket-service',
            interactions: [microProducer({ namespace: 'ticket-service' })],
          }),
        },
      ],
    });
    expect(forward.correlations[0]).toMatchObject({ state: 'target_only_candidate' });
    expect(serializeCanonicalSystemAnalysis(reversed)).toBe(
      serializeCanonicalSystemAnalysis(forward),
    );
  });

  it('preserves realm collisions and request fan-out as distinct uncertainty states', () => {
    const mismatch = stitch({
      topology: topology({ consumerBrokerAlias: 'shadow-rmq' }),
    });
    expect(mismatch.correlations[0]).toMatchObject({
      state: 'unmatched',
      unmatchedReason: 'realm_mismatch',
    });

    const consumers = ['ctt-queue-a', 'ctt-queue-b'];
    const ambiguous = stitch({
      consumers,
      topology: topology({ consumerNamespaces: consumers }),
    });
    expect(ambiguous.correlations).toEqual([
      expect.objectContaining({
        state: 'ambiguous',
        ambiguityReason: 'multiple_request_consumers',
      }),
    ]);
  });

  it('matches an exact BullMQ producer to a queue-wide worker contract', () => {
    const manifest = assertValidSystemTopologyManifest({
      schemaVersion: '1.0.0',
      systemName: 'reports-system',
      brokerRealms: [
        {
          brokerAlias: 'reports-redis',
          environmentAlias: 'test',
          technology: 'bullmq',
          transport: 'bullmq',
          destination: { kind: 'queue', value: 'reports' },
          prefix: null,
          namespace: null,
        },
      ],
      bindings: [
        {
          serviceNamespace: 'reports-api',
          role: 'producer',
          contract: {
            targetKind: 'job_queue',
            technology: 'bullmq',
            queue: 'reports',
            job: 'generate-pdf',
          },
          analysisRecordId: null,
          brokerAlias: 'reports-redis',
          environmentAlias: 'test',
        },
        {
          serviceNamespace: 'reports-worker',
          role: 'consumer',
          contract: {
            targetKind: 'job_queue',
            technology: 'bullmq',
            queue: 'reports',
            job: null,
          },
          analysisRecordId: null,
          brokerAlias: 'reports-redis',
          environmentAlias: 'test',
        },
      ],
    });
    const document = stitchSystemAnalyses({
      systemName: 'reports-system',
      topology: manifest,
      services: [
        {
          namespace: 'reports-api',
          artifactLabel: 'reports-api-analysis.json',
          analysis: analysis({
            namespace: 'reports-api',
            interactions: [bullProducer('reports-api')],
          }),
        },
        {
          namespace: 'reports-worker',
          artifactLabel: 'reports-worker-analysis.json',
          analysis: analysis({
            namespace: 'reports-worker',
            handlers: [bullConsumer('reports-worker')],
          }),
        },
      ],
    });
    expect(document.correlations[0]).toMatchObject({ state: 'declared_realm_candidate' });
    expect(validateSystemAnalysisDocument(document)).toMatchObject({ success: true });
  });

  it('keeps cold and dynamic producers explicitly unsupported', () => {
    const cold = stitch({
      producer: microProducer({ namespace: 'ticket-service', activation: 'constructed_cold' }),
    });
    expect(cold.correlations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'unmatched',
          unmatchedReason: 'unsupported_identity',
        }),
      ]),
    );
    expect(cold.diagnostics.map(({ code }) => code)).toContain('SYSTEM_TARGET_UNSUPPORTED');

    const dynamic = stitch({
      producer: microProducer({ namespace: 'ticket-service', pattern: null }),
    });
    expect(dynamic.correlations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'unmatched',
          unmatchedReason: 'unsupported_identity',
        }),
      ]),
    );
  });

  it('rejects incompatible, duplicate, and unresolved topology declarations', () => {
    expect(
      validateSystemTopologyManifest({
        schemaVersion: '1.0.0',
        systemName: 'bad-system',
        brokerRealms: [
          {
            brokerAlias: 'bad',
            environmentAlias: 'test',
            technology: 'bullmq',
            transport: 'rmq',
            destination: { kind: 'queue', value: 'reports' },
            prefix: null,
            namespace: null,
          },
        ],
        bindings: [],
      }),
    ).toMatchObject({ success: false });
    expect(() =>
      stitchSystemAnalyses({
        systemName: 'ticket-ctt-system',
        topology: topology(),
        services: [
          {
            namespace: 'ticket-service',
            artifactLabel: 'ticket-service-analysis.json',
            analysis: analysis({ namespace: 'ticket-service', interactions: [] }),
          },
        ],
      }),
    ).toThrow('did not select a source record');
    expect(() =>
      stitch({
        topology: topology(),
        producer: microProducer({ namespace: 'ticket-service', transport: 'kafka' }),
      }),
    ).toThrow('contradicts source transport kafka');
  });
});
