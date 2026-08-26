import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildAnalysisSemanticProjection } from '../../../src/comparison/projection.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import {
  buildEndpointCatalogue,
  renderEndpointCatalogueMarkdown,
} from '../../../src/reporting/endpoint-catalogue.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import {
  writeFakeAxios,
  writeFakeNestCommon,
  writeFakeUndici,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

interface ExpectedOutboundHttpFixture {
  readonly supportedMethods: Readonly<Record<string, number>>;
  readonly mustNotEmit: readonly string[];
  readonly diagnostics: readonly string[];
}

describe('eager outbound HTTP extraction', () => {
  it('extracts package-proven Axios/fetch calls and preserves dynamic and redaction boundaries', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeAxios(project),
        writeFakeUndici(project),
      ]);
      const [fixture, expectedText] = await Promise.all([
        readFile('test/fixtures/interactions/outbound-http.ts.txt', 'utf8'),
        readFile('test/fixtures/interactions/outbound-http.expected.json', 'utf8'),
      ]);
      const expected = JSON.parse(expectedText) as ExpectedOutboundHttpFixture;
      await project.write('src/outbound-http.ts', fixture);
      await writeBasicTsconfig(project);

      const first = await scanRepository({ repositoryRoot: project.path });
      const second = await scanRepository({ repositoryRoot: project.path });
      const depthLimited = await scanRepository({
        repositoryRoot: project.path,
        configuration: { maxCallDepth: 1 },
      });
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
        boundary: interaction.boundary,
        dispatchTiming: interaction.dispatchTiming,
        evidenceRoles: interaction.evidenceIds.map(
          (id) => analysis.evidence.find((evidence) => evidence.id === id)?.role,
        ),
      }));
      const forMethod = (method: string) =>
        facts.filter(({ method: qualifiedName }) => qualifiedName.endsWith(method));

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
      expect(
        forMethod('GatewayService.direct').map(({ httpMethod, resolution, value, queryKeys }) => ({
          httpMethod,
          resolution,
          value,
          queryKeys,
        })),
      ).toEqual(
        expect.arrayContaining([
          {
            httpMethod: 'GET',
            resolution: 'exact',
            value: 'https://status.example/health',
            queryKeys: ['mode', 'token'],
          },
          {
            httpMethod: 'POST',
            resolution: 'template',
            value: 'https://users.example/users/{0}',
            queryKeys: ['authorization', 'view'],
          },
          {
            httpMethod: 'PATCH',
            resolution: 'exact',
            value: 'https://config.example/request',
            queryKeys: ['apiKey'],
          },
          {
            httpMethod: 'DELETE',
            resolution: 'exact',
            value: 'https://override.example/api/relative',
            queryKeys: ['expand', 'locale', 'page'],
          },
          {
            httpMethod: 'GET',
            resolution: 'exact',
            value: 'https://global.example/items',
            queryKeys: ['cursor'],
          },
          {
            httpMethod: 'PUT',
            resolution: 'template',
            value: 'https://undici.example/items/{0}',
            queryKeys: [],
          },
        ]),
      );
      expect(forMethod('GatewayService.instance')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            httpMethod: 'PUT',
            resolution: 'exact',
            value: 'https://api.example/v1/orders/42',
            queryKeys: ['expand'],
          }),
          expect.objectContaining({
            httpMethod: 'HEAD',
            resolution: 'template',
            value: 'https://tenant.example/{0}/ready',
          }),
        ]),
      );
      expect(forMethod('GatewayService.dynamic').every(({ value }) => value === null)).toBe(true);
      expect(facts.every(({ activation }) => activation === 'eager')).toBe(true);
      expect(facts.every(({ boundary }) => boundary === 'external_or_unobserved')).toBe(true);
      expect(facts.every(({ dispatchTiming }) => dispatchTiming === 'asynchronous')).toBe(true);
      expect(
        facts.every(
          ({ evidenceRoles }) =>
            evidenceRoles.includes('call_site') && evidenceRoles.includes('resolution_basis'),
        ),
      ).toBe(true);

      const serialized = serializeCanonicalAnalysis(analysis);
      for (const forbidden of [
        'do-not-store',
        'password@',
        '#private',
        '#fragment',
        'body-must-not-appear',
        'header-must-not-appear',
        'header-body-must-not-appear',
        'global-secret',
        'body-secret',
      ]) {
        expect(serialized, forbidden).not.toContain(forbidden);
      }
      for (const forbiddenTarget of expected.mustNotEmit) {
        expect(
          facts.some(({ value }) => value === forbiddenTarget),
          forbiddenTarget,
        ).toBe(false);
      }
      const diagnosticCodes = new Set<string>(analysis.diagnostics.map(({ code }) => code));
      for (const code of expected.diagnostics) expect(diagnosticCodes.has(code), code).toBe(true);

      const trace = buildEndpointTrace(analysis, { httpMethod: 'GET', path: '/gateway/direct' });
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(
          trace.trace.steps.filter(({ relation }) => relation === 'METHOD_INITIATES_INTERACTION'),
        ).toHaveLength(6);
        expect(
          renderEndpointTraceMarkdown({
            analysis,
            trace: trace.trace,
            diagnostics: trace.diagnostics,
          }),
        ).toContain('## Outbound HTTP interactions');
      }

      const catalogue = buildEndpointCatalogue(analysis);
      const directEndpoint = catalogue.endpoints.find(({ path }) => path === '/gateway/direct');
      expect(directEndpoint?.outboundHttpInteractions).toHaveLength(6);
      expect(renderEndpointCatalogueMarkdown(catalogue)).toContain('## Outbound HTTP interactions');
      const graph = buildGraphReportDocument({ analysis });
      expect(graph.schemaVersion).toBe('3.0.0');
      const directGraph = graph.endpoints.find(({ path }) => path === '/gateway/direct');
      expect(directGraph?.scene.nodes.filter(({ kind }) => kind === 'interaction')).toHaveLength(6);
      expect(
        directGraph?.scene.nodes.filter(({ kind }) => kind === 'external_target'),
      ).toHaveLength(6);
      expect(directGraph?.scene.nodes.filter(({ kind }) => kind === 'boundary')).toHaveLength(6);
      expect(directGraph?.scene.nodes.some(({ label }) => label.includes('unused.example'))).toBe(
        false,
      );

      const deepTrace = buildEndpointTrace(analysis, {
        httpMethod: 'GET',
        path: '/gateway/deep',
      });
      expect(deepTrace.status).toBe('resolved');
      if (deepTrace.status === 'resolved') {
        expect(
          deepTrace.trace.steps.filter(
            ({ relation }) => relation === 'METHOD_INITIATES_INTERACTION',
          ),
        ).toHaveLength(1);
      }
      const limitedTrace = buildEndpointTrace(depthLimited.analysis, {
        httpMethod: 'GET',
        path: '/gateway/deep',
      });
      expect(limitedTrace.status).toBe('resolved');
      if (limitedTrace.status === 'resolved') {
        expect(
          limitedTrace.trace.steps.filter(
            ({ relation }) => relation === 'METHOD_INITIATES_INTERACTION',
          ),
        ).toHaveLength(0);
        expect(limitedTrace.diagnostics.map(({ code }) => code)).toContain('CALL_DEPTH_LIMIT');
      }

      const projection = buildAnalysisSemanticProjection(analysis);
      expect(
        [...projection.semanticKeyById.entries()].filter(([id]) =>
          outbound.some((interaction) => interaction.id === id),
        ),
      ).toHaveLength(outbound.length);
      expect(
        projection.collisions.filter(({ recordKind }) => recordKind === 'interaction'),
      ).toEqual([]);

      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
      expect(serializeCanonicalAnalysis(second.analysis)).toBe(serialized);
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('bounds oversized static targets without retaining their contents', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeAxios(project);
      const oversized = `https://limit.example/${'x'.repeat(2_100)}`;
      await project.write(
        'src/limit.ts',
        [
          "import axios from 'axios';",
          'export class LimitClient {',
          `  send(): void { axios.get(${JSON.stringify(oversized)}); }`,
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      expect(analysis.interactions).toHaveLength(1);
      expect(analysis.interactions[0]).toMatchObject({
        kind: 'outbound_http',
        target: { url: { resolution: 'dynamic', value: null } },
      });
      expect(analysis.diagnostics.map(({ code }) => code)).toContain(
        'OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED',
      );
      expect(serializeCanonicalAnalysis(analysis)).not.toContain('x'.repeat(200));
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
