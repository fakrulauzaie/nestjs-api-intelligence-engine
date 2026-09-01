import type { AnalysisResultState } from '../model/analysis.js';
import type {
  JobQueueTechnology,
  MicroserviceMessageMode,
  MicroservicePatternKind,
} from '../model/interactions.js';

export const SYSTEM_ANALYSIS_SCHEMA_VERSION = '1.0.0' as const;

export const SYSTEM_CORRELATABLE_INTERACTION_KINDS = ['job_queue', 'microservice_message'] as const;
export type SystemCorrelatableInteractionKind =
  (typeof SYSTEM_CORRELATABLE_INTERACTION_KINDS)[number];

export const SYSTEM_BROKER_TECHNOLOGIES = ['bullmq', 'nest_microservices'] as const;
export type SystemBrokerTechnology = (typeof SYSTEM_BROKER_TECHNOLOGIES)[number];

export const SYSTEM_BROKER_TRANSPORTS = ['bullmq', 'tcp', 'redis', 'rmq', 'kafka'] as const;
export type SystemBrokerTransport = (typeof SYSTEM_BROKER_TRANSPORTS)[number];

export const SYSTEM_BROKER_DESTINATION_KINDS = ['queue', 'topic', 'pattern'] as const;
export type SystemBrokerDestinationKind = (typeof SYSTEM_BROKER_DESTINATION_KINDS)[number];

export const SYSTEM_ENDPOINT_ROLES = ['producer', 'consumer'] as const;
export type SystemEndpointRole = (typeof SYSTEM_ENDPOINT_ROLES)[number];

export const SYSTEM_CORRELATION_STATES = [
  'declared_realm_candidate',
  'target_only_candidate',
  'ambiguous',
  'unmatched',
] as const;
export type SystemCorrelationState = (typeof SYSTEM_CORRELATION_STATES)[number];

export const SYSTEM_CORRELATION_AMBIGUITY_REASONS = [
  'multiple_request_consumers',
  'multiple_job_consumers',
  'conflicting_realms',
] as const;
export type SystemCorrelationAmbiguityReason =
  (typeof SYSTEM_CORRELATION_AMBIGUITY_REASONS)[number];

export const SYSTEM_UNMATCHED_REASONS = [
  'producer_only',
  'consumer_only',
  'realm_mismatch',
  'target_mismatch',
  'unsupported_identity',
] as const;
export type SystemUnmatchedReason = (typeof SYSTEM_UNMATCHED_REASONS)[number];

export const SYSTEM_DIAGNOSTIC_CODES = [
  'SYSTEM_TOPOLOGY_MISSING',
  'SYSTEM_TARGET_ONLY_CANDIDATE',
  'SYSTEM_CORRELATION_AMBIGUOUS',
  'SYSTEM_PRODUCER_UNMATCHED',
  'SYSTEM_CONSUMER_UNMATCHED',
  'SYSTEM_REALM_MISMATCH',
  'SYSTEM_TARGET_UNSUPPORTED',
  'SYSTEM_SOURCE_ANALYSIS_INCOMPLETE',
] as const;
export type SystemDiagnosticCode = (typeof SYSTEM_DIAGNOSTIC_CODES)[number];

export interface SystemServiceRecord {
  readonly id: string;
  /** Stable, user-declared service identity; never derived from a repository path. */
  readonly namespace: string;
  readonly displayName: string;
  readonly analysisId: string;
  readonly analysisSchemaVersion: string;
  readonly analysisResultState: Extract<AnalysisResultState, 'completed' | 'completed_with_gaps'>;
  /** Human-readable artifact label only. Absolute paths are not canonical system facts. */
  readonly artifactLabel: string;
}

export interface SystemBrokerDestination {
  readonly kind: SystemBrokerDestinationKind;
  readonly value: string;
}

export interface BrokerRealmRecord {
  readonly id: string;
  /** Explicit topology-manifest alias, not a hostname or credential. */
  readonly brokerAlias: string;
  /** Explicit deployment/environment alias such as test, staging, or production. */
  readonly environmentAlias: string;
  readonly technology: SystemBrokerTechnology;
  readonly transport: SystemBrokerTransport;
  readonly destination: SystemBrokerDestination;
  readonly prefix: string | null;
  readonly namespace: string | null;
  readonly declarationSource: 'topology_manifest';
}

export interface SystemAnalysisRecordReference {
  readonly serviceId: string;
  readonly analysisRecordId: string;
  /** Stable namespace + source-record identity. */
  readonly namespacedId: string;
}

export interface SystemJobQueueContractTarget {
  readonly targetKind: 'job_queue';
  readonly technology: JobQueueTechnology;
  /** Null retains a dynamic or otherwise unsupported queue identity. */
  readonly queue: string | null;
  /** Null retains a queue-wide or otherwise unsupported job identity. */
  readonly job: string | null;
}

export interface SystemMicroserviceMessageContractTarget {
  readonly targetKind: 'microservice_message';
  readonly mode: MicroserviceMessageMode;
  readonly patternKind: MicroservicePatternKind;
  /** Canonical JSON from the source analysis; null only for a dynamic pattern. */
  readonly canonicalPattern: string | null;
}

export type SystemInteractionContractTarget =
  | SystemJobQueueContractTarget
  | SystemMicroserviceMessageContractTarget;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function systemInteractionContractKey(target: SystemInteractionContractTarget): string {
  return canonicalJson(target);
}

export interface SystemInteractionEndpointRecord {
  readonly id: string;
  readonly serviceId: string;
  readonly role: SystemEndpointRole;
  readonly kind: SystemCorrelatableInteractionKind;
  readonly analysisRecord: SystemAnalysisRecordReference;
  readonly contract: SystemInteractionContractTarget;
  readonly contractKey: string;
  /** Source-analysis transport evidence; topology may supplement null but never contradict it. */
  readonly sourceTransport: SystemBrokerTransport | null;
  /** Null means the selected topology supplied no exact realm binding. */
  readonly brokerRealmId: string | null;
}

interface SystemCorrelationBase {
  readonly id: string;
  readonly kind: SystemCorrelatableInteractionKind;
  readonly contractKey: string;
  readonly producerEndpointId: string | null;
  readonly consumerEndpointIds: readonly string[];
  readonly brokerRealmId: string | null;
  readonly diagnosticIds: readonly string[];
}

export interface DeclaredRealmCandidateCorrelation extends SystemCorrelationBase {
  readonly state: 'declared_realm_candidate';
  readonly brokerRealmId: string;
  readonly producerEndpointId: string;
  readonly unmatchedReason: null;
  readonly ambiguityReason: null;
}

export interface TargetOnlyCandidateCorrelation extends SystemCorrelationBase {
  readonly state: 'target_only_candidate';
  readonly brokerRealmId: null;
  readonly producerEndpointId: string;
  readonly unmatchedReason: null;
  readonly ambiguityReason: null;
}

export interface AmbiguousSystemCorrelation extends SystemCorrelationBase {
  readonly state: 'ambiguous';
  readonly producerEndpointId: string;
  readonly unmatchedReason: null;
  readonly ambiguityReason: SystemCorrelationAmbiguityReason;
}

export interface UnmatchedSystemCorrelation extends SystemCorrelationBase {
  readonly state: 'unmatched';
  readonly unmatchedReason: SystemUnmatchedReason;
  readonly ambiguityReason: null;
}

export type SystemInteractionCorrelationRecord =
  | DeclaredRealmCandidateCorrelation
  | TargetOnlyCandidateCorrelation
  | AmbiguousSystemCorrelation
  | UnmatchedSystemCorrelation;

/** Only this state may become a conditional stitch edge in later phases. */
export function systemCorrelationHasDeclaredRealmCandidate(
  correlation: SystemInteractionCorrelationRecord,
): correlation is DeclaredRealmCandidateCorrelation {
  return correlation.state === 'declared_realm_candidate';
}

export interface SystemDiagnosticRecord {
  readonly id: string;
  readonly code: SystemDiagnosticCode;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly subjectId: string;
}

export interface SystemAnalysisDocument {
  readonly schemaVersion: typeof SYSTEM_ANALYSIS_SCHEMA_VERSION;
  readonly systemId: string;
  readonly systemName: string;
  /** Literal guard against embedding or merging source analysis collections. */
  readonly sourceDocumentsEmbedded: false;
  readonly services: readonly SystemServiceRecord[];
  readonly brokerRealms: readonly BrokerRealmRecord[];
  readonly interactionEndpoints: readonly SystemInteractionEndpointRecord[];
  readonly correlations: readonly SystemInteractionCorrelationRecord[];
  readonly diagnostics: readonly SystemDiagnosticRecord[];
}

export const SYSTEM_TOPOLOGY_SCHEMA_VERSION = '1.0.0' as const;

export interface SystemTopologyRealmDeclaration {
  readonly brokerAlias: string;
  readonly environmentAlias: string;
  readonly technology: SystemBrokerTechnology;
  readonly transport: SystemBrokerTransport;
  readonly destination: SystemBrokerDestination;
  readonly prefix: string | null;
  readonly namespace: string | null;
}

export interface SystemTopologyBinding {
  readonly serviceNamespace: string;
  readonly role: SystemEndpointRole;
  readonly contract: SystemInteractionContractTarget;
  /** Optional exact source-record selector. Structural selection is the default. */
  readonly analysisRecordId: string | null;
  readonly brokerAlias: string;
  readonly environmentAlias: string;
}

export interface SystemTopologyManifest {
  readonly schemaVersion: typeof SYSTEM_TOPOLOGY_SCHEMA_VERSION;
  readonly systemName: string;
  readonly brokerRealms: readonly SystemTopologyRealmDeclaration[];
  readonly bindings: readonly SystemTopologyBinding[];
}
