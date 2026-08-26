import { join, resolve } from 'node:path';
import { renderImpactMarkdown } from '../impact/markdown.js';
import type { ImpactDocument } from '../impact/model.js';
import { serializeImpactDocument } from '../impact/ordering.js';
import { assertValidImpactDocument } from '../impact/validate.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export const IMPACT_OUTPUT_FORMATS = ['json', 'markdown'] as const;
export type ImpactOutputFormat = (typeof IMPACT_OUTPUT_FORMATS)[number];

export async function writeImpactArtifact(input: {
  readonly outputDirectory: string;
  readonly format: ImpactOutputFormat;
  readonly impact: ImpactDocument;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const impact = assertValidImpactDocument(input.impact);
  const outputDirectory = resolve(input.outputDirectory);
  const outputPath = join(outputDirectory, input.format === 'json' ? 'impact.json' : 'impact.md');
  const contents =
    input.format === 'json' ? serializeImpactDocument(impact) : renderImpactMarkdown(impact);
  await writeTextFilesAtomically([{ path: outputPath, contents }], input.signal);
  return outputPath;
}
