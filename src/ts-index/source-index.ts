import { resolve } from 'node:path';
import ts from 'typescript';
import type { InventorySourceFile, RepositoryInventory } from '../scanner/inventory.js';
import type { ResolvedDecoratorIdentity } from './decorators.js';
import { resolveDecorators } from './decorators.js';
import {
  declarationNameText,
  declarationQualifiedName,
  qualifiedSymbolName,
  resolveAliasedSymbol,
  symbolAt,
} from './symbols.js';

export interface IndexedImportBinding {
  readonly localName: string;
  readonly exportedName: string;
  readonly moduleSpecifier: string;
  readonly kind: 'default' | 'named' | 'namespace';
  readonly isTypeOnly: boolean;
  readonly aliasSymbol: ts.Symbol | null;
  readonly symbol: ts.Symbol | null;
  readonly node: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport;
}

export interface IndexedImport {
  readonly moduleSpecifier: string;
  readonly isTypeOnly: boolean;
  readonly bindings: readonly IndexedImportBinding[];
  readonly node: ts.ImportDeclaration;
}

export interface IndexedParameter {
  readonly name: string;
  readonly typeText: string | null;
  readonly decorators: readonly ResolvedDecoratorIdentity[];
  readonly node: ts.ParameterDeclaration;
  readonly symbol: ts.Symbol | null;
}

export interface IndexedConstructor {
  readonly qualifiedName: string;
  readonly parameters: readonly IndexedParameter[];
  readonly decorators: readonly ResolvedDecoratorIdentity[];
  readonly node: ts.ConstructorDeclaration;
}

export interface IndexedMethod {
  readonly name: string;
  readonly qualifiedName: string;
  readonly checkerQualifiedName: string | null;
  readonly signature: string;
  readonly parameters: readonly IndexedParameter[];
  readonly decorators: readonly ResolvedDecoratorIdentity[];
  readonly node: ts.MethodDeclaration;
  readonly symbol: ts.Symbol | null;
}

export interface IndexedClass {
  readonly name: string;
  readonly qualifiedName: string;
  readonly checkerQualifiedName: string | null;
  readonly decorators: readonly ResolvedDecoratorIdentity[];
  readonly constructors: readonly IndexedConstructor[];
  readonly methods: readonly IndexedMethod[];
  readonly node: ts.ClassDeclaration;
  readonly symbol: ts.Symbol | null;
}

export interface IndexedSourceFile {
  readonly inventorySource: InventorySourceFile;
  readonly sourceFile: ts.SourceFile;
  readonly imports: readonly IndexedImport[];
  readonly classes: readonly IndexedClass[];
}

export interface SourceIndex {
  readonly sourceFiles: readonly IndexedSourceFile[];
  readonly imports: readonly IndexedImport[];
  readonly classes: readonly IndexedClass[];
  readonly constructors: readonly IndexedConstructor[];
  readonly methods: readonly IndexedMethod[];
  readonly sourceByPath: ReadonlyMap<string, IndexedSourceFile>;
  readonly classByQualifiedName: ReadonlyMap<string, readonly IndexedClass[]>;
  readonly methodByQualifiedName: ReadonlyMap<string, readonly IndexedMethod[]>;
}

function absolutePathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function indexParameter(node: ts.ParameterDeclaration, checker: ts.TypeChecker): IndexedParameter {
  return {
    name: node.name.getText(),
    typeText: node.type?.getText() ?? null,
    decorators: resolveDecorators(node, checker),
    node,
    symbol: symbolAt(checker, node.name),
  };
}

function indexMethod(
  node: ts.MethodDeclaration,
  classQualifiedName: string,
  checker: ts.TypeChecker,
): IndexedMethod {
  const name = declarationNameText(node.name);
  const symbol = symbolAt(checker, node.name);
  const signature = checker.getSignatureFromDeclaration(node);
  const methodText = node.getText();
  const bodyStart = methodText.indexOf('{');

  return {
    name,
    qualifiedName: `${classQualifiedName}.${name}`,
    checkerQualifiedName: qualifiedSymbolName(checker, symbol),
    signature:
      signature === undefined
        ? methodText.slice(0, bodyStart < 0 ? undefined : bodyStart).trim()
        : checker.signatureToString(signature, node, ts.TypeFormatFlags.NoTruncation),
    parameters: node.parameters.map((parameter) => indexParameter(parameter, checker)),
    decorators: resolveDecorators(node, checker),
    node,
    symbol,
  };
}

function indexClass(node: ts.ClassDeclaration, checker: ts.TypeChecker): IndexedClass {
  const name = node.name?.text ?? '<anonymous>';
  const qualifiedName = declarationQualifiedName(node);
  const symbol = symbolAt(checker, node.name);
  const constructors: IndexedConstructor[] = [];
  const methods: IndexedMethod[] = [];

  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      constructors.push({
        qualifiedName: `${qualifiedName}.constructor`,
        parameters: member.parameters.map((parameter) => indexParameter(parameter, checker)),
        decorators: resolveDecorators(member, checker),
        node: member,
      });
    } else if (ts.isMethodDeclaration(member)) {
      methods.push(indexMethod(member, qualifiedName, checker));
    }
  }

  return {
    name,
    qualifiedName,
    checkerQualifiedName: qualifiedSymbolName(checker, symbol),
    decorators: resolveDecorators(node, checker),
    constructors,
    methods,
    node,
    symbol,
  };
}

function binding(
  node: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport,
  moduleSpecifier: string,
  exportedName: string,
  kind: IndexedImportBinding['kind'],
  isTypeOnly: boolean,
  checker: ts.TypeChecker,
): IndexedImportBinding {
  const name = ts.isImportClause(node) ? node.name : node.name;
  const aliasSymbol = symbolAt(checker, name);
  return {
    localName: name?.text ?? '<missing>',
    exportedName,
    moduleSpecifier,
    kind,
    isTypeOnly,
    aliasSymbol,
    symbol: resolveAliasedSymbol(checker, aliasSymbol ?? undefined),
    node,
  };
}

function indexImport(node: ts.ImportDeclaration, checker: ts.TypeChecker): IndexedImport | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return null;
  const moduleSpecifier = node.moduleSpecifier.text;
  const clause = node.importClause;
  const bindings: IndexedImportBinding[] = [];

  if (clause?.name !== undefined) {
    bindings.push(
      binding(clause, moduleSpecifier, 'default', 'default', clause.isTypeOnly, checker),
    );
  }
  if (clause?.namedBindings !== undefined) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push(
        binding(
          clause.namedBindings,
          moduleSpecifier,
          '*',
          'namespace',
          clause.isTypeOnly,
          checker,
        ),
      );
    } else {
      for (const specifier of clause.namedBindings.elements) {
        bindings.push(
          binding(
            specifier,
            moduleSpecifier,
            specifier.propertyName?.text ?? specifier.name.text,
            'named',
            clause.isTypeOnly || specifier.isTypeOnly,
            checker,
          ),
        );
      }
    }
  }

  return {
    moduleSpecifier,
    isTypeOnly: clause?.isTypeOnly ?? false,
    bindings,
    node,
  };
}

function addToMultiMap<T>(map: Map<string, readonly T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

export function buildSourceIndex(
  inventory: RepositoryInventory,
  program: ts.Program,
  checker: ts.TypeChecker = program.getTypeChecker(),
): SourceIndex {
  const programSources = new Map(
    program
      .getSourceFiles()
      .map((sourceFile) => [absolutePathKey(sourceFile.fileName), sourceFile]),
  );
  const indexedSources: IndexedSourceFile[] = [];

  for (const inventorySource of inventory.sourceFiles) {
    const sourceFile = programSources.get(absolutePathKey(inventorySource.absolutePath));
    if (sourceFile === undefined) continue;

    const imports: IndexedImport[] = [];
    const classes: IndexedClass[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const imported = indexImport(node, checker);
        if (imported !== null) imports.push(imported);
        return;
      }
      if (ts.isClassDeclaration(node)) classes.push(indexClass(node, checker));
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);

    indexedSources.push({ inventorySource, sourceFile, imports, classes });
  }

  const imports = indexedSources.flatMap((source) => source.imports);
  const classes = indexedSources.flatMap((source) => source.classes);
  const constructors = classes.flatMap((indexedClass) => indexedClass.constructors);
  const methods = classes.flatMap((indexedClass) => indexedClass.methods);
  const sourceByPath = new Map(
    indexedSources.map((source) => [source.inventorySource.record.path, source]),
  );
  const classByQualifiedName = new Map<string, readonly IndexedClass[]>();
  for (const indexedClass of classes) {
    addToMultiMap(classByQualifiedName, indexedClass.qualifiedName, indexedClass);
  }
  const methodByQualifiedName = new Map<string, readonly IndexedMethod[]>();
  for (const method of methods) addToMultiMap(methodByQualifiedName, method.qualifiedName, method);

  return {
    sourceFiles: indexedSources,
    imports,
    classes,
    constructors,
    methods,
    sourceByPath,
    classByQualifiedName,
    methodByQualifiedName,
  };
}
