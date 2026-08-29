import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository, SUPPORTED_INTERACTION_KINDS } from '../../src/analysis/scan-repository.js';
import {
  buildEndpointCatalogue,
  renderEndpointCatalogueMarkdown,
} from '../../src/reporting/endpoint-catalogue.js';
import { renderEndpointTraceMarkdown } from '../../src/reporting/endpoint-trace-markdown.js';
import { buildEndpointTrace } from '../../src/tracing/endpoint-trace.js';

function normalizeNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n');
}

function normalizeGeneratedMarkdown(value: string): string {
  const lines = normalizeNewlines(value)
    .replace(/Analysis: `analysis:[a-f0-9]{32}`/u, 'Analysis: `<run-specific-analysis-id>`')
    .split('\n')
    .map((line) => {
      if (!line.startsWith('|') || !line.endsWith('|') || !line.includes('<br>')) return line;
      const cells = line.split('|');
      const evidenceIndex = cells.length - 2;
      cells[evidenceIndex] = cells[evidenceIndex]!.trim()
        .split('<br>')
        .sort((left, right) => left.localeCompare(right))
        .join('<br>');
      return cells.join('|');
    });
  const traceStepsHeading = lines.indexOf('## Trace steps');
  if (traceStepsHeading >= 0) {
    const firstRow = traceStepsHeading + 4;
    let end = firstRow;
    while (end < lines.length && lines[end]!.startsWith('|')) end += 1;
    lines.splice(firstRow, end - firstRow, ...lines.slice(firstRow, end).sort());
  }
  return lines.join('\n').trimEnd();
}

describe('Documentation Gate D1 current examples', () => {
  it('keeps the checked-in catalogue, traces, and summary equal to current v5 output', async () => {
    const { analysis } = await scanRepository({ repositoryRoot: resolve('example-nestjs-app') });
    if (analysis.schemaVersion !== '5.0.0') throw new Error('Expected current analysis v5.');

    const [catalogue, readTrace, writeTrace, summaryText] = await Promise.all([
      readFile(resolve('docs/examples/current/endpoints.md'), 'utf8'),
      readFile(resolve('docs/examples/current/read-trace.md'), 'utf8'),
      readFile(resolve('docs/examples/current/write-trace.md'), 'utf8'),
      readFile(resolve('docs/examples/current/analysis-summary.json'), 'utf8'),
    ]);
    const generatedCatalogue = renderEndpointCatalogueMarkdown(buildEndpointCatalogue(analysis));
    expect(normalizeGeneratedMarkdown(catalogue)).toBe(
      normalizeGeneratedMarkdown(generatedCatalogue),
    );

    for (const [method, path, expected] of [
      ['GET', '/notes', readTrace],
      ['POST', '/notes', writeTrace],
    ] as const) {
      const result = buildEndpointTrace(analysis, { httpMethod: method, path });
      expect(result.status).toBe('resolved');
      if (result.status !== 'resolved') continue;
      const generated = renderEndpointTraceMarkdown({
        analysis,
        trace: result.trace,
        diagnostics: result.diagnostics,
      });
      expect(normalizeGeneratedMarkdown(expected)).toBe(normalizeGeneratedMarkdown(generated));
    }

    const summary = JSON.parse(summaryText) as {
      readonly schemaVersion: string;
      readonly resultState: string;
      readonly recordCounts: Readonly<Record<string, number>>;
      readonly interactionAnalysis: {
        readonly schemaKinds: readonly string[];
        readonly supportedKinds: readonly string[];
        readonly enabledKinds: readonly string[];
        readonly state: string;
      };
    };
    expect(summary).toEqual({
      artifactKind: 'current-analysis-summary-not-complete-canonical-document',
      schemaVersion: analysis.schemaVersion,
      resultState: analysis.resultState,
      recordCounts: {
        sourceFiles: analysis.sourceFiles.length,
        endpoints: analysis.endpoints.length,
        modules: analysis.modules.length,
        applications: analysis.applications.length,
        interactions: analysis.interactions.length,
        interactionHandlers: analysis.interactionHandlers.length,
        interactionHandlerDispatches: analysis.interactionHandlerDispatches.length,
        interactionHandlerBranches: analysis.interactionHandlerBranches.length,
        interactionHandlerBranchEffects: analysis.interactionHandlerBranchEffects.length,
        diagnostics: analysis.diagnostics.length,
      },
      interactionAnalysis: {
        schemaKinds: analysis.interactionAnalysis.schemaKinds,
        supportedKinds: [...SUPPORTED_INTERACTION_KINDS].sort(),
        enabledKinds: [...SUPPORTED_INTERACTION_KINDS].sort(),
        state: analysis.interactionAnalysis.state,
      },
    });
  }, 30_000);
});
