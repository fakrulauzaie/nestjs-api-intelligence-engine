import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { buildAnalysisSemanticProjection } from '../../../src/comparison/projection.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { buildImpactGraph, pathsFromEndpoints } from '../../../src/impact/graph.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../../../src/tracing/interaction-handler-trace.js';
import {
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestEventEmitter,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

interface ExpectedEventFixture {
  readonly applications: number;
  readonly interactions: number;
  readonly handlers: number;
  readonly handlerRegistrationStates: Readonly<Record<string, number>>;
  readonly interactionMethods: Readonly<Record<string, number>>;
  readonly mustNotEmit: readonly string[];
  readonly diagnostics: readonly string[];
}

describe('Nest EventEmitter2 exact-event extraction', () => {
  it('inventories roots, exact producers, handlers, registration, and deterministic fan-out', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeNestCore(project),
        writeFakeNestEventEmitter(project),
        writeFakeNestTypeOrm(project),
        writeFakeTypeOrm(project),
      ]);
      const [fixture, expectedText] = await Promise.all([
        readFile('test/fixtures/interactions/nest-event-emitter.ts.txt', 'utf8'),
        readFile('test/fixtures/interactions/nest-event-emitter.expected.json', 'utf8'),
      ]);
      const expected = JSON.parse(expectedText) as ExpectedEventFixture;
      await project.write('src/nest-event-emitter.ts', fixture);
      await writeBasicTsconfig(project);

      const first = await scanRepository({ repositoryRoot: project.path });
      const second = await scanRepository({ repositoryRoot: project.path });
      const { analysis } = first;
      if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
      const methods = new Map(analysis.methods.map((method) => [method.id, method.qualifiedName]));
      const events = analysis.interactions.filter(
        (interaction) => interaction.kind === 'in_process_event',
      );
      const handlers = analysis.interactionHandlers.filter(
        (handler) => handler.kind === 'in_process_event',
      );
      const facts = events.map((interaction) => ({
        method: methods.get(interaction.sourceMethodId) ?? interaction.sourceMethodId,
        identityKind: interaction.target.identityKind,
        value: interaction.target.value,
        timing: interaction.dispatchTiming,
        applicationId: interaction.applicationId,
      }));

      expect(analysis.interactionAnalysis).toMatchObject({
        supportedKinds: ['in_process_event', 'job_queue', 'microservice_message', 'outbound_http'],
        enabledKinds: ['in_process_event', 'job_queue', 'microservice_message', 'outbound_http'],
        state: 'incomplete',
      });
      expect(analysis.applications).toHaveLength(expected.applications);
      expect(events).toHaveLength(expected.interactions);
      expect(handlers).toHaveLength(expected.handlers);
      for (const [suffix, count] of Object.entries(expected.interactionMethods)) {
        expect(
          facts.filter(({ method }) => method.endsWith(suffix)),
          suffix,
        ).toHaveLength(count);
      }
      for (const [state, count] of Object.entries(expected.handlerRegistrationStates)) {
        expect(
          handlers.filter(({ registrationState }) => registrationState === state),
          state,
        ).toHaveLength(count);
      }

      expect(
        facts.find(({ method }) => method.endsWith('EventsController.asyncEvent')),
      ).toMatchObject({
        identityKind: 'string',
        value: 'order.audited',
        timing: 'asynchronous',
      });
      expect(facts.find(({ method }) => method.endsWith('EventsController.symbol'))).toMatchObject({
        identityKind: 'symbol',
        value: 'src/nest-event-emitter.ts#ORDER_SYMBOL',
        timing: 'unknown',
      });
      expect(facts.find(({ method }) => method.endsWith('EventsController.dynamic'))).toMatchObject(
        {
          identityKind: 'dynamic',
          value: null,
        },
      );
      expect(
        facts.find(({ method }) => method.endsWith('EventsController.create'))?.applicationId,
      ).not.toBeNull();

      const created = events.find(({ target }) => target.value === 'order.created');
      expect(created).toBeDefined();
      const matches = analysis.assertions.filter(
        ({ predicate, subjectId }) =>
          predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER' && subjectId === created?.id,
      );
      expect(matches).toHaveLength(4);
      expect(
        matches.map(
          ({ objectId }) => handlers.find(({ id }) => id === objectId)?.registrationState,
        ),
      ).toEqual(
        expect.arrayContaining([
          'proven_registered',
          'proven_registered',
          'declared_candidate',
          'declared_candidate',
        ]),
      );
      expect(
        analysis.assertions.filter(({ predicate }) => predicate === 'HANDLER_IMPLEMENTED_BY'),
      ).toHaveLength(expected.handlers);
      const wildcardHandler = handlers.find(
        ({ target }) => target.identityKind === 'string' && target.value === 'order.*',
      );
      expect(wildcardHandler).toBeDefined();
      expect(wildcardHandler?.target.pattern).toBeUndefined();
      expect(
        analysis.assertions.filter(
          ({ predicate, objectId }) =>
            predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER' && objectId === wildcardHandler?.id,
        ),
      ).toEqual([]);
      expect(
        analysis.assertions.filter(({ predicate }) => predicate === 'APPLICATION_USES_ROOT_MODULE'),
      ).toHaveLength(expected.applications);

      for (const forbidden of expected.mustNotEmit) {
        expect(
          facts.some(({ value }) => value === forbidden),
          forbidden,
        ).toBe(false);
      }
      const serialized = serializeCanonicalAnalysis(analysis);
      expect(serialized).not.toContain('payload-secret-must-not-appear');
      expect(serialized).not.toContain('async-secret');
      const diagnosticCodes = new Set<string>(analysis.diagnostics.map(({ code }) => code));
      for (const code of expected.diagnostics) expect(diagnosticCodes.has(code), code).toBe(true);
      expect(
        analysis.diagnostics.filter(({ code }) =>
          new Set<string>(['TS_PARSE_ERROR', 'TS_IMPORT_UNRESOLVED']).has(code),
        ),
      ).toEqual([]);
      expect(
        analysis.diagnostics.filter(
          ({ code, message }) =>
            code === 'DI_TOKEN_UNSUPPORTED' && message.includes('EventEmitter2'),
        ),
      ).toEqual([]);

      const projection = buildAnalysisSemanticProjection(analysis);
      expect(
        projection.collisions.filter(({ recordKind }) =>
          ['application', 'interaction', 'interaction_handler'].includes(recordKind),
        ),
      ).toEqual([]);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
      expect(serializeCanonicalAnalysis(second.analysis)).toBe(serialized);

      const createdTrace = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/events/create',
      });
      expect(createdTrace.status).toBe('resolved');
      if (createdTrace.status === 'resolved') {
        expect(
          createdTrace.trace.steps.filter(
            ({ relation }) => relation === 'INTERACTION_MATCHES_LOCAL_HANDLER',
          ),
        ).toHaveLength(4);
        expect(
          createdTrace.trace.steps.filter(({ relation }) => relation === 'HANDLER_IMPLEMENTED_BY'),
        ).toHaveLength(4);
        expect(
          createdTrace.trace.terminals,
          JSON.stringify(
            createdTrace.trace.terminals.map((terminal) => ({
              ...terminal,
              method: methods.get(terminal.methodId),
            })),
            null,
            2,
          ),
        ).toHaveLength(3);
        expect(
          createdTrace.trace.terminals.every(({ tableName }) => tableName === 'order_audit'),
        ).toBe(true);
        expect(createdTrace.trace.terminals.map(({ causalClass }) => causalClass)).toEqual([
          'local_interaction_synchronous',
          'local_interaction_synchronous',
          'synchronous',
        ]);
        const markdown = renderEndpointTraceMarkdown({
          analysis,
          trace: createdTrace.trace,
          diagnostics: createdTrace.diagnostics,
        });
        expect(markdown).toContain('## In-process event interactions');
        expect(markdown).toContain('local_interaction_synchronous');
      }
      const asyncTrace = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/events/async',
      });
      expect(asyncTrace.status).toBe('resolved');
      if (asyncTrace.status === 'resolved') {
        expect(asyncTrace.trace.terminals).toEqual([
          expect.objectContaining({ causalClass: 'local_interaction_asynchronous' }),
        ]);
      }
      const symbolTrace = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/events/symbol',
      });
      expect(symbolTrace.status).toBe('resolved');
      if (symbolTrace.status === 'resolved') {
        expect(symbolTrace.trace.terminals).toEqual([
          expect.objectContaining({ causalClass: 'local_interaction_asynchronous' }),
        ]);
      }
      const cycleTrace = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/events/cycle',
      });
      expect(cycleTrace.status).toBe('resolved');
      if (cycleTrace.status === 'resolved') {
        expect(cycleTrace.diagnostics.map(({ code }) => code)).toContain(
          'INTERACTION_CYCLE_TRUNCATED',
        );
        expect(cycleTrace.trace.steps.length).toBeLessThan(20);
      }

      const createdHandler = handlers.find(({ methodId }) =>
        methods.get(methodId)?.endsWith('OrderHandlers.handleCreated'),
      );
      expect(createdHandler).toBeDefined();
      const handlerTrace = buildInteractionHandlerTrace(analysis, createdHandler!.id);
      expect(handlerTrace.status).toBe('resolved');
      if (handlerTrace.status === 'resolved') {
        expect(handlerTrace.trace.terminals).toEqual([
          expect.objectContaining({
            direction: 'WRITE',
            tableName: 'order_audit',
            causalClass: 'local_interaction_synchronous',
          }),
        ]);
      }

      const withInteractionLimits = (
        overrides: Partial<NonNullable<typeof analysis.analysisRun.configuration.interactions>>,
      ): typeof analysis => ({
        ...analysis,
        analysisRun: {
          ...analysis.analysisRun,
          configuration: {
            ...analysis.analysisRun.configuration,
            interactions: {
              ...analysis.analysisRun.configuration.interactions!,
              ...overrides,
            },
          },
        },
      });
      const fanOutTrace = buildEndpointTrace(
        withInteractionLimits({ maxFanOutPerInteraction: 2 }),
        { httpMethod: 'POST', path: '/events/state-limit' },
      );
      expect(fanOutTrace.status).toBe('resolved');
      if (fanOutTrace.status === 'resolved') {
        expect(fanOutTrace.diagnostics.map(({ code }) => code)).toContain(
          'INTERACTION_TRACE_LIMIT_REACHED',
        );
        expect(
          fanOutTrace.trace.steps.filter(
            ({ relation }) => relation === 'INTERACTION_MATCHES_LOCAL_HANDLER',
          ),
        ).toHaveLength(2);
      }
      const stateLimitedTrace = buildEndpointTrace(
        withInteractionLimits({ maxInteractionTraceStates: 10 }),
        { httpMethod: 'POST', path: '/events/state-limit' },
      );
      expect(stateLimitedTrace.status).toBe('resolved');
      if (stateLimitedTrace.status === 'resolved') {
        expect(stateLimitedTrace.diagnostics.map(({ code }) => code)).toContain(
          'INTERACTION_TRACE_LIMIT_REACHED',
        );
      }
      const methodDepthLimitedTrace = buildEndpointTrace(
        {
          ...analysis,
          analysisRun: {
            ...analysis.analysisRun,
            configuration: { ...analysis.analysisRun.configuration, maxCallDepth: 1 },
          },
        },
        { httpMethod: 'POST', path: '/events/create' },
      );
      expect(methodDepthLimitedTrace.status).toBe('resolved');
      if (methodDepthLimitedTrace.status === 'resolved') {
        expect(methodDepthLimitedTrace.trace.terminals).toHaveLength(2);
        expect(
          methodDepthLimitedTrace.trace.terminals.map(({ causalClass }) => causalClass),
        ).toEqual(['local_interaction_synchronous', 'synchronous']);
      }
      const hopLimitedTrace = buildEndpointTrace(withInteractionLimits({ maxInteractionHops: 0 }), {
        httpMethod: 'POST',
        path: '/events/async',
      });
      expect(hopLimitedTrace.status).toBe('resolved');
      if (hopLimitedTrace.status === 'resolved') {
        expect(hopLimitedTrace.trace.terminals).toEqual([]);
        expect(hopLimitedTrace.diagnostics.map(({ code }) => code)).toContain(
          'INTERACTION_TRACE_LIMIT_REACHED',
        );
      }

      const graph = buildGraphReportDocument({ analysis });
      const createdScene = graph.endpoints.find(({ path }) => path === '/events/create')?.scene;
      expect(graph.schemaVersion).toBe('9.0.0');
      expect(createdScene?.nodes.some(({ label }) => label.includes('event order.created'))).toBe(
        true,
      );
      expect(
        createdScene?.nodes.some(({ label }) => label.includes('@OnEvent order.created')),
      ).toBe(true);
      expect(createdScene?.nodes.some(({ kind }) => kind === 'interaction_handler')).toBe(true);
      expect(createdScene?.nodes.some(({ kind }) => kind === 'boundary')).toBe(true);
      expect(createdScene?.edges.some(({ label }) => label === 'dispatches')).toBe(true);
      expect(createdScene?.edges.some(({ label }) => label === 'delivered')).toBe(false);
      expect(
        createdScene?.edges.filter(
          ({ relation }) => relation === 'INTERACTION_MATCHES_LOCAL_HANDLER',
        ),
      ).toHaveLength(4);

      const impactGraph = buildImpactGraph('after', analysis, projection);
      const handlerPaths = pathsFromEndpoints(impactGraph, createdHandler!.methodId);
      expect(
        handlerPaths.some(({ steps }) =>
          [
            'ENDPOINT_IMPLEMENTED_BY',
            'METHOD_INITIATES_INTERACTION',
            'INTERACTION_MATCHES_LOCAL_HANDLER',
            'HANDLER_IMPLEMENTED_BY',
          ].every((predicate) => steps.some((step) => step.predicate === predicate)),
        ),
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('keeps consumer-only handlers and reports registration as unknown', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([writeFakeNestCommon(project), writeFakeNestEventEmitter(project)]);
      await project.write(
        'src/consumer-only.ts',
        [
          "import { Injectable } from '@nestjs/common';",
          "import { OnEvent } from '@nestjs/event-emitter';",
          '@Injectable()',
          'export class ConsumerOnly {',
          "  @OnEvent('inbound.only')",
          '  handle(): void {}',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
      expect(analysis.applications).toEqual([]);
      expect(analysis.interactions).toEqual([]);
      expect(analysis.interactionHandlers).toEqual([
        expect.objectContaining({
          kind: 'in_process_event',
          registrationState: 'registration_unknown',
          target: { targetKind: 'event', identityKind: 'string', value: 'inbound.only' },
        }),
      ]);
      expect(analysis.diagnostics.map(({ code }) => code)).toContain(
        'EVENT_HANDLER_REGISTRATION_UNKNOWN',
      );
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
