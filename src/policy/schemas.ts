import { z } from 'zod';
import { semanticKeySchema } from '../comparison/schemas.js';
import { stableIdSchema } from '../model/schemas.js';
import {
  POLICY_CONFIGURATION_VERSION,
  POLICY_OUTCOMES,
  POLICY_REASON_CODES,
  POLICY_RESULTS_SCHEMA_VERSION,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
  type PolicyResultsDocument,
} from './model.js';
import { normalizedPolicyRuleConfigurationSchema } from './rule-config.js';

const nonEmptyStringSchema = z.string().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();

const inputReferenceSchema = z
  .object({
    analysisId: stableIdSchema,
    analysisSchemaVersion: nonEmptyStringSchema,
    resultState: z.enum(['completed', 'completed_with_gaps']),
  })
  .strict();

const policyResultSchema = z
  .object({
    ruleId: z.enum(POLICY_RULE_IDS),
    ruleVersion: z.literal('1.0.0'),
    severity: z.enum(POLICY_SEVERITIES),
    outcome: z.enum(POLICY_OUTCOMES),
    blocking: z.boolean(),
    reasonCode: z.enum(POLICY_REASON_CODES),
    message: nonEmptyStringSchema,
    subject: z
      .object({
        semanticKey: semanticKeySchema,
        displayName: nonEmptyStringSchema,
        canonicalIds: z.array(stableIdSchema).min(1),
      })
      .strict(),
    evidenceIds: z.array(stableIdSchema),
  })
  .strict();

export const policyResultsDocumentSchema: z.ZodType<PolicyResultsDocument> = z
  .object({
    schemaVersion: z.literal(POLICY_RESULTS_SCHEMA_VERSION),
    analysis: inputReferenceSchema,
    baseline: inputReferenceSchema.nullable(),
    configuration: z
      .object({
        version: z.literal(POLICY_CONFIGURATION_VERSION),
        rules: z.array(normalizedPolicyRuleConfigurationSchema).min(1),
      })
      .strict(),
    summary: z
      .object({
        passed: nonNegativeIntegerSchema,
        failed: nonNegativeIntegerSchema,
        unknown: nonNegativeIntegerSchema,
        notApplicable: nonNegativeIntegerSchema,
        warnings: nonNegativeIntegerSchema,
        errors: nonNegativeIntegerSchema,
        blocking: nonNegativeIntegerSchema,
      })
      .strict(),
    results: z.array(policyResultSchema).min(1),
  })
  .strict();
