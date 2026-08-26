import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectConfigurationV2Schema } from '../config/project-config-schema.js';
import { POLICY_CONFIGURATION_VERSION, type NormalizedPolicyConfiguration } from './model.js';
import { normalizePolicyConfiguration, normalizePolicyRuleSettings } from './rule-config.js';

export {
  normalizePolicyConfiguration,
  policyConfigurationSchema,
  type PolicyConfiguration,
} from './rule-config.js';

export class PolicyConfigurationInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PolicyConfigurationInputError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadPolicyConfiguration(
  path: string,
  signal?: AbortSignal,
): Promise<NormalizedPolicyConfiguration> {
  const absolutePath = resolve(path);
  let contents: string;
  try {
    contents = await readFile(absolutePath, {
      encoding: 'utf8',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new PolicyConfigurationInputError(
      `Could not read policy configuration ${absolutePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new PolicyConfigurationInputError(
      `Invalid JSON in policy configuration ${absolutePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  try {
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      parsed.version === 2
    ) {
      const project = projectConfigurationV2Schema.parse(parsed);
      if (project.rules === undefined) {
        throw new Error('Version 2 configuration must define rules for the check command.');
      }
      return {
        version: POLICY_CONFIGURATION_VERSION,
        rules: normalizePolicyRuleSettings(project.rules),
      } satisfies NormalizedPolicyConfiguration;
    }
    return normalizePolicyConfiguration(parsed);
  } catch (error) {
    throw new PolicyConfigurationInputError(
      `Invalid policy configuration ${absolutePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}
