import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type {
  ClassRecord,
  ClassRole,
  MethodRecord,
  RawSqlAnalysisConfiguration,
  TableRecord,
} from '../model/entities.js';
import type { EvidenceRecord, EvidenceRole } from '../model/evidence.js';
import { makeAssertionId, makeTableId } from '../model/ids.js';
import type { SqlDialectAdapter, SqlTableAccess } from '../sql/dialect-adapter.js';
import { postgresql18TableAccessAdapter } from '../sql/postgresql-table-access.js';
import { resolveSimpleString } from '../ts-index/constants.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import { resolveAliasedSymbol, symbolDeclarationFile } from '../ts-index/symbols.js';
import {
  createClassRecord,
  createDeclarationEvidence,
  createMethodRecord,
} from './canonical-records.js';
import { declarationBelongsToPackage, isPackageDecorator } from './package-symbols.js';

export const TYPEORM_RAW_SQL_RULE_IDS = {
  selectRead: 'typeorm.raw-sql.select.read.v1',
  insertWrite: 'typeorm.raw-sql.insert.write.v1',
  updateRead: 'typeorm.raw-sql.update.read.v1',
  updateWrite: 'typeorm.raw-sql.update.write.v1',
  deleteRead: 'typeorm.raw-sql.delete.read.v1',
  deleteWrite: 'typeorm.raw-sql.delete.write.v1',
} as const;

const NEST_COMMON_MODULE = '@nestjs/common';
const TYPEORM_MODULE = 'typeorm';
const TYPEORM_RAW_SQL_RECEIVERS = new Set([
  'Repository',
  'DataSource',
  'EntityManager',
  'QueryRunner',
]);

interface LocatedClass {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
}

interface LocatedMethod extends LocatedClass {
  readonly method: IndexedMethod;
}

interface RawSqlCandidate extends LocatedMethod {
  readonly node: ts.CallExpression | ts.TaggedTemplateExpression;
  readonly receiver: ts.Expression;
  readonly sqlSource:
    | { readonly kind: 'call'; readonly expression: ts.Expression | undefined }
    | { readonly kind: 'tag'; readonly template: ts.TemplateLiteral };
}

type ReceiverResolution = 'ignored' | 'ambiguous' | 'resolved';

interface SqlSourceResolution {
  readonly status: 'resolved' | 'unsupported';
  readonly sql?: string | undefined;
  readonly message?: string | undefined;
  readonly evidenceNodes: readonly ts.Node[];
}

export interface TypeOrmRawSqlExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly tables: readonly TableRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

function ownerRoles(located: LocatedClass): readonly ClassRole[] {
  const isController = located.indexedClass.decorators.some((decorator) =>
    isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Controller'),
  );
  const isProvider = located.indexedClass.decorators.some((decorator) =>
    isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Injectable'),
  );
  return [
    ...(isController ? (['controller'] as const) : []),
    ...(isProvider ? (['provider'] as const) : []),
  ];
}

function isNestedThisBoundary(node: ts.Node): boolean {
  return ts.isFunctionLike(node) && !ts.isArrowFunction(node);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function resolveTaggedTemplate(template: ts.TemplateLiteral): SqlSourceResolution {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return { status: 'resolved', sql: template.text, evidenceNodes: [template] };
  }
  let sql = template.head.text;
  const evidenceNodes: ts.Node[] = [template];
  for (const [index, span] of template.templateSpans.entries()) {
    const expression = unwrapExpression(span.expression);
    evidenceNodes.push(span.expression);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      return {
        status: 'unsupported',
        message:
          'Function-wrapped tagged-template fragments may alter identifiers or SQL structure and are unsupported.',
        evidenceNodes,
      };
    }
    sql += `$${index + 1}${span.literal.text}`;
  }
  return { status: 'resolved', sql, evidenceNodes };
}

function sourceForCandidate(
  candidate: RawSqlCandidate,
  checker: ts.TypeChecker,
): SqlSourceResolution {
  if (candidate.sqlSource.kind === 'tag') {
    return resolveTaggedTemplate(candidate.sqlSource.template);
  }
  if (candidate.sqlSource.expression === undefined) {
    return {
      status: 'unsupported',
      message: 'TypeORM query() has no SQL source argument.',
      evidenceNodes: [candidate.node],
    };
  }
  const resolved = resolveSimpleString(candidate.sqlSource.expression, checker);
  if (resolved.status === 'resolved') {
    return { status: 'resolved', sql: resolved.value, evidenceNodes: resolved.evidenceNodes };
  }
  return {
    status: 'unsupported',
    message: `TypeORM query() SQL is outside the static literal or one-hop const boundary (${resolved.reason}).`,
    evidenceNodes: resolved.evidenceNodes,
  };
}

function ruleIdFor(access: SqlTableAccess): string {
  if (access.statementKind === 'select') return TYPEORM_RAW_SQL_RULE_IDS.selectRead;
  if (access.statementKind === 'insert' && access.direction === 'read') {
    return TYPEORM_RAW_SQL_RULE_IDS.selectRead;
  }
  const key = `${access.statementKind}${access.direction === 'read' ? 'Read' : 'Write'}` as
    | 'insertWrite'
    | 'updateRead'
    | 'updateWrite'
    | 'deleteRead'
    | 'deleteWrite';
  return TYPEORM_RAW_SQL_RULE_IDS[key];
}

function diagnosticCodeForFailure(
  kind: 'limit_exceeded' | 'parse_failed' | 'unsupported_statement',
): DiagnosticCode {
  switch (kind) {
    case 'limit_exceeded':
      return 'TYPEORM_RAW_SQL_LIMIT_EXCEEDED';
    case 'parse_failed':
      return 'TYPEORM_RAW_SQL_PARSE_FAILED';
    case 'unsupported_statement':
      return 'TYPEORM_RAW_SQL_STATEMENT_UNSUPPORTED';
  }
}

function adapterFor(configuration: RawSqlAnalysisConfiguration): SqlDialectAdapter | null {
  if (
    configuration.dialect === postgresql18TableAccessAdapter.dialect &&
    configuration.parserName === postgresql18TableAccessAdapter.parserName &&
    configuration.parserVersion === postgresql18TableAccessAdapter.parserVersion
  ) {
    return postgresql18TableAccessAdapter;
  }
  return null;
}

export async function extractTypeOrmRawSql(input: {
  sourceIndex: SourceIndex;
  checker: ts.TypeChecker;
  repositoryRevision: string | null;
  evidenceSnippetLimit: number;
  configuration?: RawSqlAnalysisConfiguration | undefined;
  signal?: AbortSignal | undefined;
}): Promise<TypeOrmRawSqlExtraction> {
  const locatedClasses: LocatedClass[] = [];
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) locatedClasses.push({ source, indexedClass });
  }

  const evidenceById = new Map<string, EvidenceRecord>();
  const classById = new Map<string, ClassRecord>();
  const methodById = new Map<string, MethodRecord>();
  const tableById = new Map<string, TableRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const diagnostics: DiagnosticRecord[] = [];

  const addEvidence = (record: EvidenceRecord): string => {
    evidenceById.set(record.id, record);
    return record.id;
  };

  const evidenceForNode = (located: LocatedClass, node: ts.Node, role: EvidenceRole): string =>
    addEvidence(
      createEvidenceForNode({
        sourceFile: located.source.sourceFile,
        sourceFileRecord: located.source.inventorySource.record,
        node,
        role,
        snippetLimit: input.evidenceSnippetLimit,
      }),
    );

  const ensureMethod = (located: LocatedMethod): MethodRecord => {
    const classDeclarationEvidenceId = addEvidence(
      createDeclarationEvidence(
        located.source,
        located.indexedClass.node,
        input.evidenceSnippetLimit,
      ),
    );
    const classCandidate = createClassRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId: classDeclarationEvidenceId,
      roles: ownerRoles(located),
    });
    classById.set(classCandidate.id, classCandidate);
    const declarationEvidenceId = addEvidence(
      createDeclarationEvidence(located.source, located.method.node, input.evidenceSnippetLimit),
    );
    const candidate = createMethodRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      method: located.method,
      classId: classCandidate.id,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId,
    });
    const existing = methodById.get(candidate.id);
    if (existing !== undefined) return existing;
    methodById.set(candidate.id, candidate);
    return candidate;
  };

  const receiverResolution = (receiver: ts.Expression): ReceiverResolution => {
    const type = input.checker.getTypeAtLocation(receiver);
    const members = type.isUnion() ? type.types : [type];
    let recognized = 0;
    let other = 0;
    for (const member of members) {
      if ((member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) continue;
      const symbol = resolveAliasedSymbol(input.checker, member.aliasSymbol ?? member.getSymbol());
      if (
        symbol !== null &&
        TYPEORM_RAW_SQL_RECEIVERS.has(symbol.getName()) &&
        declarationBelongsToPackage(symbolDeclarationFile(symbol), TYPEORM_MODULE)
      ) {
        recognized += 1;
      } else {
        other += 1;
      }
    }
    if (recognized === 0) return 'ignored';
    return other === 0 ? 'resolved' : 'ambiguous';
  };

  const candidates: RawSqlCandidate[] = [];
  for (const located of locatedClasses) {
    for (const method of located.indexedClass.methods) {
      const body = method.node.body;
      if (body === undefined) continue;
      const visit = (node: ts.Node): void => {
        if (node !== body && isNestedThisBoundary(node)) return;
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'query'
        ) {
          candidates.push({
            ...located,
            method,
            node,
            receiver: node.expression.expression,
            sqlSource: { kind: 'call', expression: node.arguments[0] },
          });
        } else if (
          ts.isTaggedTemplateExpression(node) &&
          ts.isPropertyAccessExpression(node.tag) &&
          node.tag.name.text === 'sql'
        ) {
          candidates.push({
            ...located,
            method,
            node,
            receiver: node.tag.expression,
            sqlSource: { kind: 'tag', template: node.template },
          });
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
    }
  }

  for (const candidate of candidates) {
    input.signal?.throwIfAborted();
    const receiver = receiverResolution(candidate.receiver);
    if (receiver === 'ignored') continue;
    const method = ensureMethod(candidate);
    const callEvidenceId = evidenceForNode(candidate, candidate.node, 'call_site');
    const receiverEvidenceId = evidenceForNode(candidate, candidate.receiver, 'resolution_basis');
    if (receiver === 'ambiguous') {
      diagnostics.push(
        createDiagnostic({
          code: 'TYPEORM_RAW_SQL_RECEIVER_AMBIGUOUS',
          subjectId: method.id,
          message:
            'The raw-SQL receiver has both TypeORM and non-TypeORM possibilities; no SQL fact was emitted.',
          evidenceIds: [callEvidenceId, receiverEvidenceId],
        }),
      );
      continue;
    }
    if (input.configuration === undefined) {
      diagnostics.push(
        createDiagnostic({
          code: 'TYPEORM_RAW_SQL_DIALECT_UNSELECTED',
          subjectId: method.id,
          message:
            'A TypeORM raw-SQL call was proven, but raw-SQL extraction requires an explicit postgresql-18 dialect selection.',
          evidenceIds: [callEvidenceId, receiverEvidenceId],
        }),
      );
      continue;
    }
    const adapter = adapterFor(input.configuration);
    if (adapter === null) {
      diagnostics.push(
        createDiagnostic({
          code: 'TYPEORM_RAW_SQL_DIALECT_UNSELECTED',
          subjectId: method.id,
          message: 'The configured raw-SQL dialect/parser combination is not supported.',
          evidenceIds: [callEvidenceId, receiverEvidenceId],
        }),
      );
      continue;
    }
    const source = sourceForCandidate(candidate, input.checker);
    const sourceEvidenceIds = source.evidenceNodes.map((node) =>
      evidenceForNode(candidate, node, 'resolution_basis'),
    );
    if (source.status === 'unsupported' || source.sql === undefined) {
      diagnostics.push(
        createDiagnostic({
          code: 'TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED',
          subjectId: method.id,
          message: source.message ?? 'The raw-SQL source is unsupported.',
          evidenceIds: [callEvidenceId, receiverEvidenceId, ...sourceEvidenceIds],
        }),
      );
      continue;
    }
    const parsed = await adapter.analyze(source.sql, input.configuration, input.signal);
    if (parsed.status === 'failed') {
      diagnostics.push(
        createDiagnostic({
          code: diagnosticCodeForFailure(parsed.kind),
          subjectId: method.id,
          message: parsed.message,
          evidenceIds: [callEvidenceId, receiverEvidenceId, ...sourceEvidenceIds],
        }),
      );
      continue;
    }
    for (const access of parsed.accesses) {
      const table: TableRecord = {
        id: makeTableId(access.tableName, 'raw_sql_literal'),
        name: access.tableName,
        nameSource: 'raw_sql_literal',
      };
      tableById.set(table.id, table);
      const predicate = access.direction === 'read' ? 'METHOD_READS_TABLE' : 'METHOD_WRITES_TABLE';
      const ruleId = ruleIdFor(access);
      const assertion: AssertionRecord = {
        id: makeAssertionId({
          subjectId: method.id,
          predicate,
          objectId: table.id,
          ruleId,
        }),
        subjectId: method.id,
        predicate,
        objectId: table.id,
        status: 'resolved',
        ruleId,
        evidenceIds: [...new Set([callEvidenceId, receiverEvidenceId, ...sourceEvidenceIds])],
      };
      const existing = assertionById.get(assertion.id);
      assertionById.set(
        assertion.id,
        existing === undefined
          ? assertion
          : {
              ...existing,
              evidenceIds: [...new Set([...existing.evidenceIds, ...assertion.evidenceIds])],
            },
      );
    }
  }

  return {
    classes: [...classById.values()],
    methods: [...methodById.values()],
    tables: [...tableById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics,
  };
}
