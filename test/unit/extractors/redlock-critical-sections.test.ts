import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import {
  writeFakeCacheManager,
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeRedlock,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('package-proven Redlock critical sections', () => {
  it('separates bounded callback effects from ordinary synchronous work', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeCacheManager(project),
        writeFakeNestTypeOrm(project),
        writeFakeTypeOrm(project),
        writeFakeRedlock(project),
      ]);
      const [fixture, expectationText] = await Promise.all([
        readFile('test/fixtures/resources/redlock-critical-sections.ts.txt', 'utf8'),
        readFile('test/fixtures/resources/redlock-critical-sections.expected.json', 'utf8'),
      ]);
      const expectation = JSON.parse(expectationText) as {
        schemaVersion: string;
        criticalSections: number;
        lockResources: number;
        callbackKinds: string[];
        diagnostics: string[];
        mustNotRetain: string[];
      };
      await project.write('src/redlock-critical-sections.ts', fixture);
      await writeBasicTsconfig(project);

      const first = await scanRepository({ repositoryRoot: project.path });
      const second = await scanRepository({ repositoryRoot: project.path });
      const { analysis } = first;
      expect(analysis.schemaVersion).toBe(expectation.schemaVersion);
      if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
      expect(validateAnalysisDocument(analysis)).toEqual({ success: true, data: analysis });
      expect(analysis.criticalSections).toHaveLength(expectation.criticalSections);
      expect(
        analysis.resourceAccesses.filter(({ technology }) => technology === 'redlock'),
      ).toHaveLength(expectation.lockResources);
      expect(
        [...new Set(analysis.criticalSections.map(({ callbackKind }) => callbackKind))].sort(),
      ).toEqual(expectation.callbackKinds.sort());
      expect(analysis.resourceAccessAnalysis).toEqual({
        supportedTechnologies: ['cache_manager', 'ioredis', 'redlock'],
        enabledTechnologies: ['cache_manager', 'ioredis', 'redlock'],
        state: 'incomplete',
      });
      expect(analysis.diagnostics.map(({ code }) => code)).toEqual(
        expect.arrayContaining(expectation.diagnostics),
      );

      const place = analysis.methods.find(({ qualifiedName }) =>
        qualifiedName.endsWith('OrderService.place'),
      )!;
      const placeSection = analysis.criticalSections.find(
        ({ sourceMethodId }) => sourceMethodId === place.id,
      )!;
      expect(placeSection.effectAssertionIds).toHaveLength(2);
      expect(
        placeSection.effectAssertionIds.map(
          (id) => analysis.assertions.find((assertion) => assertion.id === id)!.predicate,
        ),
      ).toEqual(expect.arrayContaining(['METHOD_ACCESSES_RESOURCE', 'METHOD_CALLS_METHOD']));

      const trace = buildEndpointTrace(analysis, { httpMethod: 'POST', path: '/orders/:id' });
      expect(trace.status).toBe('resolved');
      if (trace.status !== 'resolved') throw new Error('Expected endpoint trace.');
      expect(
        trace.trace.resourceTerminals?.filter(({ technology }) => technology === 'redlock'),
      ).toHaveLength(2);
      expect(
        trace.trace.resourceTerminals?.find(({ technology }) => technology === 'cache_manager')
          ?.causalClass,
      ).toBe('critical_section_conditional');
      expect(
        trace.trace.terminals.find(({ tableName }) => tableName === 'audit_log')?.causalClass,
      ).toBe('critical_section_conditional');
      expect(trace.trace.causalSummary?.synchronousEffects).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ tableName: 'audit_log' })]),
      );
      expect(trace.trace.causalSummary?.criticalSectionConditionalEffects).toEqual(
        expect.arrayContaining([expect.objectContaining({ tableName: 'audit_log' })]),
      );

      const graph = buildGraphReportDocument({ analysis });
      expect(graph.schemaVersion).toBe('9.0.0');
      expect(
        graph.endpoints
          .flatMap(({ scene }) => scene.nodes)
          .some(({ kind }) => kind === 'critical_section'),
      ).toBe(true);
      expect(serializeCanonicalAnalysis(second.analysis)).toBe(
        serializeCanonicalAnalysis(analysis),
      );
      const serialized = serializeCanonicalAnalysis(analysis);
      for (const forbidden of expectation.mustNotRetain)
        expect(serialized).not.toContain(forbidden);

      await project.write(
        'src/redlock-critical-sections.ts',
        fixture.replaceAll('locks:orders', 'locks:orders:v2'),
      );
      const changed = await scanRepository({ repositoryRoot: project.path });
      const diff = compareAnalysisDocuments(analysis, changed.analysis);
      expect(diff.endpointChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reasons: expect.arrayContaining(['resource_accesses']) }),
        ]),
      );
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
