import { join, resolve } from 'node:path';
import { renderDiffMarkdown } from '../comparison/markdown.js';
import type { DiffDocument } from '../comparison/model.js';
import { serializeDiffDocument } from '../comparison/ordering.js';
import { assertValidDiffDocument } from '../comparison/validate.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export const DIFF_OUTPUT_FORMATS = ['json', 'markdown'] as const;
export type DiffOutputFormat = (typeof DIFF_OUTPUT_FORMATS)[number];

export async function writeDiffArtifact(input: {
  readonly outputDirectory: string;
  readonly format: DiffOutputFormat;
  readonly diff: DiffDocument;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const diff = assertValidDiffDocument(input.diff);
  const outputDirectory = resolve(input.outputDirectory);
  const outputPath = join(outputDirectory, input.format === 'json' ? 'diff.json' : 'diff.md');
  const contents = input.format === 'json' ? serializeDiffDocument(diff) : renderDiffMarkdown(diff);
  await writeTextFilesAtomically([{ path: outputPath, contents }], input.signal);
  return outputPath;
}
