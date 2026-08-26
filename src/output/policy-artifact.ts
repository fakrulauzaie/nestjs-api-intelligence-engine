import { join, resolve } from 'node:path';
import { renderPolicyResultsMarkdown } from '../policy/markdown.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import { serializePolicyResults } from '../policy/ordering.js';
import { assertValidPolicyResultsDocument } from '../policy/validate.js';
import type { PreparedTextArtifact } from './artifact-plan.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export const POLICY_OUTPUT_FORMATS = ['json', 'markdown'] as const;
export type PolicyOutputFormat = (typeof POLICY_OUTPUT_FORMATS)[number];

export function preparePolicyArtifact(input: {
  readonly outputDirectory: string;
  readonly format: PolicyOutputFormat;
  readonly results: PolicyResultsDocument;
}): { readonly path: string; readonly artifact: PreparedTextArtifact } {
  const results = assertValidPolicyResultsDocument(input.results);
  const outputDirectory = resolve(input.outputDirectory);
  const path = join(
    outputDirectory,
    input.format === 'json' ? 'policy-results.json' : 'policy-results.md',
  );
  const contents =
    input.format === 'json'
      ? serializePolicyResults(results)
      : renderPolicyResultsMarkdown(results);
  return { path, artifact: { kind: 'policy_results', path, contents } };
}

export async function writePolicyArtifact(input: {
  readonly outputDirectory: string;
  readonly format: PolicyOutputFormat;
  readonly results: PolicyResultsDocument;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const prepared = preparePolicyArtifact(input);
  await writeTextFilesAtomically([prepared.artifact], input.signal);
  return prepared.path;
}
