import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import {
  buildEndpointCatalogue,
  renderEndpointCatalogueMarkdown,
} from '../../../src/reporting/endpoint-catalogue.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../../../src/tracing/interaction-handler-trace.js';
import {
  writeFakeCacheManager,
  writeFakeBullMq,
  writeFakeIoredis,
  writeFakeNestCommon,
  writeFakeNestEventEmitter,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('non-relational resource access extraction', () => {
  it('extracts package-proven cache-manager and ioredis operations without retaining payloads', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeCacheManager(project),
        writeFakeIoredis(project),
        writeFakeNestEventEmitter(project),
      ]);
      const fixture = await readFile('test/fixtures/resources/cache-and-redis.ts.txt', 'utf8');
      await project.write('src/cache-and-redis.ts', fixture);
      await writeBasicTsconfig(project);

      const first = await scanRepository({ repositoryRoot: project.path });
      const second = await scanRepository({ repositoryRoot: project.path });
      const { analysis } = first;
      if (analysis.schemaVersion !== '7.0.0') throw new Error('Expected analysis v7.');

      expect(analysis.resourceAccessAnalysis).toEqual({
        supportedTechnologies: ['cache_manager', 'ioredis', 'redlock'],
        enabledTechnologies: ['cache_manager', 'ioredis', 'redlock'],
        state: 'incomplete',
      });
      expect(analysis.resourceAccesses).toHaveLength(15);
      expect(
        analysis.resourceAccesses.filter(({ technology }) => technology === 'cache_manager'),
      ).toHaveLength(5);
      expect(
        analysis.resourceAccesses.filter(({ technology }) => technology === 'ioredis'),
      ).toHaveLength(10);
      expect(analysis.resourceAccesses.map(({ target }) => target.kind)).toEqual(
        expect.arrayContaining(['exact', 'template', 'symbolic', 'dynamic']),
      );
      expect(
        analysis.resourceAccesses.filter(
          ({ resourceKind, operation }) =>
            resourceKind === 'redis_keyspace' && operation === 'scan',
        ),
      ).toEqual([
        expect.objectContaining({
          api: 'scan',
          target: { kind: 'exact', value: 'redis:*' },
          selector: null,
        }),
      ]);
      expect(
        analysis.assertions.filter(({ predicate }) => predicate === 'METHOD_ACCESSES_RESOURCE'),
      ).toHaveLength(15);
      expect(analysis.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          'RESOURCE_ACCESS_TARGET_DYNAMIC',
          'RESOURCE_ACCESS_OPERATION_UNSUPPORTED',
        ]),
      );
      expect(
        analysis.diagnostics.filter(({ code }) => code === 'RESOURCE_ACCESS_OPERATION_UNSUPPORTED'),
      ).toHaveLength(3);
      expect(
        analysis.resourceAccesses.some(({ target }) =>
          target.kind === 'exact' ? target.value === 'lookalike' : false,
        ),
      ).toBe(false);

      const serialized = serializeCanonicalAnalysis(analysis);
      expect(serialized).not.toContain('secretPayload');
      expect(serialized).not.toContain('payload-not-retained');
      expect(serialized).not.toContain('handler-payload-not-retained');
      expect(validateAnalysisDocument(analysis).success).toBe(true);
      expect(serializeCanonicalAnalysis(second.analysis)).toBe(serialized);

      const trace = buildEndpointTrace(analysis, {
        httpMethod: 'GET',
        path: '/resources/:id',
      });
      expect(trace.status).toBe('resolved');
      if (trace.status === 'resolved') {
        expect(trace.trace.resourceTerminals).toHaveLength(14);
        expect(
          trace.trace.resourceTerminals?.every(({ causalClass }) => causalClass === 'synchronous'),
        ).toBe(true);
        expect(
          trace.trace.steps.filter(({ relation }) => relation === 'METHOD_ACCESSES_RESOURCE'),
        ).toHaveLength(14);
        expect(
          renderEndpointTraceMarkdown({
            analysis,
            trace: trace.trace,
            diagnostics: trace.diagnostics,
          }),
        ).toContain('## Non-relational resource access');
      }
      const eventHandler = analysis.interactionHandlers.find(
        (handler) => handler.kind === 'in_process_event',
      );
      expect(eventHandler).toBeDefined();
      const handlerTrace = buildInteractionHandlerTrace(analysis, eventHandler!.id);
      expect(handlerTrace.status).toBe('resolved');
      if (handlerTrace.status === 'resolved') {
        expect(handlerTrace.trace.resourceTerminals).toEqual([
          expect.objectContaining({
            operation: 'write',
            resourceKind: 'cache_entry',
            causalClass: 'local_interaction_synchronous',
          }),
        ]);
      }
      expect(renderEndpointCatalogueMarkdown(buildEndpointCatalogue(analysis))).toContain(
        '## Non-relational resource access',
      );
      const graph = buildGraphReportDocument({ analysis });
      expect(graph.schemaVersion).toBe('9.0.0');
      expect(
        graph.endpoints[0]?.scene.nodes.filter(({ kind }) => kind === 'resource_access'),
      ).toHaveLength(14);
      expect(
        graph.interactionHandlers?.[0]?.scene.nodes.some(({ kind }) => kind === 'resource_access'),
      ).toBe(true);
      expect(graph.architecture?.scene.nodes.some(({ kind }) => kind === 'resource_access')).toBe(
        true,
      );

      await project.write(
        'src/cache-and-redis.ts',
        fixture.replace(
          "const EXACT_CACHE_KEY = 'cache:exact';",
          "const EXACT_CACHE_KEY = 'cache:renamed';",
        ),
      );
      const changed = await scanRepository({ repositoryRoot: project.path });
      const diff = compareAnalysisDocuments(analysis, changed.analysis);
      expect(diff.schemaVersion).toBe('5.0.0');
      expect(diff.before.facts.resourceAccesses).toBe('available');
      expect(diff.after.facts.resourceAccesses).toBe('available');
      expect(diff.endpointChanges).toEqual([
        expect.objectContaining({
          change: 'modified',
          reasons: ['resource_accesses'],
          before: expect.objectContaining({
            resourceAccesses: expect.objectContaining({ availability: 'available' }),
          }),
          after: expect.objectContaining({
            resourceAccesses: expect.objectContaining({ availability: 'available' }),
          }),
        }),
      ]);
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('keeps resource effects branch-scoped across a BullMQ worker boundary', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeBullMq(project),
        writeFakeCacheManager(project),
      ]);
      const fixture = await readFile(
        'test/fixtures/phase40/bullmq-branch-endpoints.ts.txt',
        'utf8',
      );
      const source = fixture
        .replace(
          "import { Controller, Injectable, Module, Post } from '@nestjs/common';",
          "import { Controller, Inject, Injectable, Module, Post } from '@nestjs/common';\nimport { CACHE_MANAGER } from '@nestjs/cache-manager';\nimport type { Cache } from 'cache-manager';",
        )
        .replace(
          '  constructor(\n    @InjectRepository(WorkerReceipt)',
          '  constructor(\n    @Inject(CACHE_MANAGER) private readonly cache: Cache,\n    @InjectRepository(WorkerReceipt)',
        )
        .replace(
          "      case 'generate-pdf': {\n        await this.generated.save({ id: job.data.id });",
          "      case 'generate-pdf': {\n        await this.cache.set(`report:${job.data.id}`, 'payload-not-retained');\n        await this.generated.save({ id: job.data.id });",
        );
      await project.write('src/fixture.ts', source);
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      if (analysis.schemaVersion !== '7.0.0') throw new Error('Expected analysis v7.');
      expect(
        analysis.interactionHandlerBranchEffects.filter(({ kind }) => kind === 'accesses_resource'),
      ).toEqual([
        expect.objectContaining({
          targetId: expect.stringMatching(/^resource_access:/u),
        }),
      ]);
      expect(validateAnalysisDocument(analysis).success).toBe(true);

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
      if (generate.status === 'resolved' && cleanup.status === 'resolved') {
        expect(generate.trace.resourceTerminals).toEqual([
          expect.objectContaining({ causalClass: 'distributed_conditional' }),
        ]);
        expect(cleanup.trace.resourceTerminals).toEqual([]);
      }
      const resourceEvidenceIds = new Set(
        analysis.resourceAccesses.flatMap(({ evidenceIds }) => evidenceIds),
      );
      expect(
        analysis.evidence
          .filter(({ id }) => resourceEvidenceIds.has(id))
          .map(({ snippet }) => snippet)
          .join('\n'),
      ).not.toContain('payload-not-retained');
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
