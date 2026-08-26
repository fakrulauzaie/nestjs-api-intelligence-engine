import ts from 'typescript';
import { resolveAliasedSymbol } from './symbols.js';

export type StringResolutionFailureReason =
  | 'dynamic_expression'
  | 'missing_initializer'
  | 'mutable_binding'
  | 'non_variable_symbol'
  | 'ambiguous_symbol'
  | 'identifier_chain';

export type SimpleStringResolution =
  | {
      readonly status: 'resolved';
      readonly value: string;
      readonly evidenceNodes: readonly ts.Node[];
    }
  | {
      readonly status: 'unsupported';
      readonly reason: StringResolutionFailureReason;
      readonly evidenceNodes: readonly ts.Node[];
    };

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

function literalValue(expression: ts.Expression): string | null {
  const unwrapped = unwrapExpression(expression);
  return ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)
    ? unwrapped.text
    : null;
}

function unsupported(
  reason: StringResolutionFailureReason,
  evidenceNodes: readonly ts.Node[],
): SimpleStringResolution {
  return { status: 'unsupported', reason, evidenceNodes };
}

export function resolveSimpleString(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): SimpleStringResolution {
  const directValue = literalValue(expression);
  if (directValue !== null) {
    return { status: 'resolved', value: directValue, evidenceNodes: [expression] };
  }

  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) return unsupported('dynamic_expression', [expression]);

  const alias = checker.getSymbolAtLocation(unwrapped);
  const symbol = resolveAliasedSymbol(checker, alias);
  if (symbol === null) return unsupported('non_variable_symbol', [expression]);

  const declarations = symbol.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (declarations.length !== 1) return unsupported('ambiguous_symbol', [expression]);

  const declaration = declarations[0];
  if (declaration === undefined) return unsupported('ambiguous_symbol', [expression]);
  const declarationList = declaration.parent;
  if (!ts.isVariableDeclarationList(declarationList)) {
    return unsupported('non_variable_symbol', [expression, declaration]);
  }
  if ((declarationList.flags & ts.NodeFlags.Const) === 0) {
    return unsupported('mutable_binding', [expression, declaration]);
  }
  if (declaration.initializer === undefined) {
    return unsupported('missing_initializer', [expression, declaration]);
  }

  const initializer = unwrapExpression(declaration.initializer);
  if (ts.isIdentifier(initializer)) {
    return unsupported('identifier_chain', [expression, declaration]);
  }
  const value = literalValue(initializer);
  return value === null
    ? unsupported('dynamic_expression', [expression, declaration, declaration.initializer])
    : {
        status: 'resolved',
        value,
        evidenceNodes: [expression, declaration, declaration.initializer],
      };
}
