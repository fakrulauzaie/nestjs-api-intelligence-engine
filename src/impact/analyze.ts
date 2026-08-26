import { compareAnalysisDocuments } from '../comparison/compare.js';
import type { AssertionSnapshot, DiagnosticSnapshot, EndpointChange } from '../comparison/model.js';
import {
  buildAnalysisSemanticProjection,
  type AnalysisSemanticProjection,
} from '../comparison/projection.js';
import type { SemanticKey } from '../comparison/semantic-key.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type {
  ClassRecord,
  MethodRecord,
  SourceFileRecord,
  TypeOrmEntityRecord,
} from '../model/entities.js';
import {
  appendAssertionToPaths,
  assertionStep,
  buildImpactGraph,
  pathHasIncompleteTrace,
  pathsFromEndpoints,
  type ImpactGraph,
} from './graph.js';
import {
  IMPACT_CATEGORIES,
  IMPACT_SCHEMA_VERSION,
  type ImpactCategory,
  type ImpactDocument,
  type ImpactPath,
  type ImpactReason,
  type ImpactReasonCode,
  type ImpactSemanticSubject,
  type ImpactSummary,
  type ImpactedEndpoint,
  type SourceFileChange,
  type UnreachableReasonCode,
  type UnreachableSourceChange,
} from './model.js';
import { deriveSourceFileChanges } from './source-changes.js';
import { assertValidImpactDocument } from './validate.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

interface SideIndex {
  readonly graph: ImpactGraph;
  readonly sourceByPath: ReadonlyMap<string, SourceFileRecord>;
  readonly classesBySourceId: ReadonlyMap<string, readonly ClassRecord[]>;
  readonly methodsByClassId: ReadonlyMap<string, readonly MethodRecord[]>;
  readonly entitiesByClassId: ReadonlyMap<string, readonly TypeOrmEntityRecord[]>;
  readonly assertionsBySubject: ReadonlyMap<string, readonly AssertionRecord[]>;
  readonly endpointProjectionById: ReadonlyMap<
    string,
    AnalysisSemanticProjection['endpoints'][number]
  >;
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values)
    groups.set(keyOf(value), [...(groups.get(keyOf(value)) ?? []), value]);
  return groups;
}

function buildSideIndex(graph: ImpactGraph): SideIndex {
  return {
    graph,
    sourceByPath: new Map(graph.analysis.sourceFiles.map((source) => [source.path, source])),
    classesBySourceId: groupBy(graph.analysis.classes, ({ sourceFileId }) => sourceFileId),
    methodsByClassId: groupBy(graph.analysis.methods, ({ classId }) => classId),
    entitiesByClassId: groupBy(graph.analysis.entities, ({ classId }) => classId),
    assertionsBySubject: groupBy(graph.analysis.assertions, ({ subjectId }) => subjectId),
    endpointProjectionById: new Map(
      graph.projection.endpoints.map((endpoint) => [endpoint.endpointId, endpoint]),
    ),
  };
}

function sourcePathForClass(index: SideIndex, classId: string): string | null {
  const sourceClass = index.graph.analysis.classes.find(({ id }) => id === classId);
  if (sourceClass === undefined) return null;
  return (
    index.graph.analysis.sourceFiles.find(({ id }) => id === sourceClass.sourceFileId)?.path ?? null
  );
}

function subjectForId(
  index: SideIndex,
  id: string,
  keyOverride?: SemanticKey,
): ImpactSemanticSubject {
  const key = keyOverride ?? index.graph.projection.semanticKeyById.get(id);
  if (key === undefined) throw new Error(`Missing semantic subject for ${id}.`);
  const method = index.graph.analysis.methods.find((record) => record.id === id);
  if (method !== undefined) {
    return {
      kind: key.kind,
      key,
      displayName: method.qualifiedName,
      sourcePath: sourcePathForClass(index, method.classId),
    };
  }
  const sourceClass = index.graph.analysis.classes.find((record) => record.id === id);
  if (sourceClass !== undefined) {
    const source = index.graph.analysis.sourceFiles.find(
      ({ id: sourceId }) => sourceId === sourceClass.sourceFileId,
    );
    return {
      kind: key.kind,
      key,
      displayName: sourceClass.qualifiedName,
      sourcePath: source?.path ?? null,
    };
  }
  const entity = index.graph.analysis.entities.find((record) => record.id === id);
  if (entity !== undefined) {
    return {
      kind: key.kind,
      key,
      displayName: entity.displayName,
      sourcePath: sourcePathForClass(index, entity.classId),
    };
  }
  const table = index.graph.analysis.tables.find((record) => record.id === id);
  if (table !== undefined) {
    return { kind: key.kind, key, displayName: table.name, sourcePath: null };
  }
  const endpoint = index.graph.analysis.endpoints.find((record) => record.id === id);
  if (endpoint !== undefined) {
    return {
      kind: key.kind,
      key,
      displayName: `${endpoint.httpMethod} ${endpoint.path}`,
      sourcePath: null,
    };
  }
  return { kind: key.kind, key, displayName: key.encoded, sourcePath: null };
}

interface MutableReason {
  category: ImpactCategory;
  reasonCode: ImpactReasonCode;
  subject: ImpactSemanticSubject;
  sourceChangePath: string | null;
  beforeEvidenceIds: Set<string>;
  afterEvidenceIds: Set<string>;
  paths: Map<string, ImpactPath>;
}

interface MutableEndpoint {
  routeSlotKey: SemanticKey;
  httpMethod: ImpactedEndpoint['httpMethod'];
  path: string;
  beforeEndpointIds: Set<string>;
  afterEndpointIds: Set<string>;
  reasons: Map<string, MutableReason>;
}

interface ImpactAccumulator {
  readonly endpoints: Map<string, MutableEndpoint>;
  readonly indexes: Readonly<Record<'before' | 'after', SideIndex>>;
}

function pathKey(path: ImpactPath): string {
  return `${path.side}:${path.endpointId}:${path.steps.map(({ assertionId }) => assertionId).join(':')}:${path.targetKey.encoded}`;
}

function addReason(
  accumulator: ImpactAccumulator,
  input: {
    readonly category: ImpactCategory;
    readonly reasonCode: ImpactReasonCode;
    readonly subject: ImpactSemanticSubject;
    readonly sourceChangePath: string | null;
    readonly paths: readonly ImpactPath[];
    readonly beforeEvidenceIds?: readonly string[];
    readonly afterEvidenceIds?: readonly string[];
    readonly addUncertainty?: boolean;
  },
): void {
  for (const path of input.paths) {
    const index = accumulator.indexes[path.side];
    const endpoint = index.endpointProjectionById.get(path.endpointId);
    if (endpoint === undefined) continue;
    const endpointKey = endpoint.routeSlotKey.encoded;
    const mutable = accumulator.endpoints.get(endpointKey) ?? {
      routeSlotKey: endpoint.routeSlotKey,
      httpMethod: endpoint.httpMethod,
      path: endpoint.path,
      beforeEndpointIds: new Set<string>(),
      afterEndpointIds: new Set<string>(),
      reasons: new Map<string, MutableReason>(),
    };
    mutable[`${path.side}EndpointIds`].add(path.endpointId);
    const reasonKey = `${input.category}:${input.reasonCode}:${input.subject.key.encoded}:${input.sourceChangePath ?? ''}`;
    const reason = mutable.reasons.get(reasonKey) ?? {
      category: input.category,
      reasonCode: input.reasonCode,
      subject: input.subject,
      sourceChangePath: input.sourceChangePath,
      beforeEvidenceIds: new Set<string>(),
      afterEvidenceIds: new Set<string>(),
      paths: new Map<string, ImpactPath>(),
    };
    for (const id of input.beforeEvidenceIds ?? []) reason.beforeEvidenceIds.add(id);
    for (const id of input.afterEvidenceIds ?? []) reason.afterEvidenceIds.add(id);
    reason.paths.set(pathKey(path), path);
    mutable.reasons.set(reasonKey, reason);
    accumulator.endpoints.set(endpointKey, mutable);

    if (
      input.addUncertainty !== false &&
      input.category !== 'unknown_due_to_incomplete_trace' &&
      pathHasIncompleteTrace(index.graph, path)
    ) {
      addReason(accumulator, {
        category: 'unknown_due_to_incomplete_trace',
        reasonCode: 'ambiguous_or_incomplete_path',
        subject: input.subject,
        sourceChangePath: input.sourceChangePath,
        paths: [path],
        beforeEvidenceIds: input.beforeEvidenceIds ?? [],
        afterEvidenceIds: input.afterEvidenceIds ?? [],
        addUncertainty: false,
      });
    }
  }
}

function declarationEvidence(index: SideIndex, method: MethodRecord): string[] {
  return [method.declarationEvidenceId];
}

function pathsForDirectEndpoint(index: SideIndex, endpointId: string): ImpactPath[] {
  const key = index.graph.projection.semanticKeyById.get(endpointId);
  if (key === undefined) return [];
  const implementations = (index.assertionsBySubject.get(endpointId) ?? []).filter(
    ({ predicate }) => predicate === 'ENDPOINT_IMPLEMENTED_BY',
  );
  if (implementations.length === 0) {
    return [{ side: index.graph.side, endpointId, targetKey: key, steps: [] }];
  }
  return implementations.map((assertion) => {
    const step = assertionStep(index.graph, assertion);
    return {
      side: index.graph.side,
      endpointId,
      targetKey: step.toKey ?? step.fromKey,
      steps: [step],
    };
  });
}

function sourceSemanticSubjects(index: SideIndex, sourcePath: string): SemanticKey[] {
  const source = index.sourceByPath.get(sourcePath);
  if (source === undefined) return [];
  const keys: SemanticKey[] = [];
  for (const sourceClass of index.classesBySourceId.get(source.id) ?? []) {
    const classKey = index.graph.projection.semanticKeyById.get(sourceClass.id);
    if (classKey !== undefined) keys.push(classKey);
    for (const method of index.methodsByClassId.get(sourceClass.id) ?? []) {
      const key = index.graph.projection.semanticKeyById.get(method.id);
      if (key !== undefined) keys.push(key);
    }
    for (const entity of index.entitiesByClassId.get(sourceClass.id) ?? []) {
      const key = index.graph.projection.semanticKeyById.get(entity.id);
      if (key !== undefined) keys.push(key);
    }
  }
  return keys.sort((left, right) => compareStrings(left.encoded, right.encoded));
}

function processSourceSide(
  accumulator: ImpactAccumulator,
  change: SourceFileChange,
  index: SideIndex,
): boolean {
  const source = index.sourceByPath.get(change.path);
  if (source === undefined) return false;
  let reachable = false;
  for (const sourceClass of index.classesBySourceId.get(source.id) ?? []) {
    for (const method of index.methodsByClassId.get(sourceClass.id) ?? []) {
      const paths = pathsFromEndpoints(index.graph, method.id);
      if (paths.length === 0) continue;
      reachable = true;
      const directPaths = paths.filter(
        ({ steps }) => !steps.some(({ predicate }) => predicate === 'METHOD_CALLS_METHOD'),
      );
      const transitivePaths = paths.filter(({ steps }) =>
        steps.some(({ predicate }) => predicate === 'METHOD_CALLS_METHOD'),
      );
      const subject = subjectForId(index, method.id);
      const evidenceIds = declarationEvidence(index, method);
      if (directPaths.length > 0) {
        addReason(accumulator, {
          category: 'direct_endpoint_change',
          reasonCode: 'handler_file_changed',
          subject,
          sourceChangePath: change.path,
          paths: directPaths,
          ...(index.graph.side === 'before'
            ? { beforeEvidenceIds: evidenceIds }
            : { afterEvidenceIds: evidenceIds }),
        });
      }
      if (transitivePaths.length > 0) {
        addReason(accumulator, {
          category: 'reachable_method_file_change',
          reasonCode: 'changed_method_reachable',
          subject,
          sourceChangePath: change.path,
          paths: transitivePaths,
          ...(index.graph.side === 'before'
            ? { beforeEvidenceIds: evidenceIds }
            : { afterEvidenceIds: evidenceIds }),
        });
      }
    }

    for (const entity of index.entitiesByClassId.get(sourceClass.id) ?? []) {
      const mappings = (index.assertionsBySubject.get(entity.id) ?? []).filter(
        ({ predicate, objectId, status }) =>
          predicate === 'ENTITY_MAPS_TO_TABLE' &&
          objectId !== null &&
          (status === 'resolved' || status === 'ambiguous'),
      );
      for (const mapping of mappings) {
        const paths = pathsFromEndpoints(index.graph, mapping.objectId!);
        if (paths.length === 0) continue;
        reachable = true;
        addReason(accumulator, {
          category: 'entity_declaration_file_change',
          reasonCode: 'changed_entity_table_reachable',
          subject: subjectForId(index, entity.id),
          sourceChangePath: change.path,
          paths,
          ...(index.graph.side === 'before'
            ? {
                beforeEvidenceIds: [sourceClass.declarationEvidenceId, ...mapping.evidenceIds],
              }
            : { afterEvidenceIds: [sourceClass.declarationEvidenceId, ...mapping.evidenceIds] }),
        });
      }
    }
  }
  return reachable;
}

function directChangeReason(change: EndpointChange['change']): ImpactReasonCode {
  return change === 'added'
    ? 'endpoint_added'
    : change === 'removed'
      ? 'endpoint_removed'
      : 'endpoint_modified';
}

function processDirectEndpointChanges(
  accumulator: ImpactAccumulator,
  changes: readonly EndpointChange[],
): void {
  for (const change of changes) {
    if (change.change === 'modified' && !change.reasons.some((reason) => reason !== 'terminals')) {
      continue;
    }
    const paths = [
      ...(change.before === null
        ? []
        : pathsForDirectEndpoint(accumulator.indexes.before, change.before.endpointId)),
      ...(change.after === null
        ? []
        : pathsForDirectEndpoint(accumulator.indexes.after, change.after.endpointId)),
    ];
    const representative = change.before ?? change.after!;
    const subject: ImpactSemanticSubject = {
      kind: change.routeSlotKey.kind,
      key: change.routeSlotKey,
      displayName: `${representative.httpMethod} ${representative.path}`,
      sourcePath: null,
    };
    const evidenceFor = (snapshot: EndpointChange['before']): string[] =>
      snapshot === null
        ? []
        : [
            ...snapshot.handlers.flatMap(({ evidenceIds }) => evidenceIds),
            ...snapshot.directGuards.guards.flatMap(({ evidenceIds }) => evidenceIds),
            ...snapshot.effectiveGuards.guards.flatMap(({ evidenceIds }) => evidenceIds),
          ];
    addReason(accumulator, {
      category: 'direct_endpoint_change',
      reasonCode: directChangeReason(change.change),
      subject,
      sourceChangePath: null,
      paths,
      beforeEvidenceIds: evidenceFor(change.before),
      afterEvidenceIds: evidenceFor(change.after),
    });
  }
}

function uniqueProjectionAssertions(
  projection: AnalysisSemanticProjection,
): Map<string, AssertionSnapshot> {
  const groups = groupBy(projection.assertions, ({ key }) => key.encoded);
  return new Map(
    [...groups.entries()].flatMap(([key, values]) =>
      values.length === 1 ? [[key, values[0]!] as const] : [],
    ),
  );
}

function processTableAccessChanges(accumulator: ImpactAccumulator): void {
  const before = uniqueProjectionAssertions(accumulator.indexes.before.graph.projection);
  const after = uniqueProjectionAssertions(accumulator.indexes.after.graph.projection);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings);
  for (const key of keys) {
    const oldAssertion = before.get(key);
    const newAssertion = after.get(key);
    const snapshot = oldAssertion ?? newAssertion!;
    if (!['METHOD_READS_TABLE', 'METHOD_WRITES_TABLE'].includes(snapshot.predicate)) continue;
    const reasonCode: ImpactReasonCode | null =
      oldAssertion === undefined
        ? 'table_access_added'
        : newAssertion === undefined
          ? 'table_access_removed'
          : oldAssertion.status !== newAssertion.status
            ? 'table_access_status_changed'
            : null;
    if (reasonCode === null) continue;
    const sidePaths: ImpactPath[] = [];
    let subject: ImpactSemanticSubject | undefined;
    const evidence: { before: string[]; after: string[] } = { before: [], after: [] };
    for (const [side, projected] of [
      ['before', oldAssertion] as const,
      ['after', newAssertion] as const,
    ]) {
      if (projected === undefined) continue;
      const index = accumulator.indexes[side];
      const raw = index.graph.assertionsById.get(projected.assertionId);
      if (raw === undefined) continue;
      const paths = appendAssertionToPaths(
        index.graph,
        pathsFromEndpoints(index.graph, raw.subjectId),
        raw,
      );
      sidePaths.push(...paths);
      evidence[side].push(...raw.evidenceIds);
      subject ??= {
        kind: projected.key.kind,
        key: projected.key,
        displayName: projected.predicate,
        sourcePath: subjectForId(index, raw.subjectId).sourcePath,
      };
    }
    if (subject !== undefined && sidePaths.length > 0) {
      addReason(accumulator, {
        category: 'table_access_fact_change',
        reasonCode,
        subject,
        sourceChangePath: null,
        paths: sidePaths,
        beforeEvidenceIds: evidence.before,
        afterEvidenceIds: evidence.after,
      });
    }
  }
}

function pathsForResolution(index: SideIndex, assertion: AssertionRecord): ImpactPath[] {
  if (index.graph.endpointIds.has(assertion.subjectId)) {
    return appendAssertionToPaths(
      index.graph,
      pathsFromEndpoints(index.graph, assertion.subjectId),
      assertion,
    );
  }
  if (
    assertion.predicate === 'METHOD_CALLS_METHOD' ||
    assertion.predicate === 'METHOD_READS_TABLE' ||
    assertion.predicate === 'METHOD_WRITES_TABLE'
  ) {
    return appendAssertionToPaths(
      index.graph,
      pathsFromEndpoints(index.graph, assertion.subjectId),
      assertion,
    );
  }
  if (assertion.predicate === 'ENTITY_MAPS_TO_TABLE' && assertion.objectId !== null) {
    return pathsFromEndpoints(index.graph, assertion.objectId);
  }
  const sourceClass = index.graph.analysis.classes.find(({ id }) => id === assertion.subjectId);
  if (sourceClass !== undefined) {
    return (index.methodsByClassId.get(sourceClass.id) ?? []).flatMap((method) =>
      pathsFromEndpoints(index.graph, method.id),
    );
  }
  return [];
}

function processResolutionChanges(
  accumulator: ImpactAccumulator,
  changes: ReturnType<typeof compareAnalysisDocuments>['assertionStatusChanges'],
): void {
  for (const change of changes) {
    if (['METHOD_READS_TABLE', 'METHOD_WRITES_TABLE'].includes(change.before.predicate)) continue;
    const paths: ImpactPath[] = [];
    const evidence = { before: [] as string[], after: [] as string[] };
    let subject: ImpactSemanticSubject | undefined;
    for (const [side, snapshot] of [
      ['before', change.before] as const,
      ['after', change.after] as const,
    ]) {
      const index = accumulator.indexes[side];
      const assertion = index.graph.assertionsById.get(snapshot.assertionId);
      if (assertion === undefined) continue;
      paths.push(...pathsForResolution(index, assertion));
      evidence[side].push(...assertion.evidenceIds);
      subject ??= {
        kind: change.key.kind,
        key: change.key,
        displayName: snapshot.predicate,
        sourcePath: subjectForId(index, assertion.subjectId).sourcePath,
      };
    }
    if (subject !== undefined && paths.length > 0) {
      addReason(accumulator, {
        category: 'diagnostic_or_resolution_change',
        reasonCode: 'assertion_resolution_changed',
        subject,
        sourceChangePath: null,
        paths,
        beforeEvidenceIds: evidence.before,
        afterEvidenceIds: evidence.after,
      });
    }
  }
}

function diagnosticRecord(
  index: SideIndex,
  snapshot: DiagnosticSnapshot | null,
): DiagnosticRecord | undefined {
  return snapshot === null
    ? undefined
    : index.graph.analysis.diagnostics.find(({ id }) => id === snapshot.diagnosticId);
}

function diagnosticReasonCode(change: 'new' | 'resolved' | 'changed'): ImpactReasonCode {
  return change === 'new'
    ? 'diagnostic_added'
    : change === 'resolved'
      ? 'diagnostic_resolved'
      : 'diagnostic_changed';
}

function processDiagnosticChanges(
  accumulator: ImpactAccumulator,
  changes: ReturnType<typeof compareAnalysisDocuments>['diagnosticChanges'],
): void {
  for (const change of changes) {
    const oldRecord = diagnosticRecord(accumulator.indexes.before, change.before);
    const newRecord = diagnosticRecord(accumulator.indexes.after, change.after);
    const paths: ImpactPath[] = [];
    let subject: ImpactSemanticSubject | undefined;
    for (const [side, record] of [['before', oldRecord] as const, ['after', newRecord] as const]) {
      if (record?.subjectId === undefined) continue;
      const index = accumulator.indexes[side];
      paths.push(...pathsFromEndpoints(index.graph, record.subjectId));
      subject ??= {
        kind: change.key.kind,
        key: change.key,
        displayName: record.code,
        sourcePath: subjectForId(index, record.subjectId).sourcePath,
      };
    }
    if (subject !== undefined && paths.length > 0) {
      addReason(accumulator, {
        category: 'diagnostic_or_resolution_change',
        reasonCode: diagnosticReasonCode(change.change),
        subject,
        sourceChangePath: null,
        paths,
        beforeEvidenceIds: oldRecord?.evidenceIds ?? [],
        afterEvidenceIds: newRecord?.evidenceIds ?? [],
      });
    }
  }
}

function processInteractionChanges(
  accumulator: ImpactAccumulator,
  diff: ReturnType<typeof compareAnalysisDocuments>,
): void {
  for (const change of diff.interactionChanges ?? []) {
    const paths: ImpactPath[] = [];
    let subject: ImpactSemanticSubject | undefined;
    for (const [side, snapshot] of [
      ['before', change.before] as const,
      ['after', change.after] as const,
    ]) {
      if (snapshot === null) continue;
      const index = accumulator.indexes[side];
      paths.push(...pathsFromEndpoints(index.graph, snapshot.interactionId));
      subject ??= {
        kind: snapshot.key.kind,
        key: snapshot.key,
        displayName: `${snapshot.kind} ${snapshot.targetKey}`,
        sourcePath: null,
      };
    }
    if (subject !== undefined && paths.length > 0) {
      addReason(accumulator, {
        category: 'diagnostic_or_resolution_change',
        reasonCode:
          change.change === 'added'
            ? 'interaction_added'
            : change.change === 'removed'
              ? 'interaction_removed'
              : 'interaction_modified',
        subject,
        sourceChangePath: null,
        paths,
        beforeEvidenceIds: change.before?.evidenceIds ?? [],
        afterEvidenceIds: change.after?.evidenceIds ?? [],
      });
    }
  }
  for (const change of diff.interactionHandlerChanges ?? []) {
    const paths: ImpactPath[] = [];
    let subject: ImpactSemanticSubject | undefined;
    for (const [side, snapshot] of [
      ['before', change.before] as const,
      ['after', change.after] as const,
    ]) {
      if (snapshot === null) continue;
      const index = accumulator.indexes[side];
      paths.push(...pathsFromEndpoints(index.graph, snapshot.handlerId));
      subject ??= {
        kind: snapshot.key.kind,
        key: snapshot.key,
        displayName: `${snapshot.kind} handler ${snapshot.targetKey}`,
        sourcePath: null,
      };
    }
    if (subject !== undefined && paths.length > 0) {
      addReason(accumulator, {
        category: 'diagnostic_or_resolution_change',
        reasonCode:
          change.change === 'added'
            ? 'interaction_handler_added'
            : change.change === 'removed'
              ? 'interaction_handler_removed'
              : 'interaction_handler_modified',
        subject,
        sourceChangePath: null,
        paths,
        beforeEvidenceIds: change.before?.evidenceIds ?? [],
        afterEvidenceIds: change.after?.evidenceIds ?? [],
      });
    }
  }
}

function finalizeEndpoints(accumulator: ImpactAccumulator): ImpactedEndpoint[] {
  return [...accumulator.endpoints.values()]
    .map((endpoint): ImpactedEndpoint => {
      const reasons = [...endpoint.reasons.values()]
        .map(
          (reason): ImpactReason => ({
            category: reason.category,
            reasonCode: reason.reasonCode,
            subject: reason.subject,
            sourceChangePath: reason.sourceChangePath,
            beforeEvidenceIds: uniqueSorted([...reason.beforeEvidenceIds]),
            afterEvidenceIds: uniqueSorted([...reason.afterEvidenceIds]),
            paths: [...reason.paths.values()].sort((left, right) =>
              pathKey(left).localeCompare(pathKey(right)),
            ),
          }),
        )
        .sort((left, right) =>
          `${left.category}:${left.reasonCode}:${left.subject.key.encoded}:${left.sourceChangePath ?? ''}`.localeCompare(
            `${right.category}:${right.reasonCode}:${right.subject.key.encoded}:${right.sourceChangePath ?? ''}`,
          ),
        );
      return {
        routeSlotKey: endpoint.routeSlotKey,
        httpMethod: endpoint.httpMethod,
        path: endpoint.path,
        beforeEndpointIds: uniqueSorted([...endpoint.beforeEndpointIds]),
        afterEndpointIds: uniqueSorted([...endpoint.afterEndpointIds]),
        direct: reasons.some(({ category }) => category === 'direct_endpoint_change'),
        reasons,
      };
    })
    .sort((left, right) => compareStrings(left.routeSlotKey.encoded, right.routeSlotKey.encoded));
}

function buildUnreachableSourceChanges(
  sourceChanges: readonly SourceFileChange[],
  reachablePaths: ReadonlySet<string>,
  indexes: ImpactAccumulator['indexes'],
): UnreachableSourceChange[] {
  return sourceChanges
    .filter(({ path }) => !reachablePaths.has(path))
    .map((change): UnreachableSourceChange => {
      const beforeKeys = sourceSemanticSubjects(indexes.before, change.path);
      const afterKeys = sourceSemanticSubjects(indexes.after, change.path);
      const idsWithIncompleteTrace = [
        ...(indexes.before.sourceByPath.get(change.path) === undefined
          ? []
          : (indexes.before.classesBySourceId.get(
              indexes.before.sourceByPath.get(change.path)!.id,
            ) ?? [])),
        ...(indexes.after.sourceByPath.get(change.path) === undefined
          ? []
          : (indexes.after.classesBySourceId.get(indexes.after.sourceByPath.get(change.path)!.id) ??
            [])),
      ].flatMap((sourceClass) => [
        sourceClass.id,
        ...(indexes.before.methodsByClassId.get(sourceClass.id) ?? []).map(({ id }) => id),
        ...(indexes.after.methodsByClassId.get(sourceClass.id) ?? []).map(({ id }) => id),
      ]);
      const incomplete = idsWithIncompleteTrace.some(
        (id) =>
          indexes.before.graph.incompleteSubjectIds.has(id) ||
          indexes.after.graph.incompleteSubjectIds.has(id),
      );
      const reasonCodes: UnreachableReasonCode[] =
        beforeKeys.length + afterKeys.length === 0
          ? ['no_supported_declarations']
          : incomplete
            ? ['no_endpoint_path', 'incomplete_trace_may_hide_path']
            : ['no_endpoint_path'];
      return {
        path: change.path,
        change: change.change,
        beforeSubjectKeys: beforeKeys,
        afterSubjectKeys: afterKeys,
        reasonCodes,
      };
    });
}

function buildSummary(
  sourceChanges: readonly SourceFileChange[],
  endpoints: readonly ImpactedEndpoint[],
  unreachable: readonly UnreachableSourceChange[],
): ImpactSummary {
  const reasons = endpoints.flatMap(({ reasons: values }) => values);
  return {
    sourceFilesAdded: sourceChanges.filter(({ change }) => change === 'added').length,
    sourceFilesRemoved: sourceChanges.filter(({ change }) => change === 'removed').length,
    sourceFilesModified: sourceChanges.filter(({ change }) => change === 'modified').length,
    impactedEndpointSlots: endpoints.length,
    directlyChangedEndpointSlots: endpoints.filter(({ direct }) => direct).length,
    transitivelyImpactedEndpointSlots: endpoints.filter(({ reasons: values }) =>
      values.some(({ category }) =>
        ['reachable_method_file_change', 'entity_declaration_file_change'].includes(category),
      ),
    ).length,
    unreachableSourceChanges: unreachable.length,
    reasonsByCategory: Object.fromEntries(
      IMPACT_CATEGORIES.map((category) => [
        category,
        reasons.filter((reason) => reason.category === category).length,
      ]),
    ) as ImpactSummary['reasonsByCategory'],
  };
}

export function analyzePotentialImpact(
  beforeAnalysis: AnalysisDocument,
  afterAnalysis: AnalysisDocument,
): ImpactDocument {
  const beforeProjection = buildAnalysisSemanticProjection(beforeAnalysis);
  const afterProjection = buildAnalysisSemanticProjection(afterAnalysis);
  const indexes = {
    before: buildSideIndex(buildImpactGraph('before', beforeAnalysis, beforeProjection)),
    after: buildSideIndex(buildImpactGraph('after', afterAnalysis, afterProjection)),
  } as const;
  const accumulator: ImpactAccumulator = { endpoints: new Map(), indexes };
  const diff = compareAnalysisDocuments(beforeAnalysis, afterAnalysis);
  const sourceChanges = deriveSourceFileChanges(beforeAnalysis, afterAnalysis);
  const reachablePaths = new Set<string>();

  processDirectEndpointChanges(accumulator, diff.endpointChanges);
  for (const change of sourceChanges) {
    const beforeReachable = processSourceSide(accumulator, change, indexes.before);
    const afterReachable = processSourceSide(accumulator, change, indexes.after);
    if (beforeReachable || afterReachable) reachablePaths.add(change.path);
  }
  processTableAccessChanges(accumulator);
  processResolutionChanges(accumulator, diff.assertionStatusChanges);
  processDiagnosticChanges(accumulator, diff.diagnosticChanges);
  processInteractionChanges(accumulator, diff);

  const impactedEndpoints = finalizeEndpoints(accumulator);
  const unreachableSourceChanges = buildUnreachableSourceChanges(
    sourceChanges,
    reachablePaths,
    indexes,
  );
  return assertValidImpactDocument({
    schemaVersion: IMPACT_SCHEMA_VERSION,
    before: diff.before,
    after: diff.after,
    summary: buildSummary(sourceChanges, impactedEndpoints, unreachableSourceChanges),
    sourceChanges,
    impactedEndpoints,
    unreachableSourceChanges,
  });
}
