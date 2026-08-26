import { join, resolve } from 'node:path';
import { renderOfflineGraphReport } from '../graph-report/html.js';
import type { GraphReportDocument } from '../graph-report/model.js';
import { assertValidGraphReportDocument } from '../graph-report/validate.js';
import type { ImpactDocument } from '../impact/model.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import type { PreparedTextArtifact } from './artifact-plan.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export async function prepareOfflineGraphReportArtifact(input: {
  readonly outputDirectory: string;
  readonly document: GraphReportDocument;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
  readonly impact?: ImpactDocument | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<{
  readonly path: string;
  readonly bytes: number;
  readonly artifact: PreparedTextArtifact;
}> {
  input.signal?.throwIfAborted();
  const document = assertValidGraphReportDocument({
    document: input.document,
    analysis: input.analysis,
    ...(input.policyResults === undefined ? {} : { policyResults: input.policyResults }),
    ...(input.impact === undefined ? {} : { impact: input.impact }),
  });
  const contents = await renderOfflineGraphReport(document);
  input.signal?.throwIfAborted();
  const path = join(resolve(input.outputDirectory), 'api-intel-graph.html');
  return {
    path,
    bytes: Buffer.byteLength(contents),
    artifact: { kind: 'offline_graph', path, contents },
  };
}

export async function writeOfflineGraphReportArtifact(input: {
  readonly outputDirectory: string;
  readonly document: GraphReportDocument;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
  readonly impact?: ImpactDocument | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<{ readonly path: string; readonly bytes: number }> {
  const prepared = await prepareOfflineGraphReportArtifact(input);
  await writeTextFilesAtomically([prepared.artifact], input.signal);
  return { path: prepared.path, bytes: prepared.bytes };
}
