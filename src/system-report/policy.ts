import { makeSystemPolicyResultId } from '../system-analysis/ids.js';
import type {
  SystemAnalysisDocument,
  SystemInteractionCorrelationRecord,
} from '../system-analysis/model.js';
import type {
  SystemPolicyOutcome,
  SystemPolicyReasonCode,
  SystemPolicyResult,
  SystemPolicyRuleId,
} from './model.js';

function result(input: {
  readonly ruleId: SystemPolicyRuleId;
  readonly outcome: SystemPolicyOutcome;
  readonly reasonCode: SystemPolicyReasonCode;
  readonly message: string;
  readonly correlation: SystemInteractionCorrelationRecord;
}): SystemPolicyResult {
  return {
    id: makeSystemPolicyResultId([
      input.ruleId,
      input.correlation.id,
      input.outcome,
      input.reasonCode,
    ]),
    ruleId: input.ruleId,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    message: input.message,
    subjectCorrelationId: input.correlation.id,
  };
}

function declaredRealmPolicy(correlation: SystemInteractionCorrelationRecord): SystemPolicyResult {
  if (correlation.producerEndpointId === null) {
    return result({
      ruleId: 'require-declared-realm-candidate',
      outcome: 'not_applicable',
      reasonCode: 'declared_realm_candidate_unknown',
      message: 'The correlation is consumer-only and has no producer subject.',
      correlation,
    });
  }
  if (correlation.state === 'declared_realm_candidate') {
    return result({
      ruleId: 'require-declared-realm-candidate',
      outcome: 'pass',
      reasonCode: 'declared_realm_candidate_found',
      message:
        'The producer has an exact structural match in one explicitly declared broker realm.',
      correlation,
    });
  }
  if (correlation.state === 'ambiguous' || correlation.unmatchedReason === 'unsupported_identity') {
    return result({
      ruleId: 'require-declared-realm-candidate',
      outcome: 'unknown',
      reasonCode: 'declared_realm_candidate_unknown',
      message: 'Ambiguity or unsupported identity prevents a unique declared-realm candidate.',
      correlation,
    });
  }
  return result({
    ruleId: 'require-declared-realm-candidate',
    outcome: 'fail',
    reasonCode: 'declared_realm_candidate_missing',
    message: 'No exact producer-to-consumer candidate shares one explicitly declared broker realm.',
    correlation,
  });
}

function ambiguityPolicy(correlation: SystemInteractionCorrelationRecord): SystemPolicyResult {
  if (correlation.producerEndpointId === null) {
    return result({
      ruleId: 'forbid-ambiguous-system-correlation',
      outcome: 'not_applicable',
      reasonCode: 'correlation_unambiguous',
      message: 'The correlation is consumer-only and has no producer selection to disambiguate.',
      correlation,
    });
  }
  return result({
    ruleId: 'forbid-ambiguous-system-correlation',
    outcome: correlation.state === 'ambiguous' ? 'fail' : 'pass',
    reasonCode:
      correlation.state === 'ambiguous' ? 'correlation_ambiguous' : 'correlation_unambiguous',
    message:
      correlation.state === 'ambiguous'
        ? `The producer correlation remains ambiguous (${correlation.ambiguityReason}).`
        : 'The system document does not contain an ambiguous consumer selection for this producer.',
    correlation,
  });
}

export function evaluateSystemPolicies(system: SystemAnalysisDocument): {
  readonly results: readonly SystemPolicyResult[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly unknown: number;
    readonly notApplicable: number;
  };
} {
  const results = system.correlations
    .flatMap((correlation) => [declaredRealmPolicy(correlation), ambiguityPolicy(correlation)])
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    results,
    summary: {
      passed: results.filter(({ outcome }) => outcome === 'pass').length,
      failed: results.filter(({ outcome }) => outcome === 'fail').length,
      unknown: results.filter(({ outcome }) => outcome === 'unknown').length,
      notApplicable: results.filter(({ outcome }) => outcome === 'not_applicable').length,
    },
  };
}
