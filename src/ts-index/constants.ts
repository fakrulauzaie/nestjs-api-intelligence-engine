import ts from 'typescript';
import { resolveAliasedSymbol } from './symbols.js';

export const MAX_STRING_RESOLUTION_DEPTH = 8;

export type StringResolutionFailureReason =
  | 'dynamic_expression'
  | 'missing_initializer'
  | 'mutable_binding'
  | 'non_constant_property'
  | 'non_variable_symbol'
  | 'ambiguous_symbol'
  | 'cyclic_reference'
  | 'resolution_depth_exceeded';

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

interface ResolutionContext {
  readonly checker: ts.TypeChecker;
  readonly evidenceNodes: ts.Node[];
  readonly evidenceNodeSet: Set<ts.Node>;
  readonly resolvingSymbols: Set<ts.Symbol>;
}

type InternalResolution =
  | { readonly status: 'resolved'; readonly value: string }
  | { readonly status: 'unsupported'; readonly reason: StringResolutionFailureReason };

function noteEvidence(context: ResolutionContext, ...nodes: readonly ts.Node[]): void {
  for (const node of nodes) {
    if (context.evidenceNodeSet.has(node)) continue;
    context.evidenceNodeSet.add(node);
    context.evidenceNodes.push(node);
  }
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
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

function unsupported(reason: StringResolutionFailureReason): InternalResolution {
  return { status: 'unsupported', reason };
}

function uniqueVariableDeclaration(symbol: ts.Symbol): ts.VariableDeclaration | null {
  const declarations = symbol.declarations?.filter(ts.isVariableDeclaration) ?? [];
  return declarations.length === 1 ? declarations[0]! : null;
}

function isImmutableVariable(declaration: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isIdentifier(declaration.name)
  );
}

function constAssertion(type: ts.TypeNode): boolean {
  return (
    type.kind === ts.SyntaxKind.ConstKeyword ||
    (ts.isTypeReferenceNode(type) &&
      ts.isIdentifier(type.typeName) &&
      type.typeName.text === 'const')
  );
}

function unwrapConstObjectInitializer(expression: ts.Expression): {
  readonly expression: ts.Expression;
  readonly constAsserted: boolean;
} {
  let current = expression;
  let constAsserted = false;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    if (
      (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) &&
      constAssertion(current.type)
    ) {
      constAsserted = true;
    }
    current = current.expression;
  }
  return { expression: current, constAsserted };
}

function accessPath(expression: ts.Expression): {
  readonly root: ts.Expression;
  readonly keys: readonly string[];
} | null {
  const keys: string[] = [];
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (current.questionDotToken !== undefined) return null;
    if (ts.isPropertyAccessExpression(current)) {
      keys.unshift(current.name.text);
      current = unwrapExpression(current.expression);
      continue;
    }
    const argument = current.argumentExpression;
    if (argument === undefined) return null;
    const key = literalValue(argument);
    if (key === null) return null;
    keys.unshift(key);
    current = unwrapExpression(current.expression);
  }
  return keys.length > 0 ? { root: current, keys } : null;
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function propertyInitializer(
  object: ts.ObjectLiteralExpression,
  key: string,
  context: ResolutionContext,
): ts.Expression | null {
  if (
    object.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) ||
        ('name' in property &&
          property.name !== undefined &&
          ts.isComputedPropertyName(property.name)),
    )
  ) {
    return null;
  }

  const matches = object.properties.filter(
    (property) =>
      'name' in property &&
      property.name !== undefined &&
      staticPropertyName(property.name) === key,
  );
  if (matches.length !== 1) return null;
  const property = matches[0]!;
  noteEvidence(context, property);
  if (ts.isPropertyAssignment(property)) {
    noteEvidence(context, property.initializer);
    return property.initializer;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    noteEvidence(context, property.name);
    return property.name;
  }
  return null;
}

function enumConstant(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  context: ResolutionContext,
): string | null {
  const symbolNode = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression.argumentExpression;
  const symbol = resolveAliasedSymbol(
    context.checker,
    symbolNode === undefined ? undefined : context.checker.getSymbolAtLocation(symbolNode),
  );
  const enumMembers = symbol?.declarations?.filter(ts.isEnumMember) ?? [];
  if (enumMembers.length !== 1) return null;
  let value: string | number | undefined;
  try {
    value =
      context.checker.getConstantValue(expression) ??
      context.checker.getConstantValue(enumMembers[0]!);
  } catch {
    return null;
  }
  if (typeof value !== 'string') return null;
  noteEvidence(context, enumMembers[0]!);
  if (enumMembers[0]!.initializer !== undefined) {
    noteEvidence(context, enumMembers[0]!.initializer!);
  }
  return value;
}

function resolveConstObjectAccess(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  context: ResolutionContext,
  depth: number,
): InternalResolution {
  const path = accessPath(expression);
  if (path === null || !ts.isIdentifier(path.root)) return unsupported('dynamic_expression');

  const symbol = resolveAliasedSymbol(
    context.checker,
    context.checker.getSymbolAtLocation(path.root),
  );
  if (symbol === null) return unsupported('non_variable_symbol');
  if (context.resolvingSymbols.has(symbol)) return unsupported('cyclic_reference');

  const declaration = uniqueVariableDeclaration(symbol);
  if (declaration === null) return unsupported('ambiguous_symbol');
  noteEvidence(context, declaration);
  if (!isImmutableVariable(declaration)) return unsupported('mutable_binding');
  if (declaration.initializer === undefined) return unsupported('missing_initializer');
  noteEvidence(context, declaration.initializer);

  const root = unwrapConstObjectInitializer(declaration.initializer);
  if (!root.constAsserted || !ts.isObjectLiteralExpression(root.expression)) {
    return unsupported('non_constant_property');
  }

  context.resolvingSymbols.add(symbol);
  try {
    let current: ts.Expression = root.expression;
    for (const [index, key] of path.keys.entries()) {
      const object = unwrapExpression(current);
      if (!ts.isObjectLiteralExpression(object)) return unsupported('non_constant_property');
      const initializer = propertyInitializer(object, key, context);
      if (initializer === null) return unsupported('non_constant_property');
      current = initializer;
      if (
        index < path.keys.length - 1 &&
        !ts.isObjectLiteralExpression(unwrapExpression(current))
      ) {
        return unsupported('non_constant_property');
      }
    }
    return resolveExpression(current, context, depth + 1);
  } finally {
    context.resolvingSymbols.delete(symbol);
  }
}

function resolveIdentifier(
  expression: ts.Identifier,
  context: ResolutionContext,
  depth: number,
): InternalResolution {
  const symbol = resolveAliasedSymbol(
    context.checker,
    context.checker.getSymbolAtLocation(expression),
  );
  if (symbol === null) return unsupported('non_variable_symbol');
  if (context.resolvingSymbols.has(symbol)) return unsupported('cyclic_reference');

  const declaration = uniqueVariableDeclaration(symbol);
  if (declaration === null) return unsupported('ambiguous_symbol');
  noteEvidence(context, declaration);
  if (!isImmutableVariable(declaration)) return unsupported('mutable_binding');
  if (declaration.initializer === undefined) return unsupported('missing_initializer');
  noteEvidence(context, declaration.initializer);

  context.resolvingSymbols.add(symbol);
  try {
    return resolveExpression(declaration.initializer, context, depth + 1);
  } finally {
    context.resolvingSymbols.delete(symbol);
  }
}

function resolveExpression(
  expression: ts.Expression,
  context: ResolutionContext,
  depth: number,
): InternalResolution {
  noteEvidence(context, expression);
  const value = literalValue(expression);
  if (value !== null) return { status: 'resolved', value };
  if (depth >= MAX_STRING_RESOLUTION_DEPTH) return unsupported('resolution_depth_exceeded');

  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return resolveIdentifier(current, context, depth);
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const constant = enumConstant(current, context);
    return constant === null
      ? resolveConstObjectAccess(current, context, depth)
      : { status: 'resolved', value: constant };
  }
  return unsupported('dynamic_expression');
}

/**
 * Resolve a bounded, immutable string expression without evaluating target code.
 * TypeScript owns import and `paths` resolution; this helper only follows symbols
 * already present in the selected program.
 */
export function resolveSimpleString(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): SimpleStringResolution {
  const context: ResolutionContext = {
    checker,
    evidenceNodes: [],
    evidenceNodeSet: new Set(),
    resolvingSymbols: new Set(),
  };
  const result = resolveExpression(expression, context, 0);
  return { ...result, evidenceNodes: context.evidenceNodes };
}
