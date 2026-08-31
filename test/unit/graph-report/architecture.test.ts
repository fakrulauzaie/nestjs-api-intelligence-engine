import { describe, expect, it } from 'vitest';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import {
  assertValidGraphReportDocument,
  GraphReportIntegrityError,
} from '../../../src/graph-report/validate.js';
import { makeMethodId } from '../../../src/model/ids.js';
import { createMinimalAnalysisDocumentV5 } from '../../helpers/minimal-analysis.js';

describe('Phase 42 graph architecture overview', () => {
  it('publishes graph v7 with bounded numeric metrics, legends, ownership, and a root scene', () => {
    const analysis = createMinimalAnalysisDocumentV5();
    const document = buildGraphReportDocument({ analysis });
    expect(document.schemaVersion).toBe('7.0.0');
    expect(document.architecture).toBeDefined();
    const architecture = document.architecture!;
    expect(architecture.scene.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: architecture.rootId, kind: 'repository' }),
        expect.objectContaining({
          id: analysis.methods[0]!.id,
          architectureReachability: 'reached_from_supported_root',
          architectureMetrics: expect.arrayContaining([
            expect.objectContaining({ metric: 'endpoint_reach_count', value: 1 }),
          ]),
        }),
      ]),
    );
    expect(architecture.metricLegends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'supported_root_reach_count',
          percentiles: { p50: 1, p75: 1, p90: 1 },
        }),
      ]),
    );
    expect(document.summary).toMatchObject({
      architectureRecords: 1,
      notReachedFromSupportedRoots: 0,
    });
  });

  it('rejects metric corruption independently of scene rendering', () => {
    const analysis = createMinimalAnalysisDocumentV5();
    const document = buildGraphReportDocument({ analysis });
    const architecture = document.architecture!;
    expect(() =>
      assertValidGraphReportDocument({
        analysis,
        document: {
          ...document,
          architecture: {
            ...architecture,
            records: architecture.records.map((record, index) =>
              index === 0
                ? {
                    ...record,
                    metrics: record.metrics.map((metric, metricIndex) =>
                      metricIndex === 0 ? { ...metric, value: metric.value + 1 } : metric,
                    ),
                  }
                : record,
            ),
          },
        },
      }),
    ).toThrow(GraphReportIntegrityError);
  });

  it('bounds the rendered scene while retaining complete metrics and compound parents', () => {
    const minimal = createMinimalAnalysisDocumentV5();
    const baseMethod = minimal.methods[0]!;
    const additionalMethods = Array.from({ length: 20 }, (_, index) => {
      const methodName = `helper${index}`;
      const signature = `${methodName}(): void`;
      return {
        ...baseMethod,
        id: makeMethodId({
          path: minimal.sourceFiles[0]!.path,
          qualifiedClassName: 'HealthController',
          methodName,
          signature,
          repositoryRevision: minimal.analysisRun.repositoryRevision,
        }),
        qualifiedName: `HealthController.${methodName}`,
        displayName: methodName,
        signature,
      };
    });
    const analysis = { ...minimal, methods: [...minimal.methods, ...additionalMethods] };

    const document = buildGraphReportDocument({
      analysis,
      options: { maxNodesPerEndpoint: 10, maxEdgesPerEndpoint: 10 },
    });
    const architecture = document.architecture!;
    const displayedIds = new Set(architecture.scene.nodes.map((node) => node.id));

    expect(architecture.records).toHaveLength(21);
    expect(architecture.scene.nodes.length).toBeLessThanOrEqual(10);
    expect(architecture.scene.omitted.nodes).toBeGreaterThan(0);
    for (const node of architecture.scene.nodes) {
      if (node.parentId != null) expect(displayedIds.has(node.parentId)).toBe(true);
    }
  });
});
