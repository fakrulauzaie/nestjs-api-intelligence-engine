import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildControlEvidenceDocument } from '../../../src/structured-exports/control-evidence.js';
import { enrichOpenApiDocument } from '../../../src/structured-exports/openapi.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import {
  writeFakeBullMq,
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

async function scanSource(path: string, withTypeOrm = false) {
  const project = await createTestTypeScriptProject();
  await Promise.all([
    writeFakeNestCommon(project),
    writeFakeBullMq(project),
    ...(withTypeOrm ? [writeFakeNestTypeOrm(project), writeFakeTypeOrm(project)] : []),
  ]);
  await project.write('src/fixture.ts', await readFile(path, 'utf8'));
  await writeBasicTsconfig(project);
  const result = await scanRepository({ repositoryRoot: project.path });
  return { project, result };
}

describe('Phase 40 BullMQ branch extraction and propagation', () => {
  it('filters exact endpoint effects while retaining common worker work', async () => {
    const { project, result } = await scanSource(
      'test/fixtures/phase40/bullmq-branch-endpoints.ts.txt',
      true,
    );
    try {
      const { analysis } = result;
      if (analysis.schemaVersion !== '7.0.0') throw new Error('Expected analysis v7.');
      expect(analysis.interactionHandlerDispatches).toEqual([
        expect.objectContaining({ state: 'complete' }),
      ]);
      expect(analysis.interactionHandlerBranches).toHaveLength(4);
      expect(analysis.interactionHandlerBranchEffects).toHaveLength(3);

      const generate = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/reports/generate',
      });
      const cleanup = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/reports/cleanup',
      });
      expect(generate.status).toBe('resolved');
      expect(cleanup.status).toBe('resolved');
      if (generate.status !== 'resolved' || cleanup.status !== 'resolved') return;
      expect(
        generate.trace.causalSummary?.distributedConditionalEffects.map(
          ({ tableName }) => tableName,
        ),
      ).toEqual(['generated_pdf', 'worker_receipt']);
      expect(
        cleanup.trace.causalSummary?.distributedConditionalEffects.map(
          ({ tableName }) => tableName,
        ),
      ).toEqual(['cleanup_receipt', 'worker_receipt']);
      expect(generate.trace.causalSummary?.jobQueueBranchIds).toHaveLength(2);
      expect(cleanup.trace.causalSummary?.jobQueueBranchIds).toHaveLength(2);

      const controls = buildControlEvidenceDocument({ analysis });
      expect(controls.schemaVersion).toBe('5.0.0');
      const controlRows = new Map(controls.rows.map((row) => [row.path, row]));
      expect(
        controlRows
          .get('/reports/generate')
          ?.distributedConditionalEffects?.map(({ table }) => table),
      ).toEqual(['generated_pdf', 'worker_receipt']);
      expect(
        controlRows
          .get('/reports/cleanup')
          ?.distributedConditionalEffects?.map(({ table }) => table),
      ).toEqual(['cleanup_receipt', 'worker_receipt']);
      expect(controlRows.get('/reports/generate')?.jobQueueBranchIds).toEqual(
        generate.trace.causalSummary?.jobQueueBranchIds,
      );

      const enriched = enrichOpenApiDocument({
        analysis,
        openApi: {
          openapi: '3.1.0',
          info: { title: 'Phase 40 fixture', version: '1.0.0' },
          paths: {
            '/reports/generate': { post: {} },
            '/reports/cleanup': { post: {} },
          },
        },
      });
      const paths = enriched.enrichedDocument.paths as Record<
        string,
        {
          post: {
            'x-api-intel': {
              schemaVersion: string;
              distributedConditionalEffects: { table: string }[];
              jobQueueBranchIds: string[];
            };
          };
        }
      >;
      expect(enriched.result.schemaVersion).toBe('5.0.0');
      expect(
        paths['/reports/generate']?.post['x-api-intel'].distributedConditionalEffects.map(
          ({ table }) => table,
        ),
      ).toEqual(['generated_pdf', 'worker_receipt']);
      expect(
        paths['/reports/cleanup']?.post['x-api-intel'].distributedConditionalEffects.map(
          ({ table }) => table,
        ),
      ).toEqual(['cleanup_receipt', 'worker_receipt']);
      expect(paths['/reports/generate']?.post['x-api-intel'].jobQueueBranchIds).toEqual(
        generate.trace.causalSummary?.jobQueueBranchIds,
      );

      const graph = buildGraphReportDocument({ analysis });
      expect(graph.schemaVersion).toBe('9.0.0');
      expect(
        graph.endpoints
          .find(({ path }) => path === '/reports/generate')
          ?.distributedConditionalEffects?.map(({ table }) => table),
      ).toEqual(['generated_pdf', 'worker_receipt']);
      expect(
        graph.interactionHandlers?.flatMap(({ scene }) =>
          scene.nodes.filter(({ kind }) => kind === 'interaction_branch'),
        ),
      ).toHaveLength(4);
      expect(
        renderEndpointTraceMarkdown({
          analysis,
          trace: generate.trace,
          diagnostics: generate.diagnostics,
        }),
      ).toContain('Selected job-queue branches');

      const generateBranch = analysis.interactionHandlerBranches.find(
        ({ selector }) => selector.kind === 'exact_jobs' && selector.jobs.includes('generate-pdf'),
      )!;
      const removedEffect = analysis.interactionHandlerBranchEffects.find(
        ({ branchId }) => branchId === generateBranch.id,
      )!;
      const after = {
        ...analysis,
        interactionHandlerBranchEffects: analysis.interactionHandlerBranchEffects.filter(
          ({ id }) => id !== removedEffect.id,
        ),
      };
      expect(validateAnalysisDocument(after)).toMatchObject({ success: true });
      const diff = compareAnalysisDocuments(analysis, after);
      expect(diff.schemaVersion).toBe('5.0.0');
      expect(diff.jobQueueBranchEffectChanges).toEqual([
        expect.objectContaining({ change: 'removed' }),
      ]);
      const impact = analyzePotentialImpact(analysis, after);
      expect(impact.schemaVersion).toBe('2.0.0');
      expect(impact.impactedEndpoints.map(({ path }) => path)).toContain('/reports/generate');
      expect(
        impact.impactedEndpoints
          .find(({ path }) => path === '/reports/cleanup')
          ?.reasons.some(({ reasonCode }) => reasonCode === 'job_queue_branch_effect_changed') ??
          false,
      ).toBe(false);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('publishes partial and unsupported residual branches without dropping calls', async () => {
    const { project, result } = await scanSource('test/fixtures/phase39/bullmq/unsupported.ts.txt');
    try {
      const { analysis } = result;
      if (analysis.schemaVersion !== '7.0.0') throw new Error('Expected analysis v7.');
      expect(analysis.interactionHandlerDispatches.map(({ state }) => state).sort()).toEqual([
        'partial',
        'partial',
        'unsupported',
        'unsupported',
        'unsupported',
      ]);
      const unknownBranchIds = new Set(
        analysis.interactionHandlerBranches
          .filter(({ selector }) => selector.kind === 'unknown')
          .map(({ id }) => id),
      );
      expect(unknownBranchIds.size).toBe(5);
      expect(
        analysis.interactionHandlerBranchEffects.filter(({ branchId }) =>
          unknownBranchIds.has(branchId),
        ).length,
      ).toBeGreaterThanOrEqual(5);
      expect(analysis.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining(['JOB_QUEUE_FILTER_PARTIAL', 'JOB_QUEUE_FILTER_UNPROVEN']),
      );
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
