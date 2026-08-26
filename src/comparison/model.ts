import type { AnalysisResultState } from '../model/analysis.js';
import type { AssertionPredicate, AssertionStatus } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticSeverity } from '../model/diagnostics.js';
import type { GuardScope, TableAccessDirection } from '../model/index.js';
import type { HttpMethod } from '../model/entities.js';
import type {
  HandlerRegistrationState,
  InteractionActivationState,
  InteractionBoundaryState,
  InteractionDispatchTiming,
  InteractionKind,
} from '../model/interactions.js';
import type { SemanticKey } from './semantic-key.js';

export const DIFF_SCHEMA_VERSION = '1.0.0' as const;
export const DIFF_SCHEMA_V2_VERSION = '2.0.0' as const;
export type DiffSchemaVersion = typeof DIFF_SCHEMA_VERSION | typeof DIFF_SCHEMA_V2_VERSION;
export const FACT_AVAILABILITY_STATES = ['available', 'unavailable'] as const;
export type FactAvailability = (typeof FACT_AVAILABILITY_STATES)[number];

export const ENDPOINT_CHANGE_KINDS = ['added', 'removed', 'modified'] as const;
export type EndpointChangeKind = (typeof ENDPOINT_CHANGE_KINDS)[number];
export const ENDPOINT_CHANGE_REASONS = [
  'endpoint_added',
  'endpoint_removed',
  'handler',
  'direct_guards',
  'effective_guards',
  'terminals',
] as const;
export type EndpointChangeReason = (typeof ENDPOINT_CHANGE_REASONS)[number];

export const DIAGNOSTIC_CHANGE_KINDS = ['new', 'resolved', 'changed'] as const;
export type DiagnosticChangeKind = (typeof DIAGNOSTIC_CHANGE_KINDS)[number];
export const DIAGNOSTIC_CHANGE_REASONS = [
  'diagnostic_added',
  'diagnostic_resolved',
  'severity',
  'message',
  'evidence',
] as const;
export type DiagnosticChangeReason = (typeof DIAGNOSTIC_CHANGE_REASONS)[number];

export const DIFF_AMBIGUITY_KINDS = [
  'semantic_key',
  'endpoint_exact_key',
  'endpoint_route_slot',
  'assertion_key',
  'diagnostic_key',
] as const;
export type DiffAmbiguityKind = (typeof DIFF_AMBIGUITY_KINDS)[number];
export const DIFF_AMBIGUITY_SIDES = ['before', 'after', 'both'] as const;
export type DiffAmbiguitySide = (typeof DIFF_AMBIGUITY_SIDES)[number];

export interface DiffInputSnapshot {
  readonly analysisId: string;
  readonly analysisSchemaVersion: string;
  readonly resultState: Extract<AnalysisResultState, 'completed' | 'completed_with_gaps'>;
  readonly configuration: {
    readonly maxCallDepth: number;
    readonly maxSourceFileBytes: number;
    readonly evidenceSnippetLimit: number;
  };
  readonly facts: {
    readonly directGuards: FactAvailability;
    readonly effectiveGuards: FactAvailability;
    readonly terminals: FactAvailability;
    readonly assertions: FactAvailability;
    readonly diagnostics: FactAvailability;
  };
}

export interface EndpointHandlerFact {
  readonly methodId: string | null;
  readonly methodKey: SemanticKey | null;
  readonly qualifiedName: string | null;
  readonly status: AssertionStatus;
  readonly ruleId: string;
  readonly assertionId: string;
  readonly evidenceIds: readonly string[];
}

export interface EndpointGuardFact {
  readonly guardId: string;
  readonly guardKey: SemanticKey;
  readonly name: string;
  readonly scope: GuardScope;
  readonly status: AssertionStatus;
  readonly ruleId: string;
  readonly assertionId: string;
  readonly evidenceIds: readonly string[];
}

export interface EndpointTerminalContributor {
  readonly methodId: string;
  readonly methodKey: SemanticKey;
  readonly assertionId: string;
  readonly status: AssertionStatus;
  readonly evidenceIds: readonly string[];
}

export interface EndpointTerminalFact {
  readonly key: SemanticKey;
  readonly direction: TableAccessDirection;
  readonly tableId: string;
  readonly tableKey: SemanticKey;
  readonly tableName: string;
  readonly status: Extract<AssertionStatus, 'resolved' | 'ambiguous'>;
  readonly contributors: readonly EndpointTerminalContributor[];
}

export interface EndpointSnapshot {
  readonly endpointId: string;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly routeSlotKey: SemanticKey;
  readonly exactKey: SemanticKey | null;
  readonly identityStatus: 'resolved' | 'ambiguous' | 'unresolved';
  readonly handlers: readonly EndpointHandlerFact[];
  readonly directGuards: {
    readonly availability: FactAvailability;
    readonly guards: readonly EndpointGuardFact[];
  };
  readonly effectiveGuards: {
    readonly availability: FactAvailability;
    readonly guards: readonly EndpointGuardFact[];
  };
  readonly terminals: {
    readonly availability: FactAvailability;
    readonly values: readonly EndpointTerminalFact[];
  };
}

export interface EndpointChange {
  readonly change: EndpointChangeKind;
  readonly routeSlotKey: SemanticKey;
  readonly reasons: readonly EndpointChangeReason[];
  readonly before: EndpointSnapshot | null;
  readonly after: EndpointSnapshot | null;
}

export interface AssertionSnapshot {
  readonly assertionId: string;
  readonly key: SemanticKey;
  readonly subjectKey: SemanticKey;
  readonly predicate: AssertionPredicate;
  readonly objectKey: SemanticKey | null;
  readonly status: AssertionStatus;
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
}

export interface AssertionStatusChange {
  readonly key: SemanticKey;
  readonly before: AssertionSnapshot;
  readonly after: AssertionSnapshot;
}

export interface DiagnosticSnapshot {
  readonly diagnosticId: string;
  readonly key: SemanticKey;
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly subjectKey: SemanticKey | null;
  readonly evidenceIds: readonly string[];
  readonly evidenceKeys: readonly SemanticKey[];
}

export interface DiagnosticChange {
  readonly change: DiagnosticChangeKind;
  readonly key: SemanticKey;
  readonly reasons: readonly DiagnosticChangeReason[];
  readonly before: DiagnosticSnapshot | null;
  readonly after: DiagnosticSnapshot | null;
}

export const INTERACTION_CHANGE_KINDS = ['added', 'removed', 'modified'] as const;
export type InteractionChangeKind = (typeof INTERACTION_CHANGE_KINDS)[number];
export const INTERACTION_CHANGE_REASONS = [
  'interaction_added',
  'interaction_removed',
  'activation',
  'boundary',
  'dispatch_timing',
  'rule',
] as const;
export type InteractionChangeReason = (typeof INTERACTION_CHANGE_REASONS)[number];
export const INTERACTION_HANDLER_CHANGE_REASONS = [
  'handler_added',
  'handler_removed',
  'registration_state',
  'rule',
] as const;
export type InteractionHandlerChangeReason = (typeof INTERACTION_HANDLER_CHANGE_REASONS)[number];

export interface InteractionSnapshot {
  readonly interactionId: string;
  readonly key: SemanticKey;
  readonly kind: InteractionKind;
  readonly sourceMethodKey: SemanticKey;
  readonly targetKey: string;
  readonly applicationKey: SemanticKey | null;
  readonly activation: InteractionActivationState;
  readonly boundary: InteractionBoundaryState;
  readonly dispatchTiming: InteractionDispatchTiming;
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
}

export interface InteractionHandlerSnapshot {
  readonly handlerId: string;
  readonly key: SemanticKey;
  readonly kind: Exclude<InteractionKind, 'outbound_http'>;
  readonly methodKey: SemanticKey;
  readonly targetKey: string;
  readonly applicationKey: SemanticKey | null;
  readonly registrationState: HandlerRegistrationState;
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
}

export interface InteractionChange {
  readonly change: InteractionChangeKind;
  readonly key: SemanticKey;
  readonly reasons: readonly InteractionChangeReason[];
  readonly before: InteractionSnapshot | null;
  readonly after: InteractionSnapshot | null;
}

export interface InteractionHandlerChange {
  readonly change: InteractionChangeKind;
  readonly key: SemanticKey;
  readonly reasons: readonly InteractionHandlerChangeReason[];
  readonly before: InteractionHandlerSnapshot | null;
  readonly after: InteractionHandlerSnapshot | null;
}

export interface DiffAmbiguity {
  readonly kind: DiffAmbiguityKind;
  readonly side: DiffAmbiguitySide;
  readonly recordKind: string;
  readonly key: SemanticKey;
  readonly beforeCandidateIds: readonly string[];
  readonly afterCandidateIds: readonly string[];
}

export interface DiffSummary {
  readonly endpointsAdded: number;
  readonly endpointsRemoved: number;
  readonly endpointsModified: number;
  readonly assertionStatusChanged: number;
  readonly diagnosticsNew: number;
  readonly diagnosticsResolved: number;
  readonly diagnosticsChanged: number;
  readonly ambiguities: number;
  readonly interactionsAdded?: number | undefined;
  readonly interactionsRemoved?: number | undefined;
  readonly interactionsModified?: number | undefined;
  readonly interactionHandlersAdded?: number | undefined;
  readonly interactionHandlersRemoved?: number | undefined;
  readonly interactionHandlersModified?: number | undefined;
}

export interface DiffDocument {
  readonly schemaVersion: DiffSchemaVersion;
  readonly before: DiffInputSnapshot;
  readonly after: DiffInputSnapshot;
  readonly summary: DiffSummary;
  readonly endpointChanges: readonly EndpointChange[];
  readonly assertionStatusChanges: readonly AssertionStatusChange[];
  readonly diagnosticChanges: readonly DiagnosticChange[];
  readonly interactionChanges?: readonly InteractionChange[] | undefined;
  readonly interactionHandlerChanges?: readonly InteractionHandlerChange[] | undefined;
  readonly ambiguities: readonly DiffAmbiguity[];
}
