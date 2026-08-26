import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertValidAnalysisDocument } from '../evidence/validate.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { EndpointCatalogueFilter } from '../reporting/endpoint-catalogue.js';
import { buildMarkdownReportBundle } from '../reporting/report-bundle.js';
import { writeTextFilesAtomically } from './atomic-files.js';
import { finalizeReportManifestUpdate, prepareReportManifestUpdate } from './report-manifest.js';

export interface MarkdownReportArtifactPaths {
  readonly outputDirectory: string;
  readonly endpointsMarkdownPath: string;
  readonly contractsMarkdownPath: string;
  readonly traceDirectory: string;
  readonly tracePaths: readonly string[];
  readonly skippedAmbiguousEndpointCount: number;
}

export async function writeMarkdownReportArtifacts(input: {
  outputDirectory: string;
  analysis: AnalysisDocument;
  filter?: EndpointCatalogueFilter;
  signal?: AbortSignal;
}): Promise<MarkdownReportArtifactPaths> {
  const analysis = assertValidAnalysisDocument(input.analysis);
  const outputDirectory = resolve(input.outputDirectory);
  const traceDirectory = join(outputDirectory, 'traces');
  const endpointsMarkdownPath = join(outputDirectory, 'endpoints.md');
  const contractsMarkdownPath = join(outputDirectory, 'contracts.md');
  const bundle = buildMarkdownReportBundle(analysis, input.filter);
  const tracePaths = bundle.traces.map((trace) => join(traceDirectory, trace.fileName));
  const manifest = await prepareReportManifestUpdate(
    outputDirectory,
    traceDirectory,
    bundle.traces.map((trace) => trace.fileName),
  );

  await mkdir(traceDirectory, { recursive: true });
  await writeTextFilesAtomically(
    [
      { path: endpointsMarkdownPath, contents: bundle.endpointsMarkdown },
      { path: contractsMarkdownPath, contents: bundle.contractsMarkdown },
      ...bundle.traces.map((trace, index) => ({
        path: tracePaths[index]!,
        contents: trace.contents,
      })),
      { path: manifest.manifestPath, contents: manifest.pendingContents },
    ],
    input.signal,
  );
  await finalizeReportManifestUpdate(manifest);

  return {
    outputDirectory,
    endpointsMarkdownPath,
    contractsMarkdownPath,
    traceDirectory,
    tracePaths,
    skippedAmbiguousEndpointCount: bundle.skippedAmbiguousEndpointCount,
  };
}
