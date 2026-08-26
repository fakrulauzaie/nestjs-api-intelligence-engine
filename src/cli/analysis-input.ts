import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AnalysisIntegrityError, assertValidAnalysisDocument } from '../evidence/validate.js';
import type { AnalysisDocument } from '../model/analysis.js';

export class CanonicalAnalysisInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalAnalysisInputError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadCanonicalAnalysis(
  path: string,
  signal?: AbortSignal,
): Promise<AnalysisDocument> {
  const absolutePath = resolve(path);
  let contents: string;
  try {
    contents = await readFile(absolutePath, {
      encoding: 'utf8',
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new CanonicalAnalysisInputError(
      `Could not read analysis file ${absolutePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new CanonicalAnalysisInputError(
      `Invalid JSON in analysis file ${absolutePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  try {
    return assertValidAnalysisDocument(parsed);
  } catch (error) {
    const detail =
      error instanceof AnalysisIntegrityError
        ? `${error.issues.length} integrity issue(s); ${error.issues[0]?.message ?? error.message}`
        : errorMessage(error);
    throw new CanonicalAnalysisInputError(
      `Invalid canonical analysis in ${absolutePath}: ${detail}`,
      { cause: error },
    );
  }
}
