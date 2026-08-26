import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { renderOfflineGraphReport } from '../../../src/graph-report/html.js';
import { buildImpactGraph, pathsFromEndpoints } from '../../../src/impact/graph.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import type {
  JobQueueHandlerRecord,
  JobQueueInteractionRecord,
} from '../../../src/model/interactions.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildControlEvidenceDocument } from '../../../src/structured-exports/control-evidence.js';
import { renderControlEvidenceCsv } from '../../../src/structured-exports/csv.js';
import { enrichOpenApiDocument } from '../../../src/structured-exports/openapi.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../../../src/tracing/interaction-handler-trace.js';
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

async function scanFixture(name: string) {
  const project = await createTestTypeScriptProject();
  await Promise.all([
    writeFakeNestCommon(project),
    writeFakeBullMq(project),
    writeFakeNestTypeOrm(project),
    writeFakeTypeOrm(project),
  ]);
  const fixture = await readFile(`test/fixtures/distributed/bullmq/${name}.ts.txt`, 'utf8');
  await project.write(`src/${name}.ts`, fixture);
  await writeBasicTsconfig(project);
  const result = await scanRepository({ repositoryRoot: project.path });
  return { project, result };
}

describe('Nest BullMQ extraction', () => {
  it('links a co-located Queue.add producer to a registered queue-wide worker conditionally', async () => {
    const { project, result } = await scanFixture('colocated');
    try {
      const { analysis } = result;
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      const interactions = analysis.interactions.filter(
        (record): record is JobQueueInteractionRecord => record.kind === 'job_queue',
      );
      const handlers = analysis.interactionHandlers.filter(
        (record): record is JobQueueHandlerRecord => record.kind === 'job_queue',
      );
      expect(interactions).toEqual([
        expect.objectContaining({
          activation: 'eager',
          boundary: 'broker_or_worker_boundary',
          dispatchTiming: 'asynchronous',
          target: {
            targetKind: 'queue',
            technology: 'bullmq',
            queue: { resolution: 'exact', value: 'reports' },
            job: { resolution: 'exact', value: 'generate-pdf' },
          },
        }),
      ]);
      expect(handlers).toEqual([
        expect.objectContaining({
          registrationState: 'proven_registered',
          target: {
            targetKind: 'queue',
            technology: 'bullmq',
            queue: { resolution: 'exact', value: 'reports' },
            job: { resolution: 'dynamic', value: null },
          },
        }),
      ]);
      expect(
        analysis.assertions.filter(
          ({ predicate }) => predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER',
        ),
      ).toHaveLength(1);
      const trace = buildEndpointTrace(analysis, { httpMethod: 'POST', path: '/reports' });
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(trace.trace.causalSummary?.distributedInteractionIds).toEqual([interactions[0]!.id]);
        expect(trace.trace.causalSummary?.distributedConditionalEffects).toEqual([
          expect.objectContaining({
            direction: 'WRITE',
            tableName: 'report_job',
            causalClass: 'distributed_conditional',
          }),
        ]);
        expect(
          renderEndpointTraceMarkdown({
            analysis,
            trace: trace.trace,
            diagnostics: trace.diagnostics,
          }),
        ).toContain('## BullMQ interactions');
      }
      const handlerTrace = buildInteractionHandlerTrace(analysis, handlers[0]!.id);
      expect(handlerTrace.status).toBe('resolved');
      if (handlerTrace.status === 'resolved') {
        expect(handlerTrace.trace.terminals).toEqual([
          expect.objectContaining({ causalClass: 'distributed_conditional' }),
        ]);
      }
      const graph = buildGraphReportDocument({ analysis });
      const scene = graph.endpoints.find(({ path }) => path === '/reports')?.scene;
      expect(scene?.nodes.some(({ label }) => label.includes('bullmq queue reports'))).toBe(true);
      expect(scene?.nodes.some(({ label }) => label.includes('@Processor'))).toBe(true);
      expect(scene?.nodes.some(({ label }) => label === 'broker or worker boundary')).toBe(true);
      expect(scene?.edges.some(({ label }) => label === 'delivered')).toBe(false);
      expect(
        graph.endpoints.find(({ path }) => path === '/reports')?.distributedConditionalEffects,
      ).toEqual([
        expect.objectContaining({
          direction: 'WRITE',
          table: 'report_job',
          causalClass: 'distributed_conditional',
        }),
      ]);

      const manualOutput = process.env.API_INTEL_PHASE35_MANUAL_OUTPUT;
      if (manualOutput !== undefined && manualOutput.length > 0) {
        const outputDirectory = resolve(manualOutput);
        await mkdir(outputDirectory, { recursive: true });
        await Promise.all([
          writeFile(
            resolve(outputDirectory, 'analysis.json'),
            serializeCanonicalAnalysis(analysis),
            'utf8',
          ),
          renderOfflineGraphReport(graph).then((html) =>
            writeFile(resolve(outputDirectory, 'api-intel-graph.html'), html, 'utf8'),
          ),
        ]);
      }

      const controls = buildControlEvidenceDocument({ analysis });
      expect(controls.schemaVersion).toBe('3.0.0');
      expect(controls.rows[0]?.distributedInteractions).toEqual([
        expect.objectContaining({ kind: 'job_queue', target: expect.stringContaining('reports') }),
      ]);
      expect(controls.rows[0]?.distributedConditionalEffects).toEqual([
        expect.objectContaining({ table: 'report_job' }),
      ]);
      const csv = renderControlEvidenceCsv(controls);
      expect(csv).toContain('distributed_interactions');
      expect(csv).toContain('distributed_conditional_effects');
      const enriched = enrichOpenApiDocument({
        analysis,
        openApi: {
          openapi: '3.1.0',
          info: { title: 'BullMQ fixture', version: '1.0.0' },
          paths: { '/reports': { post: {} } },
        },
      });
      expect(enriched.result.schemaVersion).toBe('3.0.0');
      expect(
        (
          enriched.enrichedDocument.paths as Record<
            string,
            { post: { 'x-api-intel': Record<string, unknown> } }
          >
        )['/reports']?.post['x-api-intel'],
      ).toMatchObject({
        distributedInteractions: [expect.objectContaining({ kind: 'job_queue' })],
        distributedConditionalEffects: [expect.objectContaining({ table: 'report_job' })],
      });

      const projection = await import('../../../src/comparison/projection.js').then(
        ({ buildAnalysisSemanticProjection }) => buildAnalysisSemanticProjection(analysis),
      );
      const impact = buildImpactGraph('after', analysis, projection);
      const paths = pathsFromEndpoints(impact, handlers[0]!.methodId);
      expect(
        paths.some(({ steps }) =>
          ['METHOD_INITIATES_INTERACTION', 'INTERACTION_MATCHES_LOCAL_HANDLER'].every((predicate) =>
            steps.some((step) => step.predicate === predicate),
          ),
        ),
      ).toBe(true);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('keeps producer-only and consumer-only repositories as normal open-world topologies', async () => {
    const producer = await scanFixture('producer-only');
    const consumer = await scanFixture('consumer-only');
    try {
      if (
        producer.result.analysis.schemaVersion !== '3.0.0' ||
        consumer.result.analysis.schemaVersion !== '3.0.0'
      ) {
        throw new Error('Expected analysis v3.');
      }
      const producerInteractions = producer.result.analysis.interactions.filter(
        ({ kind }) => kind === 'job_queue',
      );
      expect(producerInteractions).toEqual([
        expect.objectContaining({ boundary: 'external_or_unobserved' }),
      ]);
      expect(
        producer.result.analysis.assertions.filter(
          ({ predicate }) => predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER',
        ),
      ).toEqual([]);
      expect(producer.result.analysis.diagnostics.map(({ code }) => code)).not.toContain(
        'JOB_QUEUE_HANDLER_REGISTRATION_UNKNOWN',
      );

      const consumerHandlers = consumer.result.analysis.interactionHandlers.filter(
        ({ kind }) => kind === 'job_queue',
      );
      expect(
        consumer.result.analysis.interactions.filter(({ kind }) => kind === 'job_queue'),
      ).toEqual([]);
      expect(consumerHandlers).toEqual([
        expect.objectContaining({ registrationState: 'proven_registered' }),
      ]);
      const trace = buildInteractionHandlerTrace(consumer.result.analysis, consumerHandlers[0]!.id);
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(trace.trace.terminals).toEqual([
          expect.objectContaining({
            direction: 'WRITE',
            tableName: 'webhook_delivery',
            causalClass: 'distributed_conditional',
          }),
        ]);
      }
    } finally {
      await Promise.all([producer.project.cleanup(), consumer.project.cleanup()]);
    }
  }, 30_000);

  it('retains queue-wide conditional effects when job-name branch slicing is unproven', async () => {
    const { project, result } = await scanFixture('branch-filtering');
    try {
      const { analysis } = result;
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      const interactions = analysis.interactions.filter(
        (record): record is JobQueueInteractionRecord => record.kind === 'job_queue',
      );
      const handlers = analysis.interactionHandlers.filter(
        (record): record is JobQueueHandlerRecord => record.kind === 'job_queue',
      );
      expect(interactions).toHaveLength(2);
      expect(handlers).toHaveLength(1);
      expect(handlers[0]!.target.job).toEqual({ resolution: 'dynamic', value: null });
      expect(analysis.diagnostics.map(({ code }) => code)).toContain('JOB_QUEUE_FILTER_UNPROVEN');
      expect(
        analysis.assertions.filter(
          ({ predicate }) => predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER',
        ),
      ).toHaveLength(2);
      expect(analysis.assertions.some(({ ruleId }) => ruleId.includes('job-specific'))).toBe(false);
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('carries BullMQ target changes through comparison and potential-impact paths', async () => {
    const { project, result: before } = await scanFixture('colocated');
    try {
      const fixture = await readFile('test/fixtures/distributed/bullmq/colocated.ts.txt', 'utf8');
      await project.write(
        'src/colocated.ts',
        fixture.replace(
          "this.reportsQueue.add('generate-pdf'",
          "this.reportsQueue.add('archive-pdf'",
        ),
      );
      const after = await scanRepository({ repositoryRoot: project.path });

      const comparison = compareAnalysisDocuments(before.analysis, after.analysis);
      expect(comparison.interactionChanges).toEqual([
        expect.objectContaining({ change: 'added' }),
        expect.objectContaining({ change: 'removed' }),
      ]);
      expect(
        comparison.interactionChanges?.map(
          ({ before: oldValue, after: newValue }) => oldValue?.targetKey ?? newValue?.targetKey,
        ),
      ).toEqual([expect.stringContaining('archive-pdf'), expect.stringContaining('generate-pdf')]);

      const impact = analyzePotentialImpact(before.analysis, after.analysis);
      const queueReasons = impact.impactedEndpoints
        .flatMap(({ reasons }) => reasons)
        .filter(({ reasonCode }) =>
          ['interaction_added', 'interaction_removed'].includes(reasonCode),
        );
      expect(queueReasons.map(({ reasonCode }) => reasonCode)).toEqual([
        'interaction_added',
        'interaction_removed',
      ]);
      expect(
        queueReasons.every(({ paths }) =>
          paths.some(({ steps }) =>
            steps.some(({ predicate }) => predicate === 'METHOD_INITIATES_INTERACTION'),
          ),
        ),
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  }, 40_000);

  it('fails closed for dynamic identities, ambiguous receivers, lookalikes, and registration gaps', async () => {
    const first = await scanFixture('negatives');
    const second = await scanFixture('negatives');
    try {
      const { analysis } = first.result;
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      const interactions = analysis.interactions.filter(
        (record): record is JobQueueInteractionRecord => record.kind === 'job_queue',
      );
      const handlers = analysis.interactionHandlers.filter(
        (record): record is JobQueueHandlerRecord => record.kind === 'job_queue',
      );
      expect(interactions).toHaveLength(3);
      expect(
        interactions.filter(({ target }) => target.queue.resolution === 'dynamic'),
      ).toHaveLength(1);
      expect(interactions.filter(({ target }) => target.job.resolution === 'dynamic')).toHaveLength(
        1,
      );
      expect(handlers).toHaveLength(3);
      expect(
        handlers.filter(({ registrationState }) => registrationState === 'registration_unknown'),
      ).toHaveLength(1);
      expect(analysis.classes.some(({ displayName }) => displayName === 'LookalikeProcessor')).toBe(
        false,
      );
      expect(analysis.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          'INTERACTION_RECEIVER_AMBIGUOUS',
          'INTERACTION_TARGET_DYNAMIC',
          'JOB_QUEUE_HANDLER_REGISTRATION_UNKNOWN',
        ]),
      );
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
      expect(serializeCanonicalAnalysis(analysis)).toBe(
        serializeCanonicalAnalysis(second.result.analysis),
      );
    } finally {
      await Promise.all([first.project.cleanup(), second.project.cleanup()]);
    }
  }, 40_000);
});
