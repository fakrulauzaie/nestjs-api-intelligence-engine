import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { buildMarkdownReportBundle } from '../../src/reporting/report-bundle.js';

describe('frozen Phase 9 reports', () => {
  it('renders every unique fixture endpoint with guards, table direction, evidence, and gaps', async () => {
    const scanned = await scanRepository({ repositoryRoot: resolve('example-nestjs-app') });
    const before = serializeCanonicalAnalysis(scanned.analysis);
    const first = buildMarkdownReportBundle(scanned.analysis);
    const second = buildMarkdownReportBundle(scanned.analysis);

    expect(first).toEqual(second);
    expect(first.traces).toHaveLength(7);
    expect(first.skippedAmbiguousEndpointCount).toBe(0);
    expect(first.traces.every((trace) => /^[a-z0-9-]+\.md$/u.test(trace.fileName))).toBe(true);

    const endpointById = new Map(
      scanned.analysis.endpoints.map((endpoint) => [
        endpoint.id,
        `${endpoint.httpMethod} ${endpoint.path}`,
      ]),
    );
    const reportFor = (selector: string): string =>
      first.traces.find((trace) => endpointById.get(trace.endpointId) === selector)?.contents ?? '';

    const guardedWrite = reportFor('DELETE /notes/:id');
    expect(guardedWrite).toContain('| AuthGuard | method | resolved |');
    expect(guardedWrite).toContain('| WRITE | note |');
    expect(guardedWrite).toContain('src/notes/notes.controller.ts:40');
    expect(guardedWrite).toContain('`AUTH_GLOBAL_POLICY_UNKNOWN`');

    const read = reportFor('GET /notes');
    expect(read).toContain('| READ | note |');
    expect(read).toContain('src/notes/notes.service.ts:25');

    const impreciseWrite = reportFor('POST /notes');
    expect(impreciseWrite).toContain('| WRITE | note |');
    expect(impreciseWrite).toContain('src/notes/notes.service.ts:18');
    expect(impreciseWrite).not.toContain('`TYPEORM_SAVE_COLUMNS_UNKNOWN`');

    const filtered = buildMarkdownReportBundle(scanned.analysis, {
      controller: 'AdminNotesController',
    });
    expect(filtered.traces).toHaveLength(1);
    expect(filtered.endpointsMarkdown).toContain('GET | `/admin/notes/count`');
    expect(filtered.endpointsMarkdown).toContain('controller=`AdminNotesController`');
    expect(serializeCanonicalAnalysis(scanned.analysis)).toBe(before);
  }, 20_000);
});
