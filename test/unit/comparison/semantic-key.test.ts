import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { buildAnalysisSemanticProjection } from '../../../src/comparison/projection.js';
import { normalizeAnalysisForComparison } from '../../../src/comparison/normalize.js';
import { AnalysisIntegrityError } from '../../../src/evidence/validate.js';
import { createSemanticKey, normalizeSignature } from '../../../src/comparison/semantic-key.js';
import type { AnalysisDocument } from '../../../src/model/analysis.js';
import { createStableId, type StableIdKind } from '../../../src/model/ids.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

function remapSnapshotIds(analysis: AnalysisDocument, salt: string): AnalysisDocument {
  const ids = [
    analysis.analysisRun.id,
    ...analysis.sourceFiles.map(({ id }) => id),
    ...analysis.classes.map(({ id }) => id),
    ...analysis.methods.map(({ id }) => id),
    ...analysis.endpoints.map(({ id }) => id),
    ...analysis.guards.map(({ id }) => id),
    ...analysis.repositoryBindings.map(({ id }) => id),
    ...analysis.entities.map(({ id }) => id),
    ...analysis.tables.map(({ id }) => id),
    ...analysis.assertions.map(({ id }) => id),
    ...analysis.evidence.map(({ id }) => id),
    ...analysis.diagnostics.map(({ id }) => id),
  ];
  const mapped = new Map(
    ids.map((id) => {
      const kind = id.slice(0, id.indexOf(':')) as StableIdKind;
      return [id, createStableId(kind, [salt, id])] as const;
    }),
  );
  const id = (value: string): string => mapped.get(value)!;

  return {
    ...analysis,
    analysisRun: {
      ...analysis.analysisRun,
      id: id(analysis.analysisRun.id),
      repositoryRevision: salt,
    },
    sourceFiles: analysis.sourceFiles.map((record) => ({ ...record, id: id(record.id) })),
    classes: analysis.classes.map((record) => ({
      ...record,
      id: id(record.id),
      sourceFileId: id(record.sourceFileId),
      declarationEvidenceId: id(record.declarationEvidenceId),
    })),
    methods: analysis.methods.map((record) => ({
      ...record,
      id: id(record.id),
      classId: id(record.classId),
      declarationEvidenceId: id(record.declarationEvidenceId),
    })),
    endpoints: analysis.endpoints.map((record) => ({ ...record, id: id(record.id) })),
    guards: analysis.guards.map((record) => ({
      ...record,
      id: id(record.id),
      classId: id(record.classId),
    })),
    repositoryBindings: analysis.repositoryBindings.map((record) => ({
      ...record,
      id: id(record.id),
      ownerClassId: id(record.ownerClassId),
      declarationEvidenceId: id(record.declarationEvidenceId),
    })),
    entities: analysis.entities.map((record) => ({
      ...record,
      id: id(record.id),
      classId: id(record.classId),
    })),
    tables: analysis.tables.map((record) => ({ ...record, id: id(record.id) })),
    assertions: analysis.assertions.map((record) => ({
      ...record,
      id: id(record.id),
      subjectId: id(record.subjectId),
      objectId: record.objectId === null ? null : id(record.objectId),
      evidenceIds: record.evidenceIds.map(id),
    })),
    evidence: analysis.evidence.map((record) => ({
      ...record,
      id: id(record.id),
      fileId: id(record.fileId),
    })),
    diagnostics: analysis.diagnostics.map((record) => ({
      ...record,
      id: id(record.id),
      ...(record.subjectId === undefined ? {} : { subjectId: id(record.subjectId) }),
      evidenceIds: record.evidenceIds.map(id),
    })),
  };
}

describe('comparison semantic keys', () => {
  it('uses canonical JSON tuples with NFC and normalized signatures', () => {
    expect(createSemanticKey('class', ['cafe\u0301']).encoded).toBe('["class","café"]');
    expect(normalizeSignature('find( id:  string ):\n Promise<string>')).toBe(
      'find( id: string ): Promise<string>',
    );
  });

  it('matches independently scoped canonical IDs without raw-ID equality', () => {
    const minimal = createMinimalAnalysisDocument();
    const before: AnalysisDocument = {
      ...minimal,
      diagnostics: [
        {
          id: createStableId('diagnostic', ['original-snapshot-diagnostic']),
          code: 'NEST_ROUTE_DYNAMIC',
          severity: 'warning',
          message: 'Route expression is not statically recoverable.',
          subjectId: minimal.endpoints[0]!.id,
          evidenceIds: [minimal.evidence[2]!.id],
        },
      ],
    };
    const after = remapSnapshotIds(before, 'independent-snapshot');
    const beforeProjection = buildAnalysisSemanticProjection(before);
    const afterProjection = buildAnalysisSemanticProjection(after);

    expect(before.analysisRun.id).not.toBe(after.analysisRun.id);
    expect(before.endpoints[0]!.id).not.toBe(after.endpoints[0]!.id);
    expect(before.diagnostics[0]!.id).not.toBe(after.diagnostics[0]!.id);
    expect(before.diagnostics[0]!.evidenceIds).not.toEqual(after.diagnostics[0]!.evidenceIds);
    expect(beforeProjection.endpoints[0]!.exactKey).toEqual(afterProjection.endpoints[0]!.exactKey);
    expect(beforeProjection.input.facts).toMatchObject({
      directGuards: 'available',
      effectiveGuards: 'unavailable',
    });
    expect(compareAnalysisDocuments(before, after).summary).toEqual({
      endpointsAdded: 0,
      endpointsRemoved: 0,
      endpointsModified: 0,
      assertionStatusChanged: 0,
      diagnosticsNew: 0,
      diagnosticsResolved: 0,
      diagnosticsChanged: 0,
      ambiguities: 0,
    });
  });

  it('rejects unknown analysis schemas at the normalization boundary', () => {
    expect(() =>
      normalizeAnalysisForComparison({
        ...createMinimalAnalysisDocument(),
        schemaVersion: '2.0.0',
      }),
    ).toThrow(AnalysisIntegrityError);
  });
});
