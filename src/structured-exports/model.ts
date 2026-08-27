import type {
  AnalysisResultState,
  DirectGuardState,
  EffectiveGuardState,
  GlobalGuardState,
  GuardScope,
} from '../model/analysis.js';
import type { AssertionStatus } from '../model/assertions.js';
import type { ColumnInfluenceState, HttpMethod } from '../model/entities.js';
import type {
  HandlerRegistrationState,
  InteractionActivationState,
  InteractionBoundaryState,
  InteractionDispatchTiming,
} from '../model/interactions.js';
import type { TableAccessDirection, TraceCausalClass } from '../model/analysis.js';
import type {
  PolicyOutcome,
  PolicyReasonCode,
  PolicyRuleId,
  PolicySeverity,
} from '../policy/model.js';

export const OPENAPI_ENRICHMENT_SCHEMA_VERSION = '1.0.0' as const;
export const OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION = '2.0.0' as const;
export const OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION = '3.0.0' as const;
export const CONTROL_EVIDENCE_SCHEMA_VERSION = '1.0.0' as const;
export const CONTROL_EVIDENCE_SCHEMA_V2_VERSION = '2.0.0' as const;
export const CONTROL_EVIDENCE_SCHEMA_V3_VERSION = '3.0.0' as const;
export type OpenApiEnrichmentSchemaVersion =
  | typeof OPENAPI_ENRICHMENT_SCHEMA_VERSION
  | typeof OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION
  | typeof OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION;
export type ControlEvidenceSchemaVersion =
  | typeof CONTROL_EVIDENCE_SCHEMA_VERSION
  | typeof CONTROL_EVIDENCE_SCHEMA_V2_VERSION
  | typeof CONTROL_EVIDENCE_SCHEMA_V3_VERSION;

export interface EndpointInteractionSummary {
  readonly interactionId: string;
  readonly kind: 'outbound_http' | 'in_process_event' | 'job_queue' | 'microservice_message';
  readonly target: string;
  readonly activation: InteractionActivationState;
  readonly boundary: InteractionBoundaryState;
  readonly dispatchTiming: InteractionDispatchTiming;
  readonly handlerStates: readonly HandlerRegistrationState[];
  readonly evidenceIds: readonly string[];
}

export interface EndpointLocalCausalEffect {
  readonly direction: TableAccessDirection;
  readonly table: string;
  readonly causalClass: Extract<
    TraceCausalClass,
    'local_interaction_synchronous' | 'local_interaction_asynchronous'
  >;
  readonly evidenceIds: readonly string[];
}

export interface EndpointDistributedCausalEffect {
  readonly direction: TableAccessDirection;
  readonly table: string;
  readonly causalClass: Extract<TraceCausalClass, 'distributed_conditional'>;
  readonly evidenceIds: readonly string[];
}

export const OPENAPI_MATCH_RESOLUTIONS = [
  'resolved',
  'ambiguous',
  'unresolved',
  'unmatched',
] as const;
export type OpenApiMatchResolution = (typeof OPENAPI_MATCH_RESOLUTIONS)[number];

export interface OpenApiResolvedExtension {
  readonly schemaVersion: OpenApiEnrichmentSchemaVersion;
  readonly resolution: 'resolved';
  readonly analysisId: string;
  readonly endpointId: string;
  readonly guards: {
    readonly direct: readonly string[];
    readonly global: readonly string[];
    readonly directState: DirectGuardState;
    readonly globalState: GlobalGuardState;
    readonly effectiveState: EffectiveGuardState;
  };
  readonly dbReads: readonly string[];
  readonly dbWrites: readonly string[];
  readonly diagnosticCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly outboundInteractions?: readonly EndpointInteractionSummary[] | undefined;
  readonly localInteractions?: readonly EndpointInteractionSummary[] | undefined;
  readonly localCausalEffects?: readonly EndpointLocalCausalEffect[] | undefined;
  readonly distributedInteractions?: readonly EndpointInteractionSummary[] | undefined;
  readonly distributedConditionalEffects?: readonly EndpointDistributedCausalEffect[] | undefined;
}

export interface OpenApiNonResolvedExtension {
  readonly schemaVersion: OpenApiEnrichmentSchemaVersion;
  readonly resolution: Exclude<OpenApiMatchResolution, 'resolved'>;
  readonly analysisId: string;
  readonly candidateEndpointIds: readonly string[];
  readonly diagnosticCodes: readonly string[];
  readonly evidenceIds: readonly string[];
}

export type OpenApiIntelExtension = OpenApiResolvedExtension | OpenApiNonResolvedExtension;

export interface OpenApiOperationMatch {
  readonly openApiPath: string;
  readonly normalizedPath: string;
  readonly httpMethod: string;
  readonly resolution: OpenApiMatchResolution;
  readonly analysisEndpointIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface OpenApiUnmatchedAnalysisEndpoint {
  readonly endpointId: string;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly mappedOpenApiPath: string;
}

export interface OpenApiEnrichmentResultDocument {
  readonly schemaVersion: OpenApiEnrichmentSchemaVersion;
  readonly analysisId: string;
  readonly analysisSchemaVersion: string;
  readonly openApiVersion: string;
  readonly pathPrefix: string;
  readonly extensionEvidence: 'included' | 'sidecar_only';
  readonly summary: {
    readonly operations: number;
    readonly resolved: number;
    readonly ambiguous: number;
    readonly unresolved: number;
    readonly unmatched: number;
    readonly unmatchedAnalysisEndpoints: number;
  };
  readonly operations: readonly OpenApiOperationMatch[];
  readonly unmatchedAnalysisEndpoints: readonly OpenApiUnmatchedAnalysisEndpoint[];
}

export const MUTATION_CLASSIFICATIONS = ['write', 'non_write', 'unknown'] as const;
export type MutationClassification = (typeof MUTATION_CLASSIFICATIONS)[number];

export interface ControlEvidenceGuard {
  readonly name: string;
  readonly scope: GuardScope;
  readonly status: AssertionStatus;
  readonly evidenceIds: readonly string[];
}

export interface ControlEvidenceInfluence {
  readonly origin: string;
  readonly column: string;
  readonly state: ColumnInfluenceState;
  readonly sinkMethod: string;
  readonly callDepth: number;
  readonly evidenceIds: readonly string[];
}

export interface ControlEvidencePolicyOutcome {
  readonly ruleId: PolicyRuleId;
  readonly outcome: PolicyOutcome;
  readonly severity: PolicySeverity;
  readonly blocking: boolean;
  readonly reasonCode: PolicyReasonCode;
  readonly evidenceIds: readonly string[];
}

export interface ControlEvidenceRow {
  readonly analysisId: string;
  readonly analysisSchemaVersion: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly endpointId: string;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly handler: string | null;
  readonly selectionStatus: 'resolved' | 'ambiguous' | 'unresolved';
  readonly directGuardState: DirectGuardState;
  readonly globalGuardState: GlobalGuardState;
  readonly effectiveGuardState: EffectiveGuardState;
  readonly directGuards: readonly ControlEvidenceGuard[];
  readonly globalGuards: readonly ControlEvidenceGuard[];
  readonly mutationClassification: MutationClassification;
  readonly dbReads: readonly string[];
  readonly dbWrites: readonly string[];
  readonly outboundInteractions?: readonly EndpointInteractionSummary[] | undefined;
  readonly localInteractions?: readonly EndpointInteractionSummary[] | undefined;
  readonly localCausalEffects?: readonly EndpointLocalCausalEffect[] | undefined;
  readonly distributedInteractions?: readonly EndpointInteractionSummary[] | undefined;
  readonly distributedConditionalEffects?: readonly EndpointDistributedCausalEffect[] | undefined;
  readonly requestColumnInfluences: readonly ControlEvidenceInfluence[];
  readonly diagnosticCodes: readonly string[];
  readonly incompletenessCodes: readonly string[];
  readonly policyOutcomes: readonly ControlEvidencePolicyOutcome[];
  readonly evidenceIds: readonly string[];
  readonly sourceLocations: readonly string[];
}

export interface ControlEvidenceDocument {
  readonly schemaVersion: ControlEvidenceSchemaVersion;
  readonly analysis: {
    readonly id: string;
    readonly schemaVersion: string;
    readonly resultState: Extract<AnalysisResultState, 'completed' | 'completed_with_gaps'>;
    readonly repositoryRevision: string | null;
    readonly toolName: string;
    readonly toolVersion: string;
    readonly typescriptVersion: string;
  };
  readonly policy: {
    readonly state: 'not_supplied' | 'supplied';
    readonly schemaVersion: string | null;
  };
  readonly rows: readonly ControlEvidenceRow[];
}
