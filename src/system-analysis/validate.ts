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
  SystemAnalysisDocument,
  SystemInteractionCorrelationRecord,
  SystemInteractionEndpointRecord,
} from './model.js';
import { systemInteractionContractKey } from './model.js';
import { systemAnalysisDocumentSchema } from './schemas.js';

export const SYSTEM_ANALYSIS_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'DUPLICATE_ID',
  'IDENTITY_MISMATCH',
  'REFERENCE_INVALID',
  'REALM_INVALID',
  'CORRELATION_INVALID',
] as const;
export type SystemAnalysisIntegrityIssueCode =
  (typeof SYSTEM_ANALYSIS_INTEGRITY_ISSUE_CODES)[number];

export interface SystemAnalysisIntegrityIssue {
  readonly code: SystemAnalysisIntegrityIssueCode;
  readonly path?: string;
  readonly message: string;
}

export type SystemAnalysisValidationResult =
  | { readonly success: true; readonly data: SystemAnalysisDocument }
  | { readonly success: false; readonly issues: readonly SystemAnalysisIntegrityIssue[] };

function pushMismatch(
  issues: SystemAnalysisIntegrityIssue[],
  path: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    issues.push({
      code: 'IDENTITY_MISMATCH',
      path,
      message: `Expected ${expected}, received ${actual}.`,
    });
  }
}

function addDuplicateIssues(
  document: SystemAnalysisDocument,
  issues: SystemAnalysisIntegrityIssue[],
): void {
  const seenIds = new Map<string, string>();
  const collections: readonly [string, readonly { readonly id: string }[]][] = [
    ['services', document.services],
    ['brokerRealms', document.brokerRealms],
    ['interactionEndpoints', document.interactionEndpoints],
    ['correlations', document.correlations],
    ['diagnostics', document.diagnostics],
  ];
  for (const [collection, records] of collections) {
    for (const [index, record] of records.entries()) {
      const path = `${collection}.${index}.id`;
      const prior = seenIds.get(record.id);
      if (prior !== undefined) {
        issues.push({
          code: 'DUPLICATE_ID',
          path,
          message: `${record.id} is already used at ${prior}.`,
        });
      } else {
        seenIds.set(record.id, path);
      }
    }
  }

  const namespaces = new Set<string>();
  for (const [index, service] of document.services.entries()) {
    if (namespaces.has(service.namespace)) {
      issues.push({
        code: 'DUPLICATE_ID',
        path: `services.${index}.namespace`,
        message: `Service namespace ${service.namespace} is declared more than once.`,
      });
    }
    namespaces.add(service.namespace);
  }

  const realmAliases = new Set<string>();
  for (const [index, realm] of document.brokerRealms.entries()) {
    const key = `${realm.environmentAlias}:${realm.brokerAlias}`;
    if (realmAliases.has(key)) {
      issues.push({
        code: 'DUPLICATE_ID',
        path: `brokerRealms.${index}`,
        message: `Broker alias ${key} maps to more than one realm.`,
      });
    }
    realmAliases.add(key);
  }
}

function addIdentityIssues(
  document: SystemAnalysisDocument,
  issues: SystemAnalysisIntegrityIssue[],
): void {
  for (const [index, service] of document.services.entries()) {
    pushMismatch(
      issues,
      `services.${index}.id`,
      service.id,
      makeSystemServiceId(service.namespace),
    );
  }
  for (const [index, realm] of document.brokerRealms.entries()) {
    pushMismatch(
      issues,
      `brokerRealms.${index}.id`,
      realm.id,
      makeBrokerRealmId({
        brokerAlias: realm.brokerAlias,
        environmentAlias: realm.environmentAlias,
        technology: realm.technology,
        transport: realm.transport,
        destination: realm.destination,
        prefix: realm.prefix,
        namespace: realm.namespace,
      }),
    );
  }
  const services = new Map(document.services.map((service) => [service.id, service]));
  for (const [index, endpoint] of document.interactionEndpoints.entries()) {
    const service = services.get(endpoint.serviceId);
    if (service === undefined) continue;
    pushMismatch(
      issues,
      `interactionEndpoints.${index}.analysisRecord.namespacedId`,
      endpoint.analysisRecord.namespacedId,
      makeNamespacedAnalysisRecordId({
        serviceNamespace: service.namespace,
        analysisRecordId: endpoint.analysisRecord.analysisRecordId,
      }),
    );
    pushMismatch(
      issues,
      `interactionEndpoints.${index}.id`,
      endpoint.id,
      makeSystemEndpointId({
        namespacedRecordId: endpoint.analysisRecord.namespacedId,
        role: endpoint.role,
      }),
    );
    pushMismatch(
      issues,
      `interactionEndpoints.${index}.contractKey`,
      endpoint.contractKey,
      systemInteractionContractKey(endpoint.contract),
    );
  }
  for (const [index, correlation] of document.correlations.entries()) {
    pushMismatch(
      issues,
      `correlations.${index}.id`,
      correlation.id,
      makeSystemCorrelationId({
        kind: correlation.kind,
        contractKey: correlation.contractKey,
        producerEndpointId: correlation.producerEndpointId,
        consumerEndpointIds: correlation.consumerEndpointIds,
        brokerRealmId: correlation.brokerRealmId,
        state: correlation.state,
        unmatchedReason: correlation.unmatchedReason,
        ambiguityReason: correlation.ambiguityReason,
      }),
    );
  }
  for (const [index, diagnostic] of document.diagnostics.entries()) {
    pushMismatch(
      issues,
      `diagnostics.${index}.id`,
      diagnostic.id,
      makeSystemDiagnosticId(diagnostic),
    );
  }
  pushMismatch(
    issues,
    'systemId',
    document.systemId,
    makeSystemAnalysisId({
      systemName: document.systemName,
      services: document.services,
      brokerRealmIds: document.brokerRealms.map(({ id }) => id),
      endpoints: document.interactionEndpoints,
      correlationIds: document.correlations.map(({ id }) => id),
      diagnosticIds: document.diagnostics.map(({ id }) => id),
    }),
  );
}

function addRealmIssues(
  document: SystemAnalysisDocument,
  issues: SystemAnalysisIntegrityIssue[],
): void {
  for (const [index, realm] of document.brokerRealms.entries()) {
    const valid =
      (realm.technology === 'bullmq' &&
        realm.transport === 'bullmq' &&
        realm.destination.kind === 'queue') ||
      (realm.technology === 'nest_microservices' && realm.transport !== 'bullmq');
    if (!valid) {
      issues.push({
        code: 'REALM_INVALID',
        path: `brokerRealms.${index}`,
        message: 'Broker technology, transport, and destination are not compatible.',
      });
    }
  }
}

function endpointContractCompatibleWithRealm(
  endpoint: SystemInteractionEndpointRecord,
  realm: SystemAnalysisDocument['brokerRealms'][number],
): boolean {
  if (endpoint.kind === 'job_queue') {
    return (
      realm.technology === 'bullmq' &&
      realm.transport === 'bullmq' &&
      endpoint.contract.targetKind === 'job_queue' &&
      endpoint.contract.queue !== null &&
      realm.destination.kind === 'queue' &&
      endpoint.contract.queue === realm.destination.value
    );
  }
  return (
    realm.technology === 'nest_microservices' &&
    realm.transport !== 'bullmq' &&
    (endpoint.sourceTransport === null || endpoint.sourceTransport === realm.transport)
  );
}

function addReferenceIssues(
  document: SystemAnalysisDocument,
  issues: SystemAnalysisIntegrityIssue[],
): void {
  const services = new Map(document.services.map((service) => [service.id, service]));
  const realms = new Map(document.brokerRealms.map((realm) => [realm.id, realm]));
  const endpoints = new Map(
    document.interactionEndpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  const correlations = new Map(
    document.correlations.map((correlation) => [correlation.id, correlation]),
  );
  const diagnostics = new Map(
    document.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]),
  );

  for (const [index, endpoint] of document.interactionEndpoints.entries()) {
    if (!services.has(endpoint.serviceId)) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `interactionEndpoints.${index}.serviceId`,
        message: `Unknown service ${endpoint.serviceId}.`,
      });
    }
    if (endpoint.analysisRecord.serviceId !== endpoint.serviceId) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `interactionEndpoints.${index}.analysisRecord.serviceId`,
        message: 'Analysis record and endpoint must use the same service namespace.',
      });
    }
    const expectedPrefix = endpoint.role === 'producer' ? 'interaction:' : 'interaction_handler:';
    if (!endpoint.analysisRecord.analysisRecordId.startsWith(expectedPrefix)) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `interactionEndpoints.${index}.analysisRecord.analysisRecordId`,
        message: `${endpoint.role} must reference an ${expectedPrefix.slice(0, -1)} record.`,
      });
    }
    if (endpoint.contract.targetKind !== endpoint.kind) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `interactionEndpoints.${index}.contract`,
        message: 'Endpoint kind must match its contract target kind.',
      });
    }
    const sourceTransportValid =
      (endpoint.kind === 'job_queue' &&
        endpoint.contract.targetKind === 'job_queue' &&
        ((endpoint.contract.technology === 'bullmq' && endpoint.sourceTransport === 'bullmq') ||
          (endpoint.contract.technology === 'bull' && endpoint.sourceTransport === null))) ||
      (endpoint.kind === 'microservice_message' && endpoint.sourceTransport !== 'bullmq');
    if (!sourceTransportValid) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `interactionEndpoints.${index}.sourceTransport`,
        message: 'Source transport is incompatible with the endpoint interaction kind.',
      });
    }
    if (
      endpoint.contract.targetKind === 'microservice_message' &&
      (endpoint.contract.patternKind === 'dynamic') !==
        (endpoint.contract.canonicalPattern === null)
    ) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `interactionEndpoints.${index}.contract`,
        message: 'Only a dynamic microservice pattern may have a null canonical pattern.',
      });
    }
    if (endpoint.brokerRealmId !== null) {
      const realm = realms.get(endpoint.brokerRealmId);
      if (realm === undefined) {
        issues.push({
          code: 'REFERENCE_INVALID',
          path: `interactionEndpoints.${index}.brokerRealmId`,
          message: `Unknown broker realm ${endpoint.brokerRealmId}.`,
        });
      } else if (!endpointContractCompatibleWithRealm(endpoint, realm)) {
        issues.push({
          code: 'REALM_INVALID',
          path: `interactionEndpoints.${index}.brokerRealmId`,
          message: 'Endpoint contract kind is incompatible with its broker realm.',
        });
      }
    }
  }

  for (const [index, correlation] of document.correlations.entries()) {
    if (correlation.producerEndpointId !== null && !endpoints.has(correlation.producerEndpointId)) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `correlations.${index}.producerEndpointId`,
        message: `Unknown producer endpoint ${correlation.producerEndpointId}.`,
      });
    }
    for (const consumerId of correlation.consumerEndpointIds) {
      if (!endpoints.has(consumerId)) {
        issues.push({
          code: 'REFERENCE_INVALID',
          path: `correlations.${index}.consumerEndpointIds`,
          message: `Unknown consumer endpoint ${consumerId}.`,
        });
      }
    }
    if (correlation.brokerRealmId !== null && !realms.has(correlation.brokerRealmId)) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `correlations.${index}.brokerRealmId`,
        message: `Unknown broker realm ${correlation.brokerRealmId}.`,
      });
    }
    for (const diagnosticId of correlation.diagnosticIds) {
      const diagnostic = diagnostics.get(diagnosticId);
      if (diagnostic === undefined) {
        issues.push({
          code: 'REFERENCE_INVALID',
          path: `correlations.${index}.diagnosticIds`,
          message: `Unknown system diagnostic ${diagnosticId}.`,
        });
      } else if (diagnostic.subjectId !== correlation.id) {
        issues.push({
          code: 'REFERENCE_INVALID',
          path: `correlations.${index}.diagnosticIds`,
          message: `Diagnostic ${diagnosticId} does not describe this correlation.`,
        });
      }
    }
  }

  const validSubjects = new Set<string>([
    ...services.keys(),
    ...realms.keys(),
    ...endpoints.keys(),
    ...correlations.keys(),
  ]);
  for (const [index, diagnostic] of document.diagnostics.entries()) {
    if (!validSubjects.has(diagnostic.subjectId)) {
      issues.push({
        code: 'REFERENCE_INVALID',
        path: `diagnostics.${index}.subjectId`,
        message: `Unknown diagnostic subject ${diagnostic.subjectId}.`,
      });
    }
  }
}

function correlationEndpoints(
  correlation: SystemInteractionCorrelationRecord,
  endpoints: ReadonlyMap<string, SystemInteractionEndpointRecord>,
): {
  producer: SystemInteractionEndpointRecord | null;
  consumers: SystemInteractionEndpointRecord[];
} {
  return {
    producer:
      correlation.producerEndpointId === null
        ? null
        : (endpoints.get(correlation.producerEndpointId) ?? null),
    consumers: correlation.consumerEndpointIds.flatMap((id) => {
      const endpoint = endpoints.get(id);
      return endpoint === undefined ? [] : [endpoint];
    }),
  };
}

function addCorrelationIssues(
  document: SystemAnalysisDocument,
  issues: SystemAnalysisIntegrityIssue[],
): void {
  const endpoints = new Map(
    document.interactionEndpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  for (const [index, correlation] of document.correlations.entries()) {
    const path = `correlations.${index}`;
    const { producer, consumers } = correlationEndpoints(correlation, endpoints);
    const members = [...(producer === null ? [] : [producer]), ...consumers];
    if (producer !== null && producer.role !== 'producer') {
      issues.push({
        code: 'CORRELATION_INVALID',
        path,
        message: 'Producer reference has consumer role.',
      });
    }
    if (consumers.some(({ role }) => role !== 'consumer')) {
      issues.push({
        code: 'CORRELATION_INVALID',
        path,
        message: 'Consumer reference has producer role.',
      });
    }
    const producerContractMismatch =
      producer !== null && producer.contractKey !== correlation.contractKey;
    const consumerContractMismatch = consumers.some((consumer) => {
      if (consumer.kind !== correlation.kind) return true;
      if (producer === null) return consumer.contractKey !== correlation.contractKey;
      if (
        producer.contract.targetKind === 'job_queue' &&
        consumer.contract.targetKind === 'job_queue'
      ) {
        return !(
          producer.contract.technology === consumer.contract.technology &&
          producer.contract.queue !== null &&
          producer.contract.queue === consumer.contract.queue &&
          (consumer.contract.job === null || producer.contract.job === consumer.contract.job)
        );
      }
      return producer.contractKey !== consumer.contractKey;
    });
    if (
      members.some(({ kind }) => kind !== correlation.kind) ||
      producerContractMismatch ||
      consumerContractMismatch
    ) {
      issues.push({
        code: 'CORRELATION_INVALID',
        path,
        message: 'Correlation members must have compatible structural contracts.',
      });
    }

    if (correlation.state === 'declared_realm_candidate') {
      if (members.some(({ brokerRealmId }) => brokerRealmId !== correlation.brokerRealmId)) {
        issues.push({
          code: 'CORRELATION_INVALID',
          path,
          message: 'A declared-realm candidate requires every member to share one explicit realm.',
        });
      }
      const target = producer?.contract;
      if (
        target === undefined ||
        (target.targetKind === 'job_queue' && (target.queue === null || target.job === null)) ||
        (target.targetKind === 'microservice_message' &&
          (target.patternKind === 'dynamic' || target.canonicalPattern === null))
      ) {
        issues.push({
          code: 'CORRELATION_INVALID',
          path,
          message: 'A declared-realm candidate requires one exact structural producer target.',
        });
      }
      if (
        consumers.length > 1 &&
        (target?.targetKind === 'job_queue' ||
          (target?.targetKind === 'microservice_message' && target.mode === 'request_response'))
      ) {
        issues.push({
          code: 'CORRELATION_INVALID',
          path,
          message: 'Multiple job or request-response consumers must remain ambiguous.',
        });
      }
    } else if (correlation.state === 'target_only_candidate') {
      const realms = new Set(members.map(({ brokerRealmId }) => brokerRealmId));
      if (realms.size === 1 && !realms.has(null)) {
        issues.push({
          code: 'CORRELATION_INVALID',
          path,
          message: 'Target-only equality cannot replace an already shared explicit realm.',
        });
      }
    } else if (correlation.state === 'ambiguous') {
      const target = producer?.contract;
      const validReason =
        (correlation.ambiguityReason === 'multiple_job_consumers' &&
          target?.targetKind === 'job_queue') ||
        (correlation.ambiguityReason === 'multiple_request_consumers' &&
          target?.targetKind === 'microservice_message' &&
          target.mode === 'request_response') ||
        (correlation.ambiguityReason === 'conflicting_realms' &&
          new Set(members.map(({ brokerRealmId }) => brokerRealmId).filter(Boolean)).size > 1);
      if (!validReason) {
        issues.push({
          code: 'CORRELATION_INVALID',
          path,
          message: 'Ambiguity reason does not match the candidate topology.',
        });
      }
    } else {
      const validShape =
        (correlation.unmatchedReason === 'producer_only' &&
          producer !== null &&
          consumers.length === 0) ||
        (correlation.unmatchedReason === 'consumer_only' &&
          producer === null &&
          consumers.length > 0) ||
        (correlation.unmatchedReason === 'realm_mismatch' &&
          producer !== null &&
          consumers.length > 0 &&
          new Set(members.map(({ brokerRealmId }) => brokerRealmId).filter(Boolean)).size > 1) ||
        (correlation.unmatchedReason === 'target_mismatch' &&
          producer !== null &&
          consumers.length === 0) ||
        (correlation.unmatchedReason === 'unsupported_identity' &&
          (producer !== null || consumers.length > 0));
      if (!validShape) {
        issues.push({
          code: 'CORRELATION_INVALID',
          path,
          message: 'Unmatched reason does not match its producer/consumer shape.',
        });
      }
    }
  }
}

export function validateSystemAnalysisDocument(input: unknown): SystemAnalysisValidationResult {
  const parsed = systemAnalysisDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const issues: SystemAnalysisIntegrityIssue[] = [];
  addDuplicateIssues(parsed.data, issues);
  addIdentityIssues(parsed.data, issues);
  addRealmIssues(parsed.data, issues);
  addReferenceIssues(parsed.data, issues);
  addCorrelationIssues(parsed.data, issues);
  return issues.length === 0
    ? { success: true, data: parsed.data }
    : {
        success: false,
        issues: issues.sort((left, right) =>
          `${left.code}:${left.path ?? ''}:${left.message}`.localeCompare(
            `${right.code}:${right.path ?? ''}:${right.message}`,
          ),
        ),
      };
}

export class SystemAnalysisIntegrityError extends Error {
  readonly issues: readonly SystemAnalysisIntegrityIssue[];

  constructor(issues: readonly SystemAnalysisIntegrityIssue[]) {
    super(`System analysis integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'SystemAnalysisIntegrityError';
    this.issues = issues;
  }
}

export function assertValidSystemAnalysisDocument(input: unknown): SystemAnalysisDocument {
  const result = validateSystemAnalysisDocument(input);
  if (!result.success) throw new SystemAnalysisIntegrityError(result.issues);
  return result.data;
}
