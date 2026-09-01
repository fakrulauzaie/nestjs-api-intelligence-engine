import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  assertValidSystemTopologyManifest,
  SystemTopologyManifestError,
  type SystemTopologyManifest,
} from '../system-analysis/index.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from './analysis-input.js';

export interface NamedAnalysisArgument {
  readonly namespace: string;
  readonly path: string;
}

export class SystemArtifactInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SystemArtifactInputError';
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseNamedAnalysisArgument(value: string): NamedAnalysisArgument {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new SystemArtifactInputError(
      `Named analysis must use <service-namespace>=<analysis.json-or-.api-intel-directory>: ${value}`,
    );
  }
  return { namespace: value.slice(0, separator), path: value.slice(separator + 1) };
}

export async function resolveAnalysisArtifactPath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  let metadata;
  try {
    metadata = await stat(absolutePath);
  } catch (error) {
    throw new SystemArtifactInputError(
      `Could not inspect analysis artifact ${absolutePath}: ${message(error)}`,
      { cause: error },
    );
  }
  if (!metadata.isDirectory()) return absolutePath;
  if (basename(absolutePath).toLowerCase() !== '.api-intel') {
    throw new SystemArtifactInputError(
      `Analysis directory must be a .api-intel artifact directory: ${absolutePath}`,
    );
  }
  return join(absolutePath, 'analysis.json');
}

export async function loadNamedAnalysisArtifact(
  argument: NamedAnalysisArgument,
  signal?: AbortSignal,
): Promise<{
  readonly namespace: string;
  readonly artifactLabel: string;
  readonly analysis: Awaited<ReturnType<typeof loadCanonicalAnalysis>>;
}> {
  const path = await resolveAnalysisArtifactPath(argument.path);
  return {
    namespace: argument.namespace,
    artifactLabel: `${argument.namespace}-analysis.json`,
    analysis: await loadCanonicalAnalysis(path, signal),
  };
}

export async function loadSystemTopologyManifest(
  path: string,
  signal?: AbortSignal,
): Promise<SystemTopologyManifest> {
  const absolutePath = resolve(path);
  let contents: string;
  try {
    contents = await readFile(absolutePath, {
      encoding: 'utf8',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new SystemArtifactInputError(
      `Could not read topology manifest ${absolutePath}: ${message(error)}`,
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new SystemArtifactInputError(
      `Invalid JSON in topology manifest ${absolutePath}: ${message(error)}`,
      { cause: error },
    );
  }
  try {
    return assertValidSystemTopologyManifest(parsed);
  } catch (error) {
    const detail =
      error instanceof SystemTopologyManifestError
        ? `${error.issues.length} issue(s); ${error.issues[0]?.message ?? error.message}`
        : message(error);
    throw new SystemArtifactInputError(`Invalid system topology in ${absolutePath}: ${detail}`, {
      cause: error,
    });
  }
}

export { CanonicalAnalysisInputError };
