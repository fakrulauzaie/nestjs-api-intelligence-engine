import { describe, expect, it } from 'vitest';
import { buildArchitectureOverview } from '../../../src/architecture/overview.js';
import type { AnalysisDocumentV2 } from '../../../src/model/analysis.js';
import type { AssertionRecord } from '../../../src/model/assertions.js';
import type { ClassRecord, MethodRecord, ModuleRecord } from '../../../src/model/entities.js';
import { createStableId } from '../../../src/model/ids.js';
import {
  createMinimalAnalysisDocument,
  createMinimalAnalysisDocumentV2,
} from '../../helpers/minimal-analysis.js';

function phase42Analysis(): AnalysisDocumentV2 {
  const analysis = createMinimalAnalysisDocumentV2();
  const controllerClass = analysis.classes[0]!;
  const controllerMethod = analysis.methods[0]!;
  const evidenceId = analysis.evidence[0]!.id;
  const serviceClassId = createStableId('class', ['phase42', 'service']);
  const serviceClass: ClassRecord = {
    id: serviceClassId,
    sourceFileId: controllerClass.sourceFileId,
    qualifiedName: 'MetricsService',
    displayName: 'MetricsService',
    roles: ['provider'],
    declarationEvidenceId: evidenceId,
  };
  const reachedMethod: MethodRecord = {
    id: createStableId('method', ['phase42', 'reached']),
    classId: serviceClassId,
    qualifiedName: 'MetricsService.reached',
    displayName: 'reached',
    signature: 'reached(): void',
    declarationEvidenceId: evidenceId,
  };
  const unreachedMethod: MethodRecord = {
    id: createStableId('method', ['phase42', 'unreached']),
    classId: serviceClassId,
    qualifiedName: 'MetricsService.unreached',
    displayName: 'unreached',
    signature: 'unreached(): void',
    declarationEvidenceId: evidenceId,
  };
  const ambiguousMethod: MethodRecord = {
    id: createStableId('method', ['phase42', 'ambiguous']),
    classId: serviceClassId,
    qualifiedName: 'MetricsService.ambiguous',
    displayName: 'ambiguous',
    signature: 'ambiguous(): void',
    declarationEvidenceId: evidenceId,
  };
  const reachedTableId = createStableId('table', ['phase42', 'reached']);
  const ambiguousTableId = createStableId('table', ['phase42', 'ambiguous']);
  const moduleAClassId = createStableId('class', ['phase42', 'module-a']);
  const moduleBClassId = createStableId('class', ['phase42', 'module-b']);
  const moduleAId = createStableId('module', ['phase42', 'module-a']);
  const moduleBId = createStableId('module', ['phase42', 'module-b']);
  const moduleClasses: ClassRecord[] = [
    {
      id: moduleAClassId,
      sourceFileId: controllerClass.sourceFileId,
      qualifiedName: 'ModuleA',
      displayName: 'ModuleA',
      roles: ['module'],
      declarationEvidenceId: evidenceId,
    },
    {
      id: moduleBClassId,
      sourceFileId: controllerClass.sourceFileId,
      qualifiedName: 'ModuleB',
      displayName: 'ModuleB',
      roles: ['module'],
      declarationEvidenceId: evidenceId,
    },
  ];
  const modules: ModuleRecord[] = [
    {
      id: moduleAId,
      classId: moduleAClassId,
      isGlobal: false,
      metadataCompleteness: 'complete',
      declarationEvidenceId: evidenceId,
    },
    {
      id: moduleBId,
      classId: moduleBClassId,
      isGlobal: false,
      metadataCompleteness: 'complete',
      declarationEvidenceId: evidenceId,
    },
  ];
  const assertion = (
    key: string,
    subjectId: string,
    predicate: AssertionRecord['predicate'],
    objectId: string,
    status: AssertionRecord['status'] = 'resolved',
  ): AssertionRecord => ({
    id: createStableId('assertion', ['phase42', key]),
    subjectId,
    predicate,
    objectId,
    status,
    ruleId: `test.phase42.${key}.v1`,
    evidenceIds: [evidenceId],
  });

  return {
    ...analysis,
    classes: [...analysis.classes, serviceClass, ...moduleClasses],
    methods: [controllerMethod, reachedMethod, unreachedMethod, ambiguousMethod],
    tables: [
      { id: reachedTableId, name: 'reached_table', nameSource: 'explicit' },
      { id: ambiguousTableId, name: 'ambiguous_table', nameSource: 'explicit' },
    ],
    modules,
    assertions: [
      ...analysis.assertions,
      assertion('call-reached', controllerMethod.id, 'METHOD_CALLS_METHOD', reachedMethod.id),
      assertion(
        'call-ambiguous',
        controllerMethod.id,
        'METHOD_CALLS_METHOD',
        ambiguousMethod.id,
        'ambiguous',
      ),
      assertion('read-reached', reachedMethod.id, 'METHOD_READS_TABLE', reachedTableId),
      assertion('read-ambiguous', ambiguousMethod.id, 'METHOD_READS_TABLE', ambiguousTableId),
      assertion('owns-controller', moduleAId, 'MODULE_DECLARES_CONTROLLER', controllerClass.id),
      assertion('owns-service-a', moduleAId, 'MODULE_PROVIDES_CLASS', serviceClass.id),
      assertion('owns-service-b', moduleBId, 'MODULE_PROVIDES_CLASS', serviceClass.id),
    ],
  };
}

describe('Phase 42 architecture overview', () => {
  it('computes direct metrics, resolved trace reach, percentile bands, and module ownership', () => {
    const analysis = phase42Analysis();
    const overview = buildArchitectureOverview(analysis);
    const metricRecord = (id: string) => overview.records.find(({ recordId }) => recordId === id)!;
    const metric = (id: string, name: string) =>
      metricRecord(id).metrics.find(({ metric: candidate }) => candidate === name)?.value;
    const controllerMethod = analysis.methods[0]!;
    const reachedMethod = analysis.methods[1]!;
    const unreachedMethod = analysis.methods[2]!;

    expect(metric(controllerMethod.id, 'direct_call_fan_out')).toBe(1);
    expect(metric(reachedMethod.id, 'direct_call_fan_in')).toBe(1);
    expect(metric(reachedMethod.id, 'endpoint_reach_count')).toBe(1);
    expect(metric(analysis.tables[0]!.id, 'endpoint_reach_count')).toBe(1);
    expect(metric(analysis.tables[1]!.id, 'endpoint_reach_count')).toBe(0);
    expect(metricRecord(unreachedMethod.id).reachability).toBe('not_reached_from_supported_roots');
    expect(overview.metricLegends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'supported_root_reach_count',
          eligibleRecords: 6,
        }),
      ]),
    );
    expect(
      overview.moduleOwnership.find(({ recordId }) => recordId === reachedMethod.id),
    ).toMatchObject({ state: 'multiple_owners', moduleIds: expect.arrayContaining([]) });
    expect(
      overview.moduleOwnership.find(({ recordId }) => recordId === controllerMethod.classId),
    ).toMatchObject({ state: 'uniquely_owned', moduleIds: [analysis.modules[0]!.id] });
    expect(overview.rootCapabilities.interactionHandlers).toBe('unavailable');
  });

  it('labels zero reach and v1 ownership honestly without dead-code conclusions', () => {
    const overview = buildArchitectureOverview(createMinimalAnalysisDocument());
    expect(overview.records[0]).toMatchObject({
      reachability: 'reached_from_supported_root',
    });
    expect(overview.moduleOwnership).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: 'unavailable' })]),
    );
    expect(JSON.stringify(overview)).not.toMatch(/dead|safe.to.delete/iu);
  });
});
