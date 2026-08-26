import ts from 'typescript';
import type {
  ColumnInfluenceState,
  RequestFieldOriginResolution,
  RequestParameterRecord,
} from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';

export const MAX_PROVENANCE_EXPRESSION_DEPTH = 8;
export const MAX_PROVENANCE_ORIGINS_PER_VALUE = 16;
const DERIVATION_METHODS = new Set(['trim', 'toLowerCase', 'toUpperCase', 'normalize']);

export interface SymbolicOrigin {
  readonly requestParameter: RequestParameterRecord;
  readonly propertyPath: readonly string[];
  readonly contractFieldIds: readonly string[];
  readonly resolution: RequestFieldOriginResolution;
  readonly state: ColumnInfluenceState;
  readonly evidenceIds: readonly string[];
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stateRank(state: ColumnInfluenceState): number {
  return state === 'direct' ? 0 : state === 'derived' ? 1 : 2;
}

export function downgradeOrigins(
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

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

export interface ProvenanceExpressionTracer {
  readonly trace: (
    expression: ts.Expression,
    depth?: number,
    aliasHops?: number,
  ) => SymbolicOrigin[];
}

export function createProvenanceExpressionTracer(input: {
  checker: ts.TypeChecker;
  method: ts.MethodDeclaration;
  parameterOrigins: (
    symbol: ts.Symbol,
    identifierEvidenceId: string,
  ) => readonly SymbolicOrigin[] | undefined;
  resolveField: (
    parameter: RequestParameterRecord,
    path: readonly string[],
  ) => Pick<SymbolicOrigin, 'contractFieldIds' | 'resolution'>;
  evidenceFor: (node: ts.Node, role: EvidenceRecord['role']) => string;
  addUnsupportedDiagnostic: (message: string, evidenceIds: readonly string[]) => void;
  addLimitDiagnostic: (message: string, evidenceIds: readonly string[]) => void;
  contextEvidenceIds?: readonly string[];
}): ProvenanceExpressionTracer {
  const contextEvidenceIds = input.contextEvidenceIds ?? [];
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
    if (input.method.body !== undefined) visit(input.method.body);
    return mutation;
  };

  const trace = (expression: ts.Expression, depth = 0, aliasHops = 0): SymbolicOrigin[] => {
    if (depth > MAX_PROVENANCE_EXPRESSION_DEPTH) {
      const evidenceId = input.evidenceFor(expression, 'resolution_basis');
      input.addLimitDiagnostic(
        `Request provenance exceeded the expression-depth limit of ${MAX_PROVENANCE_EXPRESSION_DEPTH}.`,
        [evidenceId, ...contextEvidenceIds],
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
      if (symbol !== undefined) {
        const identifierEvidenceId = input.evidenceFor(expression, 'resolution_basis');
        const parameterOrigins = input.parameterOrigins(symbol, identifierEvidenceId);
        if (parameterOrigins !== undefined) {
          return parameterOrigins.map((origin) => ({
            ...origin,
            evidenceIds: sortedUnique([...origin.evidenceIds, identifierEvidenceId]),
          }));
        }
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
        const bindingEvidenceId = input.evidenceFor(declaration, 'resolution_basis');
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
          const field = input.resolveField(base.requestParameter, propertyPath);
          return {
            ...base,
            propertyPath,
            ...field,
            state: field.resolution === 'unknown' ? 'unknown' : base.state,
            evidenceIds: sortedUnique([...base.evidenceIds, bindingEvidenceId]),
          };
        });
        return aliasHops >= 1 ? downgradeOrigins(origins, 'unknown', bindingEvidenceId) : origins;
      }
      if (
        ts.isVariableDeclaration(declaration) &&
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined
      ) {
        const aliasEvidenceId = input.evidenceFor(declaration, 'resolution_basis');
        let origins = trace(declaration.initializer, depth + 1, aliasHops + 1);
        if (aliasHops >= 1) origins = downgradeOrigins(origins, 'unknown', aliasEvidenceId);
        if (symbol !== undefined) {
          const mutation = symbolIsMutated(symbol);
          if (mutation !== null) {
            const mutationEvidenceId = input.evidenceFor(mutation, 'resolution_basis');
            origins = downgradeOrigins(origins, 'unknown', mutationEvidenceId);
            input.addUnsupportedDiagnostic(
              'A request-derived local alias is mutated, so direct provenance is not claimed.',
              [aliasEvidenceId, mutationEvidenceId, ...contextEvidenceIds],
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
        const accessEvidenceId = input.evidenceFor(expression, 'resolution_basis');
        if (base.propertyPath.length > 0) {
          return {
            ...base,
            state: 'unknown',
            evidenceIds: sortedUnique([...base.evidenceIds, accessEvidenceId]),
          };
        }
        const propertyPath = [expression.name.text];
        const field = input.resolveField(base.requestParameter, propertyPath);
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
        return downgradeOrigins(
          trace(expression.expression.expression, depth + 1, aliasHops),
          'derived',
          input.evidenceFor(expression, 'resolution_basis'),
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
      const evidenceId = input.evidenceFor(expression, 'resolution_basis');
      input.addUnsupportedDiagnostic(
        'An arbitrary call consumes request data; its returned value is retained as unknown influence.',
        [evidenceId, ...contextEvidenceIds],
      );
      return downgradeOrigins(dependencies, 'unknown', evidenceId);
    }
    if (ts.isBinaryExpression(expression)) {
      return downgradeOrigins(
        [
          ...trace(expression.left, depth + 1, aliasHops),
          ...trace(expression.right, depth + 1, aliasHops),
        ],
        'derived',
        input.evidenceFor(expression, 'resolution_basis'),
      );
    }
    if (ts.isTemplateExpression(expression)) {
      return downgradeOrigins(
        expression.templateSpans.flatMap((span) => trace(span.expression, depth + 1, aliasHops)),
        'derived',
        input.evidenceFor(expression, 'resolution_basis'),
      );
    }
    if (ts.isConditionalExpression(expression)) {
      const evidenceId = input.evidenceFor(expression, 'resolution_basis');
      const origins = downgradeOrigins(
        [
          ...trace(expression.whenTrue, depth + 1, aliasHops),
          ...trace(expression.whenFalse, depth + 1, aliasHops),
        ],
        'unknown',
        evidenceId,
      );
      if (origins.length > 0) {
        input.addUnsupportedDiagnostic(
          'A conditional value merges request provenance across branches.',
          [evidenceId, ...contextEvidenceIds],
        );
      }
      return origins;
    }
    if (ts.isElementAccessExpression(expression)) {
      const evidenceId = input.evidenceFor(expression, 'resolution_basis');
      const origins = downgradeOrigins(
        trace(expression.expression, depth + 1, aliasHops),
        'unknown',
        evidenceId,
      );
      if (origins.length > 0) {
        input.addUnsupportedDiagnostic(
          'Computed request-property access is outside the one-field static boundary.',
          [evidenceId, ...contextEvidenceIds],
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
      const evidenceId = input.evidenceFor(expression, 'resolution_basis');
      input.addUnsupportedDiagnostic(
        'Nested object or array construction retains request dependency as unknown influence.',
        [evidenceId, ...contextEvidenceIds],
      );
      return downgradeOrigins(dependencies, 'unknown', evidenceId);
    }
    if (ts.isPrefixUnaryExpression(expression)) {
      return downgradeOrigins(
        trace(expression.operand, depth + 1, aliasHops),
        'derived',
        input.evidenceFor(expression, 'resolution_basis'),
      );
    }
    return [];
  };

  return { trace };
}
