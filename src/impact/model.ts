import type { AssertionPredicate, AssertionStatus } from '../model/assertions.js';
import type { HttpMethod } from '../model/entities.js';
import type { DiffInputSnapshot } from '../comparison/model.js';
import type { SemanticKey, SemanticKeyKind } from '../comparison/semantic-key.js';

export const IMPACT_SCHEMA_VERSION = '1.0.0' as const;
export const IMPACT_SCHEMA_V2_VERSION = '2.0.0' as const;
export type ImpactSchemaVersion = typeof IMPACT_SCHEMA_VERSION | typeof IMPACT_SCHEMA_V2_VERSION;

export const SOURCE_CHANGE_KINDS = ['added', 'removed', 'modified'] as const;
export type SourceChangeKind = (typeof SOURCE_CHANGE_KINDS)[number];

export const IMPACT_GRAPH_SIDES = ['before', 'after'] as const;
export type ImpactGraphSide = (typeof IMPACT_GRAPH_SIDES)[number];

export const IMPACT_CATEGORIES = [
  'direct_endpoint_change',
  'reachable_method_file_change',
  'entity_declaration_file_change',
  'table_access_fact_change',
  'diagnostic_or_resolution_change',
  'unknown_due_to_incomplete_trace',
] as const;
export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];

export const IMPACT_REASON_CODES_V1 = [
  'endpoint_added',
  'endpoint_removed',
  'endpoint_modified',
  'handler_file_changed',
  'changed_method_reachable',
  'changed_entity_table_reachable',
  'table_access_added',
  'table_access_removed',
  'table_access_status_changed',
  'diagnostic_added',
  'diagnostic_resolved',
  'diagnostic_changed',
  'assertion_resolution_changed',
  'interaction_added',
  'interaction_removed',
  'interaction_modified',
  'interaction_handler_added',
  'interaction_handler_removed',
  'interaction_handler_modified',
  'ambiguous_or_incomplete_path',
] as const;
export const IMPACT_REASON_CODES = [
  ...IMPACT_REASON_CODES_V1,
  'job_queue_dispatch_changed',
  'job_queue_branch_changed',
  'job_queue_branch_effect_changed',
] as const;
export type ImpactReasonCode = (typeof IMPACT_REASON_CODES)[number];

export const UNREACHABLE_REASON_CODES = [
  'no_supported_declarations',
  'no_endpoint_path',
  'incomplete_trace_may_hide_path',
] as const;
export type UnreachableReasonCode = (typeof UNREACHABLE_REASON_CODES)[number];

export interface SourceFileSnapshot {
  readonly sourceFileId: string;
  readonly path: string;
  readonly contentHash: string;
}

export interface SourceFileChange {
  readonly change: SourceChangeKind;
  readonly path: string;
  readonly before: SourceFileSnapshot | null;
  readonly after: SourceFileSnapshot | null;
}

export interface ImpactSemanticSubject {
  readonly kind: SemanticKeyKind;
  readonly key: SemanticKey;
  readonly displayName: string;
  readonly sourcePath: string | null;
}

export interface ImpactPathStep {
  readonly assertionId: string;
  readonly fromId: string;
  readonly fromKey: SemanticKey;
  readonly predicate: AssertionPredicate;
  readonly toId: string | null;
  readonly toKey: SemanticKey | null;
  readonly status: AssertionStatus;
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
}

export interface ImpactPath {
  readonly side: ImpactGraphSide;
  readonly endpointId: string;
  readonly targetKey: SemanticKey;
  readonly steps: readonly ImpactPathStep[];
}

export interface ImpactReason {
  readonly category: ImpactCategory;
  readonly reasonCode: ImpactReasonCode;
  readonly subject: ImpactSemanticSubject;
  readonly sourceChangePath: string | null;
  readonly beforeEvidenceIds: readonly string[];
  readonly afterEvidenceIds: readonly string[];
  readonly paths: readonly ImpactPath[];
}

export interface ImpactedEndpoint {
  readonly routeSlotKey: SemanticKey;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly beforeEndpointIds: readonly string[];
  readonly afterEndpointIds: readonly string[];
  readonly direct: boolean;
  readonly reasons: readonly ImpactReason[];
}

export interface UnreachableSourceChange {
  readonly path: string;
  readonly change: SourceChangeKind;
  readonly beforeSubjectKeys: readonly SemanticKey[];
  readonly afterSubjectKeys: readonly SemanticKey[];
  readonly reasonCodes: readonly UnreachableReasonCode[];
}

export interface ImpactSummary {
  readonly sourceFilesAdded: number;
  readonly sourceFilesRemoved: number;
  readonly sourceFilesModified: number;
  readonly impactedEndpointSlots: number;
  readonly directlyChangedEndpointSlots: number;
  readonly transitivelyImpactedEndpointSlots: number;
  readonly unreachableSourceChanges: number;
  readonly reasonsByCategory: Readonly<Record<ImpactCategory, number>>;
}

export interface ImpactDocument {
  readonly schemaVersion: ImpactSchemaVersion;
  readonly before: DiffInputSnapshot;
  readonly after: DiffInputSnapshot;
  readonly summary: ImpactSummary;
  readonly sourceChanges: readonly SourceFileChange[];
  readonly impactedEndpoints: readonly ImpactedEndpoint[];
  readonly unreachableSourceChanges: readonly UnreachableSourceChange[];
}
