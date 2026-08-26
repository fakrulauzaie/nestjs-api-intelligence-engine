import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisDocument,
  type AssertionRecord,
  type ClassRecord,
  type DiagnosticRecord,
  type EndpointRecord,
  type EvidenceRecord,
  type MethodRecord,
  type SourceFileRecord,
  type TypeOrmEntityRecord,
} from '../../src/model/index.js';
import { assertValidAnalysisDocument } from '../../src/evidence/validate.js';
import { hashContent } from '../../src/model/hashing.js';
import { createStableId } from '../../src/model/ids.js';

type ImpactFixtureSide = 'before' | 'after';

export interface ImpactFixtureOptions {
  readonly callers?: readonly ('first' | 'second')[];
  readonly includeCycle?: boolean;
  readonly includeIncompleteDiagnostic?: boolean;
  readonly includeTableAccess?: boolean;
  readonly tableAccessStatus?: AssertionRecord['status'];
  readonly unusedPath?: string;
}

function id(kind: Parameters<typeof createStableId>[0], revision: string, name: string): string {
  return createStableId(kind, [revision, name]);
}

export function createImpactAnalysisSnapshot(
  side: ImpactFixtureSide,
  options: ImpactFixtureOptions = {},
): AnalysisDocument {
  const revision = `phase14-${side}`;
  const callers = options.callers ?? ['first', 'second'];
  const sourceDefinitions = [
    { name: 'controller', path: 'src/example.controller.ts', text: '// stable controller\n' },
    { name: 'service', path: 'src/shared.service.ts', text: `// changed service ${side}\n` },
    {
      name: 'unused',
      path: options.unusedPath ?? 'src/unused.service.ts',
      text: `// changed unused ${side}\n`,
    },
    { name: 'entity', path: 'src/note.entity.ts', text: `// changed entity ${side}\n` },
  ] as const;
  const sourceFiles: SourceFileRecord[] = sourceDefinitions.map((source) => ({
    id: id('source', revision, source.name),
    path: source.path,
    contentHash: hashContent(source.text),
    byteLength: Buffer.byteLength(source.text),
  }));
  const sourceByName = new Map(
    sourceDefinitions.map((definition, index) => [definition.name, sourceFiles[index]!] as const),
  );
  const evidenceRecords: EvidenceRecord[] = [];
  let line = 1;
  const evidence = (
    sourceName: (typeof sourceDefinitions)[number]['name'],
    role: EvidenceRecord['role'],
    name: string,
  ): EvidenceRecord => {
    const source = sourceByName.get(sourceName)!;
    const record: EvidenceRecord = {
      id: id('evidence', revision, name),
      fileId: source.id,
      startLine: line,
      startColumn: 1,
      endLine: line,
      endColumn: 8,
      role,
      snippet: name,
      contentHash: source.contentHash,
    };
    line += 1;
    evidenceRecords.push(record);
    return record;
  };

  const classDefinitions = [
    { name: 'ExampleController', source: 'controller' as const, roles: ['controller'] as const },
    { name: 'SharedService', source: 'service' as const, roles: ['provider'] as const },
    { name: 'UnusedService', source: 'unused' as const, roles: ['provider'] as const },
    { name: 'Note', source: 'entity' as const, roles: ['entity'] as const },
  ];
  const classes: ClassRecord[] = classDefinitions.map((definition) => ({
    id: id('class', revision, definition.name),
    sourceFileId: sourceByName.get(definition.source)!.id,
    qualifiedName: definition.name,
    displayName: definition.name,
    roles: definition.roles,
    declarationEvidenceId: evidence(definition.source, 'declaration', `class-${definition.name}`)
      .id,
  }));
  const classByName = new Map(classes.map((sourceClass) => [sourceClass.displayName, sourceClass]));
  const methods: MethodRecord[] = [];
  const addMethod = (
    className: 'ExampleController' | 'SharedService' | 'UnusedService',
    name: string,
    source: 'controller' | 'service' | 'unused',
  ): MethodRecord => {
    const method: MethodRecord = {
      id: id('method', revision, `${className}.${name}`),
      classId: classByName.get(className)!.id,
      qualifiedName: `${className}.${name}`,
      displayName: name,
      signature: `${name}(): string`,
      declarationEvidenceId: evidence(source, 'declaration', `method-${className}-${name}`).id,
    };
    methods.push(method);
    return method;
  };
  const first = addMethod('ExampleController', 'first', 'controller');
  const second = addMethod('ExampleController', 'second', 'controller');
  const sharedWork = addMethod('SharedService', 'work', 'service');
  addMethod('UnusedService', 'work', 'unused');

  const endpoints: EndpointRecord[] = [];
  const assertions: AssertionRecord[] = [];
  const addEndpoint = (name: 'first' | 'second', method: MethodRecord): void => {
    const endpoint: EndpointRecord = {
      id: id('endpoint', revision, name),
      httpMethod: 'GET',
      path: `/${name}`,
    };
    endpoints.push(endpoint);
    const routeEvidence = evidence('controller', 'decorator', `route-${name}`);
    assertions.push({
      id: id('assertion', revision, `handler-${name}`),
      subjectId: endpoint.id,
      predicate: 'ENDPOINT_IMPLEMENTED_BY',
      objectId: method.id,
      status: 'resolved',
      ruleId: 'nest.route.standard.v1',
      evidenceIds: [routeEvidence.id, method.declarationEvidenceId],
    });
  };
  addEndpoint('first', first);
  addEndpoint('second', second);

  for (const [name, method] of [['first', first] as const, ['second', second] as const]) {
    if (!callers.includes(name)) continue;
    assertions.push({
      id: id('assertion', revision, `call-${name}`),
      subjectId: method.id,
      predicate: 'METHOD_CALLS_METHOD',
      objectId: sharedWork.id,
      status: 'resolved',
      ruleId: 'ts.direct-bound-member-call.v1',
      evidenceIds: [evidence('controller', 'call_site', `call-${name}`).id],
    });
  }

  if (options.includeCycle !== false) {
    assertions.push({
      id: id('assertion', revision, 'service-cycle'),
      subjectId: sharedWork.id,
      predicate: 'METHOD_CALLS_METHOD',
      objectId: sharedWork.id,
      status: 'resolved',
      ruleId: 'ts.direct-bound-member-call.v1',
      evidenceIds: [evidence('service', 'call_site', 'service-cycle').id],
    });
  }

  const tableId = createStableId('table', ['note']);
  if (options.includeTableAccess !== false) {
    assertions.push({
      id: id('assertion', revision, 'read-note'),
      subjectId: sharedWork.id,
      predicate: 'METHOD_READS_TABLE',
      objectId: tableId,
      status: options.tableAccessStatus ?? 'resolved',
      ruleId: 'typeorm.repository.find.v1',
      evidenceIds: [evidence('service', 'call_site', 'read-note').id],
    });
  }
  const entity: TypeOrmEntityRecord = {
    id: id('entity', revision, 'Note'),
    classId: classByName.get('Note')!.id,
    displayName: 'Note',
  };
  assertions.push({
    id: id('assertion', revision, 'entity-note-table'),
    subjectId: entity.id,
    predicate: 'ENTITY_MAPS_TO_TABLE',
    objectId: tableId,
    status: 'resolved',
    ruleId: 'typeorm.entity.table.v1',
    evidenceIds: [evidence('entity', 'decorator', 'entity-note-table').id],
  });

  const diagnostics: DiagnosticRecord[] = [];
  if (options.includeIncompleteDiagnostic !== false) {
    diagnostics.push({
      id: id('diagnostic', revision, 'depth-limit'),
      code: 'CALL_DEPTH_LIMIT',
      severity: 'warning',
      message: 'Fixture trace reached its configured depth.',
      subjectId: sharedWork.id,
      evidenceIds: [evidence('service', 'call_site', 'depth-limit').id],
    });
  }

  return assertValidAnalysisDocument({
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    resultState: diagnostics.length === 0 ? 'completed' : 'completed_with_gaps',
    analysisRun: {
      id: id('analysis', revision, 'run'),
      repositoryRevision: revision,
      tsconfigPath: 'tsconfig.json',
      tool: { name: 'api-intel', version: '0.1.0', typescriptVersion: '5.9.3' },
      configuration: {
        maxCallDepth: 3,
        maxSourceFileBytes: 1_048_576,
        evidenceSnippetLimit: 240,
      },
    },
    sourceFiles,
    classes,
    methods,
    endpoints,
    guards: [],
    repositoryBindings: [],
    entities: [entity],
    tables: [{ id: tableId, name: 'note', nameSource: 'default_lowercase_class_name' }],
    assertions,
    evidence: evidenceRecords,
    diagnostics,
  });
}
