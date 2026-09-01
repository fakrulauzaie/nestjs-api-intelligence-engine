import { join, resolve } from 'node:path';
import { renderOfflineSystemReport } from '../system-report/html.js';
import { renderSystemReportMarkdown } from '../system-report/markdown.js';
import type { SystemReportDocument } from '../system-report/model.js';
import { serializeCanonicalSystemReport } from '../system-report/ordering.js';
import { assertValidSystemReportDocument } from '../system-report/validate.js';
import { writeTextFilesAtomically } from './atomic-files.js';

export async function writeSystemReportArtifacts(input: {
  readonly outputDirectory: string;
  readonly document: SystemReportDocument;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly htmlPath: string;
  readonly htmlBytes: number;
}> {
  const document = assertValidSystemReportDocument(input.document);
  const outputDirectory = resolve(input.outputDirectory);
  const jsonPath = join(outputDirectory, 'system-report.json');
  const markdownPath = join(outputDirectory, 'system-report.md');
  const htmlPath = join(outputDirectory, 'api-intel-system-graph.html');
  const html = await renderOfflineSystemReport(document);
  await writeTextFilesAtomically(
    [
      { path: jsonPath, contents: serializeCanonicalSystemReport(document) },
      { path: markdownPath, contents: renderSystemReportMarkdown(document) },
      { path: htmlPath, contents: html },
    ],
    input.signal,
  );
  return { jsonPath, markdownPath, htmlPath, htmlBytes: Buffer.byteLength(html, 'utf8') };
}
