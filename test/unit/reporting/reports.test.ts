import { describe, expect, it } from 'vitest';
import { createStableId, makeAssertionId } from '../../../src/model/ids.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import {
  buildMarkdownReportBundle,
  traceReportFileName,
} from '../../../src/reporting/report-bundle.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

describe('deterministic Markdown reports', () => {
  it('uses stable filesystem-safe names for separators, parameters, and wildcards', () => {
    const endpoint = {
      id: createStableId('endpoint', ['unsafe-route']),
      httpMethod: 'GET' as const,
      path: '/customers/:id/files/*',
    };

    expect(traceReportFileName(endpoint)).toMatch(
      /^get-customers-param-id-files-[a-f0-9]{10}\.md$/u,
    );
    expect(traceReportFileName(endpoint)).toBe(traceReportFileName(endpoint));
    expect(traceReportFileName(endpoint)).not.toMatch(/[/:*?"<>|\\]/u);
  });

  it('renders readable evidence without mutating canonical JSON and honors view filters', () => {
    const analysis = createMinimalAnalysisDocument();
    const before = serializeCanonicalAnalysis(analysis);
    const bundle = buildMarkdownReportBundle(analysis);

    expect(bundle.traces).toHaveLength(1);
    expect(bundle.endpointsMarkdown).toContain('Endpoints: 1 of 1');
    expect(bundle.contractsMarkdown).toContain('Contract inventory is unavailable');
    expect(bundle.traces[0]?.contents).toContain('## Trace steps');
    expect(bundle.traces[0]?.contents).toContain('decorator src/health.controller.ts:3:3');
    expect(bundle.traces[0]?.contents).toContain('## Limitations');
    expect(serializeCanonicalAnalysis(analysis)).toBe(before);

    const filtered = buildMarkdownReportBundle(analysis, { route: '/missing/' });
    expect(filtered.traces).toEqual([]);
    expect(filtered.endpointsMarkdown).toContain('Endpoints: 0 of 1');
    expect(filtered.endpointsMarkdown).toContain('route=`/missing`');
    expect(filtered.contractsMarkdown).not.toContain('### `GET` `/health`');
    expect(serializeCanonicalAnalysis(analysis)).toBe(before);
  });

  it('does not guess reports for ambiguous selectors', () => {
    const analysis = createMinimalAnalysisDocument();
    const duplicate = {
      ...analysis.endpoints[0]!,
      id: createStableId('endpoint', ['duplicate-health-report']),
    };
    const implementation = analysis.assertions[0]!;
    const duplicateImplementation = {
      ...implementation,
      id: makeAssertionId({
        subjectId: duplicate.id,
        predicate: 'ENDPOINT_IMPLEMENTED_BY',
        objectId: implementation.objectId,
        ruleId: implementation.ruleId,
      }),
      subjectId: duplicate.id,
    };
    const bundle = buildMarkdownReportBundle({
      ...analysis,
      endpoints: [...analysis.endpoints, duplicate],
      assertions: [...analysis.assertions, duplicateImplementation],
    });

    expect(bundle.traces).toEqual([]);
    expect(bundle.skippedAmbiguousEndpointCount).toBe(2);
    expect(bundle.endpointsMarkdown.match(/\| ambiguous \|/gu)).toHaveLength(2);
  });
});
