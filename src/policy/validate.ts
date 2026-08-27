import type { PolicyResultsDocument } from './model.js';
import { policyResultsDocumentSchema } from './schemas.js';

export const POLICY_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'SUMMARY_MISMATCH',
  'DUPLICATE_POLICY_RESULT',
  'RULE_CONFIGURATION_MISMATCH',
  'RULE_REASON_MISMATCH',
  'BLOCKING_STATE_MISMATCH',
] as const;
export type PolicyIntegrityIssueCode = (typeof POLICY_INTEGRITY_ISSUE_CODES)[number];

export interface PolicyIntegrityIssue {
  readonly code: PolicyIntegrityIssueCode;
  readonly message: string;
  readonly path?: string;
}

export type PolicyValidationResult =
  | { readonly success: true; readonly data: PolicyResultsDocument }
  | { readonly success: false; readonly issues: readonly PolicyIntegrityIssue[] };

const REASON_CODES_BY_RULE = {
  'no-repository-access-in-controller': new Set([
    'direct_repository_access',
    'no_direct_repository_access',
    'controller_repository_access_unknown',
    'no_controller_subjects',
  ]),
  'require-guard-on-write-endpoint': new Set([
    'write_endpoint_guard_declared',
    'write_endpoint_guard_missing',
    'write_endpoint_guard_unknown',
    'write_reachability_unknown',
    'endpoint_has_no_write',
  ]),
  'require-complete-write-trace': new Set([
    'write_trace_complete',
    'write_trace_incomplete',
    'write_trace_unknown',
    'no_write_trace_subject',
  ]),
  'no-new-diagnostics': new Set([
    'new_diagnostics_found',
    'no_new_diagnostics',
    'diagnostic_comparison_ambiguous',
    'baseline_not_supplied',
  ]),
  'forbid-dynamic-interaction-target': new Set([
    'interaction_target_static',
    'interaction_target_dynamic',
    'interaction_target_unknown',
    'no_interaction_subjects',
  ]),
  'require-proven-interaction-activation': new Set([
    'interaction_activation_proven',
    'interaction_activation_cold',
    'interaction_activation_unknown',
    'no_interaction_subjects',
  ]),
  'require-local-in-process-event-handler': new Set([
    'local_event_handler_found',
    'local_event_handler_missing',
    'local_event_handler_unknown',
    'no_in_process_event_subjects',
  ]),
} as const;

export function validatePolicyResultsDocument(input: unknown): PolicyValidationResult {
  const parsed = policyResultsDocumentSchema.safeParse(input);
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

  const document = parsed.data;
  const issues: PolicyIntegrityIssue[] = [];
  const configuredRules = new Map(
    document.configuration.rules.map((configuration) => [configuration.ruleId, configuration]),
  );
  if (configuredRules.size !== document.configuration.rules.length) {
    issues.push({
      code: 'RULE_CONFIGURATION_MISMATCH',
      path: 'configuration.rules',
      message: 'A policy rule is configured more than once.',
    });
  }
  for (const [index, configuration] of document.configuration.rules.entries()) {
    const validDiagnosticOption =
      configuration.ruleId === 'no-new-diagnostics'
        ? configuration.minimumSeverity !== undefined
        : configuration.minimumSeverity === undefined;
    if (!validDiagnosticOption) {
      issues.push({
        code: 'RULE_CONFIGURATION_MISMATCH',
        path: `configuration.rules.${index}.minimumSeverity`,
        message: `Policy rule ${configuration.ruleId} has inconsistent typed options.`,
      });
    }
  }

  const identities = new Set<string>();
  for (const [index, result] of document.results.entries()) {
    const identity = `${result.ruleId}:${result.subject.semanticKey.encoded}`;
    if (identities.has(identity)) {
      issues.push({
        code: 'DUPLICATE_POLICY_RESULT',
        path: `results.${index}`,
        message: `Policy result ${identity} occurs more than once.`,
      });
    }
    identities.add(identity);

    const configuration = configuredRules.get(result.ruleId);
    const expectedSeverity =
      result.outcome === 'unknown' ? configuration?.onUnknown : configuration?.severity;
    if (configuration === undefined || result.severity !== expectedSeverity) {
      issues.push({
        code: 'RULE_CONFIGURATION_MISMATCH',
        path: `results.${index}.severity`,
        message: `Policy result ${identity} does not match its configured severity.`,
      });
    }
    if (!REASON_CODES_BY_RULE[result.ruleId].has(result.reasonCode)) {
      issues.push({
        code: 'RULE_REASON_MISMATCH',
        path: `results.${index}.reasonCode`,
        message: `Policy result ${identity} has a reason code owned by another rule.`,
      });
    }
    const expectedBlocking =
      (result.outcome === 'fail' || result.outcome === 'unknown') && result.severity === 'error';
    if (result.blocking !== expectedBlocking) {
      issues.push({
        code: 'BLOCKING_STATE_MISMATCH',
        path: `results.${index}.blocking`,
        message: `Policy result ${identity} has inconsistent blocking state.`,
      });
    }
  }

  for (const ruleId of configuredRules.keys()) {
    if (!document.results.some((result) => result.ruleId === ruleId)) {
      issues.push({
        code: 'RULE_CONFIGURATION_MISMATCH',
        path: 'results',
        message: `Configured rule ${ruleId} has no result.`,
      });
    }
  }

  const expectedSummary = {
    passed: document.results.filter(({ outcome }) => outcome === 'pass').length,
    failed: document.results.filter(({ outcome }) => outcome === 'fail').length,
    unknown: document.results.filter(({ outcome }) => outcome === 'unknown').length,
    notApplicable: document.results.filter(({ outcome }) => outcome === 'not_applicable').length,
    warnings: document.results.filter(
      ({ outcome, severity }) =>
        (outcome === 'fail' || outcome === 'unknown') && severity === 'warn',
    ).length,
    errors: document.results.filter(
      ({ outcome, severity }) =>
        (outcome === 'fail' || outcome === 'unknown') && severity === 'error',
    ).length,
    blocking: document.results.filter(({ blocking }) => blocking).length,
  };
  for (const [field, value] of Object.entries(expectedSummary)) {
    if (document.summary[field as keyof typeof expectedSummary] !== value) {
      issues.push({
        code: 'SUMMARY_MISMATCH',
        path: `summary.${field}`,
        message: `Policy summary ${field} does not match its result count.`,
      });
    }
  }

  return issues.length === 0
    ? { success: true, data: document }
    : {
        success: false,
        issues: issues.sort((left, right) =>
          `${left.code}:${left.path ?? ''}`.localeCompare(`${right.code}:${right.path ?? ''}`),
        ),
      };
}

export class PolicyResultsIntegrityError extends Error {
  readonly issues: readonly PolicyIntegrityIssue[];

  constructor(issues: readonly PolicyIntegrityIssue[]) {
    super(`Policy result integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'PolicyResultsIntegrityError';
    this.issues = issues;
  }
}

export function assertValidPolicyResultsDocument(input: unknown): PolicyResultsDocument {
  const result = validatePolicyResultsDocument(input);
  if (!result.success) throw new PolicyResultsIntegrityError(result.issues);
  return result.data;
}
