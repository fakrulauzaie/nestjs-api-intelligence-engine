import type {
  AnalysisResultState,
  DirectGuardState,
  EffectiveGuardState,
  GlobalGuardState,
} from '../model/analysis.js';
import type { AssertionStatus } from '../model/assertions.js';
import type { DiagnosticSeverity } from '../model/diagnostics.js';
import type { EvidenceRole } from '../model/evidence.js';
import type { HttpMethod } from '../model/entities.js';
import type {
  HandlerRegistrationState,
  InteractionBoundaryState,
  InteractionKind,
} from '../model/interactions.js';
import type { ImpactCategory, ImpactGraphSide, ImpactReasonCode } from '../impact/model.js';
import type {
  PolicyOutcome,
  PolicyReasonCode,
  PolicyRuleId,
  PolicySeverity,
} from '../policy/model.js';
import type {
  EndpointDistributedCausalEffect,
  EndpointLocalCausalEffect,
  MutationClassification,
} from '../structured-exports/model.js';

export const GRAPH_REPORT_SCHEMA_VERSION = '1.0.0' as const;
export const GRAPH_REPORT_SCHEMA_V2_VERSION = '2.0.0' as const;
export const GRAPH_REPORT_SCHEMA_V3_VERSION = '3.0.0' as const;
export const GRAPH_REPORT_SCHEMA_V4_VERSION = '4.0.0' as const;
export type GraphReportSchemaVersion =
  | typeof GRAPH_REPORT_SCHEMA_VERSION
  | typeof GRAPH_REPORT_SCHEMA_V2_VERSION
  | typeof GRAPH_REPORT_SCHEMA_V3_VERSION
  | typeof GRAPH_REPORT_SCHEMA_V4_VERSION;
export const DEFAULT_GRAPH_NODE_LIMIT = 120;
export const DEFAULT_GRAPH_EDGE_LIMIT = 180;
export const MIN_GRAPH_DISPLAY_LIMIT = 10;
export const MAX_GRAPH_NODE_LIMIT = 500;
export const MAX_GRAPH_EDGE_LIMIT = 1_000;

export const GRAPH_NODE_KINDS_V1 = [
  'endpoint',
  'method',
  'table',
  'guard',
  'request_parameter',
  'request_origin',
  'entity_column',
  'gap',
] as const;
export const GRAPH_NODE_KINDS_V2 = [...GRAPH_NODE_KINDS_V1, 'interaction'] as const;
export const GRAPH_NODE_KINDS = [
  ...GRAPH_NODE_KINDS_V2,
  'interaction_handler',
  'external_target',
  'boundary',
] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const GRAPH_EDGE_KINDS_V2 = ['assertion', 'guard', 'provenance'] as const;
export const GRAPH_EDGE_KINDS = [...GRAPH_EDGE_KINDS_V2, 'interaction'] as const;
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export const GRAPH_UNCERTAINTY_STATES = [
  'resolved',
  'ambiguous',
  'unresolved',
  'unsupported',
  'unknown',
] as const;
export type GraphUncertaintyState = (typeof GRAPH_UNCERTAINTY_STATES)[number];

export const GRAPH_IMPACT_STATES = ['none', 'direct', 'potential', 'unknown'] as const;
export type GraphImpactState = (typeof GRAPH_IMPACT_STATES)[number];

export interface GraphReportLimits {
  readonly maxNodesPerEndpoint: number;
  readonly maxEdgesPerEndpoint: number;
  readonly maxEvidencePerEndpoint: number;
}

export interface GraphReportNode {
  readonly id: string;
  readonly label: string;
  readonly kind: GraphNodeKind;
  readonly uncertainty: GraphUncertaintyState;
  readonly impact: GraphImpactState;
  readonly evidenceIds: readonly string[];
}

export interface GraphReportEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly kind: GraphEdgeKind;
  readonly relation: string | null;
  readonly uncertainty: GraphUncertaintyState;
  readonly impact: GraphImpactState;
  readonly evidenceIds: readonly string[];
}

export interface GraphReportEvidence {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly role: EvidenceRole;
  readonly snippet: string | null;
}

export interface GraphReportScene {
  readonly nodes: readonly GraphReportNode[];
  readonly edges: readonly GraphReportEdge[];
  readonly evidence: readonly GraphReportEvidence[];
  readonly omitted: {
    readonly nodes: number;
    readonly edges: number;
    readonly evidence: number;
  };
}

export interface GraphReportDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

export interface GraphReportPolicyOutcome {
  readonly ruleId: PolicyRuleId;
  readonly outcome: PolicyOutcome;
  readonly severity: PolicySeverity;
  readonly blocking: boolean;
  readonly reasonCode: PolicyReasonCode;
  readonly evidenceIds: readonly string[];
}

export interface GraphReportImpactReason {
  readonly category: ImpactCategory;
  readonly reasonCode: ImpactReasonCode;
  readonly subject: string;
  readonly sourceChangePath: string | null;
}

export interface GraphReportEndpoint {
  readonly endpointId: string;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly handler: string | null;
  readonly selectionStatus: 'resolved' | 'ambiguous' | 'unresolved';
  readonly directGuardState: DirectGuardState;
  readonly globalGuardState: GlobalGuardState;
  readonly effectiveGuardState: EffectiveGuardState;
  readonly guards: readonly string[];
  readonly mutationClassification: MutationClassification;
  readonly dbReads: readonly string[];
  readonly dbWrites: readonly string[];
  readonly localCausalEffects?: readonly EndpointLocalCausalEffect[] | undefined;
  readonly distributedConditionalEffects?: readonly EndpointDistributedCausalEffect[] | undefined;
  readonly diagnostics: readonly GraphReportDiagnostic[];
  readonly policyOutcomes: readonly GraphReportPolicyOutcome[];
  readonly impact: GraphImpactState;
  readonly impactReasons: readonly GraphReportImpactReason[];
  readonly scene: GraphReportScene;
}

export interface GraphReportInteractionHandler {
  readonly handlerId: string;
  readonly kind: Exclude<InteractionKind, 'outbound_http'>;
  readonly target: string;
  readonly method: string;
  readonly registrationState: HandlerRegistrationState;
  readonly boundary: InteractionBoundaryState;
  readonly causalClass:
    | 'local_interaction_synchronous'
    | 'local_interaction_asynchronous'
    | 'distributed_conditional'
    | 'unknown';
  readonly dbReads: readonly string[];
  readonly dbWrites: readonly string[];
  readonly diagnostics: readonly GraphReportDiagnostic[];
  readonly producerInteractionIds: readonly string[];
  readonly scene: GraphReportScene;
}

export interface GraphReportDocument {
  readonly schemaVersion: GraphReportSchemaVersion;
  readonly analysis: {
    readonly id: string;
    readonly schemaVersion: string;
    readonly resultState: Extract<AnalysisResultState, 'completed' | 'completed_with_gaps'>;
    readonly repositoryRevision: string | null;
    readonly toolName: string;
    readonly toolVersion: string;
  };
  readonly policy: {
    readonly state: 'not_supplied' | 'supplied';
    readonly schemaVersion: string | null;
  };
  readonly impact: {
    readonly state: 'not_supplied' | 'supplied';
    readonly schemaVersion: string | null;
    readonly side: ImpactGraphSide | null;
  };
  readonly limits: GraphReportLimits;
  readonly summary: {
    readonly endpoints: number;
    readonly endpointsWithGuards: number;
    readonly endpointsWithDiagnostics: number;
    readonly endpointsWithWrites: number;
    readonly impactedEndpoints: number;
    readonly omittedNodes: number;
    readonly omittedEdges: number;
    readonly omittedEvidence: number;
    readonly interactionHandlers?: number | undefined;
    readonly handlersWithDiagnostics?: number | undefined;
    readonly handlersWithWrites?: number | undefined;
  };
  readonly endpoints: readonly GraphReportEndpoint[];
  readonly interactionHandlers?: readonly GraphReportInteractionHandler[] | undefined;
}

export function graphUncertaintyFromAssertion(status: AssertionStatus): GraphUncertaintyState {
  return status;
}
