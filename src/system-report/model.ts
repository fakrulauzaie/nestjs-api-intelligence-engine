import type {
  SystemAnalysisRecordReference,
  SystemCorrelationState,
} from '../system-analysis/model.js';

export const SYSTEM_REPORT_SCHEMA_VERSION = '1.0.0' as const;

export const DEFAULT_SYSTEM_REPORT_NODE_LIMIT = 240;
export const DEFAULT_SYSTEM_REPORT_EDGE_LIMIT = 400;

export const SYSTEM_REPORT_NODE_KINDS = [
  'service',
  'broker_realm',
  'broker_destination',
  'http_endpoint',
  'producer',
  'consumer',
  'table_effect',
  'resource_effect',
] as const;
export type SystemReportNodeKind = (typeof SYSTEM_REPORT_NODE_KINDS)[number];

export const SYSTEM_REPORT_EDGE_KINDS = [
  'initiates',
  'conditional_route',
  'conditional_candidate',
  'conditional_effect',
] as const;
export type SystemReportEdgeKind = (typeof SYSTEM_REPORT_EDGE_KINDS)[number];

export const SYSTEM_REPORT_CERTAINTY_STATES = [
  'resolved',
  'ambiguous',
  'conditional_candidate',
  'unknown',
] as const;
export type SystemReportCertaintyState = (typeof SYSTEM_REPORT_CERTAINTY_STATES)[number];

export const SYSTEM_POLICY_RULE_IDS = [
  'require-declared-realm-candidate',
  'forbid-ambiguous-system-correlation',
] as const;
export type SystemPolicyRuleId = (typeof SYSTEM_POLICY_RULE_IDS)[number];

export const SYSTEM_POLICY_OUTCOMES = ['pass', 'fail', 'unknown', 'not_applicable'] as const;
export type SystemPolicyOutcome = (typeof SYSTEM_POLICY_OUTCOMES)[number];

export const SYSTEM_POLICY_REASON_CODES = [
  'declared_realm_candidate_found',
  'declared_realm_candidate_missing',
  'declared_realm_candidate_unknown',
  'correlation_unambiguous',
  'correlation_ambiguous',
] as const;
export type SystemPolicyReasonCode = (typeof SYSTEM_POLICY_REASON_CODES)[number];

export interface SystemReportNode {
  readonly id: string;
  readonly label: string;
  readonly kind: SystemReportNodeKind;
  readonly parentId: string | null;
  readonly serviceId: string | null;
  readonly certainty: SystemReportCertaintyState;
  readonly analysisRecords: readonly SystemAnalysisRecordReference[];
  readonly correlationIds: readonly string[];
  readonly diagnosticIds: readonly string[];
}

export interface SystemReportEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly kind: SystemReportEdgeKind;
  readonly certainty: SystemReportCertaintyState;
  readonly correlationId: string | null;
  readonly diagnosticIds: readonly string[];
}

export interface SystemReportDiagnostic {
  readonly id: string;
  readonly origin: 'system_analysis' | 'source_analysis';
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly subjectId: string;
  readonly serviceId: string | null;
  readonly sourceDiagnosticId: string | null;
}

export interface SystemReportCorrelation {
  readonly id: string;
  readonly state: SystemCorrelationState;
  readonly kind: 'job_queue' | 'microservice_message';
  readonly contractLabel: string;
  readonly producerEndpointId: string | null;
  readonly consumerEndpointIds: readonly string[];
  readonly brokerRealmId: string | null;
  readonly reason: string | null;
  readonly diagnosticIds: readonly string[];
}

export interface SystemConditionalPath {
  readonly id: string;
  readonly correlationId: string;
  readonly httpRootNodeId: string | null;
  readonly producerNodeId: string;
  readonly brokerDestinationNodeId: string;
  readonly consumerNodeId: string;
  readonly effectNodeIds: readonly string[];
  readonly boundary: 'conditional_candidate';
  readonly completeness: 'complete' | 'incomplete';
  readonly diagnosticIds: readonly string[];
}

export interface SystemPolicyResult {
  readonly id: string;
  readonly ruleId: SystemPolicyRuleId;
  readonly outcome: SystemPolicyOutcome;
  readonly reasonCode: SystemPolicyReasonCode;
  readonly message: string;
  readonly subjectCorrelationId: string;
}

export interface SystemReportDocument {
  readonly schemaVersion: typeof SYSTEM_REPORT_SCHEMA_VERSION;
  readonly reportId: string;
  readonly system: {
    readonly id: string;
    readonly name: string;
    readonly schemaVersion: string;
  };
  readonly sourceDocumentsEmbedded: false;
  readonly limits: {
    readonly maxNodes: number;
    readonly maxEdges: number;
  };
  readonly summary: {
    readonly services: number;
    readonly brokerRealms: number;
    readonly correlations: number;
    readonly declaredRealmCandidates: number;
    readonly conditionalPaths: number;
    readonly workerEffects: number;
    readonly policyFailures: number;
    readonly diagnostics: number;
    readonly totalNodes: number;
    readonly displayedNodes: number;
    readonly omittedNodes: number;
    readonly totalEdges: number;
    readonly displayedEdges: number;
    readonly omittedEdges: number;
  };
  readonly correlations: readonly SystemReportCorrelation[];
  readonly conditionalPaths: readonly SystemConditionalPath[];
  readonly policies: {
    readonly results: readonly SystemPolicyResult[];
    readonly summary: {
      readonly passed: number;
      readonly failed: number;
      readonly unknown: number;
      readonly notApplicable: number;
    };
  };
  readonly diagnostics: readonly SystemReportDiagnostic[];
  readonly graph: {
    readonly nodes: readonly SystemReportNode[];
    readonly edges: readonly SystemReportEdge[];
  };
}
