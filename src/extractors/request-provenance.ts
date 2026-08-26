import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord, AssertionStatus } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type {
  ColumnInfluenceRecord,
  ColumnInfluenceState,
  ContractFieldRecord,
  EntityColumnRecord,
  RequestFieldOriginRecord,
  RequestFieldOriginResolution,
  RequestParameterRecord,
} from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { makeAssertionId, makeColumnInfluenceId, makeRequestFieldOriginId } from '../model/ids.js';
import type { TypeOrmObjectWriteSink } from './typeorm-persistence.js';

export const REQUEST_FIELD_ORIGIN_RULE_ID = 'request.provenance.field-origin.v1';
export const REQUEST_COLUMN_INFLUENCE_RULE_ID = 'request.provenance.explicit-object-write.v1';

const MAX_EXPRESSION_DEPTH = 8;
const MAX_ORIGINS_PER_VALUE = 16;
const DERIVATION_METHODS = new Set(['trim', 'toLowerCase', 'toUpperCase', 'normalize']);

interface SymbolicOrigin {
  readonly requestParameter: RequestParameterRecord;
  readonly propertyPath: readonly string[];
  readonly contractFieldIds: readonly string[];
  readonly resolution: RequestFieldOriginResolution;
  readonly state: ColumnInfluenceState;
  readonly evidenceIds: readonly string[];
}

export interface RequestProvenanceExtraction {
  readonly requestFieldOrigins: readonly RequestFieldOriginRecord[];
  readonly columnInfluences: readonly ColumnInfluenceRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stateRank(state: ColumnInfluenceState): number {
  return state === 'direct' ? 0 : state === 'derived' ? 1 : 2;
}

function downgrade(
  origins: readonly SymbolicOrigin[],
  state: ColumnInfluenceState,
  evidenceId?: string,
): SymbolicOrigin[] {
  return origins.map((origin) => ({
    ...origin,
    state: stateRank(origin.state) >= stateRank(state) ? origin.state : state,
    evidenceIds: sortedUnique([
      ...origin.evidenceIds,
      ...(evidenceId === undefined ? [] : [evidenceId]),
    ]),
  }));
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (
    ts.isSpreadAssignment(node) ||
    node.name === undefined ||
    ts.isComputedPropertyName(node.name)
  ) {
    return null;
  }
  return ts.isIdentifier(node.name) ||
    ts.isStringLiteralLike(node.name) ||
    ts.isNumericLiteral(node.name)
    ? node.name.text
    : null;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function enclosingUncertainBoundary(
  expression: ts.Expression,
  method: ts.MethodDeclaration,
): ts.Node | null {
  let current: ts.Node | undefined = expression.parent;
  while (current !== undefined && current !== method) {
    if (
      (ts.isFunctionLike(current) && current !== method) ||
      ts.isIfStatement(current) ||
      ts.isSwitchStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isTryStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

export function extractRequestProvenance(input: {
  checker: ts.TypeChecker;
  requestParameters: readonly RequestParameterRecord[];
  contractFields: readonly ContractFieldRecord[];
  entityColumns: readonly EntityColumnRecord[];
  writeSinks: readonly TypeOrmObjectWriteSink[];
  evidenceSnippetLimit: number;
}): RequestProvenanceExtraction {
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticById = new Map<string, DiagnosticRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const originById = new Map<string, RequestFieldOriginRecord>();
  const influenceById = new Map<string, ColumnInfluenceRecord>();
  const fieldsByTypeAndName = new Map<string, ContractFieldRecord[]>();
  const columnsByEntityAndProperty = new Map<string, EntityColumnRecord[]>();

  for (const field of input.contractFields) {
    const key = `${field.contractTypeId}:${field.name}`;
    fieldsByTypeAndName.set(key, [...(fieldsByTypeAndName.get(key) ?? []), field]);
  }
  for (const column of input.entityColumns) {
    const key = `${column.entityId}:${column.propertyName}`;
    columnsByEntityAndProperty.set(key, [...(columnsByEntityAndProperty.get(key) ?? []), column]);
  }

  const addAssertion = (record: AssertionRecord): void => {
    const previous = assertionById.get(record.id);
    if (previous === undefined) {
      assertionById.set(record.id, record);
      return;
    }
    const statuses: readonly AssertionStatus[] = [previous.status, record.status];
    const status: AssertionStatus = statuses.includes('resolved')
      ? 'resolved'
      : statuses.includes('ambiguous')
        ? 'ambiguous'
        : statuses.includes('unresolved')
          ? 'unresolved'
          : 'unsupported';
    assertionById.set(record.id, {
      ...previous,
      status,
      evidenceIds: sortedUnique([...previous.evidenceIds, ...record.evidenceIds]),
    });
  };

  const addDiagnostic = (
    code: 'REQUEST_PROVENANCE_UNSUPPORTED' | 'REQUEST_PROVENANCE_LIMIT_EXCEEDED',
    methodId: string,
    message: string,
    evidenceIds: readonly string[],
  ): void => {
    const diagnostic = createDiagnostic({ code, subjectId: methodId, message, evidenceIds });
    diagnosticById.set(diagnostic.id, diagnostic);
  };

  for (const sink of input.writeSinks) {
    const methodParameters = input.requestParameters.filter(
      ({ methodId }) => methodId === sink.methodId,
    );
    if (methodParameters.length === 0) continue;
    const parameterBySymbol = new Map<ts.Symbol, RequestParameterRecord>();
    for (const parameter of methodParameters) {
      const declaration = sink.indexedMethod.node.parameters[parameter.parameterIndex];
      const symbol =
        declaration === undefined ? undefined : input.checker.getSymbolAtLocation(declaration.name);
      if (symbol !== undefined) parameterBySymbol.set(symbol, parameter);
    }

    const evidenceFor = (node: ts.Node, role: EvidenceRecord['role']): string => {
      const evidence = createEvidenceForNode({
        sourceFile: sink.source.sourceFile,
        sourceFileRecord: sink.source.inventorySource.record,
        node,
        role,
        snippetLimit: input.evidenceSnippetLimit,
      });
      evidenceById.set(evidence.id, evidence);
      return evidence.id;
    };

    const resolveField = (
      parameter: RequestParameterRecord,
      path: readonly string[],
    ): Pick<SymbolicOrigin, 'contractFieldIds' | 'resolution'> => {
      if (parameter.selectorState === 'literal') {
        return { contractFieldIds: [], resolution: 'resolved' };
      }
      const fieldName = path[0];
      if (fieldName === undefined) return { contractFieldIds: [], resolution: 'unknown' };
      const candidates = parameter.declaredType.contractTypeIds.flatMap(
        (typeId) => fieldsByTypeAndName.get(`${typeId}:${fieldName}`) ?? [],
      );
      const contractFieldIds = sortedUnique(candidates.map(({ id }) => id));
      return {
        contractFieldIds,
        resolution:
          contractFieldIds.length === 0
            ? 'unknown'
            : contractFieldIds.length === 1
              ? 'resolved'
              : 'ambiguous',
      };
    };

    const parameterOrigin = (
      parameter: RequestParameterRecord,
      evidenceId: string,
    ): SymbolicOrigin => {
      const propertyPath =
        parameter.selectorState === 'literal' && parameter.selector !== null
          ? [parameter.selector]
          : [];
      const field = resolveField(parameter, propertyPath);
      return {
        requestParameter: parameter,
        propertyPath,
        ...field,
        state: field.resolution === 'unknown' && propertyPath.length > 0 ? 'unknown' : 'direct',
        evidenceIds: [evidenceId],
      };
    };

    const symbolIsMutated = (symbol: ts.Symbol): ts.Node | null => {
      let mutation: ts.Node | null = null;
      const visit = (node: ts.Node): void => {
        if (mutation !== null) return;
        if (ts.isIdentifier(node) && input.checker.getSymbolAtLocation(node) === symbol) {
          const parent = node.parent;
          if (
            (ts.isBinaryExpression(parent) &&
              parent.left === node &&
              isAssignmentOperator(parent.operatorToken.kind)) ||
            ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
              parent.operand === node)
          ) {
            mutation = parent;
            return;
          }
        }
        ts.forEachChild(node, visit);
      };
      if (sink.indexedMethod.node.body !== undefined) visit(sink.indexedMethod.node.body);
      return mutation;
    };

    const trace = (expression: ts.Expression, depth = 0, aliasHops = 0): SymbolicOrigin[] => {
      if (depth > MAX_EXPRESSION_DEPTH) {
        const evidenceId = evidenceFor(expression, 'resolution_basis');
        addDiagnostic(
          'REQUEST_PROVENANCE_LIMIT_EXCEEDED',
          sink.methodId,
          `Request provenance exceeded the expression-depth limit of ${MAX_EXPRESSION_DEPTH}.`,
          [evidenceId, sink.operationEvidenceId],
        );
        return [];
      }
      if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isTypeAssertionExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isAwaitExpression(expression)
      ) {
        return trace(expression.expression, depth + 1, aliasHops);
      }
      if (ts.isIdentifier(expression)) {
        const symbol = ts.isShorthandPropertyAssignment(expression.parent)
          ? (input.checker.getShorthandAssignmentValueSymbol(expression.parent) ??
            input.checker.getSymbolAtLocation(expression))
          : input.checker.getSymbolAtLocation(expression);
        const parameter = symbol === undefined ? undefined : parameterBySymbol.get(symbol);
        if (parameter !== undefined) {
          return [parameterOrigin(parameter, evidenceFor(expression, 'resolution_basis'))];
        }
        const declarations = symbol?.declarations ?? [];
        if (declarations.length !== 1) return [];
        const declaration = declarations[0]!;
        if (ts.isBindingElement(declaration)) {
          const variable = declaration.parent.parent;
          if (!ts.isVariableDeclaration(variable) || variable.initializer === undefined) return [];
          const name =
            declaration.propertyName !== undefined &&
            (ts.isIdentifier(declaration.propertyName) ||
              ts.isStringLiteralLike(declaration.propertyName))
              ? declaration.propertyName.text
              : ts.isIdentifier(declaration.name)
                ? declaration.name.text
                : null;
          if (name === null) return [];
          const bindingEvidenceId = evidenceFor(declaration, 'resolution_basis');
          const bases = trace(variable.initializer, depth + 1, aliasHops + 1);
          const origins = bases.map((base): SymbolicOrigin => {
            if (base.propertyPath.length > 0) {
              return {
                ...base,
                state: 'unknown',
                evidenceIds: sortedUnique([...base.evidenceIds, bindingEvidenceId]),
              };
            }
            const propertyPath = [name];
            const field = resolveField(base.requestParameter, propertyPath);
            return {
              ...base,
              propertyPath,
              ...field,
              state: field.resolution === 'unknown' ? 'unknown' : base.state,
              evidenceIds: sortedUnique([...base.evidenceIds, bindingEvidenceId]),
            };
          });
          return aliasHops >= 1 ? downgrade(origins, 'unknown', bindingEvidenceId) : origins;
        }
        if (
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name) &&
          declaration.initializer !== undefined
        ) {
          const aliasEvidenceId = evidenceFor(declaration, 'resolution_basis');
          let origins = trace(declaration.initializer, depth + 1, aliasHops + 1);
          if (aliasHops >= 1) origins = downgrade(origins, 'unknown', aliasEvidenceId);
          if (symbol !== undefined) {
            const mutation = symbolIsMutated(symbol);
            if (mutation !== null) {
              const mutationEvidenceId = evidenceFor(mutation, 'resolution_basis');
              origins = downgrade(origins, 'unknown', mutationEvidenceId);
              addDiagnostic(
                'REQUEST_PROVENANCE_UNSUPPORTED',
                sink.methodId,
                'A request-derived local alias is mutated, so direct provenance is not claimed.',
                [aliasEvidenceId, mutationEvidenceId, sink.operationEvidenceId],
              );
            }
          }
          return origins.map((origin) => ({
            ...origin,
            evidenceIds: sortedUnique([...origin.evidenceIds, aliasEvidenceId]),
          }));
        }
        return [];
      }
      if (ts.isPropertyAccessExpression(expression)) {
        return trace(expression.expression, depth + 1, aliasHops).map((base): SymbolicOrigin => {
          const accessEvidenceId = evidenceFor(expression, 'resolution_basis');
          if (base.propertyPath.length > 0) {
            return {
              ...base,
              state: 'unknown',
              evidenceIds: sortedUnique([...base.evidenceIds, accessEvidenceId]),
            };
          }
          const propertyPath = [expression.name.text];
          const field = resolveField(base.requestParameter, propertyPath);
          return {
            ...base,
            propertyPath,
            ...field,
            state: field.resolution === 'unknown' ? 'unknown' : base.state,
            evidenceIds: sortedUnique([...base.evidenceIds, accessEvidenceId]),
          };
        });
      }
      if (ts.isCallExpression(expression)) {
        if (
          ts.isPropertyAccessExpression(expression.expression) &&
          DERIVATION_METHODS.has(expression.expression.name.text)
        ) {
          return downgrade(
            trace(expression.expression.expression, depth + 1, aliasHops),
            'derived',
            evidenceFor(expression, 'resolution_basis'),
          );
        }
        const dependencies = [
          ...(ts.isPropertyAccessExpression(expression.expression)
            ? trace(expression.expression.expression, depth + 1, aliasHops)
            : []),
          ...expression.arguments.flatMap((argument) =>
            ts.isSpreadElement(argument)
              ? trace(argument.expression, depth + 1, aliasHops)
              : trace(argument, depth + 1, aliasHops),
          ),
        ];
        if (dependencies.length === 0) return [];
        const evidenceId = evidenceFor(expression, 'resolution_basis');
        addDiagnostic(
          'REQUEST_PROVENANCE_UNSUPPORTED',
          sink.methodId,
          'An arbitrary call consumes request data; its returned value is retained as unknown influence.',
          [evidenceId, sink.operationEvidenceId],
        );
        return downgrade(dependencies, 'unknown', evidenceId);
      }
      if (ts.isBinaryExpression(expression)) {
        return downgrade(
          [
            ...trace(expression.left, depth + 1, aliasHops),
            ...trace(expression.right, depth + 1, aliasHops),
          ],
          'derived',
          evidenceFor(expression, 'resolution_basis'),
        );
      }
      if (ts.isTemplateExpression(expression)) {
        return downgrade(
          expression.templateSpans.flatMap((span) => trace(span.expression, depth + 1, aliasHops)),
          'derived',
          evidenceFor(expression, 'resolution_basis'),
        );
      }
      if (ts.isConditionalExpression(expression)) {
        const evidenceId = evidenceFor(expression, 'resolution_basis');
        const origins = downgrade(
          [
            ...trace(expression.whenTrue, depth + 1, aliasHops),
            ...trace(expression.whenFalse, depth + 1, aliasHops),
          ],
          'unknown',
          evidenceId,
        );
        if (origins.length > 0) {
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            sink.methodId,
            'A conditional value merges request provenance across branches.',
            [evidenceId, sink.operationEvidenceId],
          );
        }
        return origins;
      }
      if (ts.isElementAccessExpression(expression)) {
        const evidenceId = evidenceFor(expression, 'resolution_basis');
        const origins = downgrade(
          trace(expression.expression, depth + 1, aliasHops),
          'unknown',
          evidenceId,
        );
        if (origins.length > 0) {
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            sink.methodId,
            'Computed request-property access is outside the one-field static boundary.',
            [evidenceId, sink.operationEvidenceId],
          );
        }
        return origins;
      }
      if (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression)) {
        const dependencies = ts.isObjectLiteralExpression(expression)
          ? expression.properties.flatMap((property) => {
              if (ts.isSpreadAssignment(property))
                return trace(property.expression, depth + 1, aliasHops);
              if (ts.isPropertyAssignment(property))
                return trace(property.initializer, depth + 1, aliasHops);
              if (ts.isShorthandPropertyAssignment(property))
                return trace(property.name, depth + 1, aliasHops);
              return [];
            })
          : expression.elements.flatMap((element) =>
              ts.isSpreadElement(element)
                ? trace(element.expression, depth + 1, aliasHops)
                : ts.isExpression(element)
                  ? trace(element, depth + 1, aliasHops)
                  : [],
            );
        if (dependencies.length === 0) return [];
        const evidenceId = evidenceFor(expression, 'resolution_basis');
        addDiagnostic(
          'REQUEST_PROVENANCE_UNSUPPORTED',
          sink.methodId,
          'Nested object or array construction retains request dependency as unknown influence.',
          [evidenceId, sink.operationEvidenceId],
        );
        return downgrade(dependencies, 'unknown', evidenceId);
      }
      if (ts.isPrefixUnaryExpression(expression)) {
        return downgrade(
          trace(expression.operand, depth + 1, aliasHops),
          'derived',
          evidenceFor(expression, 'resolution_basis'),
        );
      }
      return [];
    };

    const valueExpression = sink.valueExpression;
    if (!ts.isObjectLiteralExpression(valueExpression)) {
      const origins = trace(valueExpression);
      if (origins.length > 0) {
        const evidenceId = evidenceFor(valueExpression, 'resolution_basis');
        addDiagnostic(
          'REQUEST_PROVENANCE_UNSUPPORTED',
          sink.methodId,
          'Only an inline object literal is supported for request-to-column provenance.',
          [evidenceId, sink.operationEvidenceId],
        );
      }
      continue;
    }

    const uncertainBoundary = enclosingUncertainBoundary(valueExpression, sink.indexedMethod.node);
    const uncertainEvidenceId =
      uncertainBoundary === null ? null : evidenceFor(uncertainBoundary, 'resolution_basis');
    if (uncertainEvidenceId !== null) {
      addDiagnostic(
        'REQUEST_PROVENANCE_UNSUPPORTED',
        sink.methodId,
        'The write sink is nested in a callback, loop, branch, or exception-flow boundary.',
        [uncertainEvidenceId, sink.operationEvidenceId],
      );
    }

    for (const property of valueExpression.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (trace(property.expression).length > 0) {
          const evidenceId = evidenceFor(property, 'resolution_basis');
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            sink.methodId,
            'Spread write objects do not prove individual entity-column assignments.',
            [evidenceId, sink.operationEvidenceId],
          );
        }
        continue;
      }
      const name = propertyName(property);
      const propertyValue = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : null;
      if (name === null || propertyValue === null) {
        const expression = ts.isPropertyAssignment(property) ? property.initializer : null;
        const origins = expression === null ? [] : trace(expression);
        if (origins.length > 0) {
          const evidenceId = evidenceFor(property, 'resolution_basis');
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            sink.methodId,
            'Computed or accessor write properties do not prove a static entity column.',
            [evidenceId, sink.operationEvidenceId],
          );
        }
        continue;
      }

      let origins = trace(propertyValue);
      if (origins.length === 0) continue;
      if (origins.length > MAX_ORIGINS_PER_VALUE) {
        const evidenceId = evidenceFor(propertyValue, 'resolution_basis');
        addDiagnostic(
          'REQUEST_PROVENANCE_LIMIT_EXCEEDED',
          sink.methodId,
          `A write value exceeded the ${MAX_ORIGINS_PER_VALUE}-origin limit.`,
          [evidenceId, sink.operationEvidenceId],
        );
        origins = origins.slice(0, MAX_ORIGINS_PER_VALUE);
      }
      if (uncertainEvidenceId !== null) {
        origins = downgrade(origins, 'unknown', uncertainEvidenceId);
      }
      const sinkEvidenceId = evidenceFor(property, 'resolution_basis');
      const targetColumns = sink.entityTargets.flatMap((entityTarget) =>
        (columnsByEntityAndProperty.get(`${entityTarget.entityId}:${name}`) ?? []).map(
          (column) => ({ column, entityTarget }),
        ),
      );
      if (targetColumns.length === 0) {
        addDiagnostic(
          'REQUEST_PROVENANCE_UNSUPPORTED',
          sink.methodId,
          `Write property ${name} has request influence but no proven entity-column target.`,
          [sinkEvidenceId, sink.operationEvidenceId],
        );
        continue;
      }

      for (const symbolic of origins) {
        if (symbolic.propertyPath.length !== 1) {
          addDiagnostic(
            'REQUEST_PROVENANCE_UNSUPPORTED',
            sink.methodId,
            'Whole-object request provenance does not prove an individual request field.',
            [sinkEvidenceId, sink.operationEvidenceId, ...symbolic.evidenceIds],
          );
          continue;
        }
        const originId = makeRequestFieldOriginId({
          requestParameterId: symbolic.requestParameter.id,
          propertyPath: symbolic.propertyPath,
        });
        const existingOrigin = originById.get(originId);
        const origin: RequestFieldOriginRecord = {
          id: originId,
          requestParameterId: symbolic.requestParameter.id,
          propertyPath: symbolic.propertyPath,
          contractFieldIds: sortedUnique([
            ...(existingOrigin?.contractFieldIds ?? []),
            ...symbolic.contractFieldIds,
          ]),
          resolution:
            existingOrigin?.resolution === 'ambiguous' || symbolic.resolution === 'ambiguous'
              ? 'ambiguous'
              : existingOrigin?.resolution === 'unknown' || symbolic.resolution === 'unknown'
                ? 'unknown'
                : 'resolved',
          originEvidenceId: symbolic.requestParameter.declarationEvidenceId,
        };
        originById.set(originId, origin);
        const originAssertionId = makeAssertionId({
          subjectId: origin.requestParameterId,
          predicate: 'REQUEST_PARAMETER_HAS_FIELD_ORIGIN',
          objectId: origin.id,
          ruleId: REQUEST_FIELD_ORIGIN_RULE_ID,
        });
        addAssertion({
          id: originAssertionId,
          subjectId: origin.requestParameterId,
          predicate: 'REQUEST_PARAMETER_HAS_FIELD_ORIGIN',
          objectId: origin.id,
          status:
            origin.resolution === 'resolved'
              ? 'resolved'
              : origin.resolution === 'ambiguous'
                ? 'ambiguous'
                : 'unsupported',
          ruleId: REQUEST_FIELD_ORIGIN_RULE_ID,
          evidenceIds: sortedUnique([
            symbolic.requestParameter.declarationEvidenceId,
            symbolic.requestParameter.decoratorEvidenceId,
            ...symbolic.evidenceIds,
          ]),
        });

        for (const { column, entityTarget } of targetColumns) {
          const disabled =
            (sink.kind.endsWith('insert') && column.insert === false) ||
            (sink.kind.endsWith('update') && column.update === false);
          if (disabled) continue;
          const influenceId = makeColumnInfluenceId({
            methodId: sink.methodId,
            originId,
            columnId: column.id,
            sinkKind: sink.kind,
            sinkPropertyName: name,
            operationEvidenceId: sink.operationEvidenceId,
            callEvidenceIds: [],
          });
          const assertionId = makeAssertionId({
            subjectId: originId,
            predicate: 'REQUEST_FIELD_MAY_FLOW_TO_COLUMN',
            objectId: column.id,
            ruleId: REQUEST_COLUMN_INFLUENCE_RULE_ID,
          });
          const status: AssertionStatus =
            entityTarget.status === 'ambiguous' || origin.resolution === 'ambiguous'
              ? 'ambiguous'
              : symbolic.state === 'unknown' || origin.resolution === 'unknown'
                ? 'unsupported'
                : 'resolved';
          const evidenceIds = sortedUnique([
            symbolic.requestParameter.declarationEvidenceId,
            symbolic.requestParameter.decoratorEvidenceId,
            ...symbolic.evidenceIds,
            sinkEvidenceId,
            sink.operationEvidenceId,
            ...sink.evidenceIds,
            ...entityTarget.evidenceIds,
            column.declarationEvidenceId,
            column.decoratorEvidenceId,
          ]);
          addAssertion({
            id: assertionId,
            subjectId: originId,
            predicate: 'REQUEST_FIELD_MAY_FLOW_TO_COLUMN',
            objectId: column.id,
            status,
            ruleId: REQUEST_COLUMN_INFLUENCE_RULE_ID,
            evidenceIds,
          });
          influenceById.set(influenceId, {
            id: influenceId,
            methodId: sink.methodId,
            originId,
            columnId: column.id,
            state: symbolic.state,
            sinkKind: sink.kind,
            sinkPropertyName: name,
            assertionId,
            sinkEvidenceId,
            operationEvidenceId: sink.operationEvidenceId,
            propagationEvidenceIds: sortedUnique(symbolic.evidenceIds),
            callPath: [],
          });
        }
      }
    }
  }

  return {
    requestFieldOrigins: [...originById.values()],
    columnInfluences: [...influenceById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
  };
}
