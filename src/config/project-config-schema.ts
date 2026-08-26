import { z } from 'zod';
import {
  MAX_GRAPH_EDGE_LIMIT,
  MAX_GRAPH_NODE_LIMIT,
  MIN_GRAPH_DISPLAY_LIMIT,
} from '../graph-report/model.js';
import { RAW_SQL_DIALECTS } from '../model/entities.js';
import { interactionTraversalConfigurationSchema } from '../model/schemas.js';
import { policyConfigurationSchema, policyRuleSettingsSchema } from '../policy/rule-config.js';

export const PROJECT_CONFIGURATION_V2_VERSION = 2 as const;
export const PROJECT_CONFIGURATION_VERSION = 3 as const;

const portablePathSchema = z
  .string()
  .refine(
    (value) => value.trim().length > 0 && !value.includes('\0'),
    'Expected a non-empty path without null bytes.',
  )
  .meta({ minLength: 1, pattern: '^(?=.*\\S)[^\\u0000]+$' });

const analysisSettingsV2Schema = z
  .object({
    maxCallDepth: z.number().int().min(1).max(3).optional(),
    rawSqlDialect: z.enum(RAW_SQL_DIALECTS).optional(),
  })
  .strict();

const analysisSettingsV3Schema = analysisSettingsV2Schema.extend({
  interactions: interactionTraversalConfigurationSchema.partial().optional(),
});

const outputSettingsSchema = z.object({ directory: portablePathSchema }).strict();

const graphReportSettingsSchema = z
  .object({
    enabled: z.boolean(),
    maxNodesPerEndpoint: z
      .number()
      .int()
      .min(MIN_GRAPH_DISPLAY_LIMIT)
      .max(MAX_GRAPH_NODE_LIMIT)
      .optional(),
    maxEdgesPerEndpoint: z
      .number()
      .int()
      .min(MIN_GRAPH_DISPLAY_LIMIT)
      .max(MAX_GRAPH_EDGE_LIMIT)
      .optional(),
  })
  .strict();

const enabledReportSettingsSchema = z.object({ enabled: z.boolean() }).strict();

const openApiReportSettingsSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      document: portablePathSchema,
      pathPrefix: z.string().optional(),
      includeEvidence: z.boolean().optional(),
    })
    .strict(),
]);

const reportSettingsSchema = z
  .object({
    policy: enabledReportSettingsSchema.optional(),
    graph: graphReportSettingsSchema.optional(),
    controls: enabledReportSettingsSchema.optional(),
    openapi: openApiReportSettingsSchema.optional(),
  })
  .strict();

export const projectConfigurationV2Schema = z
  .object({
    $schema: z.string().min(1).optional(),
    version: z.literal(PROJECT_CONFIGURATION_V2_VERSION),
    analysis: analysisSettingsV2Schema.optional(),
    output: outputSettingsSchema.optional(),
    rules: policyRuleSettingsSchema.optional(),
    reports: reportSettingsSchema.optional(),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.reports?.policy?.enabled === true && configuration.rules === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reports', 'policy'],
        message: 'An enabled policy report requires a non-empty rules category.',
      });
    }
  });

export const projectConfigurationV3Schema = z
  .object({
    $schema: z.string().min(1).optional(),
    version: z.literal(PROJECT_CONFIGURATION_VERSION),
    analysis: analysisSettingsV3Schema.optional(),
    output: outputSettingsSchema.optional(),
    rules: policyRuleSettingsSchema.optional(),
    reports: reportSettingsSchema.optional(),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.reports?.policy?.enabled === true && configuration.rules === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reports', 'policy'],
        message: 'An enabled policy report requires a non-empty rules category.',
      });
    }
  });

export const projectConfigurationFileSchema = z.union([
  policyConfigurationSchema,
  projectConfigurationV2Schema,
  projectConfigurationV3Schema,
]);

export type ProjectConfigurationV2 = z.infer<typeof projectConfigurationV2Schema>;
export type ProjectConfigurationV3 = z.infer<typeof projectConfigurationV3Schema>;

function completeGeneratedContracts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(completeGeneratedContracts);
  if (typeof value !== 'object' || value === null) return value;
  const completed = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, completeGeneratedContracts(entry)]),
  );
  if (Array.isArray(completed.prefixItems)) {
    completed.items = false;
    completed.minItems = completed.prefixItems.length;
    completed.maxItems = completed.prefixItems.length;
  }
  return completed;
}

export function apiIntelConfigurationJsonSchema(): Record<string, unknown> {
  const generated = completeGeneratedContracts(
    z.toJSONSchema(projectConfigurationFileSchema, { target: 'draft-2020-12' }),
  ) as Record<string, unknown>;
  return {
    ...generated,
    $id: 'https://backend-api-intelligence.local/schemas/api-intel.config.schema.json',
    title: 'API Intelligence project configuration',
  };
}
