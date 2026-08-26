import ts from 'typescript';
import { resolveAliasedSymbol, symbolAt, symbolDeclarationFile } from './symbols.js';

export type DecoratorImportKind = 'default' | 'named' | 'namespace' | null;

export interface ResolvedDecoratorIdentity {
  readonly node: ts.Decorator;
  readonly expression: ts.LeftHandSideExpression;
  readonly localName: string;
  readonly exportedName: string;
  readonly moduleSpecifier: string | null;
  readonly importKind: DecoratorImportKind;
  readonly symbol: ts.Symbol | null;
  readonly declarationFile: string | null;
}

interface ImportOrigin {
  readonly moduleSpecifier: string;
  readonly exportedName: string;
  readonly importKind: Exclude<DecoratorImportKind, null>;
}

export interface ResolvedImportedExpressionIdentity {
  readonly exportedName: string;
  readonly moduleSpecifier: string | null;
  readonly symbol: ts.Symbol | null;
  readonly declarationFile: string | null;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function importDeclarationFor(node: ts.Node): ts.ImportDeclaration | null {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return null;
}

function moduleSpecifierFor(node: ts.Node): string | null {
  const declaration = importDeclarationFor(node);
  return declaration !== null && ts.isStringLiteral(declaration.moduleSpecifier)
    ? declaration.moduleSpecifier.text
    : null;
}

function originForIdentifier(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  propertyName?: string,
): ImportOrigin | null {
  const alias = symbolAt(checker, identifier);

  for (const declaration of alias?.declarations ?? []) {
    const moduleSpecifier = moduleSpecifierFor(declaration);
    if (moduleSpecifier === null) continue;

    if (ts.isImportSpecifier(declaration)) {
      return {
        moduleSpecifier,
        exportedName: declaration.propertyName?.text ?? declaration.name.text,
        importKind: 'named',
      };
    }
    if (ts.isImportClause(declaration) && declaration.name === identifier) {
      return { moduleSpecifier, exportedName: 'default', importKind: 'default' };
    }
    if (ts.isNamespaceImport(declaration)) {
      return {
        moduleSpecifier,
        exportedName: propertyName ?? identifier.text,
        importKind: 'namespace',
      };
    }
  }

  return null;
}

function decoratorTarget(decorator: ts.Decorator): ts.LeftHandSideExpression {
  const expression = decorator.expression;
  return ts.isCallExpression(expression) ? expression.expression : expression;
}

export function resolveImportedExpressionIdentity(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
): ResolvedImportedExpressionIdentity {
  let origin: ImportOrigin | null = null;
  let exportedName = expression.getText();

  if (ts.isIdentifier(expression)) {
    exportedName = expression.text;
    origin = originForIdentifier(expression, checker);
  } else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    exportedName = expression.name.text;
    origin = originForIdentifier(expression.expression, checker, expression.name.text);
  }

  const aliasSymbol =
    symbolAt(checker, expression) ??
    (ts.isPropertyAccessExpression(expression) ? symbolAt(checker, expression.name) : null);
  const symbol = resolveAliasedSymbol(checker, aliasSymbol ?? undefined);

  return {
    exportedName: origin?.exportedName ?? exportedName,
    moduleSpecifier: origin?.moduleSpecifier ?? null,
    symbol,
    declarationFile: symbolDeclarationFile(symbol),
  };
}

export function resolveDecoratorIdentity(
  decorator: ts.Decorator,
  checker: ts.TypeChecker,
): ResolvedDecoratorIdentity {
  const expression = decoratorTarget(decorator);
  let origin: ImportOrigin | null = null;
  let localName = expression.getText();

  if (ts.isIdentifier(expression)) {
    localName = expression.text;
    origin = originForIdentifier(expression, checker);
  } else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    localName = expression.name.text;
    origin = originForIdentifier(expression.expression, checker, expression.name.text);
  }

  const importedExpression = resolveImportedExpressionIdentity(expression, checker);

  return {
    node: decorator,
    expression,
    localName,
    exportedName: origin?.exportedName ?? localName,
    moduleSpecifier: origin?.moduleSpecifier ?? null,
    importKind: origin?.importKind ?? null,
    symbol: importedExpression.symbol,
    declarationFile: importedExpression.declarationFile,
  };
}

export function resolveDecorators(
  node: ts.Node,
  checker: ts.TypeChecker,
): readonly ResolvedDecoratorIdentity[] {
  return decoratorsOf(node).map((decorator) => resolveDecoratorIdentity(decorator, checker));
}

export function isImportedDecorator(
  identity: ResolvedDecoratorIdentity,
  moduleSpecifier: string,
  exportedName: string,
): boolean {
  return (
    identity.symbol !== null &&
    identity.declarationFile !== null &&
    identity.moduleSpecifier === moduleSpecifier &&
    identity.exportedName === exportedName
  );
}
