import { z } from 'zod';
import { DIAGNOSTIC_SEVERITIES } from '../model/diagnostics.js';
import {
  POLICY_CONFIGURATION_VERSION,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
  type NormalizedPolicyConfiguration,
  type NormalizedPolicyRuleConfiguration,
  type PolicyRuleId,
  type PolicySeverity,
} from './model.js';

const severitySchema = z.enum(POLICY_SEVERITIES);
const unknownOptionsSchema = z.object({ onUnknown: severitySchema }).strict();
const diagnosticOptionsSchema = z
  .object({
    minimumSeverity: z.enum(DIAGNOSTIC_SEVERITIES),
    onUnknown: severitySchema.optional(),
  })
  .strict();
const setting = <T extends z.ZodType>(options: T) =>
  z.union([severitySchema, z.tuple([severitySchema, options])]);

export const policyRuleSettingsSchema = z
  .object({
    'no-repository-access-in-controller': setting(unknownOptionsSchema).optional(),
    'require-guard-on-write-endpoint': setting(unknownOptionsSchema).optional(),
    'require-complete-write-trace': setting(unknownOptionsSchema).optional(),
    'no-new-diagnostics': setting(diagnosticOptionsSchema).optional(),
    'forbid-dynamic-interaction-target': setting(unknownOptionsSchema).optional(),
    'require-proven-interaction-activation': setting(unknownOptionsSchema).optional(),
    'require-local-in-process-event-handler': setting(unknownOptionsSchema).optional(),
    'require-proven-authorization-enforcement': setting(unknownOptionsSchema).optional(),
  })
  .strict()
  .refine((rules) => Object.keys(rules).length > 0, 'At least one policy rule is required.')
  .meta({ minProperties: 1 });

export const policyConfigurationSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    version: z.literal(POLICY_CONFIGURATION_VERSION),
    rules: policyRuleSettingsSchema,
  })
  .strict();

export type PolicyRuleSettings = z.infer<typeof policyRuleSettingsSchema>;
export type PolicyConfiguration = z.infer<typeof policyConfigurationSchema>;

function normalizedRule(
  ruleId: PolicyRuleId,
  settingValue: NonNullable<PolicyRuleSettings[PolicyRuleId]>,
): NormalizedPolicyRuleConfiguration {
  const severity: PolicySeverity = Array.isArray(settingValue) ? settingValue[0] : settingValue;
  const options = Array.isArray(settingValue) ? settingValue[1] : undefined;
  return {
    ruleId,
    severity,
    onUnknown: options?.onUnknown ?? severity,
    ...(ruleId === 'no-new-diagnostics'
      ? {
          minimumSeverity:
            options !== undefined && 'minimumSeverity' in options
              ? options.minimumSeverity
              : ('warning' as const),
        }
      : {}),
  };
}

export function normalizePolicyRuleSettings(
  input: PolicyRuleSettings,
): readonly NormalizedPolicyRuleConfiguration[] {
  return POLICY_RULE_IDS.flatMap((ruleId): NormalizedPolicyRuleConfiguration[] => {
    const settingValue = input[ruleId];
    return settingValue === undefined ? [] : [normalizedRule(ruleId, settingValue)];
  });
}

export function normalizePolicyConfiguration(input: unknown): NormalizedPolicyConfiguration {
  const parsed = policyConfigurationSchema.parse(input);
  return {
    version: POLICY_CONFIGURATION_VERSION,
    rules: normalizePolicyRuleSettings(parsed.rules),
  };
}

export const normalizedPolicyRuleConfigurationSchema = z
  .object({
    ruleId: z.enum(POLICY_RULE_IDS),
    severity: z.enum(POLICY_SEVERITIES),
    onUnknown: z.enum(POLICY_SEVERITIES),
    minimumSeverity: z.enum(DIAGNOSTIC_SEVERITIES).optional(),
  })
  .strict();
