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
  MicroserviceMessageHandlerRecord,
  MicroserviceMessageInteractionRecord,
} from '../../../src/model/interactions.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildControlEvidenceDocument } from '../../../src/structured-exports/control-evidence.js';
import { enrichOpenApiDocument } from '../../../src/structured-exports/openapi.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../../../src/tracing/interaction-handler-trace.js';
import {
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestMicroservices,
  writeFakeNestTypeOrm,
  writeFakeRxjs,
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
    writeFakeNestCore(project),
    writeFakeNestMicroservices(project),
    writeFakeNestTypeOrm(project),
    writeFakeRxjs(project),
    writeFakeTypeOrm(project),
  ]);
  const fixture = await readFile(
    `test/fixtures/distributed/nest-microservices/${name}.ts.txt`,
    'utf8',
  );
  await project.write(`src/${name}.ts`, fixture);
  await writeBasicTsconfig(project);
  const result = await scanRepository({ repositoryRoot: project.path });
  return { project, result };
}

function microserviceRecords(analysis: Awaited<ReturnType<typeof scanRepository>>['analysis']) {
  if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
  return {
    interactions: analysis.interactions.filter(
      (record): record is MicroserviceMessageInteractionRecord =>
        record.kind === 'microservice_message',
    ),
    handlers: analysis.interactionHandlers.filter(
      (record): record is MicroserviceMessageHandlerRecord =>
        record.kind === 'microservice_message',
    ),
  };
}

describe('Nest microservices extraction', () => {
  it('links co-located emit/send calls only as transport-compatible delivery candidates', async () => {
    const { project, result } = await scanFixture('colocated');
    try {
      const { analysis } = result;
      const { interactions, handlers } = microserviceRecords(analysis);
      expect(interactions).toHaveLength(2);
      expect(handlers).toHaveLength(2);
      expect(analysis.schemaVersion).toBe('8.0.0');
      if (analysis.schemaVersion !== '8.0.0') return;
      expect(analysis.applications).toEqual([
        expect.objectContaining({ kind: 'microservice', transport: 'rmq' }),
      ]);
      expect(interactions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activation: 'eager',
            boundary: 'broker_or_worker_boundary',
            dispatchTiming: 'asynchronous',
            target: expect.objectContaining({
              mode: 'event',
              patternKind: 'scalar',
              canonicalPattern: '"user.created"',
              transport: 'rmq',
            }),
          }),
          expect.objectContaining({
            activation: 'proven_activated',
            boundary: 'broker_or_worker_boundary',
            target: expect.objectContaining({
              mode: 'request_response',
              patternKind: 'object',
              canonicalPattern: '{"cmd":"get_user"}',
              transport: 'rmq',
            }),
          }),
        ]),
      );
      expect(
        analysis.assertions.filter(
          ({ predicate }) => predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER',
        ),
      ).toHaveLength(2);

      const event = interactions.find(({ target }) => target.mode === 'event')!;
      const eventHandler = handlers.find(({ target }) => target.mode === 'event')!;
      const publisher = analysis.methods.find(
        ({ qualifiedName }) => qualifiedName === 'UsersPublisher.publishCreated',
      )!;
      const endpoint = analysis.endpoints[0];
      expect(publisher).toBeDefined();
      expect(endpoint).toBeUndefined();
      const handlerTrace = buildInteractionHandlerTrace(analysis, eventHandler.id);
      expect(handlerTrace.status).toBe('resolved');
      if (handlerTrace.status === 'resolved') {
        expect(handlerTrace.trace.terminals).toEqual([
          expect.objectContaining({
            direction: 'WRITE',
            tableName: 'user_event',
            causalClass: 'distributed_conditional',
          }),
        ]);
      }
      const graph = buildGraphReportDocument({ analysis });
      expect(graph.endpoints).toEqual([]);
      expect(graph.schemaVersion).toBe('9.0.0');
      expect(graph.interactionHandlers).toHaveLength(2);
      expect(graph.interactionHandlers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'microservice_message',
            boundary: 'broker_or_worker_boundary',
            causalClass: 'distributed_conditional',
            dbWrites: ['user_event'],
          }),
        ]),
      );
      expect(event.boundary).toBe('broker_or_worker_boundary');
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('keeps producer-only and consumer-only repositories as normal open-world topologies', async () => {
    const producer = await scanFixture('producer-only');
    const consumer = await scanFixture('consumer-only');
    try {
      const producerRecords = microserviceRecords(producer.result.analysis);
      expect(producerRecords.interactions).toEqual([
        expect.objectContaining({
          activation: 'eager',
          boundary: 'external_or_unobserved',
          target: expect.objectContaining({ transport: 'kafka' }),
        }),
      ]);
      expect(producerRecords.handlers).toEqual([]);
      expect(producer.result.analysis.diagnostics.map(({ code }) => code)).not.toContain(
        'MICROSERVICE_HANDLER_REGISTRATION_UNKNOWN',
      );

      const consumerRecords = microserviceRecords(consumer.result.analysis);
      expect(consumerRecords.interactions).toEqual([]);
      expect(consumerRecords.handlers).toEqual([
        expect.objectContaining({ registrationState: 'proven_registered' }),
      ]);
      const trace = buildInteractionHandlerTrace(
        consumer.result.analysis,
        consumerRecords.handlers[0]!.id,
      );
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(trace.trace.terminals).toEqual([
          expect.objectContaining({
            direction: 'WRITE',
            tableName: 'stripe_payment',
            causalClass: 'distributed_conditional',
          }),
        ]);
      }
    } finally {
      await Promise.all([producer.project.cleanup(), consumer.project.cleanup()]);
    }
  }, 30_000);

  it('classifies cold send activation without claiming delivery', async () => {
    const { project, result } = await scanFixture('activation');
    try {
      const { interactions } = microserviceRecords(result.analysis);
      expect(interactions).toHaveLength(5);
      const activationByMethod = new Map(
        interactions.map((interaction) => [
          result.analysis.methods.find(({ id }) => id === interaction.sourceMethodId)
            ?.qualifiedName,
          interaction.activation,
        ]),
      );
      expect(activationByMethod).toEqual(
        new Map([
          ['ActivationController.lookup', 'proven_activated'],
          ['ActivationPublisher.constructOnly', 'constructed_cold'],
          ['ActivationPublisher.firstValue', 'proven_activated'],
          ['ActivationPublisher.subscribe', 'proven_activated'],
          ['ActivationPublisher.wrapped', 'unknown'],
        ]),
      );
      expect(result.analysis.diagnostics.map(({ code }) => code)).toContain(
        'MICROSERVICE_ACTIVATION_UNKNOWN',
      );
      expect(
        result.analysis.assertions.some(({ predicate }) => predicate.includes('DELIVER')),
      ).toBe(false);
      const trace = buildEndpointTrace(result.analysis, {
        httpMethod: 'POST',
        path: '/inventory/lookup',
      });
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(trace.trace.causalSummary?.distributedInteractionIds).toHaveLength(1);
        expect(
          renderEndpointTraceMarkdown({
            analysis: result.analysis,
            trace: trace.trace,
            diagnostics: trace.diagnostics,
          }),
        ).toContain('## Nest microservice interactions');
      }
      const graph = buildGraphReportDocument({ analysis: result.analysis });
      const scene = graph.endpoints.find(({ path }) => path === '/inventory/lookup')?.scene;
      expect(scene?.nodes.some(({ label }) => label.includes('request-response'))).toBe(true);
      expect(scene?.nodes.some(({ label }) => label === 'broker or worker boundary')).toBe(false);
      expect(scene?.edges.some(({ label }) => label === 'delivered')).toBe(false);

      const manualOutput = process.env.API_INTEL_PHASE36_MANUAL_OUTPUT;
      if (manualOutput !== undefined && manualOutput.length > 0) {
        const outputDirectory = resolve(manualOutput);
        await mkdir(outputDirectory, { recursive: true });
        await Promise.all([
          writeFile(
            resolve(outputDirectory, 'analysis.json'),
            serializeCanonicalAnalysis(result.analysis),
            'utf8',
          ),
          renderOfflineGraphReport(graph).then((html) =>
            writeFile(resolve(outputDirectory, 'api-intel-graph.html'), html, 'utf8'),
          ),
        ]);
      }

      const controls = buildControlEvidenceDocument({ analysis: result.analysis });
      expect(controls.schemaVersion).toBe('5.0.0');
      expect(controls.rows[0]?.distributedInteractions).toEqual([
        expect.objectContaining({ kind: 'microservice_message' }),
      ]);
      const enriched = enrichOpenApiDocument({
        analysis: result.analysis,
        openApi: {
          openapi: '3.1.0',
          info: { title: 'Activation fixture', version: '1.0.0' },
          paths: { '/inventory/lookup': { post: {} } },
        },
      });
      expect(enriched.result.schemaVersion).toBe('5.0.0');
      expect(
        (
          enriched.enrichedDocument.paths as Record<
            string,
            { post: { 'x-api-intel': Record<string, unknown> } }
          >
        )['/inventory/lookup']?.post['x-api-intel'],
      ).toMatchObject({
        distributedInteractions: [expect.objectContaining({ kind: 'microservice_message' })],
      });
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('canonicalizes JSON patterns, fans out events, and leaves duplicate requests ambiguous', async () => {
    const { project, result } = await scanFixture('patterns');
    try {
      const { analysis } = result;
      const { interactions } = microserviceRecords(analysis);
      const objectPattern = interactions.find(
        ({ target }) => target.canonicalPattern === '{"cmd":"get_user","scope":"admin"}',
      );
      expect(objectPattern?.boundary).toBe('broker_or_worker_boundary');
      const event = interactions.find(
        ({ target }) => target.canonicalPattern === '"account.updated"',
      )!;
      const request = interactions.find(
        ({ target }) => target.canonicalPattern === '"duplicate.request"',
      )!;
      const matches = analysis.assertions.filter(
        ({ predicate }) => predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER',
      );
      expect(matches.filter(({ subjectId }) => subjectId === event.id)).toEqual([
        expect.objectContaining({ status: 'resolved' }),
        expect.objectContaining({ status: 'resolved' }),
      ]);
      expect(matches.filter(({ subjectId }) => subjectId === request.id)).toEqual([
        expect.objectContaining({ status: 'ambiguous' }),
        expect.objectContaining({ status: 'ambiguous' }),
      ]);
      expect(analysis.diagnostics.map(({ code }) => code)).toContain(
        'MICROSERVICE_REQUEST_HANDLER_AMBIGUOUS',
      );
      const projection = await import('../../../src/comparison/projection.js').then(
        ({ buildAnalysisSemanticProjection }) => buildAnalysisSemanticProjection(analysis),
      );
      const impact = buildImpactGraph('after', analysis, projection);
      for (const match of matches.filter(({ subjectId }) => subjectId === request.id)) {
        expect(pathsFromEndpoints(impact, match.objectId!)).toEqual([]);
      }
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('inventories supported transports and refuses incompatible or ambiguous bindings', async () => {
    const { project, result } = await scanFixture('transports');
    try {
      const { analysis } = result;
      const { interactions, handlers } = microserviceRecords(analysis);
      if (analysis.schemaVersion !== '8.0.0') return;
      expect(analysis.applications.map(({ transport }) => transport).sort()).toEqual([
        'kafka',
        'redis',
        'rmq',
        'rmq',
        'tcp',
      ]);
      const mismatch = interactions.find(
        ({ target }) => target.canonicalPattern === '"transport.mismatch"',
      )!;
      expect(mismatch).toMatchObject({
        boundary: 'external_or_unobserved',
        target: { transport: 'kafka' },
      });
      expect(
        analysis.assertions.filter(
          ({ predicate, subjectId }) =>
            predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER' && subjectId === mismatch.id,
        ),
      ).toEqual([]);
      expect(analysis.diagnostics.map(({ code }) => code)).toContain(
        'MICROSERVICE_TRANSPORT_MISMATCH',
      );
      const ambiguous = interactions.find(
        ({ target }) => target.canonicalPattern === '"shared.event"',
      )!;
      expect(ambiguous).toMatchObject({
        applicationId: null,
        boundary: 'unknown',
        target: { transport: null },
      });
      expect(
        handlers.some(({ target }) => target.canonicalPattern === '"transport.mismatch"'),
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('fails closed for dynamic patterns, provider handlers, and package lookalikes', async () => {
    const first = await scanFixture('negatives');
    const second = await scanFixture('negatives');
    try {
      const { analysis } = first.result;
      const { interactions, handlers } = microserviceRecords(analysis);
      expect(interactions).toHaveLength(2);
      expect(interactions.every(({ target }) => target.patternKind === 'dynamic')).toBe(true);
      expect(handlers).toEqual([
        expect.objectContaining({
          registrationState: 'registration_unknown',
          target: expect.objectContaining({ canonicalPattern: '"invalid.provider"' }),
        }),
      ]);
      const interactionMethodNames = new Set(
        interactions.map(
          ({ sourceMethodId }) =>
            analysis.methods.find(({ id }) => id === sourceMethodId)?.qualifiedName,
        ),
      );
      expect(interactionMethodNames.has('LookalikePublisher.publish')).toBe(false);
      const handlerMethodNames = new Set(
        handlers.map(
          ({ methodId }) => analysis.methods.find(({ id }) => id === methodId)?.qualifiedName,
        ),
      );
      expect(handlerMethodNames.has('LookalikeHandler.handle')).toBe(false);
      expect(analysis.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          'INTERACTION_TARGET_DYNAMIC',
          'MICROSERVICE_HANDLER_REGISTRATION_UNKNOWN',
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

  it('carries message target changes through comparison and potential impact', async () => {
    const { project, result: before } = await scanFixture('activation');
    try {
      const fixture = await readFile(
        'test/fixtures/distributed/nest-microservices/activation.ts.txt',
        'utf8',
      );
      await project.write(
        'src/activation.ts',
        fixture.replaceAll("'inventory.lookup'", "'inventory.lookup-v2'"),
      );
      const after = await scanRepository({ repositoryRoot: project.path });
      const comparison = compareAnalysisDocuments(before.analysis, after.analysis);
      expect(comparison.interactionChanges).toHaveLength(10);
      expect(
        comparison.interactionChanges?.every(({ change }) => ['added', 'removed'].includes(change)),
      ).toBe(true);
      const impact = analyzePotentialImpact(before.analysis, after.analysis);
      expect(
        impact.impactedEndpoints
          .flatMap(({ reasons }) => reasons)
          .some(({ reasonCode }) => reasonCode === 'interaction_added'),
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  }, 40_000);

  it('discovers a bounded hybrid bootstrap without inventing extra transports', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeNestCore(project),
        writeFakeNestMicroservices(project),
        writeFakeRxjs(project),
      ]);
      await project.write(
        'src/hybrid.ts',
        [
          "import { Module } from '@nestjs/common';",
          "import { NestFactory } from '@nestjs/core';",
          "import { Transport } from '@nestjs/microservices';",
          '@Module({}) class HybridModule {}',
          'async function bootstrap(): Promise<void> {',
          '  const app = await NestFactory.create(HybridModule);',
          '  app.connectMicroservice({ transport: Transport.KAFKA });',
          '}',
          'void bootstrap;',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);
      const result = await scanRepository({ repositoryRoot: project.path });
      if (result.analysis.schemaVersion !== '8.0.0') return;
      expect(result.analysis.applications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'hybrid',
            rootResolution: 'resolved',
            transport: 'kafka',
            transportState: 'resolved',
          }),
          expect.objectContaining({ kind: 'http' }),
        ]),
      );
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
