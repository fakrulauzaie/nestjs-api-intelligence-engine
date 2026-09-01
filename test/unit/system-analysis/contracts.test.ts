import { describe, expect, it } from 'vitest';
import { createStableId } from '../../../src/model/ids.js';
import {
  assertValidSystemAnalysisDocument,
  makeBrokerRealmId,
  makeNamespacedAnalysisRecordId,
  makeSystemAnalysisId,
  makeSystemCorrelationId,
  makeSystemDiagnosticId,
  makeSystemEndpointId,
  makeSystemServiceId,
  serializeCanonicalSystemAnalysis,
  systemAnalysisDocumentSchema,
  systemCorrelationHasDeclaredRealmCandidate,
  systemInteractionContractKey,
  validateSystemAnalysisDocument,
  type BrokerRealmRecord,
  type SystemAnalysisDocument,
  type SystemDiagnosticRecord,
  type SystemInteractionContractTarget,
  type SystemInteractionCorrelationRecord,
  type SystemInteractionEndpointRecord,
  type SystemServiceRecord,
} from '../../../src/system-analysis/index.js';

function service(namespace: string): SystemServiceRecord {
  return {
    id: makeSystemServiceId(namespace),
    namespace,
    displayName: namespace,
    analysisId: createStableId('analysis', [namespace]),
    analysisSchemaVersion: '7.0.0',
    analysisResultState: 'completed_with_gaps',
    artifactLabel: `${namespace}-analysis`,
  };
}

function realm(input?: {
  readonly brokerAlias?: string;
  readonly environmentAlias?: string;
}): BrokerRealmRecord {
  const identity = {
    brokerAlias: input?.brokerAlias ?? 'shared-rmq',
    environmentAlias: input?.environmentAlias ?? 'test',
    technology: 'nest_microservices',
    transport: 'rmq',
    destination: { kind: 'queue', value: 'intt_ctt_queue' },
    prefix: null,
    namespace: null,
  } as const;
  return { id: makeBrokerRealmId(identity), ...identity, declarationSource: 'topology_manifest' };
}

const contract = {
  targetKind: 'microservice_message',
  mode: 'request_response',
  patternKind: 'scalar',
  canonicalPattern: '"tmf-update-ctt-list"',
} as const satisfies SystemInteractionContractTarget;

function endpoint(input: {
  readonly service: SystemServiceRecord;
  readonly role: 'producer' | 'consumer';
  readonly contract?: SystemInteractionContractTarget;
  readonly brokerRealmId?: string | null;
  readonly sourceRecordId?: string;
}): SystemInteractionEndpointRecord {
  const selectedContract = input.contract ?? contract;
  const analysisRecordId =
    input.sourceRecordId ??
    createStableId(input.role === 'producer' ? 'interaction' : 'interaction_handler', [
      input.service.namespace,
      systemInteractionContractKey(selectedContract),
    ]);
  const namespacedId = makeNamespacedAnalysisRecordId({
    serviceNamespace: input.service.namespace,
    analysisRecordId,
  });
  return {
    id: makeSystemEndpointId({ namespacedRecordId: namespacedId, role: input.role }),
    serviceId: input.service.id,
    role: input.role,
    kind: selectedContract.targetKind,
    analysisRecord: { serviceId: input.service.id, analysisRecordId, namespacedId },
    contract: selectedContract,
    contractKey: systemInteractionContractKey(selectedContract),
    sourceTransport: selectedContract.targetKind === 'job_queue' ? 'bullmq' : 'rmq',
    brokerRealmId: input.brokerRealmId ?? null,
  };
}

function correlation(
  input: Omit<SystemInteractionCorrelationRecord, 'id' | 'diagnosticIds'>,
  diagnostic?: { readonly code: SystemDiagnosticRecord['code']; readonly message: string },
): { correlation: SystemInteractionCorrelationRecord; diagnostic: SystemDiagnosticRecord | null } {
  const id = makeSystemCorrelationId(input);
  if (diagnostic === undefined) {
    return {
      correlation: { ...input, id, diagnosticIds: [] } as SystemInteractionCorrelationRecord,
      diagnostic: null,
    };
  }
  const record = {
    code: diagnostic.code,
    severity: 'warning',
    message: diagnostic.message,
    subjectId: id,
  } as const;
  const diagnosticRecord = { ...record, id: makeSystemDiagnosticId(record) };
  return {
    correlation: {
      ...input,
      id,
      diagnosticIds: [diagnosticRecord.id],
    } as SystemInteractionCorrelationRecord,
    diagnostic: diagnosticRecord,
  };
}

function document(input: {
  readonly services: readonly SystemServiceRecord[];
  readonly realms: readonly BrokerRealmRecord[];
  readonly endpoints: readonly SystemInteractionEndpointRecord[];
  readonly correlations: readonly SystemInteractionCorrelationRecord[];
  readonly diagnostics?: readonly SystemDiagnosticRecord[];
}): SystemAnalysisDocument {
  return {
    schemaVersion: '1.0.0',
    systemId: makeSystemAnalysisId({
      systemName: 'ticket-platform',
      services: input.services,
      brokerRealmIds: input.realms.map(({ id }) => id),
      endpoints: input.endpoints,
      correlationIds: input.correlations.map(({ id }) => id),
      diagnosticIds: (input.diagnostics ?? []).map(({ id }) => id),
    }),
    systemName: 'ticket-platform',
    sourceDocumentsEmbedded: false,
    services: input.services,
    brokerRealms: input.realms,
    interactionEndpoints: input.endpoints,
    correlations: input.correlations,
    diagnostics: input.diagnostics ?? [],
  };
}

describe('Phase 45 system identity and correlation contract', () => {
  it('namespaces identical source IDs without merging source analysis documents', () => {
    const left = service('ticket-service');
    const right = service('ctt-queue-service');
    const sameProducerId = createStableId('interaction', ['intentionally-identical']);
    const leftEndpoint = endpoint({
      service: left,
      role: 'producer',
      sourceRecordId: sameProducerId,
    });
    const rightEndpoint = endpoint({
      service: right,
      role: 'producer',
      sourceRecordId: sameProducerId,
    });
    expect(leftEndpoint.analysisRecord.analysisRecordId).toBe(
      rightEndpoint.analysisRecord.analysisRecordId,
    );
    expect(leftEndpoint.analysisRecord.namespacedId).not.toBe(
      rightEndpoint.analysisRecord.namespacedId,
    );

    const value = document({
      services: [right, left],
      realms: [],
      endpoints: [rightEndpoint, leftEndpoint],
      correlations: [],
    });
    expect(assertValidSystemAnalysisDocument(value)).toEqual(value);
    const serialized = serializeCanonicalSystemAnalysis(value);
    expect(serialized).not.toContain('"sourceFiles"');
    expect(serialized).not.toContain('"assertions"');
    expect(serializeCanonicalSystemAnalysis({ ...value, services: [left, right] })).toBe(
      serialized,
    );
  });

  it('represents the real ticket-to-CTT RMQ pair only as a declared-realm candidate', () => {
    const ticket = service('ticket-service');
    const queue = service('ctt-queue-service');
    const sharedRealm = realm();
    const producer = endpoint({
      service: ticket,
      role: 'producer',
      brokerRealmId: sharedRealm.id,
    });
    const consumer = endpoint({
      service: queue,
      role: 'consumer',
      brokerRealmId: sharedRealm.id,
    });
    const linked = correlation({
      state: 'declared_realm_candidate',
      kind: 'microservice_message',
      contractKey: producer.contractKey,
      producerEndpointId: producer.id,
      consumerEndpointIds: [consumer.id],
      brokerRealmId: sharedRealm.id,
      unmatchedReason: null,
      ambiguityReason: null,
    });
    const value = document({
      services: [ticket, queue],
      realms: [sharedRealm],
      endpoints: [producer, consumer],
      correlations: [linked.correlation],
    });
    expect(validateSystemAnalysisDocument(value)).toMatchObject({ success: true });
    expect(systemCorrelationHasDeclaredRealmCandidate(linked.correlation)).toBe(true);
    expect(linked.correlation.state).not.toBe('proven');
  });

  it('makes target-only equality non-traversable and rejects it as declared-realm proof', () => {
    const ticket = service('ticket-service');
    const queue = service('ctt-queue-service');
    const producer = endpoint({ service: ticket, role: 'producer' });
    const consumer = endpoint({ service: queue, role: 'consumer' });
    const targetOnly = correlation(
      {
        state: 'target_only_candidate',
        kind: 'microservice_message',
        contractKey: producer.contractKey,
        producerEndpointId: producer.id,
        consumerEndpointIds: [consumer.id],
        brokerRealmId: null,
        unmatchedReason: null,
        ambiguityReason: null,
      },
      {
        code: 'SYSTEM_TARGET_ONLY_CANDIDATE',
        message: 'Static target equality has no explicit shared broker realm.',
      },
    );
    const targetOnlyDocument = document({
      services: [ticket, queue],
      realms: [],
      endpoints: [producer, consumer],
      correlations: [targetOnly.correlation],
      diagnostics: [targetOnly.diagnostic!],
    });
    expect(validateSystemAnalysisDocument(targetOnlyDocument)).toMatchObject({ success: true });
    expect(systemCorrelationHasDeclaredRealmCandidate(targetOnly.correlation)).toBe(false);

    const invalidDeclared = correlation({
      state: 'declared_realm_candidate',
      kind: 'microservice_message',
      contractKey: producer.contractKey,
      producerEndpointId: producer.id,
      consumerEndpointIds: [consumer.id],
      brokerRealmId: realm().id,
      unmatchedReason: null,
      ambiguityReason: null,
    });
    expect(
      validateSystemAnalysisDocument({
        ...targetOnlyDocument,
        brokerRealms: [realm()],
        correlations: [invalidDeclared.correlation],
        diagnostics: [],
        systemId: makeSystemAnalysisId({
          systemName: 'ticket-platform',
          services: [ticket, queue],
          brokerRealmIds: [realm().id],
          endpoints: [producer, consumer],
          correlationIds: [invalidDeclared.correlation.id],
          diagnosticIds: [],
        }),
      }),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'CORRELATION_INVALID' })]),
    });
  });

  it('keeps request fan-out ambiguous and rejects merged source-analysis fields', () => {
    const producerService = service('ticket-service');
    const consumerAService = service('ctt-queue-a');
    const consumerBService = service('ctt-queue-b');
    const sharedRealm = realm();
    const producer = endpoint({
      service: producerService,
      role: 'producer',
      brokerRealmId: sharedRealm.id,
    });
    const consumerA = endpoint({
      service: consumerAService,
      role: 'consumer',
      brokerRealmId: sharedRealm.id,
    });
    const consumerB = endpoint({
      service: consumerBService,
      role: 'consumer',
      brokerRealmId: sharedRealm.id,
    });
    const ambiguous = correlation(
      {
        state: 'ambiguous',
        kind: 'microservice_message',
        contractKey: producer.contractKey,
        producerEndpointId: producer.id,
        consumerEndpointIds: [consumerB.id, consumerA.id],
        brokerRealmId: sharedRealm.id,
        unmatchedReason: null,
        ambiguityReason: 'multiple_request_consumers',
      },
      {
        code: 'SYSTEM_CORRELATION_AMBIGUOUS',
        message: 'Multiple request-response consumers share the declared realm.',
      },
    );
    const value = document({
      services: [producerService, consumerAService, consumerBService],
      realms: [sharedRealm],
      endpoints: [producer, consumerA, consumerB],
      correlations: [ambiguous.correlation],
      diagnostics: [ambiguous.diagnostic!],
    });
    expect(validateSystemAnalysisDocument(value)).toMatchObject({ success: true });
    expect(systemCorrelationHasDeclaredRealmCandidate(ambiguous.correlation)).toBe(false);
    expect(() =>
      assertValidSystemAnalysisDocument(JSON.parse(serializeCanonicalSystemAnalysis(value))),
    ).not.toThrow();
    expect(systemAnalysisDocumentSchema.safeParse({ ...value, sourceFiles: [] }).success).toBe(
      false,
    );
  });

  it('keeps one-sided inventory and same-target realm collisions explicitly unmatched', () => {
    const ticket = service('ticket-service');
    const queue = service('ctt-queue-service');
    const primaryRealm = realm({ brokerAlias: 'primary-rmq' });
    const shadowRealm = realm({ brokerAlias: 'shadow-rmq' });
    const producer = endpoint({
      service: ticket,
      role: 'producer',
      brokerRealmId: primaryRealm.id,
    });
    const consumer = endpoint({
      service: queue,
      role: 'consumer',
      brokerRealmId: shadowRealm.id,
    });
    const collision = correlation(
      {
        state: 'unmatched',
        kind: 'microservice_message',
        contractKey: producer.contractKey,
        producerEndpointId: producer.id,
        consumerEndpointIds: [consumer.id],
        brokerRealmId: null,
        unmatchedReason: 'realm_mismatch',
        ambiguityReason: null,
      },
      {
        code: 'SYSTEM_REALM_MISMATCH',
        message: 'The structural target is present in two explicit broker realms.',
      },
    );
    expect(
      validateSystemAnalysisDocument(
        document({
          services: [ticket, queue],
          realms: [primaryRealm, shadowRealm],
          endpoints: [producer, consumer],
          correlations: [collision.correlation],
          diagnostics: [collision.diagnostic!],
        }),
      ),
    ).toMatchObject({ success: true });
    expect(systemCorrelationHasDeclaredRealmCandidate(collision.correlation)).toBe(false);

    const producerOnly = correlation(
      {
        state: 'unmatched',
        kind: 'microservice_message',
        contractKey: producer.contractKey,
        producerEndpointId: producer.id,
        consumerEndpointIds: [],
        brokerRealmId: primaryRealm.id,
        unmatchedReason: 'producer_only',
        ambiguityReason: null,
      },
      {
        code: 'SYSTEM_PRODUCER_UNMATCHED',
        message: 'No selected consumer analysis contains a compatible candidate.',
      },
    );
    expect(
      validateSystemAnalysisDocument(
        document({
          services: [ticket],
          realms: [primaryRealm],
          endpoints: [producer],
          correlations: [producerOnly.correlation],
          diagnostics: [producerOnly.diagnostic!],
        }),
      ),
    ).toMatchObject({ success: true });

    const consumerOnly = correlation(
      {
        state: 'unmatched',
        kind: 'microservice_message',
        contractKey: consumer.contractKey,
        producerEndpointId: null,
        consumerEndpointIds: [consumer.id],
        brokerRealmId: shadowRealm.id,
        unmatchedReason: 'consumer_only',
        ambiguityReason: null,
      },
      {
        code: 'SYSTEM_CONSUMER_UNMATCHED',
        message: 'No selected producer analysis contains a compatible candidate.',
      },
    );
    expect(
      validateSystemAnalysisDocument(
        document({
          services: [queue],
          realms: [shadowRealm],
          endpoints: [consumer],
          correlations: [consumerOnly.correlation],
          diagnostics: [consumerOnly.diagnostic!],
        }),
      ),
    ).toMatchObject({ success: true });
  });
});
