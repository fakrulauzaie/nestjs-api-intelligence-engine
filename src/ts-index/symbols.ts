import ts from 'typescript';

export function resolveAliasedSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.Symbol | null {
  if (symbol === undefined) return null;
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;

  try {
    const resolved = checker.getAliasedSymbol(symbol);
    return resolved.flags === ts.SymbolFlags.None ? null : resolved;
  } catch {
    return null;
  }
}

export function symbolAt(checker: ts.TypeChecker, node: ts.Node | undefined): ts.Symbol | null {
  if (node === undefined) return null;
  return checker.getSymbolAtLocation(node) ?? null;
}

export function resolvedSymbolAt(
  checker: ts.TypeChecker,
  node: ts.Node | undefined,
): ts.Symbol | null {
  return resolveAliasedSymbol(
    checker,
    node === undefined ? undefined : checker.getSymbolAtLocation(node),
  );
}

export function qualifiedSymbolName(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | null,
): string | null {
  if (symbol === null) return null;
  return checker.getFullyQualifiedName(symbol);
}

export function symbolDeclarationFile(symbol: ts.Symbol | null): string | null {
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  return declaration?.getSourceFile().fileName ?? null;
}

export function declarationNameText(name: ts.DeclarationName | undefined): string {
  if (name === undefined) return '<anonymous>';
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

export function declarationQualifiedName(node: ts.ClassDeclaration): string {
  const segments = [node.name?.text ?? '<anonymous>'];
  let current: ts.Node = node.parent;

  while (!ts.isSourceFile(current)) {
    if (ts.isModuleDeclaration(current)) segments.unshift(current.name.getText());
    current = current.parent;
  }

  return segments.join('.');
}
