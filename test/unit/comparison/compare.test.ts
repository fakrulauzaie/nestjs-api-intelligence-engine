import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { serializeDiffDocument } from '../../../src/comparison/ordering.js';
import { buildAnalysisSemanticProjection } from '../../../src/comparison/projection.js';
import { assertValidAnalysisDocument } from '../../../src/evidence/validate.js';
import type { AnalysisDocument } from '../../../src/model/analysis.js';
import { createStableId } from '../../../src/model/ids.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

function reverseCanonicalArrays(analysis: AnalysisDocument): AnalysisDocument {
  return {
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
    ...(analysis.schemaVersion !== '1.0.0'
      ? {
          modules: [...analysis.modules].reverse(),
          globalGuardRegistrations: [...analysis.globalGuardRegistrations].reverse(),
          contractTypes: [...analysis.contractTypes].reverse(),
          contractFields: [...analysis.contractFields].reverse(),
          requestParameters: [...analysis.requestParameters].reverse(),
          responseContracts: [...analysis.responseContracts].reverse(),
          entityColumns: [...analysis.entityColumns].reverse(),
        }
      : {}),
    ...(analysis.schemaVersion === '3.0.0'
      ? {
          applications: [...analysis.applications].reverse(),
          interactions: [...analysis.interactions].reverse(),
          interactionHandlers: [...analysis.interactionHandlers].reverse(),
        }
      : {}),
  };
}

describe('deterministic analysis comparison', () => {
  it('reports endpoint, assertion, and diagnostic changes from semantic facts', () => {
    const before = assertValidAnalysisDocument(createComparisonAnalysisSnapshot('before'));
    const after = assertValidAnalysisDocument(createComparisonAnalysisSnapshot('after'));
    const diff = compareAnalysisDocuments(before, after);

    expect(diff.summary).toEqual({
      endpointsAdded: 2,
      endpointsRemoved: 2,
      endpointsModified: 2,
      assertionStatusChanged: 1,
      diagnosticsNew: 1,
      diagnosticsResolved: 1,
      diagnosticsChanged: 1,
      ambiguities: 0,
    });
    expect(
      diff.endpointChanges.map(({ change, before: old, after: current, reasons }) => ({
        change,
        route: old?.path ?? current?.path,
        reasons,
      })),
    ).toEqual([
      { change: 'removed', route: '/notes/:id', reasons: ['endpoint_removed'] },
      { change: 'added', route: '/notes/:noteId', reasons: ['endpoint_added'] },
      { change: 'modified', route: '/notes', reasons: ['handler', 'terminals'] },
      { change: 'removed', route: '/notes/:id', reasons: ['endpoint_removed'] },
      { change: 'added', route: '/notes/:id', reasons: ['endpoint_added'] },
      { change: 'modified', route: '/notes', reasons: ['direct_guards', 'terminals'] },
    ]);

    const getChange = diff.endpointChanges.find(
      ({ change, before: old }) => change === 'modified' && old?.httpMethod === 'GET',
    );
    expect(getChange?.before?.handlers[0]?.qualifiedName).toBe('NotesController.list');
    expect(getChange?.after?.handlers[0]?.qualifiedName).toBe('NotesController.findAll');
    expect(getChange?.before?.handlers[0]?.assertionId).not.toBe(
      getChange?.after?.handlers[0]?.assertionId,
    );
    expect(getChange?.before?.terminals.values[0]?.tableName).toBe('note');
    expect(getChange?.after?.terminals.values[0]?.tableName).toBe('audit_log');

    expect(diff.assertionStatusChanges[0]?.before.status).toBe('ambiguous');
    expect(diff.assertionStatusChanges[0]?.after.status).toBe('resolved');
    expect(diff.diagnosticChanges.map(({ change }) => change).sort()).toEqual([
      'changed',
      'new',
      'resolved',
    ]);
    const changedDiagnostic = diff.diagnosticChanges.find(({ change }) => change === 'changed');
    expect(changedDiagnostic?.reasons).toEqual(['severity', 'message', 'evidence']);
  });

  it('is byte-identical when canonical record arrays are shuffled', () => {
    const before = createComparisonAnalysisSnapshot('before');
    const after = createComparisonAnalysisSnapshot('after');
    const ordered = serializeDiffDocument(compareAnalysisDocuments(before, after));
    const shuffled = serializeDiffDocument(
      compareAnalysisDocuments(reverseCanonicalArrays(before), reverseCanonicalArrays(after)),
    );

    expect(shuffled).toBe(ordered);
  });

  it('keeps same-named methods in different source classes semantically distinct', () => {
    const analysis = createComparisonAnalysisSnapshot('after');
    const controllerMethod = analysis.methods.find(
      ({ qualifiedName }) => qualifiedName === 'NotesController.create',
    )!;
    const guardClass = analysis.classes.find(
      ({ qualifiedName }) => qualifiedName === 'AuditGuard',
    )!;
    const guardMethod = {
      ...controllerMethod,
      id: createStableId('method', ['phase13-after', 'AuditGuard.create']),
      classId: guardClass.id,
      qualifiedName: 'AuditGuard.create',
      declarationEvidenceId: guardClass.declarationEvidenceId,
    };
    const expanded = assertValidAnalysisDocument({
      ...analysis,
      methods: [...analysis.methods, guardMethod],
    });
    const projection = buildAnalysisSemanticProjection(expanded);

    expect(projection.semanticKeyById.get(controllerMethod.id)).not.toEqual(
      projection.semanticKeyById.get(guardMethod.id),
    );
    expect(projection.collisions.filter(({ recordKind }) => recordKind === 'method')).toEqual([]);
  });

  it('reports duplicate route slots and leaves their endpoints unmatched', () => {
    const before = createComparisonAnalysisSnapshot('before');
    const after = createComparisonAnalysisSnapshot('after');
    const original = after.endpoints.find(
      ({ httpMethod, path }) => httpMethod === 'GET' && path === '/notes',
    )!;
    const implementation = after.assertions.find(
      ({ predicate, subjectId }) =>
        predicate === 'ENDPOINT_IMPLEMENTED_BY' && subjectId === original.id,
    )!;
    const duplicateId = createStableId('endpoint', ['phase13-after', 'duplicate-get-notes']);
    const duplicateAssertionId = createStableId('assertion', [
      'phase13-after',
      'duplicate-get-notes',
    ]);
    const duplicated = assertValidAnalysisDocument({
      ...after,
      endpoints: [...after.endpoints, { ...original, id: duplicateId }],
      assertions: [
        ...after.assertions,
        {
          ...implementation,
          id: duplicateAssertionId,
          subjectId: duplicateId,
        },
      ],
    });
    const diff = compareAnalysisDocuments(before, duplicated);
    const routeAmbiguity = diff.ambiguities.find(
      ({ kind, key }) => kind === 'endpoint_route_slot' && key.components.includes('/notes'),
    );
    const routeChanges = diff.endpointChanges.filter(
      ({ routeSlotKey }) =>
        routeSlotKey.components[0] === 'GET' && routeSlotKey.components[1] === '/notes',
    );

    expect(routeAmbiguity?.beforeCandidateIds).toEqual([
      before.endpoints.find(({ httpMethod, path }) => httpMethod === 'GET' && path === '/notes')!
        .id,
    ]);
    expect(routeAmbiguity?.afterCandidateIds).toHaveLength(2);
    expect(routeAmbiguity?.side).toBe('after');
    expect(routeChanges.map(({ change }) => change).sort()).toEqual(['added', 'added', 'removed']);
    expect(routeChanges.some(({ change }) => change === 'modified')).toBe(false);
  });

  it('normalizes v1 effective guards as unavailable and v2 effective guards as available', () => {
    const v1 = createMinimalAnalysisDocument();
    const v2 = assertValidAnalysisDocument({
      ...v1,
      schemaVersion: '2.0.0',
      modules: [],
      globalGuardRegistrations: [],
      contractTypes: [],
      contractFields: [],
      requestParameters: [],
      responseContracts: [],
      entityColumns: [],
      requestFieldOrigins: [],
      columnInfluences: [],
      globalGuardAnalysis: { completeness: 'incomplete', state: 'unknown' },
    });

    expect(buildAnalysisSemanticProjection(v1).input.facts.effectiveGuards).toBe('unavailable');
    expect(buildAnalysisSemanticProjection(v2).input.facts.effectiveGuards).toBe('available');
    const crossVersion = compareAnalysisDocuments(v1, v2);
    expect(crossVersion.endpointChanges).toHaveLength(1);
    expect(crossVersion.endpointChanges[0]?.reasons).toEqual(['effective_guards']);
  });
});
