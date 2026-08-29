import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { renderOfflineGraphReport } from '../../src/graph-report/html.js';
import { buildGraphReportDocument } from '../../src/graph-report/project.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import {
  writeFakeAxios,
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestEventEmitter,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
  writeFakeUndici,
} from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

describe('Phase 34 integrated bounded-local interaction report', () => {
  it('renders outbound targets and configured local-event fan-out in one offline graph', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeNestCore(project),
        writeFakeNestEventEmitter(project),
        writeFakeNestTypeOrm(project),
        writeFakeTypeOrm(project),
        writeFakeAxios(project),
        writeFakeUndici(project),
      ]);
      const [httpFixture, eventFixture] = await Promise.all([
        readFile('test/fixtures/interactions/outbound-http.ts.txt', 'utf8'),
        readFile('test/fixtures/interactions/nest-event-emitter-wildcard.ts.txt', 'utf8'),
      ]);
      await Promise.all([
        project.write('src/outbound-http.ts', httpFixture),
        project.write('src/event-wildcards.ts', eventFixture),
      ]);
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      const graph = buildGraphReportDocument({ analysis });
      const html = await renderOfflineGraphReport(graph);
      const outbound = graph.endpoints.find(({ path }) => path === '/gateway/direct')!;
      const event = graph.endpoints.find(({ path }) => path === '/wildcards/dot-created')!;

      expect(graph.schemaVersion).toBe('6.0.0');
      expect(outbound.scene.nodes.some(({ kind }) => kind === 'external_target')).toBe(true);
      expect(outbound.scene.nodes.some(({ kind }) => kind === 'boundary')).toBe(true);
      expect(event.scene.nodes.filter(({ kind }) => kind === 'interaction_handler')).toHaveLength(
        5,
      );
      expect(event.localCausalEffects).toHaveLength(5);
      expect(graph.interactionHandlers).toHaveLength(9);
      expect(
        graph.interactionHandlers?.every(({ scene, handlerId }) =>
          scene.nodes.some(({ id }) => id === handlerId),
        ),
      ).toBe(true);
      expect(event.scene.edges.some(({ label }) => label === 'dispatches')).toBe(true);
      expect(html).toContain("connect-src 'none'");
      expect(html).not.toContain('>delivered<');

      const manualOutput = process.env.API_INTEL_PHASE34_MANUAL_OUTPUT;
      if (manualOutput !== undefined && manualOutput.length > 0) {
        const outputDirectory = resolve(manualOutput);
        await mkdir(outputDirectory, { recursive: true });
        await Promise.all([
          writeFile(
            resolve(outputDirectory, 'analysis.json'),
            serializeCanonicalAnalysis(analysis),
            'utf8',
          ),
          writeFile(resolve(outputDirectory, 'api-intel-graph.html'), html, 'utf8'),
        ]);
      }
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
