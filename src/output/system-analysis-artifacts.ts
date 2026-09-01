import { join, resolve } from 'node:path';
import { renderSystemAnalysisMarkdown } from '../system-analysis/markdown.js';
import type { SystemAnalysisDocument } from '../system-analysis/model.js';
import { serializeCanonicalSystemAnalysis } from '../system-analysis/ordering.js';
import { assertValidSystemAnalysisDocument } from '../system-analysis/validate.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export async function writeSystemAnalysisArtifacts(input: {
  readonly outputDirectory: string;
  readonly document: SystemAnalysisDocument;
  readonly signal?: AbortSignal;
}): Promise<{ readonly jsonPath: string; readonly markdownPath: string }> {
  const document = assertValidSystemAnalysisDocument(input.document);
  const outputDirectory = resolve(input.outputDirectory);
  const jsonPath = join(outputDirectory, 'system-analysis.json');
  const markdownPath = join(outputDirectory, 'system-analysis.md');
  await writeTextFilesAtomically(
    [
      { path: markdownPath, contents: renderSystemAnalysisMarkdown(document) },
      { path: jsonPath, contents: serializeCanonicalSystemAnalysis(document) },
    ],
    input.signal,
  );
  return { jsonPath, markdownPath };
}
