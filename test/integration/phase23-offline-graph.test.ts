import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { buildGraphReportDocument } from '../../src/graph-report/project.js';
import { renderOfflineGraphReport } from '../../src/graph-report/html.js';

describe('Phase 23 integrated offline graph', () => {
  it('renders endpoint paths, guards, provenance, evidence, and explicit uncertainty', async () => {
    const { analysis } = await scanRepository({ repositoryRoot: resolve('example-nestjs-app') });
    const document = buildGraphReportDocument({ analysis });
    expect(document.endpoints).toHaveLength(7);
    const create = document.endpoints.find(
      ({ httpMethod, path }) => httpMethod === 'POST' && path === '/notes',
    )!;
    expect(create.scene.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'NotesController.create', kind: 'method' }),
        expect.objectContaining({ label: 'NotesService.create', kind: 'method' }),
        expect.objectContaining({ label: 'body.title', kind: 'request_origin' }),
        expect.objectContaining({ label: 'Note.title', kind: 'entity_column' }),
        expect.objectContaining({ label: 'note', kind: 'table' }),
      ]),
    );
    expect(create.scene.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'calls', kind: 'assertion' }),
        expect.objectContaining({ label: 'writes', kind: 'assertion' }),
        expect.objectContaining({ label: 'may flow (direct)', kind: 'provenance' }),
      ]),
    );
    const guarded = document.endpoints.find(
      ({ httpMethod, path }) => httpMethod === 'DELETE' && path === '/notes/:id',
    )!;
    expect(guarded.guards).toContain('AuthGuard');
    expect(guarded.scene.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'AuthGuard', kind: 'guard' })]),
    );
    expect(create.scene.evidence.some(({ path }) => path.includes('notes.service.ts'))).toBe(true);
    const html = await renderOfflineGraphReport(document);
    expect(html).toContain('body.title');
    expect(html).toContain('no omitted fact is inferred as absent');
  }, 30_000);
});
