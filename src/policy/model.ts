import type { AnalysisResultState } from '../model/analysis.js';
import type { DiagnosticSeverity } from '../model/diagnostics.js';
import type { SemanticKey } from '../comparison/semantic-key.js';

export const POLICY_RESULTS_SCHEMA_VERSION = '1.0.0' as const;
export const POLICY_CONFIGURATION_VERSION = 1 as const;

export const POLICY_RULE_IDS = [
  'no-repository-access-in-controller',
  'require-guard-on-write-endpoint',
  'require-complete-write-trace',
  'no-new-diagnostics',
  'forbid-dynamic-interaction-target',
  'require-proven-interaction-activation',
  'require-local-in-process-event-handler',
  'require-proven-authorization-enforcement',
] as const;
export type PolicyRuleId = (typeof POLICY_RULE_IDS)[number];

export const POLICY_RULE_VERSIONS: Readonly<Record<PolicyRuleId, '1.0.0'>> = {
  'no-repository-access-in-controller': '1.0.0',
  'require-guard-on-write-endpoint': '1.0.0',
  'require-complete-write-trace': '1.0.0',
  'no-new-diagnostics': '1.0.0',
  'forbid-dynamic-interaction-target': '1.0.0',
  'require-proven-interaction-activation': '1.0.0',
  'require-local-in-process-event-handler': '1.0.0',
  'require-proven-authorization-enforcement': '1.0.0',
};

export const POLICY_SEVERITIES = ['warn', 'error'] as const;
export type PolicySeverity = (typeof POLICY_SEVERITIES)[number];
export const POLICY_OUTCOMES = ['pass', 'fail', 'unknown', 'not_applicable'] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export const POLICY_REASON_CODES = [
  'direct_repository_access',
  'no_direct_repository_access',
  'controller_repository_access_unknown',
  'no_controller_subjects',
  'write_endpoint_guard_declared',
  'write_endpoint_guard_missing',
  'write_endpoint_guard_unknown',
  'write_reachability_unknown',
  'endpoint_has_no_write',
  'write_trace_complete',
  'write_trace_incomplete',
  'write_trace_unknown',
  'no_write_trace_subject',
  'new_diagnostics_found',
  'no_new_diagnostics',
  'diagnostic_comparison_ambiguous',
  'baseline_not_supplied',
  'interaction_target_static',
  'interaction_target_dynamic',
  'interaction_target_unknown',
  'no_interaction_subjects',
  'interaction_activation_proven',
  'interaction_activation_cold',
  'interaction_activation_unknown',
  'local_event_handler_found',
  'local_event_handler_missing',
  'local_event_handler_unknown',
  'no_in_process_event_subjects',
  'authorization_enforcement_proven',
  'authorization_enforcement_configured',
  'authorization_enforcement_unknown',
  'no_authorization_metadata',
] as const;
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export interface NormalizedPolicyRuleConfiguration {
  readonly ruleId: PolicyRuleId;
  readonly severity: PolicySeverity;
  readonly onUnknown: PolicySeverity;
  readonly minimumSeverity?: DiagnosticSeverity | undefined;
}

export interface NormalizedPolicyConfiguration {
  readonly version: typeof POLICY_CONFIGURATION_VERSION;
  readonly rules: readonly NormalizedPolicyRuleConfiguration[];
}

export interface PolicyInputReference {
  readonly analysisId: string;
  readonly analysisSchemaVersion: string;
  readonly resultState: Extract<AnalysisResultState, 'completed' | 'completed_with_gaps'>;
}

export interface PolicySubject {
  readonly semanticKey: SemanticKey;
  readonly displayName: string;
  readonly canonicalIds: readonly string[];
}

export interface PolicyResult {
  readonly ruleId: PolicyRuleId;
  readonly ruleVersion: '1.0.0';
  readonly severity: PolicySeverity;
  readonly outcome: PolicyOutcome;
  readonly blocking: boolean;
  readonly reasonCode: PolicyReasonCode;
  readonly message: string;
  readonly subject: PolicySubject;
  readonly evidenceIds: readonly string[];
}

export interface PolicySummary {
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly notApplicable: number;
  readonly warnings: number;
  readonly errors: number;
  readonly blocking: number;
}

export interface PolicyResultsDocument {
  readonly schemaVersion: typeof POLICY_RESULTS_SCHEMA_VERSION;
  readonly analysis: PolicyInputReference;
  readonly baseline: PolicyInputReference | null;
  readonly configuration: NormalizedPolicyConfiguration;
  readonly summary: PolicySummary;
  readonly results: readonly PolicyResult[];
}
