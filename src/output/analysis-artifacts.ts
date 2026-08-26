import { join, resolve } from 'node:path';
import { assertValidAnalysisDocument } from '../evidence/validate.js';
import type { AnalysisDocument, RunDocument } from '../model/analysis.js';
import {
  canonicalStringify,
  canonicalizeRunDocument,
  serializeCanonicalAnalysis,
} from '../model/ordering.js';
import { runDocumentSchema } from '../model/schemas.js';
import type { EndpointCatalogueFilter } from '../reporting/endpoint-catalogue.js';
import { buildMarkdownReportBundle } from '../reporting/report-bundle.js';
import type { PreparedTextArtifact } from './artifact-plan.js';
import { writeTextFilesAtomically } from './atomic-files.js';
import { cleanupStaleTraceArtifacts, prepareReportManifestUpdate } from './report-manifest.js';

export interface AnalysisArtifactPaths {
  readonly outputDirectory: string;
  readonly analysisPath: string;
  readonly runPath: string;
  readonly endpointsMarkdownPath: string;
  readonly contractsMarkdownPath: string;
  readonly traceDirectory: string;
  readonly tracePaths: readonly string[];
  readonly skippedAmbiguousEndpointCount: number;
}

export interface PreparedAnalysisArtifacts extends AnalysisArtifactPaths {
  readonly artifacts: readonly PreparedTextArtifact[];
  readonly staleTracePaths: readonly string[];
}

export async function prepareAnalysisArtifacts(
  outputDirectory: string,
  analysis: AnalysisDocument,
  run: RunDocument,
  options: { readonly filter?: EndpointCatalogueFilter } = {},
): Promise<PreparedAnalysisArtifacts> {
  const absoluteOutputDirectory = resolve(outputDirectory);
  const analysisPath = join(absoluteOutputDirectory, 'analysis.json');
  const runPath = join(absoluteOutputDirectory, 'run.json');
  const endpointsMarkdownPath = join(absoluteOutputDirectory, 'endpoints.md');
  const contractsMarkdownPath = join(absoluteOutputDirectory, 'contracts.md');
  const traceDirectory = join(absoluteOutputDirectory, 'traces');
  const validatedRun = runDocumentSchema.parse(run);
  const validatedAnalysis = assertValidAnalysisDocument(analysis);
  const reports = buildMarkdownReportBundle(validatedAnalysis, options.filter);
  const tracePaths = reports.traces.map((trace) => join(traceDirectory, trace.fileName));
  const manifest = await prepareReportManifestUpdate(
    absoluteOutputDirectory,
    traceDirectory,
    reports.traces.map((trace) => trace.fileName),
  );
  return {
    outputDirectory: absoluteOutputDirectory,
    analysisPath,
    runPath,
    endpointsMarkdownPath,
    contractsMarkdownPath,
    traceDirectory,
    tracePaths,
    skippedAmbiguousEndpointCount: reports.skippedAmbiguousEndpointCount,
    staleTracePaths: manifest.staleTracePaths,
    artifacts: [
      {
        kind: 'endpoint_catalogue',
        path: endpointsMarkdownPath,
        contents: reports.endpointsMarkdown,
      },
      { kind: 'contract_report', path: contractsMarkdownPath, contents: reports.contractsMarkdown },
      ...reports.traces.map(
        (trace, index): PreparedTextArtifact => ({
          kind: 'endpoint_trace',
          path: tracePaths[index]!,
          contents: trace.contents,
        }),
      ),
      { kind: 'trace_manifest', path: manifest.manifestPath, contents: manifest.finalContents },
      {
        kind: 'run',
        path: runPath,
        contents: canonicalStringify(canonicalizeRunDocument(validatedRun)),
        stability: 'run_metadata',
      },
      {
        kind: 'analysis',
        path: analysisPath,
        contents: serializeCanonicalAnalysis(validatedAnalysis),
      },
    ],
  };
}

export async function writeAnalysisArtifacts(
  outputDirectory: string,
  analysis: AnalysisDocument,
  run: RunDocument,
  options: { readonly filter?: EndpointCatalogueFilter; readonly signal?: AbortSignal } = {},
): Promise<AnalysisArtifactPaths> {
  const prepared = await prepareAnalysisArtifacts(outputDirectory, analysis, run, options);
  await writeTextFilesAtomically(prepared.artifacts, options.signal);
  await cleanupStaleTraceArtifacts(prepared.staleTracePaths);
  return {
    outputDirectory: prepared.outputDirectory,
    analysisPath: prepared.analysisPath,
    runPath: prepared.runPath,
    endpointsMarkdownPath: prepared.endpointsMarkdownPath,
    contractsMarkdownPath: prepared.contractsMarkdownPath,
    traceDirectory: prepared.traceDirectory,
    tracePaths: prepared.tracePaths,
    skippedAmbiguousEndpointCount: prepared.skippedAmbiguousEndpointCount,
  };
}
