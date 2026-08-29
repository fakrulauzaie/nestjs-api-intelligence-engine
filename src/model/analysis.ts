import type { AssertionRecord, AssertionStatus } from './assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from './diagnostics.js';
import type {
  AnalysisConfiguration,
  AnalysisRunRecord,
  ClassRecord,
  ColumnInfluenceRecord,
  ContractFieldRecord,
  ContractTypeRecord,
  EndpointRecord,
  EntityColumnRecord,
  GuardRecord,
  GlobalGuardRegistrationRecord,
  HttpMethod,
  MethodRecord,
  ModuleRecord,
  RecordId,
  RepositoryBindingRecord,
  RequestParameterRecord,
  RequestFieldOriginRecord,
  ResponseContractRecord,
  RawSqlDialect,
  SourceFileRecord,
  TableRecord,
  ToolMetadata,
  TypeOrmEntityRecord,
} from './entities.js';
import type { EvidenceRecord } from './evidence.js';
import type {
  ApplicationRecord,
  InteractionAnalysisMetadata,
  InteractionHandlerRecord,
  InteractionRecord,
} from './interactions.js';
import type {
  JobQueueHandlerBranchEffectRecord,
  JobQueueHandlerBranchRecord,
  JobQueueHandlerDispatchRecord,
} from './job-queue-branches.js';
import type {
  AuthorizationAnalysisConfiguration,
  AuthorizationEnforcementRecord,
  AuthorizationMetadataRecord,
} from './authorization.js';
import type { NormalizedPolicyRuleConfiguration } from '../policy/model.js';

export const ANALYSIS_SCHEMA_V1_VERSION = '1.0.0' as const;
export const ANALYSIS_SCHEMA_V2_VERSION = '2.0.0' as const;
export const ANALYSIS_SCHEMA_V3_VERSION = '3.0.0' as const;
export const ANALYSIS_SCHEMA_V4_VERSION = '4.0.0' as const;
export const ANALYSIS_SCHEMA_V5_VERSION = '5.0.0' as const;
/** Frozen v1 authoring constant retained for compatibility fixtures. */
export const ANALYSIS_SCHEMA_VERSION = ANALYSIS_SCHEMA_V1_VERSION;
export const CURRENT_ANALYSIS_SCHEMA_VERSION = ANALYSIS_SCHEMA_V5_VERSION;

export const ANALYSIS_RESULT_STATES = [
  'completed',
  'completed_with_gaps',
  'failed',
  'canceled',
] as const;
export type AnalysisResultState = (typeof ANALYSIS_RESULT_STATES)[number];

interface AnalysisDocumentBase {
  readonly resultState: AnalysisResultState;
  readonly analysisRun: AnalysisRunRecord;
  readonly sourceFiles: readonly SourceFileRecord[];
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly endpoints: readonly EndpointRecord[];
  readonly guards: readonly GuardRecord[];
  readonly repositoryBindings: readonly RepositoryBindingRecord[];
  readonly entities: readonly TypeOrmEntityRecord[];
  readonly tables: readonly TableRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

export interface AnalysisDocumentV1 extends AnalysisDocumentBase {
  readonly schemaVersion: typeof ANALYSIS_SCHEMA_V1_VERSION;
}

export const GLOBAL_ANALYSIS_COMPLETENESS_STATES = ['complete', 'incomplete'] as const;
export type GlobalAnalysisCompleteness = (typeof GLOBAL_ANALYSIS_COMPLETENESS_STATES)[number];
export const GLOBAL_GUARD_STATES = ['declared', 'none_proven', 'unknown'] as const;
export type GlobalGuardState = (typeof GLOBAL_GUARD_STATES)[number];

export interface GlobalGuardAnalysis {
  readonly completeness: GlobalAnalysisCompleteness;
  readonly state: GlobalGuardState;
}

export interface AnalysisDocumentV2 extends AnalysisDocumentBase {
  readonly schemaVersion: typeof ANALYSIS_SCHEMA_V2_VERSION;
  readonly modules: readonly ModuleRecord[];
  readonly globalGuardRegistrations: readonly GlobalGuardRegistrationRecord[];
  readonly globalGuardAnalysis: GlobalGuardAnalysis;
  readonly contractTypes: readonly ContractTypeRecord[];
  readonly contractFields: readonly ContractFieldRecord[];
  readonly requestParameters: readonly RequestParameterRecord[];
  readonly responseContracts: readonly ResponseContractRecord[];
  readonly entityColumns: readonly EntityColumnRecord[];
  readonly requestFieldOrigins: readonly RequestFieldOriginRecord[];
  readonly columnInfluences: readonly ColumnInfluenceRecord[];
}

export interface AnalysisDocumentV3 extends AnalysisDocumentBase {
  readonly schemaVersion: typeof ANALYSIS_SCHEMA_V3_VERSION;
  readonly modules: readonly ModuleRecord[];
  readonly globalGuardRegistrations: readonly GlobalGuardRegistrationRecord[];
  readonly globalGuardAnalysis: GlobalGuardAnalysis;
  readonly contractTypes: readonly ContractTypeRecord[];
  readonly contractFields: readonly ContractFieldRecord[];
  readonly requestParameters: readonly RequestParameterRecord[];
  readonly responseContracts: readonly ResponseContractRecord[];
  readonly entityColumns: readonly EntityColumnRecord[];
  readonly requestFieldOrigins: readonly RequestFieldOriginRecord[];
  readonly columnInfluences: readonly ColumnInfluenceRecord[];
  readonly applications: readonly ApplicationRecord[];
  readonly interactions: readonly InteractionRecord[];
  readonly interactionHandlers: readonly InteractionHandlerRecord[];
  readonly interactionAnalysis: InteractionAnalysisMetadata;
}

export interface AnalysisDocumentV4 extends AnalysisDocumentBase {
  readonly schemaVersion: typeof ANALYSIS_SCHEMA_V4_VERSION;
  readonly modules: readonly ModuleRecord[];
  readonly globalGuardRegistrations: readonly GlobalGuardRegistrationRecord[];
  readonly globalGuardAnalysis: GlobalGuardAnalysis;
  readonly contractTypes: readonly ContractTypeRecord[];
  readonly contractFields: readonly ContractFieldRecord[];
  readonly requestParameters: readonly RequestParameterRecord[];
  readonly responseContracts: readonly ResponseContractRecord[];
  readonly entityColumns: readonly EntityColumnRecord[];
  readonly requestFieldOrigins: readonly RequestFieldOriginRecord[];
  readonly columnInfluences: readonly ColumnInfluenceRecord[];
  readonly applications: readonly ApplicationRecord[];
  readonly interactions: readonly InteractionRecord[];
  readonly interactionHandlers: readonly InteractionHandlerRecord[];
  readonly interactionAnalysis: InteractionAnalysisMetadata;
  readonly interactionHandlerDispatches: readonly JobQueueHandlerDispatchRecord[];
  readonly interactionHandlerBranches: readonly JobQueueHandlerBranchRecord[];
  readonly interactionHandlerBranchEffects: readonly JobQueueHandlerBranchEffectRecord[];
}

export interface AnalysisDocumentV5 extends AnalysisDocumentBase {
  readonly schemaVersion: typeof ANALYSIS_SCHEMA_V5_VERSION;
  readonly modules: readonly ModuleRecord[];
  readonly globalGuardRegistrations: readonly GlobalGuardRegistrationRecord[];
  readonly globalGuardAnalysis: GlobalGuardAnalysis;
  readonly contractTypes: readonly ContractTypeRecord[];
  readonly contractFields: readonly ContractFieldRecord[];
  readonly requestParameters: readonly RequestParameterRecord[];
  readonly responseContracts: readonly ResponseContractRecord[];
  readonly entityColumns: readonly EntityColumnRecord[];
  readonly requestFieldOrigins: readonly RequestFieldOriginRecord[];
  readonly columnInfluences: readonly ColumnInfluenceRecord[];
  readonly applications: readonly ApplicationRecord[];
  readonly interactions: readonly InteractionRecord[];
  readonly interactionHandlers: readonly InteractionHandlerRecord[];
  readonly interactionAnalysis: InteractionAnalysisMetadata;
  readonly interactionHandlerDispatches: readonly JobQueueHandlerDispatchRecord[];
  readonly interactionHandlerBranches: readonly JobQueueHandlerBranchRecord[];
  readonly interactionHandlerBranchEffects: readonly JobQueueHandlerBranchEffectRecord[];
  readonly authorizationMetadata: readonly AuthorizationMetadataRecord[];
  readonly authorizationEnforcements: readonly AuthorizationEnforcementRecord[];
}

export type InteractionAnalysisDocument =
  | AnalysisDocumentV3
  | AnalysisDocumentV4
  | AnalysisDocumentV5;

export type AnalysisDocument =
  | AnalysisDocumentV1
  | AnalysisDocumentV2
  | AnalysisDocumentV3
  | AnalysisDocumentV4
  | AnalysisDocumentV5;

export function analysisHasInteractionFacts(
  analysis: AnalysisDocument,
): analysis is InteractionAnalysisDocument {
  return (
    analysis.schemaVersion === '3.0.0' ||
    analysis.schemaVersion === '4.0.0' ||
    analysis.schemaVersion === '5.0.0'
  );
}

export function analysisHasJobQueueBranchFacts(
  analysis: AnalysisDocument,
): analysis is AnalysisDocumentV4 | AnalysisDocumentV5 {
  return analysis.schemaVersion === '4.0.0' || analysis.schemaVersion === '5.0.0';
}

export function analysisHasAuthorizationFacts(
  analysis: AnalysisDocument,
): analysis is AnalysisDocumentV5 {
  return analysis.schemaVersion === '5.0.0';
}

export const PROJECT_CONFIGURATION_SOURCE_KINDS = ['none', 'discovered', 'explicit'] as const;
export type ProjectConfigurationSourceKind = (typeof PROJECT_CONFIGURATION_SOURCE_KINDS)[number];

export interface EffectiveProjectConfiguration {
  readonly source: {
    readonly kind: ProjectConfigurationSourceKind;
    readonly path: string | null;
    readonly fileVersion: 1 | 2 | 3 | 4 | null;
  };
  readonly analysis: {
    readonly maxCallDepth: number;
    readonly rawSqlDialect: RawSqlDialect | null;
    readonly interactions?:
      | {
          readonly maxInteractionHops: number;
          readonly maxFanOutPerInteraction: number;
          readonly maxInteractionTraceStates: number;
        }
      | undefined;
    readonly authorization?: AuthorizationAnalysisConfiguration | undefined;
  };
  readonly output: {
    readonly directory: string;
  };
  readonly rules: readonly NormalizedPolicyRuleConfiguration[];
  readonly reports: {
    readonly policy: {
      readonly enabled: boolean;
    };
    readonly graph: {
      readonly enabled: boolean;
      readonly maxNodesPerEndpoint: number;
      readonly maxEdgesPerEndpoint: number;
    };
    readonly controls: {
      readonly enabled: boolean;
    };
    readonly openapi: {
      readonly enabled: boolean;
      readonly documentPath: string | null;
      readonly pathPrefix: string;
      readonly includeEvidence: boolean;
    };
  };
}

export interface RunDocument {
  readonly schemaVersion: AnalysisDocument['schemaVersion'];
  readonly analysisId: RecordId;
  readonly repositoryPath: string;
  readonly repositoryRevision: string | null;
  readonly startedAt: string;
  readonly endedAt?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly resultState: AnalysisResultState;
  readonly tool: ToolMetadata;
  readonly configuration: AnalysisConfiguration;
  readonly projectConfiguration?: EffectiveProjectConfiguration | undefined;
  readonly diagnostics: readonly DiagnosticRecord[];
}

export const GUARD_SCOPES = ['application_global', 'controller', 'method'] as const;
export type GuardScope = (typeof GUARD_SCOPES)[number];
export const DIRECT_GUARD_STATES = ['declared', 'none_declared'] as const;
export type DirectGuardState = (typeof DIRECT_GUARD_STATES)[number];
export const EFFECTIVE_GUARD_STATES = [
  'guard_declared',
  'no_supported_guard_proven',
  'unknown',
] as const;
export type EffectiveGuardState = (typeof EFFECTIVE_GUARD_STATES)[number];

export interface EndpointTraceGuard {
  readonly guardId: RecordId;
  readonly name: string;
  readonly scope: GuardScope;
  readonly status: AssertionStatus;
  readonly evidenceIds: readonly RecordId[];
}

export interface EndpointTraceStep {
  readonly fromId: RecordId;
  readonly relation: AssertionRecord['predicate'];
  readonly toId: RecordId | null;
  readonly status: AssertionStatus;
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}

export const TABLE_ACCESS_DIRECTIONS = ['READ', 'WRITE'] as const;
export type TableAccessDirection = (typeof TABLE_ACCESS_DIRECTIONS)[number];

export const TRACE_CAUSAL_CLASSES = [
  'synchronous',
  'local_interaction_synchronous',
  'local_interaction_asynchronous',
  'distributed_conditional',
] as const;
export type TraceCausalClass = (typeof TRACE_CAUSAL_CLASSES)[number];

export interface EndpointTraceTerminal {
  readonly methodId: RecordId;
  readonly direction: TableAccessDirection;
  readonly tableId: RecordId;
  readonly tableName: string;
  /** Present on v3/v4 traces; omitted by frozen v1/v2 views. */
  readonly causalClass?: TraceCausalClass | undefined;
}

export interface EndpointTraceView {
  readonly schemaVersion: AnalysisDocument['schemaVersion'];
  readonly analysisId: RecordId;
  readonly endpoint: {
    readonly id: RecordId;
    readonly httpMethod: HttpMethod;
    readonly path: string;
  };
  readonly directGuardState: DirectGuardState;
  readonly globalGuardState: GlobalGuardState;
  readonly effectiveGuardState: EffectiveGuardState;
  readonly guards: readonly EndpointTraceGuard[];
  readonly steps: readonly EndpointTraceStep[];
  readonly terminals: readonly EndpointTraceTerminal[];
  readonly diagnosticIds: readonly RecordId[];
  /** Present only on v3/v4 endpoint traces. */
  readonly causalSummary?:
    | {
        readonly synchronousEffects: readonly EndpointTraceTerminal[];
        readonly localInteractionEffects: readonly EndpointTraceTerminal[];
        readonly distributedConditionalEffects: readonly EndpointTraceTerminal[];
        readonly outboundInteractionIds: readonly RecordId[];
        readonly localInteractionIds: readonly RecordId[];
        /** Present when a v3/v4 trace initiates a queue or microservice boundary. */
        readonly distributedInteractionIds?: readonly RecordId[] | undefined;
        /** Present on v4 when exact BullMQ producers select bounded worker branches. */
        readonly jobQueueBranchIds?: readonly RecordId[] | undefined;
        readonly completeness: {
          readonly state: 'complete' | 'incomplete';
          readonly diagnosticCodes: readonly DiagnosticCode[];
        };
      }
    | undefined;
}

export interface InteractionHandlerTraceView {
  readonly schemaVersion: AnalysisDocument['schemaVersion'];
  readonly analysisId: RecordId;
  readonly handler: InteractionHandlerRecord;
  readonly steps: readonly EndpointTraceStep[];
  readonly terminals: readonly EndpointTraceTerminal[];
  readonly diagnosticIds: readonly RecordId[];
}
