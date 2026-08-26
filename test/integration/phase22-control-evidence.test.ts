import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { normalizePolicyConfiguration } from '../../src/policy/config.js';
import { evaluatePolicies } from '../../src/policy/evaluate.js';
import { buildControlEvidenceDocument } from '../../src/structured-exports/control-evidence.js';
import { renderControlEvidenceCsv } from '../../src/structured-exports/csv.js';
import { serializeControlEvidenceDocument } from '../../src/structured-exports/ordering.js';
import { assertValidControlEvidenceDocument } from '../../src/structured-exports/validate.js';

describe('Phase 22 integrated control-evidence export', () => {
  it('exports one evidence-backed endpoint row with guards, tables, provenance, and policy outcomes', async () => {
    const { analysis } = await scanRepository({ repositoryRoot: resolve('example-nestjs-app') });
    const policyResults = evaluatePolicies({
      analysis,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: {
          'require-guard-on-write-endpoint': ['warn', { onUnknown: 'warn' }],
          'require-complete-write-trace': 'warn',
        },
      }),
    });
    const document = buildControlEvidenceDocument({ analysis, policyResults });
    expect(assertValidControlEvidenceDocument({ document, analysis, policyResults })).toEqual(
      document,
    );
    expect(document.rows).toHaveLength(7);
    const create = document.rows.find(
      ({ httpMethod, path }) => httpMethod === 'POST' && path === '/notes',
    )!;
    expect(create).toMatchObject({
      handler: 'NotesController.create',
      mutationClassification: 'write',
      dbWrites: ['note'],
    });
    expect(create.requestColumnInfluences).toEqual([
      expect.objectContaining({
        origin: 'body.title',
        column: 'Note.title',
        state: 'direct',
        sinkMethod: 'NotesService.create',
        callDepth: 1,
      }),
    ]);
    expect(create.policyOutcomes.length).toBeGreaterThan(0);
    expect(create.evidenceIds.length).toBeGreaterThan(0);
    expect(create.sourceLocations.some((location) => location.includes('notes.service.ts'))).toBe(
      true,
    );

    const guarded = document.rows.find(
      ({ httpMethod, path }) => httpMethod === 'DELETE' && path === '/notes/:id',
    )!;
    expect(guarded.directGuards).toEqual([
      expect.objectContaining({ name: 'AuthGuard', scope: 'method', status: 'resolved' }),
    ]);
    const first = serializeControlEvidenceDocument({ document, analysis, policyResults });
    const second = serializeControlEvidenceDocument({
      document: { ...document, rows: document.rows.toReversed() },
      analysis,
      policyResults,
    });
    expect(second).toBe(first);
    const csv = renderControlEvidenceCsv(document);
    expect(csv).toContain('request_column_influences');
    expect(csv).toContain('body.title -> Note.title');
    expect(csv.endsWith('\r\n')).toBe(true);
  }, 30_000);
});
