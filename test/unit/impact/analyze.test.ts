import { describe, expect, it } from 'vitest';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { serializeImpactDocument } from '../../../src/impact/ordering.js';
import { assertValidAnalysisDocument } from '../../../src/evidence/validate.js';
import type { AnalysisDocument } from '../../../src/model/analysis.js';
import { createImpactAnalysisSnapshot } from '../../helpers/impact-analysis.js';

function reasons(impact: ReturnType<typeof analyzePotentialImpact>, category: string) {
  return impact.impactedEndpoints.flatMap((endpoint) =>
    endpoint.reasons
      .filter((reason) => reason.category === category)
      .map((reason) => ({ endpoint, reason })),
  );
}

function reverseCanonicalArrays(analysis: AnalysisDocument): AnalysisDocument {
  return assertValidAnalysisDocument({
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
}

describe('Phase 14 potential impact analysis', () => {
  it('derives source changes from canonical paths and content hashes only', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after'),
    );

    expect(impact.sourceChanges.map(({ change, path }) => ({ change, path }))).toEqual([
      { change: 'modified', path: 'src/note.entity.ts' },
      { change: 'modified', path: 'src/shared.service.ts' },
      { change: 'modified', path: 'src/unused.service.ts' },
    ]);
    expect(impact.before.analysisId).not.toBe(impact.after.analysisId);
  });

  it('derives added and removed paths solely from source records', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after', { unusedPath: 'src/new-unused.service.ts' }),
    );

    expect(impact.sourceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          change: 'added',
          path: 'src/new-unused.service.ts',
          before: null,
        }),
        expect.objectContaining({
          change: 'removed',
          path: 'src/unused.service.ts',
          after: null,
        }),
      ]),
    );
  });

  it('marks both callers of a changed helper without treating them as direct endpoint edits', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after'),
    );
    const helperReasons = reasons(impact, 'reachable_method_file_change');

    expect(helperReasons.map(({ endpoint }) => endpoint.path).sort()).toEqual([
      '/first',
      '/second',
    ]);
    expect(helperReasons.every(({ endpoint }) => !endpoint.direct)).toBe(true);
    expect(
      helperReasons.every(({ reason }) =>
        reason.paths.every((path) =>
          path.steps.some(({ predicate }) => predicate === 'METHOD_CALLS_METHOD'),
        ),
      ),
    ).toBe(true);
  });

  it('does not impact an endpoint for a same-named but uncalled changed method', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after'),
    );
    const reasonSubjects = impact.impactedEndpoints.flatMap(({ reasons: values }) =>
      values.map(({ subject }) => subject.displayName),
    );

    expect(reasonSubjects).not.toContain('UnusedService.work');
    expect(impact.unreachableSourceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/unused.service.ts',
          reasonCodes: ['no_endpoint_path'],
        }),
      ]),
    );
  });

  it('connects a changed entity declaration to endpoints reaching its mapped table', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after'),
    );
    const entityReasons = reasons(impact, 'entity_declaration_file_change');

    expect(entityReasons.map(({ endpoint }) => endpoint.path).sort()).toEqual([
      '/first',
      '/second',
    ]);
    expect(entityReasons.every(({ reason }) => reason.subject.displayName === 'Note')).toBe(true);
    expect(
      entityReasons.every(({ reason }) =>
        reason.paths.every((path) => path.steps.at(-1)?.predicate === 'METHOD_READS_TABLE'),
      ),
    ).toBe(true);
  });

  it('retains a deleted call path from the before graph', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after', { callers: ['second'] }),
    );
    const firstHelper = reasons(impact, 'reachable_method_file_change').find(
      ({ endpoint }) => endpoint.path === '/first',
    );

    expect(firstHelper?.reason.paths.map(({ side }) => side)).toEqual(['before']);
  });

  it('retains a new call path from the after graph', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before', { callers: ['second'] }),
      createImpactAnalysisSnapshot('after'),
    );
    const firstHelper = reasons(impact, 'reachable_method_file_change').find(
      ({ endpoint }) => endpoint.path === '/first',
    );

    expect(firstHelper?.reason.paths.map(({ side }) => side)).toEqual(['after']);
  });

  it('keeps direct endpoint diffs separate from changed table-access facts', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after', { includeTableAccess: false }),
    );
    const tableReasons = reasons(impact, 'table_access_fact_change');

    expect(tableReasons).toHaveLength(2);
    expect(tableReasons.every(({ reason }) => reason.reasonCode === 'table_access_removed')).toBe(
      true,
    );
    expect(
      tableReasons.every(({ reason }) => reason.paths.every(({ side }) => side === 'before')),
    ).toBe(true);
    expect(impact.impactedEndpoints.every(({ direct }) => !direct)).toBe(true);
    expect(
      impact.impactedEndpoints.every(({ reasons: values }) =>
        values.some(({ category }) => category === 'reachable_method_file_change'),
      ),
    ).toBe(true);
  });

  it('reports a matched table-access resolution change once per reached endpoint', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before', { tableAccessStatus: 'ambiguous' }),
      createImpactAnalysisSnapshot('after'),
    );
    const tableReasons = reasons(impact, 'table_access_fact_change');

    expect(tableReasons).toHaveLength(2);
    expect(
      tableReasons.every(({ reason }) => reason.reasonCode === 'table_access_status_changed'),
    ).toBe(true);
  });

  it('terminates cycles, keeps finite paths, and carries relevant trace uncertainty', () => {
    const before = createImpactAnalysisSnapshot('before');
    const after = createImpactAnalysisSnapshot('after');
    const first = analyzePotentialImpact(before, after);
    const second = analyzePotentialImpact(before, after);

    expect(serializeImpactDocument(first)).toBe(serializeImpactDocument(second));
    expect(
      first.impactedEndpoints
        .flatMap(({ reasons: values }) => values)
        .flatMap(({ paths }) => paths)
        .every(({ steps }) => steps.length <= 3),
    ).toBe(true);
    expect(reasons(first, 'unknown_due_to_incomplete_trace').length).toBeGreaterThan(0);
  });

  it('serializes byte-identically when canonical input arrays are shuffled', () => {
    const before = createImpactAnalysisSnapshot('before');
    const after = createImpactAnalysisSnapshot('after');

    expect(
      serializeImpactDocument(
        analyzePotentialImpact(reverseCanonicalArrays(before), reverseCanonicalArrays(after)),
      ),
    ).toBe(serializeImpactDocument(analyzePotentialImpact(before, after)));
  });
});
