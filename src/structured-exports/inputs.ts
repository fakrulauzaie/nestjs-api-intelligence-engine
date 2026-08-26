import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PolicyResultsDocument } from '../policy/model.js';
import type { ImpactDocument } from '../impact/model.js';
import { assertValidImpactDocument, ImpactIntegrityError } from '../impact/validate.js';
import {
  assertValidPolicyResultsDocument,
  PolicyResultsIntegrityError,
} from '../policy/validate.js';

export class StructuredExportInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StructuredExportInputError';
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadJsonDocument(path: string, signal?: AbortSignal): Promise<unknown> {
  const absolutePath = resolve(path);
  let contents: string;
  try {
    contents = await readFile(absolutePath, {
      encoding: 'utf8',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new StructuredExportInputError(
      `Could not read JSON input ${absolutePath}: ${message(error)}`,
      {
        cause: error,
      },
    );
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new StructuredExportInputError(`Invalid JSON in ${absolutePath}: ${message(error)}`, {
      cause: error,
    });
  }
}

export async function loadPolicyResults(
  path: string,
  signal?: AbortSignal,
): Promise<PolicyResultsDocument> {
  const parsed = await loadJsonDocument(path, signal);
  try {
    return assertValidPolicyResultsDocument(parsed);
  } catch (error) {
    const detail =
      error instanceof PolicyResultsIntegrityError
        ? `${error.issues.length} integrity issue(s); ${error.issues[0]?.message ?? error.message}`
        : message(error);
    throw new StructuredExportInputError(`Invalid policy results: ${detail}`, { cause: error });
  }
}

export async function loadImpactResults(
  path: string,
  signal?: AbortSignal,
): Promise<ImpactDocument> {
  const parsed = await loadJsonDocument(path, signal);
  try {
    return assertValidImpactDocument(parsed);
  } catch (error) {
    const detail =
      error instanceof ImpactIntegrityError
        ? `${error.issues.length} integrity issue(s); ${error.issues[0]?.message ?? error.message}`
        : message(error);
    throw new StructuredExportInputError(`Invalid impact results: ${detail}`, { cause: error });
  }
}
