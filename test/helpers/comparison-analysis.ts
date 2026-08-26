import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisDocument,
  type AssertionRecord,
  type AssertionStatus,
  type ClassRecord,
  type DiagnosticRecord,
  type DiagnosticSeverity,
  type EndpointRecord,
  type EvidenceRecord,
  type GuardRecord,
  type HttpMethod,
  type MethodRecord,
  type SourceFileRecord,
  type TableRecord,
} from '../../src/model/index.js';
import { hashContent } from '../../src/model/hashing.js';
import { createStableId } from '../../src/model/ids.js';

type SnapshotVariant = 'before' | 'after';

function stableId(
  kind: Parameters<typeof createStableId>[0],
  revision: string,
  identity: string,
): string {
  return createStableId(kind, [revision, identity]);
}

export function createComparisonAnalysisSnapshot(variant: SnapshotVariant): AnalysisDocument {
  const revision = `phase13-${variant}`;
  const sourceText = `// Phase 13 ${variant} comparison fixture\n// declarations and evidence anchors\n`;
  const contentHash = hashContent(sourceText);
  const sourceDefinitions = [
    ['controller', 'src/notes.controller.ts'],
    ['service', 'src/notes.service.ts'],
    ['guard', 'src/audit.guard.ts'],
  ] as const;
  const sourceFiles: SourceFileRecord[] = sourceDefinitions.map(([name, path]) => ({
    id: stableId('source', revision, name),
    path,
    contentHash,
    byteLength: Buffer.byteLength(sourceText),
  }));
  const sourceByName = new Map(
    sourceDefinitions.map(([name], index) => [name, sourceFiles[index]!] as const),
  );
  const evidenceById = new Map<string, EvidenceRecord>();
  let nextLine = 1;
  const evidence = (
    sourceName: (typeof sourceDefinitions)[number][0],
    role: EvidenceRecord['role'],
    identity: string,
    fixedLine?: number,
  ): EvidenceRecord => {
    const source = sourceByName.get(sourceName)!;
    const line = fixedLine ?? nextLine;
    const record: EvidenceRecord = {
      id: stableId('evidence', revision, identity),
      fileId: source.id,
      startLine: line,
      startColumn: 1,
      endLine: line,
      endColumn: 8,
      role,
      snippet: identity,
      contentHash,
    };
    if (fixedLine === undefined) nextLine += 1;
    evidenceById.set(record.id, record);
    return record;
  };

  const classDefinitions = [
    {
      name: 'NotesController',
      source: 'controller' as const,
      roles: ['controller'] as const,
    },
    { name: 'NotesService', source: 'service' as const, roles: ['provider'] as const },
    { name: 'AuditGuard', source: 'guard' as const, roles: ['guard'] as const },
  ];
  const classes: ClassRecord[] = classDefinitions.map((definition) => {
    const declaration = evidence(definition.source, 'declaration', `class-${definition.name}`);
    return {
      id: stableId('class', revision, definition.name),
      sourceFileId: sourceByName.get(definition.source)!.id,
      qualifiedName: definition.name,
      displayName: definition.name,
      roles: definition.roles,
      declarationEvidenceId: declaration.id,
    };
  });
  const classByName = new Map(classes.map((record) => [record.displayName, record]));
  const methods: MethodRecord[] = [];
  const addMethod = (className: string, name: string, signature: string): MethodRecord => {
    const source = className === 'NotesController' ? 'controller' : 'service';
    const declaration = evidence(source, 'declaration', `method-${className}-${name}`);
    const method: MethodRecord = {
      id: stableId('method', revision, `${className}.${name}`),
      classId: classByName.get(className)!.id,
      qualifiedName: `${className}.${name}`,
      displayName: name,
      signature,
      declarationEvidenceId: declaration.id,
    };
    methods.push(method);
    return method;
  };

  const getHandler = addMethod(
    'NotesController',
    variant === 'before' ? 'list' : 'findAll',
    `${variant === 'before' ? 'list' : 'findAll'}(): string[]`,
  );
  const createHandler = addMethod('NotesController', 'create', 'create(title: string): string');
  const removeHandler = addMethod('NotesController', 'remove', 'remove(id: string): string');
  const detailHandler =
    variant === 'before'
      ? addMethod('NotesController', 'findOne', 'findOne(id: string): string')
      : addMethod('NotesController', 'update', 'update(id: string): string');

  const tables: TableRecord[] = [
    {
      id: createStableId('table', ['note']),
      name: 'note',
      nameSource: 'default_lowercase_class_name',
    },
    {
      id: createStableId('table', ['audit_log']),
      name: 'audit_log',
      nameSource: 'explicit',
    },
  ];
  const tableByName = new Map(tables.map((table) => [table.name, table]));
  const endpoints: EndpointRecord[] = [];
  const assertions: AssertionRecord[] = [];
  const addEndpoint = (
    httpMethod: HttpMethod,
    path: string,
    handler: MethodRecord,
  ): EndpointRecord => {
    const endpoint: EndpointRecord = {
      id: stableId('endpoint', revision, `${httpMethod}:${path}:${handler.qualifiedName}`),
      httpMethod,
      path,
    };
    endpoints.push(endpoint);
    const routeEvidence = evidence('controller', 'decorator', `route-${httpMethod}-${path}`);
    assertions.push({
      id: stableId('assertion', revision, `implementation-${httpMethod}-${path}`),
      subjectId: endpoint.id,
      predicate: 'ENDPOINT_IMPLEMENTED_BY',
      objectId: handler.id,
      status: 'resolved',
      ruleId: 'nest.route.standard.v1',
      evidenceIds: [routeEvidence.id, handler.declarationEvidenceId],
    });
    return endpoint;
  };

  addEndpoint('GET', '/notes', getHandler);
  const postEndpoint = addEndpoint('POST', '/notes', createHandler);
  addEndpoint('DELETE', variant === 'before' ? '/notes/:id' : '/notes/:noteId', removeHandler);
  addEndpoint(variant === 'before' ? 'GET' : 'PATCH', '/notes/:id', detailHandler);

  const addTableAccess = (
    identity: string,
    method: MethodRecord,
    predicate: Extract<AssertionRecord['predicate'], 'METHOD_READS_TABLE' | 'METHOD_WRITES_TABLE'>,
    tableName: string,
    status: AssertionStatus,
  ): void => {
    const callEvidence = evidence('controller', 'call_site', identity);
    assertions.push({
      id: stableId('assertion', revision, identity),
      subjectId: method.id,
      predicate,
      objectId: tableByName.get(tableName)!.id,
      status,
      ruleId:
        predicate === 'METHOD_READS_TABLE'
          ? 'typeorm.repository.find.v1'
          : 'typeorm.repository.insert.v1',
      evidenceIds: [callEvidence.id],
    });
  };
  addTableAccess(
    'get-terminal',
    getHandler,
    'METHOD_READS_TABLE',
    variant === 'before' ? 'note' : 'audit_log',
    'resolved',
  );
  addTableAccess(
    'post-terminal',
    createHandler,
    'METHOD_WRITES_TABLE',
    'note',
    variant === 'before' ? 'ambiguous' : 'resolved',
  );

  const guards: GuardRecord[] = [];
  if (variant === 'after') {
    const guardClass = classByName.get('AuditGuard')!;
    const guard: GuardRecord = {
      id: stableId('guard', revision, 'AuditGuard'),
      classId: guardClass.id,
      displayName: 'AuditGuard',
    };
    guards.push(guard);
    const guardEvidence = evidence('controller', 'decorator', 'post-audit-guard');
    assertions.push({
      id: stableId('assertion', revision, 'post-audit-guard'),
      subjectId: postEndpoint.id,
      predicate: 'ENDPOINT_USES_GUARD',
      objectId: guard.id,
      status: 'resolved',
      ruleId: 'nest.guard.method.v1',
      evidenceIds: [guardEvidence.id],
    });
  }

  const diagnostics: DiagnosticRecord[] = [];
  const addDiagnostic = (input: {
    identity: string;
    code: DiagnosticRecord['code'];
    severity: DiagnosticSeverity;
    message: string;
    subjectId?: string;
    withEvidence?: boolean;
  }): void => {
    const diagnosticEvidence =
      input.withEvidence === true
        ? evidence(
            'controller',
            'call_site',
            `diagnostic-${input.identity}`,
            input.identity === 'stable-changed' ? 90 : 91,
          )
        : undefined;
    diagnostics.push({
      id: stableId('diagnostic', revision, input.identity),
      code: input.code,
      severity: input.severity,
      message: input.message,
      ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
      evidenceIds: diagnosticEvidence === undefined ? [] : [diagnosticEvidence.id],
    });
  };
  addDiagnostic({
    identity: 'stable-changed',
    code: 'CALL_TARGET_UNRESOLVED',
    severity: variant === 'before' ? 'info' : 'warning',
    message: variant === 'before' ? 'Call target needs review.' : 'Call target remains unresolved.',
    subjectId: createHandler.id,
    withEvidence: true,
  });
  if (variant === 'before') {
    addDiagnostic({
      identity: 'resolved-global',
      code: 'AUTH_GLOBAL_POLICY_UNKNOWN',
      severity: 'info',
      message: 'Global authentication policy is unknown.',
    });
  } else {
    addDiagnostic({
      identity: 'new-save-gap',
      code: 'TYPEORM_SAVE_COLUMNS_UNKNOWN',
      severity: 'warning',
      message: 'Save columns are unknown.',
      subjectId: createHandler.id,
      withEvidence: true,
    });
  }

  const configuration = {
    maxCallDepth: 3,
    maxSourceFileBytes: 1_048_576,
    evidenceSnippetLimit: 240,
  } as const;
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    resultState: 'completed_with_gaps',
    analysisRun: {
      id: stableId('analysis', revision, 'run'),
      repositoryRevision: revision,
      tsconfigPath: 'tsconfig.json',
      tool: { name: 'api-intel', version: '0.1.0', typescriptVersion: '5.9.3' },
      configuration,
    },
    sourceFiles,
    classes,
    methods,
    endpoints,
    guards,
    repositoryBindings: [],
    entities: [],
    tables,
    assertions,
    evidence: [...evidenceById.values()],
    diagnostics,
  };
}
