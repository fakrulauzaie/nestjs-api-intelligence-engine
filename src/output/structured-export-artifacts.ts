import { join, resolve } from 'node:path';
import type { AnalysisDocument } from '../model/analysis.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import { renderControlEvidenceCsv } from '../structured-exports/csv.js';
import type {
  ControlEvidenceDocument,
  OpenApiEnrichmentResultDocument,
} from '../structured-exports/model.js';
import {
  serializeControlEvidenceDocument,
  serializeOpenApiEnrichmentResult,
} from '../structured-exports/ordering.js';
import { serializeEnrichedOpenApi } from '../structured-exports/openapi.js';
import type { PreparedTextArtifact } from './artifact-plan.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export function prepareOpenApiEnrichmentArtifacts(input: {
  readonly sourceOpenApiPath: string;
  readonly outputDirectory: string;
  readonly enrichedDocument: Record<string, unknown>;
  readonly result: OpenApiEnrichmentResultDocument;
}): {
  readonly enrichedPath: string;
  readonly sidecarPath: string;
  readonly artifacts: readonly PreparedTextArtifact[];
} {
  const outputDirectory = resolve(input.outputDirectory);
  const enrichedPath = join(outputDirectory, 'openapi.enriched.json');
  const sidecarPath = join(outputDirectory, 'openapi-enrichment.json');
  const sourcePath = resolve(input.sourceOpenApiPath);
  if (sourcePath === resolve(enrichedPath) || sourcePath === resolve(sidecarPath)) {
    throw new RangeError('The OpenAPI input path collides with a generated output artifact.');
  }
  return {
    enrichedPath,
    sidecarPath,
    artifacts: [
      {
        kind: 'openapi_enriched',
        path: enrichedPath,
        contents: serializeEnrichedOpenApi(input.enrichedDocument),
      },
      {
        kind: 'openapi_sidecar',
        path: sidecarPath,
        contents: serializeOpenApiEnrichmentResult(input.result),
      },
    ],
  };
}

export async function writeOpenApiEnrichmentArtifacts(input: {
  readonly sourceOpenApiPath: string;
  readonly outputDirectory: string;
  readonly enrichedDocument: Record<string, unknown>;
  readonly result: OpenApiEnrichmentResultDocument;
  readonly signal?: AbortSignal;
}): Promise<{ readonly enrichedPath: string; readonly sidecarPath: string }> {
  const prepared = prepareOpenApiEnrichmentArtifacts(input);
  await writeTextFilesAtomically(prepared.artifacts, input.signal);
  return { enrichedPath: prepared.enrichedPath, sidecarPath: prepared.sidecarPath };
}

export function prepareControlEvidenceArtifacts(input: {
  readonly outputDirectory: string;
  readonly document: ControlEvidenceDocument;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
}): {
  readonly jsonPath: string;
  readonly csvPath: string;
  readonly artifacts: readonly PreparedTextArtifact[];
} {
  const outputDirectory = resolve(input.outputDirectory);
  const jsonPath = join(outputDirectory, 'control-evidence.json');
  const csvPath = join(outputDirectory, 'control-evidence.csv');
  const json = serializeControlEvidenceDocument({
    document: input.document,
    analysis: input.analysis,
    ...(input.policyResults === undefined ? {} : { policyResults: input.policyResults }),
  });
  return {
    jsonPath,
    csvPath,
    artifacts: [
      { kind: 'control_evidence_json', path: jsonPath, contents: json },
      {
        kind: 'control_evidence_csv',
        path: csvPath,
        contents: renderControlEvidenceCsv(input.document),
      },
    ],
  };
}

export async function writeControlEvidenceArtifacts(input: {
  readonly outputDirectory: string;
  readonly document: ControlEvidenceDocument;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
  readonly signal?: AbortSignal;
}): Promise<{ readonly jsonPath: string; readonly csvPath: string }> {
  const prepared = prepareControlEvidenceArtifacts(input);
  await writeTextFilesAtomically(prepared.artifacts, input.signal);
  return { jsonPath: prepared.jsonPath, csvPath: prepared.csvPath };
}
