import { describe, expect, it } from 'vitest';
import { assertValidAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import {
  assertValidGraphReportDocument,
  GraphReportIntegrityError,
} from '../../../src/graph-report/validate.js';
import { serializeGraphReportDocument } from '../../../src/graph-report/ordering.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import type { AnalysisDocument } from '../../../src/model/analysis.js';
import type { AssertionRecord } from '../../../src/model/assertions.js';
import type { MethodRecord } from '../../../src/model/entities.js';
import { createStableId } from '../../../src/model/ids.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { createImpactAnalysisSnapshot } from '../../helpers/impact-analysis.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

function expandedAnalysis(options: {
  readonly branches?: number;
  readonly cycle?: boolean;
  readonly gap?: boolean;
}): AnalysisDocument {
  const analysis = createMinimalAnalysisDocument();
  const handler = analysis.methods[0]!;
  const evidenceId = analysis.evidence[1]!.id;
  const methods: MethodRecord[] = [];
  const assertions: AssertionRecord[] = [];
  for (let index = 0; index < (options.branches ?? 1); index += 1) {
    const id = createStableId('method', ['phase23', `branch-${index}`]);
    methods.push({
      id,
      classId: handler.classId,
      qualifiedName: `HealthController.branch${index}`,
      displayName: `branch${index}`,
      signature: `branch${index}(): void`,
      declarationEvidenceId: evidenceId,
    });
    assertions.push({
      id: createStableId('assertion', ['phase23', `call-${index}`]),
      subjectId: handler.id,
      predicate: 'METHOD_CALLS_METHOD',
      objectId: id,
      status: 'resolved',
      ruleId: 'test.phase23.call.v1',
      evidenceIds: [evidenceId],
    });
  }
  if (options.cycle && methods[0] !== undefined) {
    assertions.push({
      id: createStableId('assertion', ['phase23', 'cycle']),
      subjectId: methods[0].id,
      predicate: 'METHOD_CALLS_METHOD',
      objectId: handler.id,
      status: 'resolved',
      ruleId: 'test.phase23.cycle.v1',
      evidenceIds: [evidenceId],
    });
  }
  if (options.gap) {
    assertions.push({
      id: createStableId('assertion', ['phase23', 'gap']),
      subjectId: handler.id,
      predicate: 'METHOD_CALLS_METHOD',
      objectId: null,
      status: 'unsupported',
      ruleId: 'test.phase23.gap.v1',
      evidenceIds: [evidenceId],
    });
  }
  return {
    ...analysis,
    methods: [...analysis.methods, ...methods],
    assertions: [...analysis.assertions, ...assertions],
  };
}

describe('Phase 23 graph report projection', () => {
  it('projects a deterministic endpoint-centered graph with evidence closure', () => {
    const analysis = createMinimalAnalysisDocument();
    const first = buildGraphReportDocument({ analysis });
    expect(first.endpoints).toHaveLength(1);
    expect(first.endpoints[0]!.scene.nodes.map(({ kind }) => kind)).toEqual(['endpoint', 'method']);
    expect(first.endpoints[0]!.scene.edges).toEqual([
      expect.objectContaining({ label: 'implemented by', uncertainty: 'resolved' }),
    ]);
    expect(first.endpoints[0]!.scene.evidence.length).toBeGreaterThan(0);
    const reversed = assertValidAnalysisDocument({
      ...analysis,
      sourceFiles: [...analysis.sourceFiles].reverse(),
      classes: [...analysis.classes].reverse(),
      methods: [...analysis.methods].reverse(),
      endpoints: [...analysis.endpoints].reverse(),
      guards: [...analysis.guards].reverse(),
      repositoryBindings: [...analysis.repositoryBindings].reverse(),
      entities: [...analysis.entities].reverse(),
      tables: [...analysis.tables].reverse(),
      assertions: [...analysis.assertions].reverse(),
      evidence: [...analysis.evidence].reverse(),
      diagnostics: [...analysis.diagnostics].reverse(),
    });
    expect(
      serializeGraphReportDocument({
        document: buildGraphReportDocument({ analysis: reversed }),
        analysis: reversed,
      }),
    ).toBe(serializeGraphReportDocument({ document: first, analysis }));
  });

  it('preserves cycles and unsupported gaps and reports display-limit omissions', () => {
    const analysis = expandedAnalysis({ branches: 14, cycle: true, gap: true });
    const document = buildGraphReportDocument({
      analysis,
      options: { maxNodesPerEndpoint: 10, maxEdgesPerEndpoint: 10 },
    });
    const endpoint = document.endpoints[0]!;
    expect(endpoint.scene.nodes.length).toBeLessThanOrEqual(10);
    expect(endpoint.scene.edges.length).toBeLessThanOrEqual(10);
    expect(endpoint.scene.omitted.nodes).toBeGreaterThan(0);
    expect(endpoint.scene.omitted.edges).toBeGreaterThan(0);

    const unbounded = buildGraphReportDocument({ analysis });
    expect(unbounded.endpoints[0]!.scene.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uncertainty: 'unsupported' }),
        expect.objectContaining({
          source: analysis.methods.at(-14)!.id,
          target: analysis.methods[0]!.id,
        }),
      ]),
    );
    expect(unbounded.endpoints[0]!.scene.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'gap', uncertainty: 'unsupported' }),
      ]),
    );
  });

  it('supports empty analysis plus same-snapshot policy and impact overlays', () => {
    const minimal = createMinimalAnalysisDocument();
    const empty: AnalysisDocument = { ...minimal, endpoints: [], assertions: [] };
    expect(buildGraphReportDocument({ analysis: empty }).endpoints).toEqual([]);

    const after = createImpactAnalysisSnapshot('after');
    const policyResults = evaluatePolicies({
      analysis: after,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: { 'no-repository-access-in-controller': 'warn' },
      }),
    });
    const impact = analyzePotentialImpact(createImpactAnalysisSnapshot('before'), after);
    const report = buildGraphReportDocument({ analysis: after, policyResults, impact });
    expect(report.policy.state).toBe('supplied');
    expect(report.impact).toMatchObject({ state: 'supplied', side: 'after' });
    expect(report.endpoints.some(({ impact: state }) => state !== 'none')).toBe(true);
    expect(report.endpoints.some(({ policyOutcomes }) => policyOutcomes.length > 0)).toBe(true);
  });

  it('rejects broken scene references and summary corruption', () => {
    const analysis = createMinimalAnalysisDocument();
    const document = buildGraphReportDocument({ analysis });
    const endpoint = document.endpoints[0]!;
    expect(() =>
      assertValidGraphReportDocument({
        analysis,
        document: {
          ...document,
          summary: { ...document.summary, endpoints: 99 },
          endpoints: [
            {
              ...endpoint,
              scene: {
                ...endpoint.scene,
                edges: endpoint.scene.edges.map((edge) => ({ ...edge, target: 'missing:node' })),
              },
            },
          ],
        },
      }),
    ).toThrow(GraphReportIntegrityError);
  });
});
