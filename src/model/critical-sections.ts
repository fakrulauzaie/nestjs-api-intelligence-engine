export const CRITICAL_SECTION_CALLBACK_KINDS = ['inline_arrow', 'inline_function'] as const;
export type CriticalSectionCallbackKind = (typeof CRITICAL_SECTION_CALLBACK_KINDS)[number];

/**
 * A package-proven bounded callback region. This records dependency and lexical
 * scope only; it does not claim lock acquisition, exclusivity, timing, or release.
 */
export interface CriticalSectionRecord {
  readonly id: string;
  readonly sourceMethodId: string;
  readonly lockResourceAccessIds: readonly string[];
  readonly callbackKind: CriticalSectionCallbackKind;
  readonly callbackEvidenceId: string;
  readonly effectAssertionIds: readonly string[];
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
}
