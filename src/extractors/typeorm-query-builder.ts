import ts from 'typescript';
import type { DiagnosticCode } from '../model/diagnostics.js';
import type { TableRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';

export const TYPEORM_QUERY_BUILDER_SELECT_RULE_ID = 'typeorm.query-builder.select.v1';
export const TYPEORM_QUERY_BUILDER_JOIN_RULE_ID = 'typeorm.query-builder.join.v1';
export const TYPEORM_QUERY_BUILDER_INSERT_RULE_ID = 'typeorm.query-builder.insert.v1';
export const TYPEORM_QUERY_BUILDER_UPDATE_RULE_ID = 'typeorm.query-builder.update.v1';
export const TYPEORM_QUERY_BUILDER_DELETE_RULE_ID = 'typeorm.query-builder.delete.v1';

const READ_TERMINALS = new Set([
  'getOne',
  'getMany',
  'getRawOne',
  'getRawMany',
  'getCount',
  'stream',
]);
const INSPECTION_TERMINALS = new Set(['getSql', 'getQuery']);
const PASSTHROUGH_OPERATIONS = new Set([
  'select',
  'addSelect',
  'where',
  'andWhere',
  'orWhere',
  'having',
  'andHaving',
  'orHaving',
  'orderBy',
  'addOrderBy',
  'groupBy',
  'addGroupBy',
  'limit',
  'offset',
  'skip',
  'take',
  'distinct',
  'setParameter',
  'setParameters',
  'values',
  'set',
  'returning',
]);
const JOIN_OPERATIONS = new Set([
  'leftJoin',
  'innerJoin',
  'leftJoinAndSelect',
  'innerJoinAndSelect',
]);

type QueryBuilderDiagnosticCode = Extract<
  DiagnosticCode,
  | 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS'
  | 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED'
  | 'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED'
  | 'TYPEORM_QUERY_BUILDER_TERMINAL_MISSING'
>;

export type QueryBuilderRootKind = 'repository' | 'data_source' | 'entity_manager';
export type QueryBuilderKind = 'select' | 'insert' | 'update' | 'delete';

export interface QueryBuilderTableTarget {
  readonly table: TableRecord;
  readonly status: 'resolved' | 'ambiguous';
  readonly evidenceIds: readonly string[];
  readonly source: 'repository' | 'entity' | 'literal' | 'join';
}

export type QueryBuilderRootResolution =
  | { readonly status: 'ignored' }
  | {
      readonly status: 'ambiguous';
      readonly message: string;
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly status: 'resolved';
      readonly kind: QueryBuilderRootKind;
      readonly tables: readonly QueryBuilderTableTarget[];
      readonly evidenceIds: readonly string[];
    };

export type QueryBuilderTargetResolution =
  | {
      readonly status: 'resolved' | 'ambiguous';
      readonly targets: readonly QueryBuilderTableTarget[];
      readonly evidenceIds: readonly string[];
      readonly message?: string | undefined;
    }
  | {
      readonly status: 'unresolved' | 'unsupported';
      readonly targets: readonly [];
      readonly evidenceIds: readonly string[];
      readonly message: string;
    };

export interface QueryBuilderAccess {
  readonly direction: 'read' | 'write';
  readonly table: TableRecord;
  readonly status: 'resolved' | 'ambiguous';
  readonly ruleId: string;
  readonly evidenceIds: readonly string[];
}

export interface QueryBuilderWriteSink {
  readonly kind: 'query_builder_insert' | 'query_builder_update';
  readonly valueExpression: ts.Expression;
  readonly table: TableRecord;
  readonly status: 'resolved' | 'ambiguous';
  readonly operationEvidenceId: string;
  readonly evidenceIds: readonly string[];
}

export interface QueryBuilderDiagnostic {
  readonly code: QueryBuilderDiagnosticCode;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

export interface QueryBuilderMethodAnalysis {
  readonly accesses: readonly QueryBuilderAccess[];
  /** Explicit values()/set() objects attached to a proven, executed write builder. */
  readonly writeSinks: readonly QueryBuilderWriteSink[];
  readonly diagnostics: readonly QueryBuilderDiagnostic[];
}

export interface QueryBuilderAnalysisInput {
  readonly body: ts.Block;
  readonly checker: ts.TypeChecker;
  readonly resolveRootReceiver: (receiver: ts.Expression) => QueryBuilderRootResolution;
  readonly resolveTableTarget: (target: ts.Expression) => QueryBuilderTargetResolution;
  readonly evidenceForNode: (node: ts.Node, role: EvidenceRecord['role']) => string;
}

interface StateTable extends QueryBuilderTableTarget {
  readonly ruleId: string;
}

interface BuilderState {
  readonly rootCalls: ReadonlySet<ts.CallExpression>;
  readonly kind: QueryBuilderKind;
  readonly rootTables: ReadonlyMap<string, StateTable>;
  readonly readTables: ReadonlyMap<string, StateTable>;
  readonly writeTables: ReadonlyMap<string, StateTable>;
  readonly writeObjects: readonly {
    readonly kind: 'insert' | 'update';
    readonly valueExpression: ts.Expression;
    readonly operationEvidenceId: string;
  }[];
  readonly evidenceIds: readonly string[];
  readonly invalid: boolean;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function propertyCall(node: ts.CallExpression): {
  readonly receiver: ts.Expression;
  readonly operation: string;
} | null {
  return ts.isPropertyAccessExpression(node.expression)
    ? { receiver: node.expression.expression, operation: node.expression.name.text }
    : null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function addTables(
  existing: ReadonlyMap<string, StateTable>,
  targets: readonly QueryBuilderTableTarget[],
  ruleId: string,
): ReadonlyMap<string, StateTable> {
  const result = new Map(existing);
  for (const target of targets) {
    const previous = result.get(target.table.id);
    result.set(target.table.id, {
      ...target,
      status:
        previous?.status === 'resolved' || target.status === 'resolved' ? 'resolved' : 'ambiguous',
      ruleId: previous?.ruleId ?? ruleId,
      evidenceIds: sortedUnique([...(previous?.evidenceIds ?? []), ...target.evidenceIds]),
    });
  }
  return result;
}

function cloneState(state: BuilderState): BuilderState {
  return {
    ...state,
    rootCalls: new Set(state.rootCalls),
    rootTables: new Map(state.rootTables),
    readTables: new Map(state.readTables),
    writeTables: new Map(state.writeTables),
    writeObjects: [...state.writeObjects],
    evidenceIds: [...state.evidenceIds],
  };
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function relationString(expression: ts.Expression): boolean {
  return (
    (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) &&
    expression.text.includes('.')
  );
}

export function analyzeTypeOrmQueryBuilders(
  input: QueryBuilderAnalysisInput,
): QueryBuilderMethodAnalysis {
  const accesses: QueryBuilderAccess[] = [];
  const writeSinks: QueryBuilderWriteSink[] = [];
  const diagnosticsByKey = new Map<string, QueryBuilderDiagnostic>();
  const rootStateByCall = new Map<ts.CallExpression, BuilderState | null>();
  const consumedRoots = new Set<ts.CallExpression>();

  const addDiagnostic = (diagnostic: QueryBuilderDiagnostic): void => {
    const evidenceIds = sortedUnique(diagnostic.evidenceIds);
    const key = `${diagnostic.code}:${evidenceIds.join(':')}`;
    if (!diagnosticsByKey.has(key)) {
      diagnosticsByKey.set(key, { ...diagnostic, evidenceIds });
    }
  };

  const rootState = (call: ts.CallExpression): BuilderState | null => {
    const cached = rootStateByCall.get(call);
    if (cached !== undefined) return cached;
    const called = propertyCall(call);
    if (called?.operation !== 'createQueryBuilder') {
      rootStateByCall.set(call, null);
      return null;
    }
    const resolution = input.resolveRootReceiver(called.receiver);
    if (resolution.status === 'ignored') {
      rootStateByCall.set(call, null);
      return null;
    }
    const rootEvidenceId = input.evidenceForNode(call, 'call_site');
    const rootCalls = new Set([call]);
    if (resolution.status === 'ambiguous') {
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS',
        message: resolution.message,
        evidenceIds: [rootEvidenceId, ...resolution.evidenceIds],
      });
      const state: BuilderState = {
        rootCalls,
        kind: 'select',
        rootTables: new Map(),
        readTables: new Map(),
        writeTables: new Map(),
        writeObjects: [],
        evidenceIds: sortedUnique([rootEvidenceId, ...resolution.evidenceIds]),
        invalid: true,
      };
      rootStateByCall.set(call, state);
      return state;
    }

    let rootTables = addTables(new Map(), resolution.tables, TYPEORM_QUERY_BUILDER_SELECT_RULE_ID);
    let readTables: ReadonlyMap<string, StateTable> = new Map(rootTables);
    let invalid = false;
    let evidenceIds = sortedUnique([rootEvidenceId, ...resolution.evidenceIds]);
    if (resolution.tables.some(({ status }) => status === 'ambiguous')) {
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS',
        message: 'The QueryBuilder repository entity maps to multiple possible tables.',
        evidenceIds,
      });
    }

    if (resolution.kind !== 'repository' && call.arguments[0] !== undefined) {
      const target = input.resolveTableTarget(call.arguments[0]);
      evidenceIds = sortedUnique([...evidenceIds, ...target.evidenceIds]);
      if (target.status === 'resolved' || target.status === 'ambiguous') {
        rootTables = addTables(rootTables, target.targets, TYPEORM_QUERY_BUILDER_SELECT_RULE_ID);
        readTables = addTables(readTables, target.targets, TYPEORM_QUERY_BUILDER_SELECT_RULE_ID);
        if (target.status === 'ambiguous') {
          addDiagnostic({
            code: 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS',
            message: target.message ?? 'The QueryBuilder root table target is ambiguous.',
            evidenceIds,
          });
        }
      } else {
        addDiagnostic({
          code:
            target.status === 'unsupported'
              ? 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED'
              : 'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED',
          message: target.message ?? 'The QueryBuilder root table target could not be resolved.',
          evidenceIds,
        });
        invalid = true;
      }
    }

    const state: BuilderState = {
      rootCalls,
      kind: 'select',
      rootTables,
      readTables,
      writeTables: new Map(),
      writeObjects: [],
      evidenceIds,
      invalid,
    };
    rootStateByCall.set(call, state);
    return state;
  };

  const resolveRequiredTarget = (
    call: ts.CallExpression,
    state: BuilderState,
    destination: 'read' | 'write',
    ruleId: string,
  ): BuilderState => {
    const targetExpression = call.arguments[0];
    const operationEvidenceId = input.evidenceForNode(call, 'call_site');
    if (targetExpression === undefined) {
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED',
        message:
          'The QueryBuilder transition requires an explicit entity class or static table literal.',
        evidenceIds: [...state.evidenceIds, operationEvidenceId],
      });
      return { ...state, invalid: true };
    }
    const target = input.resolveTableTarget(targetExpression);
    const evidenceIds = sortedUnique([
      ...state.evidenceIds,
      operationEvidenceId,
      ...target.evidenceIds,
    ]);
    if (target.status === 'unresolved' || target.status === 'unsupported') {
      addDiagnostic({
        code:
          target.status === 'unsupported'
            ? 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED'
            : 'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED',
        message: target.message,
        evidenceIds,
      });
      return { ...state, evidenceIds, invalid: true };
    }
    if (target.status === 'ambiguous') {
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS',
        message: target.message ?? 'The QueryBuilder table target is ambiguous.',
        evidenceIds,
      });
    }
    return destination === 'read'
      ? {
          ...state,
          readTables: addTables(state.readTables, target.targets, ruleId),
          evidenceIds,
        }
      : {
          ...state,
          writeTables: addTables(state.writeTables, target.targets, ruleId),
          evidenceIds,
        };
  };

  const applyTransition = (call: ts.CallExpression, initial: BuilderState): BuilderState => {
    const called = propertyCall(call);
    if (called === null) return { ...initial, invalid: true };
    const operation = called.operation;
    const operationEvidenceId = input.evidenceForNode(call, 'call_site');
    const withEvidence = (): BuilderState => ({
      ...initial,
      evidenceIds: sortedUnique([...initial.evidenceIds, operationEvidenceId]),
    });

    if (operation === 'values' && initial.kind === 'insert' && call.arguments[0] !== undefined) {
      return {
        ...withEvidence(),
        writeObjects: [
          ...initial.writeObjects,
          {
            kind: 'insert',
            valueExpression: call.arguments[0],
            operationEvidenceId,
          },
        ],
      };
    }
    if (operation === 'set' && initial.kind === 'update' && call.arguments[0] !== undefined) {
      return {
        ...withEvidence(),
        writeObjects: [
          ...initial.writeObjects,
          {
            kind: 'update',
            valueExpression: call.arguments[0],
            operationEvidenceId,
          },
        ],
      };
    }
    if (PASSTHROUGH_OPERATIONS.has(operation)) return withEvidence();
    if (operation === 'insert') {
      return {
        ...withEvidence(),
        kind: 'insert',
        writeTables: addTables(
          new Map(),
          [...initial.rootTables.values()],
          TYPEORM_QUERY_BUILDER_INSERT_RULE_ID,
        ),
      };
    }
    if (operation === 'update') {
      const state: BuilderState = {
        ...withEvidence(),
        kind: 'update',
        writeTables: addTables(
          new Map(),
          [...initial.rootTables.values()],
          TYPEORM_QUERY_BUILDER_UPDATE_RULE_ID,
        ),
      };
      return call.arguments[0] === undefined
        ? state
        : resolveRequiredTarget(
            call,
            { ...state, writeTables: new Map() },
            'write',
            TYPEORM_QUERY_BUILDER_UPDATE_RULE_ID,
          );
    }
    if (operation === 'delete') {
      return {
        ...withEvidence(),
        kind: 'delete',
        writeTables: addTables(
          new Map(),
          [...initial.rootTables.values()],
          TYPEORM_QUERY_BUILDER_DELETE_RULE_ID,
        ),
      };
    }
    if (operation === 'into') {
      const ruleId =
        initial.kind === 'insert'
          ? TYPEORM_QUERY_BUILDER_INSERT_RULE_ID
          : initial.kind === 'update'
            ? TYPEORM_QUERY_BUILDER_UPDATE_RULE_ID
            : TYPEORM_QUERY_BUILDER_DELETE_RULE_ID;
      return resolveRequiredTarget(call, { ...initial, writeTables: new Map() }, 'write', ruleId);
    }
    if (operation === 'from') {
      if (initial.kind === 'delete') {
        return resolveRequiredTarget(
          call,
          { ...initial, writeTables: new Map() },
          'write',
          TYPEORM_QUERY_BUILDER_DELETE_RULE_ID,
        );
      }
      return resolveRequiredTarget(call, initial, 'read', TYPEORM_QUERY_BUILDER_SELECT_RULE_ID);
    }
    if (operation === 'addFrom') {
      return resolveRequiredTarget(call, initial, 'read', TYPEORM_QUERY_BUILDER_SELECT_RULE_ID);
    }
    if (JOIN_OPERATIONS.has(operation)) {
      const targetExpression = call.arguments[0];
      if (targetExpression === undefined || relationString(targetExpression)) {
        addDiagnostic({
          code: 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED',
          message:
            'Relation-string QueryBuilder joins require entity relation metadata and do not create a joined-table fact.',
          evidenceIds: [...initial.evidenceIds, operationEvidenceId],
        });
        return withEvidence();
      }
      const target = input.resolveTableTarget(targetExpression);
      const evidenceIds = sortedUnique([
        ...initial.evidenceIds,
        operationEvidenceId,
        ...target.evidenceIds,
      ]);
      if (
        target.status === 'resolved' &&
        target.targets.length > 0 &&
        target.targets.every(({ source }) => source === 'entity')
      ) {
        return {
          ...initial,
          readTables: addTables(
            initial.readTables,
            target.targets.map((value) => ({ ...value, source: 'join' as const })),
            TYPEORM_QUERY_BUILDER_JOIN_RULE_ID,
          ),
          evidenceIds,
        };
      }
      addDiagnostic({
        code:
          target.status === 'ambiguous'
            ? 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS'
            : target.status === 'unresolved'
              ? 'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED'
              : 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED',
        message:
          target.message ??
          'Only a checker-resolved entity class is supported as a QueryBuilder join target.',
        evidenceIds,
      });
      return { ...initial, evidenceIds, invalid: target.status !== 'ambiguous' };
    }
    if (operation === 'addCommonTableExpression') {
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED',
        message: 'QueryBuilder common-table-expression bodies are not parsed or traversed.',
        evidenceIds: [...initial.evidenceIds, operationEvidenceId],
      });
      return { ...withEvidence(), invalid: true };
    }

    addDiagnostic({
      code: 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED',
      message: `QueryBuilder operation ${operation} is outside the supported bounded flow.`,
      evidenceIds: [...initial.evidenceIds, operationEvidenceId],
    });
    return { ...withEvidence(), invalid: true };
  };

  const variableDeclarationFor = (identifier: ts.Identifier): ts.VariableDeclaration | null => {
    const symbol = input.checker.getSymbolAtLocation(identifier);
    if (symbol === undefined) return null;
    const declarations = symbol.declarations?.filter(ts.isVariableDeclaration) ?? [];
    return declarations.length === 1 ? declarations[0]! : null;
  };

  const evaluateExpression = (
    expression: ts.Expression,
    terminalPosition: number,
  ): BuilderState | null => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) return evaluateLocalVariable(unwrapped, terminalPosition);
    if (!ts.isCallExpression(unwrapped)) return null;
    const directRoot = rootState(unwrapped);
    if (directRoot !== null) return cloneState(directRoot);
    const called = propertyCall(unwrapped);
    if (called === null) return null;
    const previous = evaluateExpression(called.receiver, terminalPosition);
    return previous === null ? null : applyTransition(unwrapped, previous);
  };

  const evaluateLocalVariable = (
    identifier: ts.Identifier,
    terminalPosition: number,
  ): BuilderState | null => {
    const declaration = variableDeclarationFor(identifier);
    if (declaration?.initializer === undefined || !ts.isIdentifier(declaration.name)) return null;
    const symbol = input.checker.getSymbolAtLocation(identifier);
    if (symbol === undefined || input.checker.getSymbolAtLocation(declaration.name) !== symbol) {
      return null;
    }
    let state = evaluateExpression(declaration.initializer, terminalPosition);
    if (state === null) return null;

    const references: ts.Identifier[] = [];
    const collect = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && input.checker.getSymbolAtLocation(node) === symbol) {
        references.push(node);
      }
      ts.forEachChild(node, collect);
    };
    collect(input.body);

    const assignment = references.find((reference) => {
      const parent = reference.parent;
      return (
        (ts.isBinaryExpression(parent) &&
          parent.left === reference &&
          isAssignmentOperator(parent.operatorToken.kind)) ||
        ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
          parent.operand === reference)
      );
    });
    if (assignment !== undefined) {
      const evidenceId = input.evidenceForNode(assignment.parent, 'resolution_basis');
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS',
        message:
          'A method-local QueryBuilder variable is reassigned, so no single dominating state is proven.',
        evidenceIds: [...state.evidenceIds, evidenceId],
      });
      return {
        ...state,
        evidenceIds: sortedUnique([...state.evidenceIds, evidenceId]),
        invalid: true,
      };
    }

    const transitions: ts.CallExpression[] = [];
    for (const reference of references) {
      if (reference === declaration.name || reference.end > terminalPosition) continue;
      const property = reference.parent;
      if (
        ts.isPropertyAccessExpression(property) &&
        property.expression === reference &&
        ts.isCallExpression(property.parent) &&
        property.parent.expression === property
      ) {
        const operation = property.name.text;
        if (
          property.parent.end < terminalPosition &&
          !READ_TERMINALS.has(operation) &&
          operation !== 'execute' &&
          !INSPECTION_TERMINALS.has(operation)
        ) {
          transitions.push(property.parent);
        }
        continue;
      }
      if (
        reference.pos >= declaration.initializer.pos &&
        reference.end <= declaration.initializer.end
      ) {
        continue;
      }
      const evidenceId = input.evidenceForNode(reference, 'resolution_basis');
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED',
        message:
          'A method-local QueryBuilder variable escapes to an unsupported call, alias, property, or return.',
        evidenceIds: [...state.evidenceIds, evidenceId],
      });
      state = {
        ...state,
        evidenceIds: sortedUnique([...state.evidenceIds, evidenceId]),
        invalid: true,
      };
    }
    transitions.sort((left, right) => left.pos - right.pos);
    for (const transition of transitions) state = applyTransition(transition, state);
    return state;
  };

  const allCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== input.body && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) allCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(input.body);

  for (const call of allCalls) {
    if (propertyCall(call)?.operation === 'createQueryBuilder') rootState(call);
  }

  for (const terminal of allCalls) {
    const called = propertyCall(terminal);
    if (called === null) continue;
    const isRead = READ_TERMINALS.has(called.operation);
    const isExecute = called.operation === 'execute';
    const isInspection = INSPECTION_TERMINALS.has(called.operation);
    if (!isRead && !isExecute && !isInspection) continue;
    const state = evaluateExpression(called.receiver, terminal.pos);
    if (state === null) continue;
    for (const root of state.rootCalls) consumedRoots.add(root);
    const terminalEvidenceId = input.evidenceForNode(terminal, 'call_site');
    const terminalEvidence = sortedUnique([...state.evidenceIds, terminalEvidenceId]);
    if (isInspection) {
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_TERMINAL_MISSING',
        message: `QueryBuilder.${called.operation} inspects generated SQL but does not execute the query.`,
        evidenceIds: terminalEvidence,
      });
      continue;
    }
    if (state.invalid) continue;
    const tables = isRead
      ? state.kind === 'select'
        ? [...state.readTables.values()]
        : []
      : state.kind === 'select'
        ? []
        : [...state.writeTables.values()];
    if (tables.length === 0) {
      addDiagnostic({
        code: 'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED',
        message: isRead
          ? 'A QueryBuilder read terminal has no proven entity or static table source.'
          : 'A QueryBuilder execute terminal has no proven insert, update, or delete target.',
        evidenceIds: terminalEvidence,
      });
      continue;
    }
    for (const target of tables) {
      accesses.push({
        direction: isRead ? 'read' : 'write',
        table: target.table,
        status: target.status,
        ruleId: isRead
          ? target.ruleId
          : state.kind === 'insert'
            ? TYPEORM_QUERY_BUILDER_INSERT_RULE_ID
            : state.kind === 'update'
              ? TYPEORM_QUERY_BUILDER_UPDATE_RULE_ID
              : TYPEORM_QUERY_BUILDER_DELETE_RULE_ID,
        evidenceIds: sortedUnique([...terminalEvidence, ...target.evidenceIds]),
      });
      if (!isRead && (state.kind === 'insert' || state.kind === 'update')) {
        for (const object of state.writeObjects.filter(({ kind }) => kind === state.kind)) {
          writeSinks.push({
            kind: state.kind === 'insert' ? 'query_builder_insert' : 'query_builder_update',
            valueExpression: object.valueExpression,
            table: target.table,
            status: target.status,
            operationEvidenceId: object.operationEvidenceId,
            evidenceIds: sortedUnique([
              ...terminalEvidence,
              ...target.evidenceIds,
              object.operationEvidenceId,
            ]),
          });
        }
      }
    }
  }

  for (const [call, state] of rootStateByCall) {
    if (state === null || consumedRoots.has(call) || state.invalid) continue;
    addDiagnostic({
      code: 'TYPEORM_QUERY_BUILDER_TERMINAL_MISSING',
      message: 'A proven TypeORM QueryBuilder root has no supported execution terminal.',
      evidenceIds: state.evidenceIds,
    });
  }

  return {
    accesses,
    writeSinks,
    diagnostics: [...diagnosticsByKey.values()].sort((left, right) =>
      `${left.code}:${left.evidenceIds.join(':')}`.localeCompare(
        `${right.code}:${right.evidenceIds.join(':')}`,
      ),
    ),
  };
}
