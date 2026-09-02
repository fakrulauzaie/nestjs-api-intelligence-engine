import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { renderOfflineSystemReport } from '../../../src/system-report/html.js';
import { OFFLINE_SYSTEM_REPORT_APP } from '../../../src/system-report/app-script.js';
import { serializeCanonicalSystemReport } from '../../../src/system-report/ordering.js';
import { buildSystemReportDocument } from '../../../src/system-report/project.js';
import { validateSystemReportDocument } from '../../../src/system-report/validate.js';
import {
  assertValidSystemTopologyManifest,
  stitchSystemAnalyses,
} from '../../../src/system-analysis/index.js';
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

async function scanFixture(name: 'report-api' | 'report-worker') {
  const project = await createTestTypeScriptProject();
  await Promise.all([
    writeFakeNestCommon(project),
    writeFakeNestCore(project),
    writeFakeNestMicroservices(project),
    writeFakeNestTypeOrm(project),
    writeFakeRxjs(project),
    writeFakeTypeOrm(project),
  ]);
  await project.write(
    `src/${name}.ts`,
    await readFile(`test/fixtures/system-report/${name}.ts.txt`, 'utf8'),
  );
  await writeBasicTsconfig(project);
  return { project, analysis: (await scanRepository({ repositoryRoot: project.path })).analysis };
}

describe('Phase 47 system report', () => {
  it('ships a syntactically valid path-first compound layout application', () => {
    expect(() => new Script(OFFLINE_SYSTEM_REPORT_APP)).not.toThrow();
    expect(OFFLINE_SYSTEM_REPORT_APP).toContain("layout: { name: 'preset', fit: false }");
    expect(OFFLINE_SYSTEM_REPORT_APP).toContain('compactGroupLayout');
    expect(OFFLINE_SYSTEM_REPORT_APP).toContain('showPaths();');
    expect(OFFLINE_SYSTEM_REPORT_APP).not.toContain("layout: { name: 'cose'");
    expect(OFFLINE_SYSTEM_REPORT_APP).not.toContain('nodeRepulsion');
  });

  it('continues an HTTP root through only a declared broker candidate to worker effects', async () => {
    const [producer, consumer] = await Promise.all([
      scanFixture('report-api'),
      scanFixture('report-worker'),
    ]);
    try {
      const services = [
        {
          namespace: 'report-api',
          artifactLabel: 'report-api-analysis.json',
          analysis: producer.analysis,
        },
        {
          namespace: 'report-worker',
          artifactLabel: 'report-worker-analysis.json',
          analysis: consumer.analysis,
        },
      ];
      const topology = assertValidSystemTopologyManifest(
        JSON.parse(
          await readFile('test/fixtures/system-report/report-system.topology.json', 'utf8'),
        ),
      );
      const system = stitchSystemAnalyses({ systemName: 'report-system', services, topology });
      const report = buildSystemReportDocument({ system, services });

      expect(validateSystemReportDocument(report)).toMatchObject({ success: true });
      expect(report.conditionalPaths).toEqual([
        expect.objectContaining({
          boundary: 'conditional_candidate',
          httpRootNodeId: expect.any(String),
          effectNodeIds: [expect.any(String)],
        }),
      ]);
      expect(report.graph.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'http_endpoint', label: 'POST /reports' }),
          expect.objectContaining({ kind: 'table_effect', label: 'WRITE table report_job' }),
        ]),
      );
      expect(
        report.graph.edges.filter(({ kind }) => kind === 'conditional_candidate'),
      ).toHaveLength(1);
      expect(report.graph.edges.some(({ label }) => label === 'delivered')).toBe(false);
      expect(report.policies.summary.failed).toBe(0);

      const reversed = buildSystemReportDocument({ system, services: [...services].reverse() });
      expect(serializeCanonicalSystemReport(reversed)).toBe(serializeCanonicalSystemReport(report));
      const html = await renderOfflineSystemReport(report, 'window.cytoscape = function () {};');
      expect(html).toContain("connect-src 'none'");
      expect(html).toContain('Accessible graph table');
      expect(html).toContain('delivery not proven');
      expect(html).toContain('Conditional paths');
      expect(html).toContain('All interactions');
      expect(html).toContain('Fit view');
      expect(html).toContain("layout: { name: 'preset', fit: false }");
      expect(html).toContain("selector: '.hidden'");
      expect(html).not.toContain("layout: { name: 'cose'");
      expect(html).not.toContain('nodeRepulsion');
      expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/)/iu);
    } finally {
      await Promise.all([producer.project.cleanup(), consumer.project.cleanup()]);
    }
  }, 30_000);

  it('keeps target-only equality out of paths and reports a typed policy failure', async () => {
    const [producer, consumer] = await Promise.all([
      scanFixture('report-api'),
      scanFixture('report-worker'),
    ]);
    try {
      const services = [
        {
          namespace: 'report-api',
          artifactLabel: 'report-api-analysis.json',
          analysis: producer.analysis,
        },
        {
          namespace: 'report-worker',
          artifactLabel: 'report-worker-analysis.json',
          analysis: consumer.analysis,
        },
      ];
      const system = stitchSystemAnalyses({ systemName: 'report-system', services });
      const report = buildSystemReportDocument({ system, services });
      expect(report.conditionalPaths).toEqual([]);
      expect(report.graph.edges.filter(({ kind }) => kind.startsWith('conditional'))).toEqual([]);
      expect(report.policies.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'require-declared-realm-candidate',
            outcome: 'fail',
          }),
        ]),
      );
      expect(validateSystemReportDocument({ ...report, schemaVersion: '2.0.0' })).toMatchObject({
        success: false,
      });
    } finally {
      await Promise.all([producer.project.cleanup(), consumer.project.cleanup()]);
    }
  }, 30_000);
});
