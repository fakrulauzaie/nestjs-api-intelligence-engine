import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { GlobalGuardAnalysis } from '../model/analysis.js';
import type { AssertionPredicate, AssertionRecord } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type {
  ClassRecord,
  ClassRole,
  GlobalGuardRegistrationKind,
  GlobalGuardRegistrationRecord,
  GuardRecord,
  ModuleRecord,
} from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { GLOBAL_GUARD_RULE_IDS } from '../model/guard-rules.js';
import {
  makeAssertionId,
  makeGlobalGuardRegistrationId,
  makeGuardId,
  makeModuleId,
} from '../model/ids.js';
import { resolveImportedExpressionIdentity } from '../ts-index/decorators.js';
import { resolvedSymbolAt, symbolAt } from '../ts-index/symbols.js';
import type { IndexedClass, IndexedSourceFile, SourceIndex } from '../ts-index/source-index.js';
import { createClassRecord, createDeclarationEvidence } from './canonical-records.js';
import { isPackageDecorator, isPackageExpression } from './package-symbols.js';

const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_CORE_MODULE = '@nestjs/core';
const NEST_EVENT_EMITTER_MODULE = '@nestjs/event-emitter';

export const NEST_MODULE_RULE_IDS = {
  import: 'nest.module.import.v1',
  provider: 'nest.module.provider.v1',
  exportClass: 'nest.module.export-class.v1',
  exportModule: 'nest.module.export-module.v1',
  controller: 'nest.module.controller.v1',
} as const;

interface ClassLocation {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
}

interface ModuleLocation extends ClassLocation {
  readonly moduleId: string;
  readonly metadata: ts.ObjectLiteralExpression | null;
}

interface PendingRegistration {
  readonly moduleId: string;
  readonly guardId: string;
  readonly kind: GlobalGuardRegistrationKind;
  readonly predicate: Extract<
    AssertionPredicate,
    'MODULE_REGISTERS_GLOBAL_GUARD' | 'APPLICATION_REGISTERS_GLOBAL_GUARD'
  >;
  readonly evidenceId: string;
  readonly orderKey: string;
}

export interface NestModuleExtraction {
  readonly classes: readonly ClassRecord[];
  readonly modules: readonly ModuleRecord[];
  readonly guards: readonly GuardRecord[];
  readonly globalGuardRegistrations: readonly GlobalGuardRegistrationRecord[];
  readonly globalGuardAnalysis: GlobalGuardAnalysis;
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  /** Internal scan context used to scope application-global facts. */
  readonly applicationRootModuleIds: readonly string[];
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

function isNestFactoryCreate(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'create') {
    return false;
  }
  const factory = unwrapExpression(expression.expression);
  if (!ts.isLeftHandSideExpression(factory)) return false;
  return isPackageExpression(
    resolveImportedExpressionIdentity(factory, checker),
    NEST_CORE_MODULE,
    'NestFactory',
  );
}

function isSupportedExternalModuleImport(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const current = unwrapExpression(expression);
  if (!ts.isCallExpression(current)) return false;
  const callee = unwrapExpression(current.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'forRoot') return false;
  const owner = unwrapExpression(callee.expression);
  return (
    ts.isLeftHandSideExpression(owner) &&
    isPackageExpression(
      resolveImportedExpressionIdentity(owner, checker),
      NEST_EVENT_EMITTER_MODULE,
      'EventEmitterModule',
    )
  );
}

function constInitializer(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.Expression | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) return null;
  const symbol = resolvedSymbolAt(checker, unwrapped);
  const declaration = symbol?.valueDeclaration;
  if (
    symbol === null ||
    declaration === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer === undefined ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    (declaration.parent.flags & ts.NodeFlags.Const) === 0
  ) {
    return null;
  }
  if (constBindingEscapesOrIsMutated(symbol, declaration, checker)) return null;
  return declaration.initializer;
}

const MUTATING_COLLECTION_METHODS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

function constBindingEscapesOrIsMutated(
  symbol: ts.Symbol,
  declaration: ts.VariableDeclaration,
  checker: ts.TypeChecker,
): boolean {
  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (
      !ts.isIdentifier(node) ||
      node === declaration.name ||
      resolvedSymbolAt(checker, node) !== symbol
    ) {
      ts.forEachChild(node, visit);
      return;
    }

    let access: ts.Node = node;
    while (
      (ts.isPropertyAccessExpression(access.parent) ||
        ts.isElementAccessExpression(access.parent)) &&
      access.parent.expression === access
    ) {
      access = access.parent;
    }
    const parent = access.parent;
    if (
      (ts.isBinaryExpression(parent) &&
        parent.left === access &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken ||
          parent.operator === ts.SyntaxKind.MinusMinusToken)) ||
      (ts.isDeleteExpression(parent) && parent.expression === access)
    ) {
      unsafe = true;
      return;
    }

    if (
      ts.isPropertyAccessExpression(access) &&
      MUTATING_COLLECTION_METHODS.has(access.name.text) &&
      ts.isCallExpression(parent) &&
      parent.expression === access
    ) {
      unsafe = true;
      return;
    }

    if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === access)) {
      unsafe = true;
      return;
    }
  };
  visit(declaration.getSourceFile());
  return unsafe;
}

function resolveStaticArray(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  visited: ReadonlySet<ts.Symbol> = new Set(),
  identifierHops = 0,
): { readonly elements: readonly ts.Expression[]; readonly complete: boolean } {
  let current = unwrapExpression(expression);
  let nextVisited = visited;
  if (ts.isIdentifier(current)) {
    if (identifierHops >= 1) return { elements: [], complete: false };
    const symbol = resolvedSymbolAt(checker, current);
    if (symbol === null || visited.has(symbol)) return { elements: [], complete: false };
    const initializer = constInitializer(current, checker);
    if (initializer === null) return { elements: [], complete: false };
    nextVisited = new Set([...visited, symbol]);
    current = unwrapExpression(initializer);
    identifierHops += 1;
  }
  if (!ts.isArrayLiteralExpression(current)) return { elements: [], complete: false };

  const elements: ts.Expression[] = [];
  let complete = true;
  for (const element of current.elements) {
    if (ts.isOmittedExpression(element)) {
      complete = false;
      continue;
    }
    if (ts.isSpreadElement(element)) {
      const spread = resolveStaticArray(element.expression, checker, nextVisited, identifierHops);
      elements.push(...spread.elements);
      complete &&= spread.complete;
      continue;
    }
    elements.push(element);
  }
  return { elements, complete };
}

function resolveObjectLiteral(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.ObjectLiteralExpression | null {
  const current = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(current)) return current;
  const initializer = constInitializer(current, checker);
  if (initializer === null) return null;
  const unwrapped = unwrapExpression(initializer);
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : null;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    !('name' in property) ||
    property.name === undefined ||
    ts.isComputedPropertyName(property.name)
  ) {
    return null;
  }
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    return property.name.text;
  return null;
}

function propertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const property of object.properties) {
    if (propertyName(property) !== name) continue;
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
  }
  return null;
}

function isConditional(node: ts.Node, boundary: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && current !== boundary) {
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isSwitchStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      ts.isTryStatement(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function padded(value: number): string {
  return value.toString().padStart(10, '0');
}

export function extractNestModules(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
}): NestModuleExtraction {
  const classLocationsBySymbol = new Map<ts.Symbol, ClassLocation[]>();
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      if (indexedClass.symbol === null) continue;
      classLocationsBySymbol.set(indexedClass.symbol, [
        ...(classLocationsBySymbol.get(indexedClass.symbol) ?? []),
        { source, indexedClass },
      ]);
    }
  }

  const classesById = new Map<string, ClassRecord>();
  const modulesById = new Map<string, ModuleRecord>();
  const guardsById = new Map<string, GuardRecord>();
  const assertionsById = new Map<string, AssertionRecord>();
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticsById = new Map<string, DiagnosticRecord>();
  const pendingRegistrations: PendingRegistration[] = [];
  const moduleLocations: ModuleLocation[] = [];
  const applicationRootModuleIds = new Set<string>();
  let globalComplete = true;

  const addEvidence = (record: EvidenceRecord): string => {
    evidenceById.set(record.id, record);
    return record.id;
  };
  const evidenceFor = (source: IndexedSourceFile, node: ts.Node): string =>
    addEvidence(
      createEvidenceForNode({
        sourceFile: source.sourceFile,
        sourceFileRecord: source.inventorySource.record,
        node,
        role: 'resolution_basis',
        snippetLimit: input.evidenceSnippetLimit,
      }),
    );

  const ensureClass = (location: ClassLocation, roles: readonly ClassRole[]): ClassRecord => {
    const declarationEvidenceId = addEvidence(
      createDeclarationEvidence(
        location.source,
        location.indexedClass.node,
        input.evidenceSnippetLimit,
      ),
    );
    const created = createClassRecord({
      source: location.source,
      indexedClass: location.indexedClass,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId,
      roles,
    });
    const existing = classesById.get(created.id);
    const record =
      existing === undefined
        ? created
        : { ...existing, roles: [...new Set([...existing.roles, ...roles])] };
    classesById.set(record.id, record);
    return record;
  };

  const classLocation = (expression: ts.Expression): ClassLocation | null => {
    const symbol = resolvedSymbolAt(input.checker, unwrapExpression(expression));
    const candidates = symbol === null ? [] : (classLocationsBySymbol.get(symbol) ?? []);
    return candidates.length === 1 ? candidates[0]! : null;
  };

  const addAssertion = (inputAssertion: {
    subjectId: string;
    predicate: AssertionPredicate;
    objectId: string;
    ruleId: string;
    evidenceId: string;
  }): AssertionRecord => {
    const id = makeAssertionId(inputAssertion);
    const assertion: AssertionRecord = {
      id,
      subjectId: inputAssertion.subjectId,
      predicate: inputAssertion.predicate,
      objectId: inputAssertion.objectId,
      status: 'resolved',
      ruleId: inputAssertion.ruleId,
      evidenceIds: [inputAssertion.evidenceId],
    };
    const existing = assertionsById.get(id);
    const merged =
      existing === undefined
        ? assertion
        : {
            ...existing,
            evidenceIds: [...new Set([...existing.evidenceIds, inputAssertion.evidenceId])],
          };
    assertionsById.set(id, merged);
    return merged;
  };

  const addDiagnostic = (inputDiagnostic: {
    code:
      | 'NEST_MODULE_METADATA_UNRESOLVED'
      | 'NEST_GLOBAL_GUARD_UNRESOLVED'
      | 'NEST_BOOTSTRAP_GUARD_UNRESOLVED';
    subjectId?: string;
    message: string;
    evidenceIds: readonly string[];
  }): void => {
    const diagnostic = createDiagnostic(inputDiagnostic);
    diagnosticsById.set(diagnostic.id, diagnostic);
    globalComplete = false;
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const moduleDecorator = indexedClass.decorators.find((decorator) =>
        isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Module'),
      );
      if (moduleDecorator === undefined) continue;
      const sourceClass = ensureClass({ source, indexedClass }, ['module']);
      const moduleId = makeModuleId(sourceClass.id);
      const call = ts.isCallExpression(moduleDecorator.node.expression)
        ? moduleDecorator.node.expression
        : null;
      const metadataExpression = call?.arguments[0];
      const unwrappedMetadata =
        metadataExpression === undefined ? null : unwrapExpression(metadataExpression);
      const metadata =
        unwrappedMetadata !== null && ts.isObjectLiteralExpression(unwrappedMetadata)
          ? unwrappedMetadata
          : null;
      const isGlobal = indexedClass.decorators.some((decorator) =>
        isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Global'),
      );
      modulesById.set(moduleId, {
        id: moduleId,
        classId: sourceClass.id,
        isGlobal,
        metadataCompleteness: metadata === null ? 'incomplete' : 'complete',
        declarationEvidenceId: sourceClass.declarationEvidenceId,
      });
      moduleLocations.push({ source, indexedClass, moduleId, metadata });
      if (metadata === null) {
        addDiagnostic({
          code: 'NEST_MODULE_METADATA_UNRESOLVED',
          subjectId: moduleId,
          message: `@Module metadata for ${indexedClass.qualifiedName} is not a supported object literal.`,
          evidenceIds: [evidenceFor(source, moduleDecorator.node)],
        });
      }
    }
  }

  const moduleByClassId = new Map(
    [...modulesById.values()].map((moduleRecord) => [moduleRecord.classId, moduleRecord]),
  );
  const markModuleIncomplete = (
    moduleLocation: ModuleLocation,
    node: ts.Node,
    message: string,
    code:
      | 'NEST_MODULE_METADATA_UNRESOLVED'
      | 'NEST_GLOBAL_GUARD_UNRESOLVED' = 'NEST_MODULE_METADATA_UNRESOLVED',
  ): void => {
    const moduleRecord = modulesById.get(moduleLocation.moduleId)!;
    modulesById.set(moduleRecord.id, { ...moduleRecord, metadataCompleteness: 'incomplete' });
    addDiagnostic({
      code,
      subjectId: moduleRecord.id,
      message,
      evidenceIds: [evidenceFor(moduleLocation.source, node)],
    });
  };

  const resolveModuleReference = (expression: ts.Expression): ModuleRecord | null => {
    let targetExpression = unwrapExpression(expression);
    if (ts.isCallExpression(targetExpression)) {
      const identity = resolveImportedExpressionIdentity(
        targetExpression.expression,
        input.checker,
      );
      if (!isPackageExpression(identity, NEST_COMMON_MODULE, 'forwardRef')) return null;
      const callback = targetExpression.arguments[0];
      if (
        callback === undefined ||
        (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
        callback.parameters.length !== 0 ||
        ts.isBlock(callback.body)
      ) {
        return null;
      }
      targetExpression = unwrapExpression(callback.body);
    }
    const location = classLocation(targetExpression);
    if (location === null) return null;
    const record = ensureClass(location, ['module']);
    return moduleByClassId.get(record.id) ?? null;
  };

  const ensureGuard = (
    expression: ts.Expression,
  ): { guard: GuardRecord; sourceClass: ClassRecord } | null => {
    const location = classLocation(expression);
    if (location === null) return null;
    const sourceClass = ensureClass(location, ['guard']);
    const guard: GuardRecord = {
      id: makeGuardId(sourceClass.id),
      classId: sourceClass.id,
      displayName: sourceClass.displayName,
    };
    guardsById.set(guard.id, guard);
    return { guard, sourceClass };
  };

  for (const moduleLocation of moduleLocations) {
    if (moduleLocation.metadata === null) continue;
    const metadata = moduleLocation.metadata;
    if (
      metadata.properties.some(
        (property) => ts.isSpreadAssignment(property) || propertyName(property) === null,
      )
    ) {
      markModuleIncomplete(
        moduleLocation,
        metadata,
        `@Module metadata for ${moduleLocation.indexedClass.qualifiedName} contains computed or spread properties.`,
      );
    }

    const arrays = new Map<
      'imports' | 'providers' | 'exports' | 'controllers',
      { readonly elements: readonly ts.Expression[]; readonly complete: boolean }
    >();
    for (const field of ['imports', 'providers', 'exports', 'controllers'] as const) {
      const matchingProperties = metadata.properties.filter(
        (property) => propertyName(property) === field,
      );
      if (matchingProperties.length === 0) {
        arrays.set(field, { elements: [], complete: true });
        continue;
      }
      const property = matchingProperties[0]!;
      const initializer =
        matchingProperties.length === 1 && ts.isPropertyAssignment(property)
          ? property.initializer
          : matchingProperties.length === 1 && ts.isShorthandPropertyAssignment(property)
            ? property.name
            : null;
      if (initializer === null) {
        arrays.set(field, { elements: [], complete: false });
        markModuleIncomplete(
          moduleLocation,
          property,
          `${field} metadata for ${moduleLocation.indexedClass.qualifiedName} is duplicated or is not a supported property assignment.`,
        );
        continue;
      }
      const resolved = resolveStaticArray(initializer, input.checker);
      arrays.set(field, resolved);
      if (!resolved.complete) {
        markModuleIncomplete(
          moduleLocation,
          initializer,
          `${field} metadata for ${moduleLocation.indexedClass.qualifiedName} is dynamic or exceeds the one-hop const boundary.`,
        );
      }
    }

    for (const expression of arrays.get('imports')!.elements) {
      const importedModule = resolveModuleReference(expression);
      if (importedModule === null) {
        if (isSupportedExternalModuleImport(expression, input.checker)) continue;
        markModuleIncomplete(
          moduleLocation,
          expression,
          `Module import ${expression.getText()} is dynamic or not a proven repository @Module class.`,
        );
        continue;
      }
      addAssertion({
        subjectId: moduleLocation.moduleId,
        predicate: 'MODULE_IMPORTS_MODULE',
        objectId: importedModule.id,
        ruleId: NEST_MODULE_RULE_IDS.import,
        evidenceId: evidenceFor(moduleLocation.source, expression),
      });
    }

    const directProviderClassIds = new Set<string>();
    const providerObjects: {
      expression: ts.Expression;
      object: ts.ObjectLiteralExpression;
      index: number;
    }[] = [];
    for (const [index, expression] of arrays.get('providers')!.elements.entries()) {
      const location = classLocation(expression);
      if (location !== null) {
        const sourceClass = ensureClass(location, ['provider']);
        directProviderClassIds.add(sourceClass.id);
        addAssertion({
          subjectId: moduleLocation.moduleId,
          predicate: 'MODULE_PROVIDES_CLASS',
          objectId: sourceClass.id,
          ruleId: NEST_MODULE_RULE_IDS.provider,
          evidenceId: evidenceFor(moduleLocation.source, expression),
        });
        continue;
      }
      const object = resolveObjectLiteral(expression, input.checker);
      if (object === null) {
        markModuleIncomplete(
          moduleLocation,
          expression,
          `Provider ${expression.getText()} is not a supported class or one-hop provider object.`,
        );
        continue;
      }
      if (
        object.properties.some(
          (property) => ts.isSpreadAssignment(property) || propertyName(property) === null,
        )
      ) {
        markModuleIncomplete(
          moduleLocation,
          object,
          `Provider ${expression.getText()} contains computed or spread properties that could hide or override a global token.`,
          'NEST_GLOBAL_GUARD_UNRESOLVED',
        );
        continue;
      }
      providerObjects.push({ expression, object, index });
    }

    for (const provider of providerObjects) {
      const propertiesNamed = (name: string): ts.ObjectLiteralElementLike[] =>
        provider.object.properties.filter((property) => propertyName(property) === name);
      const tokenProperties = propertiesNamed('provide');
      if (tokenProperties.length !== 1) {
        if (tokenProperties.length > 1) {
          markModuleIncomplete(
            moduleLocation,
            provider.object,
            'Provider object has duplicate provide fields, so its token is not statically unique.',
            'NEST_GLOBAL_GUARD_UNRESOLVED',
          );
        }
        continue;
      }
      const token = propertyInitializer(provider.object, 'provide');
      if (token === null) continue;
      const tokenExpression = unwrapExpression(token);
      if (!ts.isLeftHandSideExpression(tokenExpression)) continue;
      const tokenIdentity = resolveImportedExpressionIdentity(tokenExpression, input.checker);
      if (!isPackageExpression(tokenIdentity, NEST_CORE_MODULE, 'APP_GUARD')) {
        const localUseClass = propertyInitializer(provider.object, 'useClass');
        const location = localUseClass === null ? null : classLocation(localUseClass);
        if (location !== null) {
          const sourceClass = ensureClass(location, ['provider']);
          addAssertion({
            subjectId: moduleLocation.moduleId,
            predicate: 'MODULE_PROVIDES_CLASS',
            objectId: sourceClass.id,
            ruleId: NEST_MODULE_RULE_IDS.provider,
            evidenceId: evidenceFor(moduleLocation.source, provider.expression),
          });
        }
        continue;
      }

      const useClassProperties = propertiesNamed('useClass');
      const useExistingProperties = propertiesNamed('useExisting');
      const strategyCount = useClassProperties.length + useExistingProperties.length;
      const useClass =
        useClassProperties.length === 1 ? propertyInitializer(provider.object, 'useClass') : null;
      const useExisting =
        useExistingProperties.length === 1
          ? propertyInitializer(provider.object, 'useExisting')
          : null;
      const kind: GlobalGuardRegistrationKind | null =
        strategyCount === 1 && useClass !== null
          ? 'app_guard_use_class'
          : strategyCount === 1 && useExisting !== null
            ? 'app_guard_use_existing'
            : null;
      const guardExpression = useClass ?? useExisting;
      if (kind === null || guardExpression === null) {
        markModuleIncomplete(
          moduleLocation,
          provider.object,
          'APP_GUARD uses an unsupported provider form such as useFactory or useValue.',
          'NEST_GLOBAL_GUARD_UNRESOLVED',
        );
        continue;
      }
      const resolvedGuard = ensureGuard(guardExpression);
      if (
        resolvedGuard === null ||
        (kind === 'app_guard_use_existing' &&
          !directProviderClassIds.has(resolvedGuard.sourceClass.id))
      ) {
        markModuleIncomplete(
          moduleLocation,
          guardExpression,
          `APP_GUARD ${kind === 'app_guard_use_existing' ? 'useExisting' : 'useClass'} target is not exactly one supported provider class.`,
          'NEST_GLOBAL_GUARD_UNRESOLVED',
        );
        continue;
      }
      const evidenceId = evidenceFor(moduleLocation.source, provider.object);
      pendingRegistrations.push({
        moduleId: moduleLocation.moduleId,
        guardId: resolvedGuard.guard.id,
        kind,
        predicate: 'MODULE_REGISTERS_GLOBAL_GUARD',
        evidenceId,
        orderKey: `${moduleLocation.source.inventorySource.record.path}:${padded(moduleLocation.indexedClass.node.getStart())}:${padded(provider.index)}`,
      });
    }

    for (const expression of arrays.get('exports')!.elements) {
      const targetModule = resolveModuleReference(expression);
      if (targetModule !== null) {
        addAssertion({
          subjectId: moduleLocation.moduleId,
          predicate: 'MODULE_EXPORTS_MODULE',
          objectId: targetModule.id,
          ruleId: NEST_MODULE_RULE_IDS.exportModule,
          evidenceId: evidenceFor(moduleLocation.source, expression),
        });
        continue;
      }
      const location = classLocation(expression);
      if (location === null) {
        markModuleIncomplete(
          moduleLocation,
          expression,
          `Module export ${expression.getText()} is not a proven repository class or module.`,
        );
        continue;
      }
      const sourceClass = ensureClass(location, ['provider']);
      addAssertion({
        subjectId: moduleLocation.moduleId,
        predicate: 'MODULE_EXPORTS_CLASS',
        objectId: sourceClass.id,
        ruleId: NEST_MODULE_RULE_IDS.exportClass,
        evidenceId: evidenceFor(moduleLocation.source, expression),
      });
    }

    for (const expression of arrays.get('controllers')!.elements) {
      const location = classLocation(expression);
      if (location === null) {
        markModuleIncomplete(
          moduleLocation,
          expression,
          `Controller metadata ${expression.getText()} is not a proven repository class.`,
        );
        continue;
      }
      const sourceClass = ensureClass(location, ['controller']);
      addAssertion({
        subjectId: moduleLocation.moduleId,
        predicate: 'MODULE_DECLARES_CONTROLLER',
        objectId: sourceClass.id,
        ruleId: NEST_MODULE_RULE_IDS.controller,
        evidenceId: evidenceFor(moduleLocation.source, expression),
      });
    }
  }

  const moduleLocationByClassSymbol = new Map<ts.Symbol, ModuleLocation>();
  for (const location of moduleLocations) {
    if (location.indexedClass.symbol !== null) {
      moduleLocationByClassSymbol.set(location.indexedClass.symbol, location);
    }
  }

  for (const source of input.sourceIndex.sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (
        !ts.isVariableDeclaration(node) ||
        !ts.isIdentifier(node.name) ||
        node.initializer === undefined
      ) {
        ts.forEachChild(node, visit);
        return;
      }
      let initializer = unwrapExpression(node.initializer);
      if (ts.isAwaitExpression(initializer)) initializer = unwrapExpression(initializer.expression);
      if (!ts.isCallExpression(initializer)) {
        ts.forEachChild(node, visit);
        return;
      }
      if (!isNestFactoryCreate(initializer.expression, input.checker)) {
        ts.forEachChild(node, visit);
        return;
      }

      const rootExpression = initializer.arguments[0];
      const rootLocation = rootExpression === undefined ? null : classLocation(rootExpression);
      const rootModule =
        rootLocation?.indexedClass.symbol === null ||
        rootLocation?.indexedClass.symbol === undefined
          ? null
          : moduleLocationByClassSymbol.get(rootLocation.indexedClass.symbol);
      const appSymbol = symbolAt(input.checker, node.name);
      if (rootModule === null || rootModule === undefined || appSymbol === null) {
        addDiagnostic({
          code: 'NEST_BOOTSTRAP_GUARD_UNRESOLVED',
          message:
            'NestFactory.create root module or application binding is not uniquely resolvable.',
          evidenceIds: [evidenceFor(source, initializer)],
        });
        ts.forEachChild(node, visit);
        return;
      }

      applicationRootModuleIds.add(rootModule.moduleId);

      const boundary = node.parent.parent.parent;
      let escaped = false;
      const inspectReference = (candidate: ts.Node): void => {
        if (ts.isIdentifier(candidate) && symbolAt(input.checker, candidate) === appSymbol) {
          if (candidate === node.name) return;
          const parent = candidate.parent;
          if (
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === candidate &&
            ts.isCallExpression(parent.parent) &&
            parent.parent.expression === parent
          ) {
            const call = parent.parent;
            if (parent.name.text === 'useGlobalGuards') {
              if (isConditional(call, boundary)) {
                addDiagnostic({
                  code: 'NEST_BOOTSTRAP_GUARD_UNRESOLVED',
                  subjectId: rootModule.moduleId,
                  message: 'Conditional bootstrap useGlobalGuards registration is unsupported.',
                  evidenceIds: [evidenceFor(source, call)],
                });
                return;
              }
              for (const [index, argument] of call.arguments.entries()) {
                const unwrapped = unwrapExpression(argument);
                const guardExpression = ts.isNewExpression(unwrapped) ? unwrapped.expression : null;
                const guard = guardExpression === null ? null : ensureGuard(guardExpression);
                if (guard === null) {
                  addDiagnostic({
                    code: 'NEST_BOOTSTRAP_GUARD_UNRESOLVED',
                    subjectId: rootModule.moduleId,
                    message: `Bootstrap global guard ${argument.getText()} is not a direct resolvable new GuardClass expression.`,
                    evidenceIds: [evidenceFor(source, argument)],
                  });
                  continue;
                }
                const evidenceId = evidenceFor(source, argument);
                pendingRegistrations.push({
                  moduleId: rootModule.moduleId,
                  guardId: guard.guard.id,
                  kind: 'bootstrap_use_global_guards',
                  predicate: 'APPLICATION_REGISTERS_GLOBAL_GUARD',
                  evidenceId,
                  orderKey: `${source.inventorySource.record.path}:${padded(call.getStart())}:${padded(index)}`,
                });
              }
            }
            return;
          }
          escaped = true;
        }
        ts.forEachChild(candidate, inspectReference);
      };
      inspectReference(boundary);
      if (escaped) {
        addDiagnostic({
          code: 'NEST_BOOTSTRAP_GUARD_UNRESOLVED',
          subjectId: rootModule.moduleId,
          message: `Nest application binding ${node.name.text} escapes the supported direct-call boundary.`,
          evidenceIds: [evidenceFor(source, node.name)],
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source.sourceFile, visit);
  }

  if (modulesById.size === 0) globalComplete = false;

  const globalGuardRegistrations: GlobalGuardRegistrationRecord[] = [];
  for (const [order, pending] of [...pendingRegistrations]
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey))
    .entries()) {
    const ruleId = GLOBAL_GUARD_RULE_IDS[pending.kind];
    const assertion = addAssertion({
      subjectId: pending.moduleId,
      predicate: pending.predicate,
      objectId: pending.guardId,
      ruleId,
      evidenceId: pending.evidenceId,
    });
    globalGuardRegistrations.push({
      id: makeGlobalGuardRegistrationId({
        moduleId: pending.moduleId,
        guardId: pending.guardId,
        kind: pending.kind,
        registrationEvidenceId: pending.evidenceId,
      }),
      guardId: pending.guardId,
      moduleId: pending.moduleId,
      kind: pending.kind,
      order,
      assertionId: assertion.id,
      registrationEvidenceId: pending.evidenceId,
    });
  }

  const globalGuardAnalysis: GlobalGuardAnalysis = {
    completeness: globalComplete ? 'complete' : 'incomplete',
    state:
      globalGuardRegistrations.length > 0 ? 'declared' : globalComplete ? 'none_proven' : 'unknown',
  };
  return {
    classes: [...classesById.values()],
    modules: [...modulesById.values()],
    guards: [...guardsById.values()],
    globalGuardRegistrations,
    globalGuardAnalysis,
    assertions: [...assertionsById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticsById.values()],
    applicationRootModuleIds: [...applicationRootModuleIds].sort(),
  };
}
