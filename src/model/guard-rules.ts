import type { GuardScope } from './analysis.js';

export const DIRECT_GUARD_RULE_IDS: Readonly<
  Record<Extract<GuardScope, 'controller' | 'method'>, string>
> = {
  controller: 'nest.guard.controller.v1',
  method: 'nest.guard.method.v1',
};

export const GLOBAL_GUARD_RULE_IDS = {
  app_guard_use_class: 'nest.global-guard.app-guard-use-class.v1',
  app_guard_use_existing: 'nest.global-guard.app-guard-use-existing.v1',
  bootstrap_use_global_guards: 'nest.global-guard.bootstrap.v1',
} as const;

export function guardScopeForRuleId(ruleId: string): GuardScope | null {
  if ((Object.values(GLOBAL_GUARD_RULE_IDS) as readonly string[]).includes(ruleId)) {
    return 'application_global';
  }
  if (ruleId === DIRECT_GUARD_RULE_IDS.controller) return 'controller';
  if (ruleId === DIRECT_GUARD_RULE_IDS.method) return 'method';
  return null;
}
