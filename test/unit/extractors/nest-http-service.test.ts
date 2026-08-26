import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { buildAnalysisSemanticProjection } from '../../../src/comparison/projection.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { buildEndpointCatalogue } from '../../../src/reporting/endpoint-catalogue.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import {
  writeFakeAxios,
  writeFakeNestAxios,
  writeFakeNestCommon,
  writeFakeNestConfig,
  writeFakeNodeProcess,
  writeFakeRxjs,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

interface ExpectedNestHttpFixture {
  readonly supportedMethods: Readonly<Record<string, number>>;
  readonly activations: Readonly<Record<string, number>>;
  readonly mustNotEmit: readonly string[];
  readonly diagnostics: readonly string[];
}

describe('Nest HttpService and symbolic outbound HTTP extraction', () => {
  it('preserves cold activation semantics and bounded config/env target identities', async () => {
    const project = await createTestTypeScriptProject();
    const originalAuthUrl = process.env.AUTH_SERVICE_URL;
    const originalStreamUrl = process.env.STREAM_SERVICE_URL;
    try {
      process.env.AUTH_SERVICE_URL = 'https://runtime-secret-must-not-appear.example';
      process.env.STREAM_SERVICE_URL = 'https://another-runtime-secret.example';
      await Promise.all([
        writeFakeAxios(project),
        writeFakeNestAxios(project),
        writeFakeNestCommon(project),
        writeFakeNestConfig(project),
        writeFakeNodeProcess(project),
        writeFakeRxjs(project),
      ]);
      const [fixture, expectedText] = await Promise.all([
        readFile('test/fixtures/interactions/nest-http-service.ts.txt', 'utf8'),
        readFile('test/fixtures/interactions/nest-http-service.expected.json', 'utf8'),
      ]);
      const expected = JSON.parse(expectedText) as ExpectedNestHttpFixture;
      await project.write('src/nest-http-service.ts', fixture);
      await writeBasicTsconfig(project);

      const first = await scanRepository({ repositoryRoot: project.path });
      const second = await scanRepository({ repositoryRoot: project.path });
      const { analysis } = first;
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      const methods = new Map(analysis.methods.map((method) => [method.id, method.qualifiedName]));
      const outbound = analysis.interactions.filter(
        (interaction) => interaction.kind === 'outbound_http',
      );
      const facts = outbound.map((interaction) => ({
        method: methods.get(interaction.sourceMethodId) ?? interaction.sourceMethodId,
        httpMethod: interaction.target.method,
        resolution: interaction.target.url.resolution,
        value: interaction.target.url.value,
        queryKeys: interaction.target.queryKeys,
        activation: interaction.activation,
        ruleId: interaction.ruleId,
        evidenceRoles: interaction.evidenceIds.map(
          (id) => analysis.evidence.find((evidence) => evidence.id === id)?.role,
        ),
      }));
      const forMethod = (suffix: string) => facts.filter(({ method }) => method.endsWith(suffix));

      expect(analysis.interactionAnalysis).toMatchObject({
        supportedKinds: ['in_process_event', 'job_queue', 'outbound_http'],
        enabledKinds: ['in_process_event', 'job_queue', 'outbound_http'],
        state: 'incomplete',
      });
      for (const [method, count] of Object.entries(expected.supportedMethods)) {
        expect(forMethod(method), `${method}: ${JSON.stringify(forMethod(method))}`).toHaveLength(
          count,
        );
      }
      expect(outbound).toHaveLength(
        Object.values(expected.supportedMethods).reduce((total, count) => total + count, 0),
      );
      for (const [activation, count] of Object.entries(expected.activations)) {
        expect(
          facts.filter((fact) => fact.activation === activation),
          activation,
        ).toHaveLength(count);
      }

      expect(forMethod('HttpGateway.first')).toEqual([
        expect.objectContaining({
          httpMethod: 'GET',
          resolution: 'symbolic',
          value: '{config:PAYMENT_URL}/charges/{0}',
          queryKeys: ['token'],
          activation: 'proven_activated',
        }),
      ]);
      expect(forMethod('HttpGateway.last')).toEqual([
        expect.objectContaining({
          httpMethod: 'POST',
          resolution: 'symbolic',
          value: '{env:AUTH_SERVICE_URL}/events',
          queryKeys: ['apiKey'],
          activation: 'proven_activated',
        }),
      ]);
      expect(forMethod('HttpGateway.subscribed')).toEqual([
        expect.objectContaining({
          resolution: 'symbolic',
          value: '{config:ASSIGNED_SERVICE_URL}/old',
          activation: 'proven_activated',
        }),
      ]);
      expect(forMethod('HttpGateway.concatenated')).toEqual([
        expect.objectContaining({
          resolution: 'symbolic',
          value: '{config:PAYMENT_URL}/lookup',
          activation: 'proven_activated',
        }),
      ]);
      expect(forMethod('HttpGateway.axiosReference')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            httpMethod: 'PATCH',
            resolution: 'symbolic',
            value: '{config:PAYMENT_URL}/eager/{0}',
            queryKeys: ['credential'],
            activation: 'eager',
            ruleId: 'http.outbound.nest-axios-ref.eager.v1',
          }),
          expect.objectContaining({
            httpMethod: 'POST',
            resolution: 'symbolic',
            value: '{env:AUTH_SERVICE_URL}/request',
            activation: 'eager',
          }),
          expect.objectContaining({
            httpMethod: 'PUT',
            resolution: 'symbolic',
            value: '{config:PAYMENT_URL}/callable',
            queryKeys: ['key'],
            activation: 'eager',
          }),
        ]),
      );
      expect(forMethod('HttpController.stream')).toEqual([
        expect.objectContaining({
          resolution: 'symbolic',
          value: '{env:STREAM_SERVICE_URL}/items',
          queryKeys: ['token'],
          activation: 'proven_activated',
        }),
      ]);
      expect(forMethod('HttpGateway.cold')[0]?.activation).toBe('constructed_cold');
      expect(forMethod('HttpGateway.stored')[0]?.activation).toBe('unknown');
      expect(forMethod('HttpController.stored')[0]?.activation).toBe('unknown');
      expect(forMethod('HttpGateway.wrapped')[0]?.activation).toBe('unknown');
      expect(forMethod('HttpGateway.dynamic')[0]).toMatchObject({
        resolution: 'dynamic',
        value: null,
        activation: 'constructed_cold',
      });
      expect(forMethod('HttpGateway.mutable')[0]).toMatchObject({
        resolution: 'dynamic',
        value: null,
      });
      expect(
        facts.every(
          ({ evidenceRoles }) =>
            evidenceRoles.includes('call_site') && evidenceRoles.includes('resolution_basis'),
        ),
      ).toBe(true);

      const serialized = serializeCanonicalAnalysis(analysis);
      for (const forbidden of [
        'do-not-store',
        '#private',
        '#fragment',
        'header-secret',
        'body-secret',
        'axios-ref-body-secret',
        'axios-ref-header-secret',
        'request-header-secret',
        'runtime-secret-must-not-appear',
        'another-runtime-secret',
      ]) {
        expect(serialized, forbidden).not.toContain(forbidden);
      }
      for (const target of expected.mustNotEmit) {
        expect(
          facts.some(({ value }) => value === target),
          target,
        ).toBe(false);
      }
      const diagnosticCodes = new Set<string>(analysis.diagnostics.map(({ code }) => code));
      for (const code of expected.diagnostics) expect(diagnosticCodes.has(code), code).toBe(true);
      expect(
        analysis.diagnostics.filter(({ code }) =>
          ['TS_PARSE_ERROR', 'TS_IMPORT_UNRESOLVED'].includes(code),
        ),
      ).toEqual([]);
      expect(
        analysis.diagnostics.filter(
          ({ code, message }) =>
            code === 'DI_TOKEN_UNSUPPORTED' &&
            (message.includes('HttpGateway.http') || message.includes('HttpGateway.config')),
        ),
      ).toEqual([]);
      const axiosReferenceMethodId = analysis.methods.find(({ qualifiedName }) =>
        qualifiedName.endsWith('HttpGateway.axiosReference'),
      )?.id;
      expect(
        analysis.diagnostics.filter(
          ({ code, subjectId }) =>
            code === 'OUTBOUND_HTTP_RECEIVER_UNSUPPORTED' && subjectId === axiosReferenceMethodId,
        ),
      ).toEqual([]);

      const trace = buildEndpointTrace(analysis, { httpMethod: 'GET', path: '/http/gateway' });
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(
          trace.trace.steps.filter(({ relation }) => relation === 'METHOD_INITIATES_INTERACTION'),
        ).toHaveLength(1);
        expect(
          renderEndpointTraceMarkdown({
            analysis,
            trace: trace.trace,
            diagnostics: trace.diagnostics,
          }),
        ).toContain('proven_activated');
      }
      const catalogue = buildEndpointCatalogue(analysis);
      expect(
        catalogue.endpoints.find(({ path }) => path === '/http/stream')?.outboundHttpInteractions,
      ).toEqual([
        expect.objectContaining({ activation: 'proven_activated', resolution: 'symbolic' }),
      ]);
      const graph = buildGraphReportDocument({ analysis });
      const streamGraph = graph.endpoints.find(({ path }) => path === '/http/stream');
      expect(graph.schemaVersion).toBe('3.0.0');
      expect(streamGraph?.scene.nodes.find(({ kind }) => kind === 'interaction')?.label).toContain(
        '[proven activated; asynchronous]',
      );
      expect(
        streamGraph?.scene.nodes.find(({ kind }) => kind === 'external_target')?.label,
      ).toContain('[symbolic]');

      const projection = buildAnalysisSemanticProjection(analysis);
      expect(
        projection.collisions.filter(({ recordKind }) => recordKind === 'interaction'),
      ).toEqual([]);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
      expect(serializeCanonicalAnalysis(second.analysis)).toBe(serialized);

      const activatedFixture = fixture.replace(
        "this.http.get('https://cold.example/path').pipe(map((value) => value));",
        "this.http.get('https://cold.example/path').pipe(map((value) => value)).subscribe();",
      );
      expect(activatedFixture).not.toBe(fixture);
      await project.write('src/nest-http-service.ts', activatedFixture);
      const changed = await scanRepository({ repositoryRoot: project.path });
      if (changed.analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      const interactionForColdMethod = (
        document: typeof analysis,
      ): (typeof document.interactions)[number] => {
        const methodId = document.methods.find(({ qualifiedName }) =>
          qualifiedName.endsWith('HttpGateway.cold'),
        )?.id;
        const interaction = document.interactions.find(
          (record) =>
            record.kind === 'outbound_http' &&
            record.sourceMethodId === methodId &&
            record.target.url.value === 'https://cold.example/path',
        );
        if (interaction === undefined) throw new Error('Expected the cold fixture interaction.');
        return interaction;
      };
      const beforeCold = interactionForColdMethod(analysis);
      const afterCold = interactionForColdMethod(changed.analysis);
      expect(beforeCold.activation).toBe('constructed_cold');
      expect(afterCold.activation).toBe('proven_activated');
      expect(
        buildAnalysisSemanticProjection(changed.analysis).semanticKeyById.get(afterCold.id)
          ?.encoded,
      ).not.toBe(projection.semanticKeyById.get(beforeCold.id)?.encoded);
    } finally {
      if (originalAuthUrl === undefined) delete process.env.AUTH_SERVICE_URL;
      else process.env.AUTH_SERVICE_URL = originalAuthUrl;
      if (originalStreamUrl === undefined) delete process.env.STREAM_SERVICE_URL;
      else process.env.STREAM_SERVICE_URL = originalStreamUrl;
      await project.cleanup();
    }
  }, 30_000);

  it('fails closed when symbolic construction exceeds its expression-depth limit', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeAxios(project),
        writeFakeNestAxios(project),
        writeFakeNestCommon(project),
        writeFakeNodeProcess(project),
        writeFakeRxjs(project),
      ]);
      const constants = [
        'const TARGET_0 = process.env.LIMIT_BASE_URL!;',
        ...Array.from(
          { length: 11 },
          (_, index) => `const TARGET_${index + 1} = TARGET_${index} + '/${index + 1}';`,
        ),
      ];
      await project.write(
        'src/symbolic-limit.ts',
        [
          "import { Injectable } from '@nestjs/common';",
          "import { HttpService } from '@nestjs/axios';",
          "import { firstValueFrom } from 'rxjs';",
          ...constants,
          '@Injectable()',
          'export class LimitedGateway {',
          '  constructor(private readonly http: HttpService) {}',
          '  send(): Promise<unknown> {',
          '    return firstValueFrom(this.http.get(TARGET_11));',
          '  }',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      expect(analysis.interactions).toHaveLength(1);
      expect(analysis.interactions[0]).toMatchObject({
        kind: 'outbound_http',
        activation: 'proven_activated',
        target: { url: { resolution: 'dynamic', value: null } },
      });
      expect(analysis.diagnostics.map(({ code }) => code)).toContain(
        'OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED',
      );
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
