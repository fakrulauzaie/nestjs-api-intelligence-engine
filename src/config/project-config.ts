import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_GRAPH_EDGE_LIMIT, DEFAULT_GRAPH_NODE_LIMIT } from '../graph-report/model.js';
import type { InteractionTraversalConfiguration, RawSqlDialect } from '../model/entities.js';
import type { NormalizedPolicyRuleConfiguration } from '../policy/model.js';
import { normalizePolicyRuleSettings, policyConfigurationSchema } from '../policy/rule-config.js';
import {
  projectConfigurationV2Schema,
  projectConfigurationV3Schema,
  type ProjectConfigurationV2,
  type ProjectConfigurationV3,
} from './project-config-schema.js';
import { DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION } from './analysis-config.js';

export const PROJECT_CONFIGURATION_FILE_NAME = 'api-intel.config.json';
export const PROJECT_CONFIGURATION_SOURCE_KINDS = ['discovered', 'explicit'] as const;
export type ProjectConfigurationSourceKind = (typeof PROJECT_CONFIGURATION_SOURCE_KINDS)[number];

export interface LoadedProjectConfiguration {
  readonly path: string;
  readonly sourceKind: ProjectConfigurationSourceKind;
  readonly fileVersion: 1 | 2 | 3;
  readonly analysis: {
    readonly maxCallDepth?: number | undefined;
    readonly rawSqlDialect?: RawSqlDialect | undefined;
    readonly interactions?: InteractionTraversalConfiguration | undefined;
  };
  readonly outputDirectory?: string | undefined;
  readonly rules: readonly NormalizedPolicyRuleConfiguration[];
  readonly graph?: {
    readonly enabled: boolean;
    readonly maxNodesPerEndpoint: number;
    readonly maxEdgesPerEndpoint: number;
  };
  readonly policy?: { readonly enabled: boolean };
  readonly controls?: { readonly enabled: boolean };
  readonly openapi?:
    | { readonly enabled: false }
    | {
        readonly enabled: true;
        readonly documentPath: string;
        readonly pathPrefix?: string | undefined;
        readonly includeEvidence: boolean;
      };
}

export class ProjectConfigurationInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectConfigurationInputError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..\\`) &&
      !relativePath.startsWith('../'))
  );
}

function normalizedVersioned(
  parsed: ProjectConfigurationV2 | ProjectConfigurationV3,
  context: {
    readonly path: string;
    readonly sourceKind: ProjectConfigurationSourceKind;
    readonly repositoryRoot: string;
  },
): LoadedProjectConfiguration {
  const outputDirectory =
    parsed.output === undefined
      ? undefined
      : resolve(dirname(context.path), parsed.output.directory);
  if (
    outputDirectory !== undefined &&
    context.sourceKind === 'discovered' &&
    !isWithinDirectory(context.repositoryRoot, outputDirectory)
  ) {
    throw new ProjectConfigurationInputError(
      `Auto-discovered configuration output must remain inside the analyzed repository: ${outputDirectory}`,
    );
  }
  const graph = parsed.reports?.graph;
  const policy = parsed.reports?.policy;
  const controls = parsed.reports?.controls;
  const openapi = parsed.reports?.openapi;
  return {
    path: context.path,
    sourceKind: context.sourceKind,
    fileVersion: parsed.version,
    analysis: {
      ...(parsed.analysis?.maxCallDepth === undefined
        ? {}
        : { maxCallDepth: parsed.analysis.maxCallDepth }),
      ...(parsed.analysis?.rawSqlDialect === undefined
        ? {}
        : { rawSqlDialect: parsed.analysis.rawSqlDialect }),
      ...(parsed.version !== 3 || parsed.analysis?.interactions === undefined
        ? {}
        : {
            interactions: {
              maxInteractionHops:
                parsed.analysis.interactions.maxInteractionHops ??
                DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION.maxInteractionHops,
              maxFanOutPerInteraction:
                parsed.analysis.interactions.maxFanOutPerInteraction ??
                DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION.maxFanOutPerInteraction,
              maxInteractionTraceStates:
                parsed.analysis.interactions.maxInteractionTraceStates ??
                DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION.maxInteractionTraceStates,
            },
          }),
    },
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
    rules: parsed.rules === undefined ? [] : normalizePolicyRuleSettings(parsed.rules),
    ...(graph === undefined
      ? {}
      : {
          graph: {
            enabled: graph.enabled,
            maxNodesPerEndpoint: graph.maxNodesPerEndpoint ?? DEFAULT_GRAPH_NODE_LIMIT,
            maxEdgesPerEndpoint: graph.maxEdgesPerEndpoint ?? DEFAULT_GRAPH_EDGE_LIMIT,
          },
        }),
    ...(policy === undefined ? {} : { policy: { enabled: policy.enabled } }),
    ...(controls === undefined ? {} : { controls: { enabled: controls.enabled } }),
    ...(openapi === undefined
      ? {}
      : openapi.enabled
        ? {
            openapi: {
              enabled: true as const,
              documentPath: resolve(dirname(context.path), openapi.document),
              ...(openapi.pathPrefix === undefined ? {} : { pathPrefix: openapi.pathPrefix }),
              includeEvidence: openapi.includeEvidence ?? false,
            },
          }
        : { openapi: { enabled: false as const } }),
  };
}

function normalizeDocument(
  input: unknown,
  context: {
    readonly path: string;
    readonly sourceKind: ProjectConfigurationSourceKind;
    readonly repositoryRoot: string;
  },
): LoadedProjectConfiguration {
  if (typeof input === 'object' && input !== null && 'version' in input && input.version === 1) {
    const parsed = policyConfigurationSchema.parse(input);
    return {
      path: context.path,
      sourceKind: context.sourceKind,
      fileVersion: 1,
      analysis: {},
      rules: normalizePolicyRuleSettings(parsed.rules),
    };
  }
  if (typeof input === 'object' && input !== null && 'version' in input && input.version === 2) {
    return normalizedVersioned(projectConfigurationV2Schema.parse(input), context);
  }
  return normalizedVersioned(projectConfigurationV3Schema.parse(input), context);
}

export async function loadProjectConfigurationForScan(input: {
  readonly repositoryRoot: string;
  readonly explicitPath?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<LoadedProjectConfiguration | undefined> {
  if (input.explicitPath !== undefined && input.disabled === true) {
    throw new RangeError('--config and --no-config cannot be used together.');
  }
  if (input.disabled === true) return undefined;

  const repositoryRoot = resolve(input.repositoryRoot);
  const sourceKind: ProjectConfigurationSourceKind =
    input.explicitPath === undefined ? 'discovered' : 'explicit';
  const path =
    input.explicitPath === undefined
      ? join(repositoryRoot, PROJECT_CONFIGURATION_FILE_NAME)
      : resolve(input.explicitPath);
  let contents: string;
  try {
    contents = await readFile(path, {
      encoding: 'utf8',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch (error) {
    if (input.signal?.aborted === true) throw error;
    if (sourceKind === 'discovered' && isNotFound(error)) return undefined;
    throw new ProjectConfigurationInputError(
      `Could not read project configuration ${path}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new ProjectConfigurationInputError(
      `Invalid JSON in project configuration ${path}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  try {
    return normalizeDocument(parsed, { path, sourceKind, repositoryRoot });
  } catch (error) {
    if (error instanceof ProjectConfigurationInputError) throw error;
    const detail = error instanceof z.ZodError ? z.prettifyError(error) : errorMessage(error);
    throw new ProjectConfigurationInputError(`Invalid project configuration ${path}: ${detail}`, {
      cause: error,
    });
  }
}
