import {
  analysisHasInteractionFacts,
  type AnalysisDocument,
  type InteractionAnalysisDocument,
} from '../model/analysis.js';
import type {
  InteractionActivationState,
  InteractionHandlerRecord,
  InteractionRecord,
} from '../model/interactions.js';
import {
  makeBrokerRealmId,
  makeNamespacedAnalysisRecordId,
  makeSystemAnalysisId,
  makeSystemCorrelationId,
  makeSystemDiagnosticId,
  makeSystemEndpointId,
  makeSystemServiceId,
} from './ids.js';
import type {
  AmbiguousSystemCorrelation,
  BrokerRealmRecord,
  DeclaredRealmCandidateCorrelation,
  SystemAnalysisDocument,
  SystemDiagnosticCode,
  SystemDiagnosticRecord,
  SystemInteractionContractTarget,
  SystemInteractionCorrelationRecord,
  SystemInteractionEndpointRecord,
  SystemServiceRecord,
  SystemTopologyBinding,
  SystemTopologyManifest,
  TargetOnlyCandidateCorrelation,
  UnmatchedSystemCorrelation,
} from './model.js';
import { SYSTEM_ANALYSIS_SCHEMA_VERSION, systemInteractionContractKey } from './model.js';
import { canonicalizeSystemAnalysisDocument } from './ordering.js';
import { assertValidSystemAnalysisDocument } from './validate.js';

export interface StitchServiceAnalysisInput {
  readonly namespace: string;
  readonly displayName?: string;
  readonly artifactLabel: string;
  readonly analysis: AnalysisDocument;
}

export interface StitchSystemAnalysesInput {
  readonly systemName: string;
  readonly services: readonly StitchServiceAnalysisInput[];
  readonly topology?: SystemTopologyManifest | undefined;
}

export class SystemStitchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemStitchInputError';
  }
}

interface ProjectedEndpoint {
  readonly record: SystemInteractionEndpointRecord;
  readonly eligible: boolean;
  readonly ineligibleReason: string | null;
}

type CorrelationSeed =
  | Omit<DeclaredRealmCandidateCorrelation, 'id' | 'diagnosticIds'>
  | Omit<TargetOnlyCandidateCorrelation, 'id' | 'diagnosticIds'>
  | Omit<AmbiguousSystemCorrelation, 'id' | 'diagnosticIds'>
  | Omit<UnmatchedSystemCorrelation, 'id' | 'diagnosticIds'>;

const SERVICE_NAMESPACE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function analysisCapabilities(analysis: AnalysisDocument): InteractionAnalysisDocument & {
  readonly resultState: 'completed' | 'completed_with_gaps';
} {
  if (!analysisHasInteractionFacts(analysis)) {
    throw new SystemStitchInputError(
      `Analysis ${analysis.analysisRun.id} uses schema ${analysis.schemaVersion}; stitching requires interaction-capable schema 3.0.0 or newer.`,
    );
  }
  if (analysis.resultState !== 'completed' && analysis.resultState !== 'completed_with_gaps') {
    throw new SystemStitchInputError(
      `Analysis ${analysis.analysisRun.id} has non-publishable result state ${analysis.resultState}.`,
    );
  }
  if (analysis.interactionAnalysis.state === 'not_run') {
    throw new SystemStitchInputError(
      `Analysis ${analysis.analysisRun.id} did not run interaction analysis.`,
    );
  }
  return analysis as InteractionAnalysisDocument & {
    readonly resultState: 'completed' | 'completed_with_gaps';
  };
}

function projectContract(
  record: InteractionRecord | InteractionHandlerRecord,
): SystemInteractionContractTarget {
  if (record.kind === 'job_queue') {
    return {
      targetKind: 'job_queue',
      technology: record.target.technology,
      queue: record.target.queue.resolution === 'exact' ? record.target.queue.value : null,
      job: record.target.job.resolution === 'exact' ? record.target.job.value : null,
    };
  }
  if (record.kind === 'microservice_message') {
    return {
      targetKind: 'microservice_message',
      mode: record.target.mode,
      patternKind: record.target.patternKind,
      canonicalPattern: record.target.canonicalPattern,
    };
  }
  throw new SystemStitchInputError(`Interaction kind ${record.kind} is not stitchable.`);
}

function exactContract(contract: SystemInteractionContractTarget): boolean {
  return contract.targetKind === 'job_queue'
    ? contract.queue !== null && contract.job !== null
    : contract.patternKind !== 'dynamic' && contract.canonicalPattern !== null;
}

function contractsCompatible(
  producer: SystemInteractionContractTarget,
  consumer: SystemInteractionContractTarget,
): boolean {
  if (producer.targetKind !== consumer.targetKind) return false;
  if (producer.targetKind === 'job_queue' && consumer.targetKind === 'job_queue') {
    return (
      producer.technology === consumer.technology &&
      producer.queue !== null &&
      producer.queue === consumer.queue &&
      (consumer.job === null || producer.job === consumer.job)
    );
  }
  return systemInteractionContractKey(producer) === systemInteractionContractKey(consumer);
}

function producerActivationEligible(activation: InteractionActivationState): boolean {
  return activation === 'eager' || activation === 'proven_activated';
}

function diagnosticFor(
  code: SystemDiagnosticCode,
  subjectId: string,
  message: string,
): SystemDiagnosticRecord {
  const base = { code, severity: 'warning', message, subjectId } as const;
  return { ...base, id: makeSystemDiagnosticId(base) };
}

function correlationWithDiagnostic(
  seed: CorrelationSeed,
  code: SystemDiagnosticCode,
  message: string,
): {
  readonly correlation: SystemInteractionCorrelationRecord;
  readonly diagnostic: SystemDiagnosticRecord;
} {
  const id = makeSystemCorrelationId(seed);
  const diagnostic = diagnosticFor(code, id, message);
  return {
    correlation: {
      ...seed,
      id,
      diagnosticIds: [diagnostic.id],
    } as SystemInteractionCorrelationRecord,
    diagnostic,
  };
}

function correlationWithoutDiagnostic(
  seed: Omit<DeclaredRealmCandidateCorrelation, 'id' | 'diagnosticIds'>,
): DeclaredRealmCandidateCorrelation {
  return { ...seed, id: makeSystemCorrelationId(seed), diagnosticIds: [] };
}

function realmRecords(topology: SystemTopologyManifest | undefined): BrokerRealmRecord[] {
  return (topology?.brokerRealms ?? []).map((declaration) => ({
    id: makeBrokerRealmId(declaration),
    ...declaration,
    declarationSource: 'topology_manifest',
  }));
}

function bindingMatches(
  binding: SystemTopologyBinding,
  input: {
    readonly namespace: string;
    readonly role: 'producer' | 'consumer';
    readonly sourceRecordId: string;
    readonly contract: SystemInteractionContractTarget;
  },
): boolean {
  return (
    binding.serviceNamespace === input.namespace &&
    binding.role === input.role &&
    systemInteractionContractKey(binding.contract) ===
      systemInteractionContractKey(input.contract) &&
    (binding.analysisRecordId === null || binding.analysisRecordId === input.sourceRecordId)
  );
}

function realmForEndpoint(input: {
  readonly topology: SystemTopologyManifest | undefined;
  readonly realmsByAlias: ReadonlyMap<string, BrokerRealmRecord>;
  readonly usedBindingIndexes: Set<number>;
  readonly namespace: string;
  readonly role: 'producer' | 'consumer';
  readonly sourceRecordId: string;
  readonly contract: SystemInteractionContractTarget;
}): string | null {
  const matches = (input.topology?.bindings ?? []).flatMap((binding, index) =>
    bindingMatches(binding, input) ? [{ binding, index }] : [],
  );
  if (matches.length > 1) {
    throw new SystemStitchInputError(
      `Multiple topology bindings select ${input.namespace} ${input.role} ${input.sourceRecordId}.`,
    );
  }
  const match = matches[0];
  if (match === undefined) return null;
  input.usedBindingIndexes.add(match.index);
  const alias = `${match.binding.environmentAlias}:${match.binding.brokerAlias}`;
  const realm = input.realmsByAlias.get(alias);
  if (realm === undefined) {
    throw new SystemStitchInputError(`Topology binding references missing realm ${alias}.`);
  }
  return realm.id;
}

function projectEndpoint(input: {
  readonly service: SystemServiceRecord;
  readonly namespace: string;
  readonly role: 'producer' | 'consumer';
  readonly source: InteractionRecord | InteractionHandlerRecord;
  readonly topology: SystemTopologyManifest | undefined;
  readonly realmsByAlias: ReadonlyMap<string, BrokerRealmRecord>;
  readonly usedBindingIndexes: Set<number>;
}): ProjectedEndpoint {
  const contract = projectContract(input.source);
  const namespacedId = makeNamespacedAnalysisRecordId({
    serviceNamespace: input.namespace,
    analysisRecordId: input.source.id,
  });
  const brokerRealmId = realmForEndpoint({
    topology: input.topology,
    realmsByAlias: input.realmsByAlias,
    usedBindingIndexes: input.usedBindingIndexes,
    namespace: input.namespace,
    role: input.role,
    sourceRecordId: input.source.id,
    contract,
  });
  const record: SystemInteractionEndpointRecord = {
    id: makeSystemEndpointId({ namespacedRecordId: namespacedId, role: input.role }),
    serviceId: input.service.id,
    role: input.role,
    kind: contract.targetKind,
    analysisRecord: {
      serviceId: input.service.id,
      analysisRecordId: input.source.id,
      namespacedId,
    },
    contract,
    contractKey: systemInteractionContractKey(contract),
    sourceTransport:
      input.source.kind === 'job_queue'
        ? input.source.target.technology === 'bullmq'
          ? 'bullmq'
          : null
        : input.source.kind === 'microservice_message'
          ? input.source.target.transport
          : null,
    brokerRealmId,
  };
  if (record.brokerRealmId !== null && record.sourceTransport !== null) {
    const realm = [...input.realmsByAlias.values()].find(({ id }) => id === record.brokerRealmId);
    if (realm !== undefined && realm.transport !== record.sourceTransport) {
      throw new SystemStitchInputError(
        `Topology realm transport ${realm.transport} contradicts source transport ${record.sourceTransport} for ${input.namespace} ${input.source.id}.`,
      );
    }
  }

  if (input.role === 'producer') {
    const source = input.source as InteractionRecord;
    if (contract.targetKind === 'job_queue' && contract.technology !== 'bullmq') {
      return {
        record,
        eligible: false,
        ineligibleReason: `queue technology ${contract.technology} is not supported`,
      };
    }
    if (!exactContract(contract)) {
      return { record, eligible: false, ineligibleReason: 'target identity is not exact' };
    }
    if (!producerActivationEligible(source.activation)) {
      return {
        record,
        eligible: false,
        ineligibleReason: `activation is ${source.activation}`,
      };
    }
  } else {
    const source = input.source as InteractionHandlerRecord;
    if (contract.targetKind === 'job_queue' && contract.technology !== 'bullmq') {
      return {
        record,
        eligible: false,
        ineligibleReason: `queue technology ${contract.technology} is not supported`,
      };
    }
    const supportedIdentity =
      contract.targetKind === 'job_queue' ? contract.queue !== null : exactContract(contract);
    if (!supportedIdentity) {
      return { record, eligible: false, ineligibleReason: 'handler target identity is not exact' };
    }
    if (source.registrationState !== 'proven_registered') {
      return {
        record,
        eligible: false,
        ineligibleReason: `registration is ${source.registrationState}`,
      };
    }
  }
  return { record, eligible: true, ineligibleReason: null };
}

function makeServices(inputs: readonly StitchServiceAnalysisInput[]): SystemServiceRecord[] {
  const namespaces = new Set<string>();
  return inputs.map((input) => {
    if (!SERVICE_NAMESPACE.test(input.namespace) || input.namespace.length > 128) {
      throw new SystemStitchInputError(`Invalid service namespace: ${input.namespace}.`);
    }
    if (namespaces.has(input.namespace)) {
      throw new SystemStitchInputError(`Service namespace is repeated: ${input.namespace}.`);
    }
    namespaces.add(input.namespace);
    const analysis = analysisCapabilities(input.analysis);
    return {
      id: makeSystemServiceId(input.namespace),
      namespace: input.namespace,
      displayName: input.displayName ?? input.namespace,
      analysisId: analysis.analysisRun.id,
      analysisSchemaVersion: analysis.schemaVersion,
      analysisResultState: analysis.resultState,
      artifactLabel: input.artifactLabel,
    };
  });
}

export function stitchSystemAnalyses(input: StitchSystemAnalysesInput): SystemAnalysisDocument {
  if (input.services.length === 0) {
    throw new SystemStitchInputError('At least one named analysis is required.');
  }
  if (input.topology !== undefined && input.topology.systemName !== input.systemName) {
    throw new SystemStitchInputError('CLI system name and topology system name do not match.');
  }
  const services = makeServices(input.services);
  const serviceByNamespace = new Map(services.map((service) => [service.namespace, service]));
  const realms = realmRecords(input.topology);
  const realmsByAlias = new Map(
    realms.map((realm) => [`${realm.environmentAlias}:${realm.brokerAlias}`, realm]),
  );
  const usedBindingIndexes = new Set<number>();
  const projected: ProjectedEndpoint[] = [];
  const diagnostics: SystemDiagnosticRecord[] = [];

  for (const sourceInput of input.services) {
    const analysis = analysisCapabilities(sourceInput.analysis);
    const service = serviceByNamespace.get(sourceInput.namespace)!;
    if (
      analysis.interactionAnalysis.state === 'incomplete' ||
      !(['job_queue', 'microservice_message'] as const).every((kind) =>
        analysis.interactionAnalysis.enabledKinds.includes(kind),
      )
    ) {
      diagnostics.push(
        diagnosticFor(
          'SYSTEM_SOURCE_ANALYSIS_INCOMPLETE',
          service.id,
          `Service ${service.namespace} has incomplete or disabled distributed interaction coverage.`,
        ),
      );
    }
    for (const interaction of analysis.interactions) {
      if (interaction.kind !== 'job_queue' && interaction.kind !== 'microservice_message') continue;
      projected.push(
        projectEndpoint({
          service,
          namespace: service.namespace,
          role: 'producer',
          source: interaction,
          topology: input.topology,
          realmsByAlias,
          usedBindingIndexes,
        }),
      );
    }
    for (const handler of analysis.interactionHandlers) {
      if (handler.kind !== 'job_queue' && handler.kind !== 'microservice_message') continue;
      projected.push(
        projectEndpoint({
          service,
          namespace: service.namespace,
          role: 'consumer',
          source: handler,
          topology: input.topology,
          realmsByAlias,
          usedBindingIndexes,
        }),
      );
    }
  }

  for (const [index, binding] of (input.topology?.bindings ?? []).entries()) {
    if (!usedBindingIndexes.has(index)) {
      throw new SystemStitchInputError(
        `Topology binding ${index} did not select a source record in service ${binding.serviceNamespace}.`,
      );
    }
  }

  const producers = projected.filter(({ record }) => record.role === 'producer');
  const consumers = projected.filter(({ record }) => record.role === 'consumer');
  const consumed = new Set<string>();
  const correlations: SystemInteractionCorrelationRecord[] = [];

  for (const producer of producers) {
    if (!producer.eligible) {
      const result = correlationWithDiagnostic(
        {
          state: 'unmatched',
          kind: producer.record.kind,
          contractKey: producer.record.contractKey,
          producerEndpointId: producer.record.id,
          consumerEndpointIds: [],
          brokerRealmId: producer.record.brokerRealmId,
          unmatchedReason: 'unsupported_identity',
          ambiguityReason: null,
        },
        'SYSTEM_TARGET_UNSUPPORTED',
        `Producer is not eligible for stitching because ${producer.ineligibleReason}.`,
      );
      correlations.push(result.correlation);
      diagnostics.push(result.diagnostic);
      continue;
    }

    const sameKindConsumers = consumers.filter(
      (consumer) => consumer.eligible && consumer.record.kind === producer.record.kind,
    );
    const candidates = sameKindConsumers.filter((consumer) =>
      contractsCompatible(producer.record.contract, consumer.record.contract),
    );
    if (candidates.length === 0) {
      const reason = sameKindConsumers.length === 0 ? 'producer_only' : 'target_mismatch';
      const result = correlationWithDiagnostic(
        {
          state: 'unmatched',
          kind: producer.record.kind,
          contractKey: producer.record.contractKey,
          producerEndpointId: producer.record.id,
          consumerEndpointIds: [],
          brokerRealmId: producer.record.brokerRealmId,
          unmatchedReason: reason,
          ambiguityReason: null,
        },
        'SYSTEM_PRODUCER_UNMATCHED',
        reason === 'producer_only'
          ? 'No selected analysis contains an eligible consumer of this interaction kind.'
          : 'Selected consumer analyses contain no compatible structural target.',
      );
      correlations.push(result.correlation);
      diagnostics.push(result.diagnostic);
      continue;
    }

    const consumerIds = candidates
      .map(({ record }) => record.id)
      .sort((a, b) => a.localeCompare(b));
    for (const id of consumerIds) consumed.add(id);
    const members = [producer, ...candidates];
    const explicitRealmIds = new Set(
      members.flatMap(({ record }) =>
        record.brokerRealmId === null ? [] : [record.brokerRealmId],
      ),
    );
    const everyMemberHasRealm = members.every(({ record }) => record.brokerRealmId !== null);
    const sharedRealmId =
      everyMemberHasRealm && explicitRealmIds.size === 1
        ? (members[0]?.record.brokerRealmId ?? null)
        : null;

    if (explicitRealmIds.size > 1) {
      const result = correlationWithDiagnostic(
        {
          state: 'unmatched',
          kind: producer.record.kind,
          contractKey: producer.record.contractKey,
          producerEndpointId: producer.record.id,
          consumerEndpointIds: consumerIds,
          brokerRealmId: null,
          unmatchedReason: 'realm_mismatch',
          ambiguityReason: null,
        },
        'SYSTEM_REALM_MISMATCH',
        'Compatible structural targets are bound to different explicit broker realms.',
      );
      correlations.push(result.correlation);
      diagnostics.push(result.diagnostic);
      continue;
    }

    const fanOutAmbiguity =
      candidates.length > 1 &&
      (producer.record.contract.targetKind === 'job_queue' ||
        (producer.record.contract.targetKind === 'microservice_message' &&
          producer.record.contract.mode === 'request_response'));
    if (fanOutAmbiguity) {
      const ambiguityReason =
        producer.record.contract.targetKind === 'job_queue'
          ? 'multiple_job_consumers'
          : 'multiple_request_consumers';
      const result = correlationWithDiagnostic(
        {
          state: 'ambiguous',
          kind: producer.record.kind,
          contractKey: producer.record.contractKey,
          producerEndpointId: producer.record.id,
          consumerEndpointIds: consumerIds,
          brokerRealmId: sharedRealmId,
          unmatchedReason: null,
          ambiguityReason,
        },
        'SYSTEM_CORRELATION_AMBIGUOUS',
        'Multiple local delivery candidates exist for a single-consumer interaction shape.',
      );
      correlations.push(result.correlation);
      diagnostics.push(result.diagnostic);
      continue;
    }

    if (sharedRealmId !== null) {
      correlations.push(
        correlationWithoutDiagnostic({
          state: 'declared_realm_candidate',
          kind: producer.record.kind,
          contractKey: producer.record.contractKey,
          producerEndpointId: producer.record.id,
          consumerEndpointIds: consumerIds,
          brokerRealmId: sharedRealmId,
          unmatchedReason: null,
          ambiguityReason: null,
        }),
      );
    } else {
      const result = correlationWithDiagnostic(
        {
          state: 'target_only_candidate',
          kind: producer.record.kind,
          contractKey: producer.record.contractKey,
          producerEndpointId: producer.record.id,
          consumerEndpointIds: consumerIds,
          brokerRealmId: null,
          unmatchedReason: null,
          ambiguityReason: null,
        },
        'SYSTEM_TARGET_ONLY_CANDIDATE',
        'Structural target equality lacks one explicit shared broker realm.',
      );
      correlations.push(result.correlation);
      diagnostics.push(result.diagnostic);
    }
  }

  for (const consumer of consumers) {
    if (consumed.has(consumer.record.id)) continue;
    const unsupported = !consumer.eligible;
    const result = correlationWithDiagnostic(
      {
        state: 'unmatched',
        kind: consumer.record.kind,
        contractKey: consumer.record.contractKey,
        producerEndpointId: null,
        consumerEndpointIds: [consumer.record.id],
        brokerRealmId: consumer.record.brokerRealmId,
        unmatchedReason: unsupported ? 'unsupported_identity' : 'consumer_only',
        ambiguityReason: null,
      },
      unsupported ? 'SYSTEM_TARGET_UNSUPPORTED' : 'SYSTEM_CONSUMER_UNMATCHED',
      unsupported
        ? `Consumer is not eligible for stitching because ${consumer.ineligibleReason}.`
        : 'No selected producer analysis contains a compatible candidate.',
    );
    correlations.push(result.correlation);
    diagnostics.push(result.diagnostic);
  }

  const interactionEndpoints = projected.map(({ record }) => record);
  const document: SystemAnalysisDocument = {
    schemaVersion: SYSTEM_ANALYSIS_SCHEMA_VERSION,
    systemId: makeSystemAnalysisId({
      systemName: input.systemName,
      services,
      brokerRealmIds: realms.map(({ id }) => id),
      endpoints: interactionEndpoints,
      correlationIds: correlations.map(({ id }) => id),
      diagnosticIds: diagnostics.map(({ id }) => id),
    }),
    systemName: input.systemName,
    sourceDocumentsEmbedded: false,
    services,
    brokerRealms: realms,
    interactionEndpoints,
    correlations,
    diagnostics,
  };
  return canonicalizeSystemAnalysisDocument(assertValidSystemAnalysisDocument(document));
}
