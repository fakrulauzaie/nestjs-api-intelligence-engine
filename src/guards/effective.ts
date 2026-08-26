import type {
  AnalysisDocument,
  DirectGuardState,
  EffectiveGuardState,
  GlobalGuardState,
  GuardScope,
} from '../model/analysis.js';
import type { AssertionStatus } from '../model/assertions.js';
import { guardScopeForRuleId } from '../model/guard-rules.js';

export interface EffectiveEndpointGuard {
  readonly guardId: string;
  readonly name: string;
  readonly scope: GuardScope;
  readonly status: AssertionStatus;
  readonly ruleId: string;
  readonly assertionId: string;
  readonly evidenceIds: readonly string[];
  readonly order: number;
}

export interface EffectiveEndpointGuards {
  readonly directGuardState: DirectGuardState;
  readonly globalGuardState: GlobalGuardState;
  readonly effectiveGuardState: EffectiveGuardState;
  readonly directGuards: readonly EffectiveEndpointGuard[];
  readonly globalGuards: readonly EffectiveEndpointGuard[];
  readonly effectiveGuards: readonly EffectiveEndpointGuard[];
}

function directScopeRank(scope: GuardScope): number {
  return scope === 'controller' ? 0 : scope === 'method' ? 1 : 2;
}

export function buildEffectiveEndpointGuards(
  analysis: AnalysisDocument,
  endpointId: string,
): EffectiveEndpointGuards {
  const guardById = new Map(analysis.guards.map((guard) => [guard.id, guard]));
  const assertionById = new Map(analysis.assertions.map((assertion) => [assertion.id, assertion]));
  const directGuards = analysis.assertions
    .filter(
      (assertion) =>
        assertion.predicate === 'ENDPOINT_USES_GUARD' &&
        assertion.subjectId === endpointId &&
        assertion.objectId !== null,
    )
    .flatMap((assertion): EffectiveEndpointGuard[] => {
      const guard = guardById.get(assertion.objectId!);
      const scope = guardScopeForRuleId(assertion.ruleId);
      if (guard === undefined || scope === null || scope === 'application_global') return [];
      return [
        {
          guardId: guard.id,
          name: guard.displayName,
          scope,
          status: assertion.status,
          ruleId: assertion.ruleId,
          assertionId: assertion.id,
          evidenceIds: [...assertion.evidenceIds].sort(),
          order: directScopeRank(scope),
        },
      ];
    })
    .sort(
      (left, right) =>
        directScopeRank(left.scope) - directScopeRank(right.scope) ||
        `${left.name}:${left.guardId}:${left.assertionId}`.localeCompare(
          `${right.name}:${right.guardId}:${right.assertionId}`,
        ),
    );

  const globalGuardState =
    analysis.schemaVersion === '1.0.0' ? 'unknown' : analysis.globalGuardAnalysis.state;
  const globalGuards =
    analysis.schemaVersion === '1.0.0'
      ? []
      : analysis.globalGuardRegistrations
          .flatMap((registration): EffectiveEndpointGuard[] => {
            const guard = guardById.get(registration.guardId);
            const assertion = assertionById.get(registration.assertionId);
            if (guard === undefined || assertion === undefined) return [];
            return [
              {
                guardId: guard.id,
                name: guard.displayName,
                scope: 'application_global',
                status: assertion.status,
                ruleId: assertion.ruleId,
                assertionId: assertion.id,
                evidenceIds: [registration.registrationEvidenceId],
                order: registration.order,
              },
            ];
          })
          .sort(
            (left, right) =>
              left.order - right.order ||
              `${left.guardId}:${left.assertionId}`.localeCompare(
                `${right.guardId}:${right.assertionId}`,
              ),
          );
  const effectiveGuards = [...globalGuards, ...directGuards];
  return {
    directGuardState: directGuards.length > 0 ? 'declared' : 'none_declared',
    globalGuardState,
    effectiveGuardState:
      effectiveGuards.length > 0
        ? 'guard_declared'
        : globalGuardState === 'none_proven'
          ? 'no_supported_guard_proven'
          : 'unknown',
    directGuards,
    globalGuards,
    effectiveGuards,
  };
}
