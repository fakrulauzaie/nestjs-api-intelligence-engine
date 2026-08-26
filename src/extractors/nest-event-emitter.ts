import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord, ModuleRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  inProcessEventTargetsMatch,
  interactionTargetKey,
  validInProcessEventPattern,
  type ApplicationRecord,
  type HandlerRegistrationState,
  type InProcessEventHandlerRecord,
  type InProcessEventInteractionRecord,
  type InProcessEventTarget,
  type InteractionDispatchTiming,
} from '../model/interactions.js';
import {
  makeApplicationId,
  makeAssertionId,
  makeClassId,
  makeInteractionHandlerId,
  makeInteractionId,
} from '../model/ids.js';
import { resolveImportedExpressionIdentity } from '../ts-index/decorators.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import { resolveAliasedSymbol, resolvedSymbolAt } from '../ts-index/symbols.js';
import {
  createClassRecord,
  createDeclarationEvidence,
  createMethodRecord,
} from './canonical-records.js';
import {
  constructorToAnalyze,
  explicitParameterMemberAssignments,
  isThisMember,
  memberBindingForParameter,
} from './constructor-members.js';
import {
  declarationBelongsToPackage,
  isPackageDecorator,
  isPackageExpression,
} from './package-symbols.js';

export const EVENT_EMITTER_INTERACTION_RULE_IDS = {
  emit: 'event.in-process.event-emitter2.emit.exact.v1',
  emitAsync: 'event.in-process.event-emitter2.emit-async.exact.v1',
} as const;

export const EVENT_HANDLER_RULE_IDS = {
  synchronous: 'event.in-process.on-event.sync.exact.v1',
  asynchronous: 'event.in-process.on-event.async.exact.v1',
  unknown: 'event.in-process.on-event.timing-unknown.exact.v1',
} as const;

export const EVENT_APPLICATION_RULE_ID = 'nest.application.http-root.v1';
export const EVENT_MATCH_RULE_ID = 'event.in-process.exact-match.v1';
export const EVENT_WILDCARD_MATCH_RULE_ID = 'event.in-process.wildcard-match.v1';

const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_CORE_MODULE = '@nestjs/core';
const EVENT_EMITTER_MODULE = '@nestjs/event-emitter';
const MAX_EVENT_IDENTITY_DEPTH = 4;
const MAX_HANDLER_TARGETS = 100;

interface LocatedMethod {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly method: IndexedMethod;
}

interface ReceiverBinding {
  readonly status: 'resolved' | 'ambiguous';
  readonly resolutionNode: ts.Node;
}

interface ResolvedEventTarget {
  readonly target: InProcessEventTarget;
  readonly evidenceNodes: readonly ts.Node[];
  readonly dynamic: boolean;
  readonly wildcardShaped: boolean;
}

interface EventModuleRegistration {
  readonly moduleId: string;
  readonly configuration: EventWildcardConfiguration | null;
  readonly evidenceId: string;
}

interface EventWildcardConfiguration {
  readonly wildcard: boolean;
  readonly delimiter: string;
}

interface PendingHandler {
  readonly located: LocatedMethod;
  readonly target: ResolvedEventTarget;
  readonly handlerEvidenceId: string;
  readonly ruleId: string;
  readonly timing: InteractionDispatchTiming;
}

export interface NestEventEmitterExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly applications: readonly ApplicationRecord[];
  readonly interactions: readonly InProcessEventInteractionRecord[];
  readonly handlers: readonly InProcessEventHandlerRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly state: 'complete' | 'incomplete';
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
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

function packageClassType(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  className: string,
): boolean {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (!ts.isTypeReferenceNode(unwrapped)) return false;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(unwrapped.typeName));
  return (
    symbol?.name === className &&
    (symbol.declarations ?? []).some((declaration) =>
      declarationBelongsToPackage(declaration.getSourceFile().fileName, EVENT_EMITTER_MODULE),
    )
  );
}

function unionContainsPackageClass(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  className: string,
): boolean {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  return ts.isUnionTypeNode(unwrapped)
    ? unwrapped.types.some((child) => packageClassType(child, checker, className))
    : false;
}

function recognizedRoles(indexedClass: IndexedClass): readonly ClassRole[] {
  return [
    ...(indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Controller'),
    )
      ? (['controller'] as const)
      : []),
    ...(indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Injectable'),
    )
      ? (['provider'] as const)
      : []),
  ];
}

function assignmentCounts(indexedClass: IndexedClass): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isThisMember(node.left)
    ) {
      counts.set(node.left.name.text, (counts.get(node.left.name.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(indexedClass.node);
  return counts;
}

function collectReceiverBindings(
  indexedClass: IndexedClass,
  checker: ts.TypeChecker,
): ReadonlyMap<string, ReceiverBinding> {
  const bindings = new Map<string, ReceiverBinding>();
  const assignments = assignmentCounts(indexedClass);
  const constructor = constructorToAnalyze(indexedClass);
  if (constructor === null) return bindings;
  const explicitAssignments = explicitParameterMemberAssignments(constructor, checker);
  for (const parameter of constructor.parameters) {
    const typeNode = parameter.node.type;
    if (typeNode === undefined) continue;
    const member = memberBindingForParameter(parameter, explicitAssignments);
    const exact = packageClassType(typeNode, checker, 'EventEmitter2');
    const ambiguousType = unionContainsPackageClass(typeNode, checker, 'EventEmitter2');
    if (!exact && !ambiguousType) continue;
    if (member === null) continue;
    const expectedAssignments = ts.isParameter(member.resolutionNode) ? 0 : 1;
    const overriddenToken = parameter.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Inject'),
    );
    bindings.set(member.memberName, {
      status:
        exact &&
        !overriddenToken &&
        (assignments.get(member.memberName) ?? 0) === expectedAssignments
          ? 'resolved'
          : 'ambiguous',
      resolutionNode: member.resolutionNode,
    });
  }
  return bindings;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    !('name' in property) ||
    property.name === undefined ||
    ts.isComputedPropertyName(property.name)
  ) {
    return null;
  }
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
    ? property.name.text
    : null;
}

function constInitializer(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.Expression | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) return null;
  const symbol = resolvedSymbolAt(checker, unwrapped);
  const declarations = symbol?.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  return ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
    declaration.initializer !== undefined
    ? declaration.initializer
    : null;
}

function staticArray(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): readonly ts.Expression[] | null {
  let current = unwrapExpression(expression);
  if (!ts.isArrayLiteralExpression(current)) {
    const initializer = constInitializer(current, checker);
    if (initializer === null) return null;
    current = unwrapExpression(initializer);
  }
  if (!ts.isArrayLiteralExpression(current)) return null;
  if (
    current.elements.some(
      (element) => ts.isSpreadElement(element) || ts.isOmittedExpression(element),
    )
  ) {
    return null;
  }
  return current.elements;
}

function objectBoolean(
  object: ts.ObjectLiteralExpression,
  name: string,
): boolean | null | undefined {
  const matches = object.properties.filter((property) => propertyName(property) === name);
  if (matches.length === 0) return undefined;
  if (matches.length !== 1 || !ts.isPropertyAssignment(matches[0]!)) return null;
  const value = unwrapExpression(matches[0]!.initializer);
  return value.kind === ts.SyntaxKind.TrueKeyword
    ? true
    : value.kind === ts.SyntaxKind.FalseKeyword
      ? false
      : null;
}

function staticObject(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.ObjectLiteralExpression | null {
  let current = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(current)) {
    const initializer = constInitializer(current, checker);
    if (initializer === null) return null;
    current = unwrapExpression(initializer);
  }
  return ts.isObjectLiteralExpression(current) ? current : null;
}

function staticString(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  depth = 0,
): string | null {
  if (depth > MAX_EVENT_IDENTITY_DEPTH) return null;
  const current = unwrapExpression(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text;
  }
  const initializer = constInitializer(current, checker);
  return initializer === null ? null : staticString(initializer, checker, depth + 1);
}

function eventWildcardConfiguration(
  option: ts.Expression | undefined,
  checker: ts.TypeChecker,
): EventWildcardConfiguration | null {
  if (option === undefined) return { wildcard: false, delimiter: '.' };
  const object = staticObject(option, checker);
  if (
    object === null ||
    object.properties.some(
      (property) => ts.isSpreadAssignment(property) || propertyName(property) === null,
    )
  ) {
    return null;
  }
  const wildcard = objectBoolean(object, 'wildcard');
  if (wildcard === null) return null;
  const delimiterProperties = object.properties.filter(
    (property) => propertyName(property) === 'delimiter',
  );
  if (delimiterProperties.length > 1) return null;
  const delimiterProperty = delimiterProperties[0];
  const delimiter =
    delimiterProperty === undefined
      ? '.'
      : ts.isPropertyAssignment(delimiterProperty)
        ? staticString(delimiterProperty.initializer, checker)
        : null;
  if (delimiter === null || delimiter.length === 0 || delimiter.includes('*')) return null;
  return { wildcard: wildcard ?? false, delimiter };
}

function eventEmitterForRoot(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'forRoot') return false;
  const owner = unwrapExpression(callee.expression);
  return (
    ts.isLeftHandSideExpression(owner) &&
    isPackageExpression(
      resolveImportedExpressionIdentity(owner, checker),
      EVENT_EMITTER_MODULE,
      'EventEmitterModule',
    )
  );
}

function nestFactoryCreate(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'create') return false;
  const owner = unwrapExpression(callee.expression);
  return (
    ts.isLeftHandSideExpression(owner) &&
    isPackageExpression(
      resolveImportedExpressionIdentity(owner, checker),
      NEST_CORE_MODULE,
      'NestFactory',
    )
  );
}

function declarationSymbolKey(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceByAbsolutePath: ReadonlyMap<string, IndexedSourceFile>,
): { readonly key: string; readonly declaration: ts.VariableDeclaration } | null {
  const symbol = resolvedSymbolAt(checker, unwrapExpression(expression));
  const declarations = symbol?.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  if (
    !ts.isIdentifier(declaration.name) ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    (declaration.parent.flags & ts.NodeFlags.Const) === 0 ||
    declaration.initializer === undefined ||
    (checker.getTypeAtLocation(expression).flags & ts.TypeFlags.UniqueESSymbol) === 0
  ) {
    return null;
  }
  const source = sourceByAbsolutePath.get(absolutePathKey(declaration.getSourceFile().fileName));
  return source === undefined
    ? null
    : { key: `${source.inventorySource.record.path}#${declaration.name.text}`, declaration };
}

function resolveEventTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceByAbsolutePath: ReadonlyMap<string, IndexedSourceFile>,
  visited: ReadonlySet<ts.Symbol> = new Set(),
  depth = 0,
): ResolvedEventTarget {
  const dynamic = (nodes: readonly ts.Node[]): ResolvedEventTarget => ({
    target: { targetKind: 'event', identityKind: 'dynamic', value: null },
    evidenceNodes: nodes,
    dynamic: true,
    wildcardShaped: false,
  });
  if (depth > MAX_EVENT_IDENTITY_DEPTH) return dynamic([expression]);
  const current = unwrapExpression(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return {
      target: { targetKind: 'event', identityKind: 'string', value: current.text },
      evidenceNodes: [expression],
      dynamic: false,
      wildcardShaped: current.text.includes('*'),
    };
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const enumMember = resolvedSymbolAt(checker, current)?.declarations?.find(ts.isEnumMember);
    const enumValue =
      checker.getConstantValue(current) ??
      (enumMember === undefined ? undefined : checker.getConstantValue(enumMember));
    if (typeof enumValue === 'string') {
      return {
        target: { targetKind: 'event', identityKind: 'string', value: enumValue },
        evidenceNodes: [expression],
        dynamic: false,
        wildcardShaped: enumValue.includes('*'),
      };
    }
  }
  const symbolIdentity = declarationSymbolKey(current, checker, sourceByAbsolutePath);
  if (symbolIdentity !== null) {
    return {
      target: { targetKind: 'event', identityKind: 'symbol', value: symbolIdentity.key },
      evidenceNodes: [expression, symbolIdentity.declaration],
      dynamic: false,
      wildcardShaped: false,
    };
  }
  if (!ts.isIdentifier(current) && !ts.isPropertyAccessExpression(current)) {
    return dynamic([expression]);
  }
  const symbol = resolvedSymbolAt(checker, current);
  if (symbol === null || visited.has(symbol)) return dynamic([expression]);
  const variableDeclarations = symbol.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (variableDeclarations.length === 1) {
    const declaration = variableDeclarations[0]!;
    if (
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined
    ) {
      const child = resolveEventTarget(
        declaration.initializer,
        checker,
        sourceByAbsolutePath,
        new Set([...visited, symbol]),
        depth + 1,
      );
      return { ...child, evidenceNodes: [expression, declaration, ...child.evidenceNodes] };
    }
  }
  return dynamic([expression]);
}

function handlerTiming(expression: ts.Expression | undefined): {
  readonly timing: InteractionDispatchTiming;
  readonly ruleId: string;
  readonly known: boolean;
} {
  if (expression === undefined) {
    return { timing: 'synchronous', ruleId: EVENT_HANDLER_RULE_IDS.synchronous, known: true };
  }
  const current = unwrapExpression(expression);
  if (
    !ts.isObjectLiteralExpression(current) ||
    current.properties.some(
      (property) => propertyName(property) === null || ts.isSpreadAssignment(property),
    )
  ) {
    return { timing: 'unknown', ruleId: EVENT_HANDLER_RULE_IDS.unknown, known: false };
  }
  const async = objectBoolean(current, 'async');
  if (async === null) {
    return { timing: 'unknown', ruleId: EVENT_HANDLER_RULE_IDS.unknown, known: false };
  }
  return async === true
    ? { timing: 'asynchronous', ruleId: EVENT_HANDLER_RULE_IDS.asynchronous, known: true }
    : { timing: 'synchronous', ruleId: EVENT_HANDLER_RULE_IDS.synchronous, known: true };
}

function nestedFunctionBoundary(node: ts.Node, root: ts.MethodDeclaration): boolean {
  return node !== root && ts.isFunctionLike(node);
}

export function extractNestEventEmitter(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
  readonly modules: readonly ModuleRecord[];
  readonly moduleAssertions: readonly AssertionRecord[];
  readonly maxFanOutPerInteraction: number;
}): NestEventEmitterExtraction {
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );
  const classLocationBySymbol = new Map<
    ts.Symbol,
    { source: IndexedSourceFile; indexedClass: IndexedClass }
  >();
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      if (indexedClass.symbol !== null)
        classLocationBySymbol.set(indexedClass.symbol, { source, indexedClass });
    }
  }

  const classById = new Map<string, ClassRecord>();
  const methodById = new Map<string, MethodRecord>();
  const applicationById = new Map<string, ApplicationRecord>();
  const interactionById = new Map<string, InProcessEventInteractionRecord>();
  const handlerById = new Map<string, InProcessEventHandlerRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticById = new Map<string, DiagnosticRecord>();
  const pendingHandlers: PendingHandler[] = [];

  const addEvidence = (record: EvidenceRecord): string => {
    evidenceById.set(record.id, record);
    return record.id;
  };
  const evidenceForNode = (
    node: ts.Node,
    role: EvidenceRecord['role'],
    snippet: boolean,
  ): string | null => {
    const source = sourceByAbsolutePath.get(absolutePathKey(node.getSourceFile().fileName));
    if (source === undefined) return null;
    const record = createEvidenceForNode({
      sourceFile: source.sourceFile,
      sourceFileRecord: source.inventorySource.record,
      node,
      role,
      snippetLimit: input.evidenceSnippetLimit,
    });
    return addEvidence(snippet ? record : { ...record, snippet: undefined });
  };
  const ensureClass = (source: IndexedSourceFile, indexedClass: IndexedClass): ClassRecord => {
    const declarationEvidenceId = addEvidence(
      createDeclarationEvidence(source, indexedClass.node, input.evidenceSnippetLimit),
    );
    const candidate = createClassRecord({
      source,
      indexedClass,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId,
      roles: recognizedRoles(indexedClass),
    });
    const existing = classById.get(candidate.id);
    const record =
      existing === undefined
        ? candidate
        : { ...existing, roles: [...new Set([...existing.roles, ...candidate.roles])] };
    classById.set(record.id, record);
    return record;
  };
  const ensureMethod = (located: LocatedMethod): MethodRecord => {
    const owner = ensureClass(located.source, located.indexedClass);
    const declarationEvidenceId = addEvidence(
      createDeclarationEvidence(located.source, located.method.node, input.evidenceSnippetLimit),
    );
    const method = createMethodRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      method: located.method,
      classId: owner.id,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId,
    });
    methodById.set(method.id, method);
    return method;
  };
  const addAssertion = (record: AssertionRecord): void => {
    const existing = assertionById.get(record.id);
    assertionById.set(
      record.id,
      existing === undefined
        ? record
        : {
            ...existing,
            evidenceIds: [...new Set([...existing.evidenceIds, ...record.evidenceIds])],
          },
    );
  };
  const addDiagnostic = (inputDiagnostic: {
    code: DiagnosticCode;
    subjectId?: string;
    message?: string;
    evidenceIds: readonly string[];
  }): void => {
    const diagnostic = createDiagnostic(inputDiagnostic);
    diagnosticById.set(diagnostic.id, diagnostic);
  };

  const moduleByClassId = new Map(input.modules.map((module) => [module.classId, module]));
  const moduleByIndexedClass = new Map<ts.ClassDeclaration, ModuleRecord>();
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const classId = makeClassId({
        path: source.inventorySource.record.path,
        qualifiedName: indexedClass.qualifiedName,
        repositoryRevision: input.repositoryRevision,
      });
      const module = moduleByClassId.get(classId);
      if (module !== undefined) moduleByIndexedClass.set(indexedClass.node, module);
    }
  }

  const eventRegistrations: EventModuleRegistration[] = [];
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const module = moduleByIndexedClass.get(indexedClass.node);
      if (module === undefined) continue;
      const decorator = indexedClass.decorators.find((candidate) =>
        isPackageDecorator(candidate, NEST_COMMON_MODULE, 'Module'),
      );
      const call =
        decorator !== undefined && ts.isCallExpression(decorator.node.expression)
          ? decorator.node.expression
          : null;
      const metadataExpression = call?.arguments[0];
      const metadata =
        metadataExpression === undefined ? null : unwrapExpression(metadataExpression);
      if (metadata === null || !ts.isObjectLiteralExpression(metadata)) continue;
      const importsProperty = metadata.properties.find(
        (property) => propertyName(property) === 'imports',
      );
      const importsExpression =
        importsProperty !== undefined && ts.isPropertyAssignment(importsProperty)
          ? importsProperty.initializer
          : undefined;
      const imports =
        importsExpression === undefined ? [] : staticArray(importsExpression, input.checker);
      if (imports === null) continue;
      for (const expression of imports) {
        const candidate = unwrapExpression(expression);
        if (!ts.isCallExpression(candidate) || !eventEmitterForRoot(candidate, input.checker))
          continue;
        const evidenceId = evidenceForNode(candidate.expression, 'resolution_basis', true);
        if (evidenceId === null) continue;
        const configuration = eventWildcardConfiguration(candidate.arguments[0], input.checker);
        eventRegistrations.push({ moduleId: module.id, configuration, evidenceId });
        if (configuration === null) {
          addDiagnostic({
            code: 'EVENT_EMITTER_CONFIGURATION_UNKNOWN',
            subjectId: module.id,
            evidenceIds: [evidenceId],
            message: 'EventEmitterModule.forRoot() uses dynamic or spread configuration.',
          });
        }
      }
    }
  }

  for (const source of input.sourceIndex.sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (!ts.isCallExpression(node) || !nestFactoryCreate(node, input.checker)) {
        ts.forEachChild(node, visit);
        return;
      }
      const bootstrapEvidenceId = evidenceForNode(node.expression, 'call_site', true);
      if (bootstrapEvidenceId === null) return;
      const rootExpression = node.arguments[0];
      const rootSymbol =
        rootExpression === undefined
          ? null
          : resolvedSymbolAt(input.checker, unwrapExpression(rootExpression));
      const rootLocation = rootSymbol === null ? undefined : classLocationBySymbol.get(rootSymbol);
      const rootModule =
        rootLocation === undefined
          ? undefined
          : moduleByIndexedClass.get(rootLocation.indexedClass.node);
      const applicationId = makeApplicationId({
        kind: 'http',
        rootModuleId: rootModule?.id ?? null,
        bootstrapEvidenceId,
      });
      const application: ApplicationRecord = {
        id: applicationId,
        kind: 'http',
        rootModuleId: rootModule?.id ?? null,
        rootResolution: rootModule === undefined ? 'unknown' : 'resolved',
        transportState: 'not_applicable',
        transport: null,
        bootstrapEvidenceId,
      };
      applicationById.set(application.id, application);
      if (rootModule !== undefined) {
        addAssertion({
          id: makeAssertionId({
            subjectId: application.id,
            predicate: 'APPLICATION_USES_ROOT_MODULE',
            objectId: rootModule.id,
            ruleId: EVENT_APPLICATION_RULE_ID,
          }),
          subjectId: application.id,
          predicate: 'APPLICATION_USES_ROOT_MODULE',
          objectId: rootModule.id,
          status: 'resolved',
          ruleId: EVENT_APPLICATION_RULE_ID,
          evidenceIds: [bootstrapEvidenceId],
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source.sourceFile, visit);
  }

  const importsByModule = new Map<string, string[]>();
  const modulesByClass = new Map<string, string[]>();
  for (const assertion of input.moduleAssertions) {
    if (assertion.objectId === null || assertion.status !== 'resolved') continue;
    if (assertion.predicate === 'MODULE_IMPORTS_MODULE') {
      importsByModule.set(assertion.subjectId, [
        ...(importsByModule.get(assertion.subjectId) ?? []),
        assertion.objectId,
      ]);
    } else if (
      assertion.predicate === 'MODULE_PROVIDES_CLASS' ||
      assertion.predicate === 'MODULE_DECLARES_CONTROLLER'
    ) {
      modulesByClass.set(assertion.objectId, [
        ...(modulesByClass.get(assertion.objectId) ?? []),
        assertion.subjectId,
      ]);
    }
  }
  const reachableModulesByApplication = new Map<string, ReadonlySet<string>>();
  for (const application of applicationById.values()) {
    const reachable = new Set<string>();
    const queue = application.rootModuleId === null ? [] : [application.rootModuleId];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const moduleId = queue[cursor]!;
      if (reachable.has(moduleId)) continue;
      reachable.add(moduleId);
      queue.push(...(importsByModule.get(moduleId) ?? []));
    }
    reachableModulesByApplication.set(application.id, reachable);
  }
  const applicationsForClass = (classId: string): ApplicationRecord[] => {
    const declaringModules = new Set(modulesByClass.get(classId) ?? []);
    return [...applicationById.values()].filter((application) =>
      [...(reachableModulesByApplication.get(application.id) ?? [])].some((moduleId) =>
        declaringModules.has(moduleId),
      ),
    );
  };
  const applicationContextForClass = (classId: string): string | null => {
    const applications = applicationsForClass(classId);
    return applications.length === 1 ? applications[0]!.id : null;
  };
  const hasUnknownApplicationRoot = [...applicationById.values()].some(
    ({ rootResolution }) => rootResolution === 'unknown',
  );
  const registrationsForApplication = (applicationId: string): EventModuleRegistration[] => {
    const reachable = reachableModulesByApplication.get(applicationId) ?? new Set<string>();
    return eventRegistrations.filter(({ moduleId }) => reachable.has(moduleId));
  };
  const configurationForApplication = (
    applicationId: string,
  ):
    | {
        readonly state: 'known';
        readonly value: EventWildcardConfiguration;
        readonly evidenceIds: readonly string[];
      }
    | { readonly state: 'unknown'; readonly evidenceIds: readonly string[] }
    | { readonly state: 'absent'; readonly evidenceIds: readonly string[] } => {
    const registrations = registrationsForApplication(applicationId);
    if (registrations.length === 0) return { state: 'absent', evidenceIds: [] };
    const evidenceIds = registrations.map(({ evidenceId }) => evidenceId).sort();
    if (registrations.some(({ configuration }) => configuration === null)) {
      return { state: 'unknown', evidenceIds };
    }
    const configurations = new Map(
      registrations.map(({ configuration }) => [
        `${String(configuration!.wildcard)}:${configuration!.delimiter}`,
        configuration!,
      ]),
    );
    return configurations.size === 1
      ? { state: 'known', value: [...configurations.values()][0]!, evidenceIds }
      : { state: 'unknown', evidenceIds };
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      for (const method of indexedClass.methods) {
        const located = { source, indexedClass, method };
        for (const decorator of method.decorators.filter((candidate) =>
          isPackageDecorator(candidate, EVENT_EMITTER_MODULE, 'OnEvent'),
        )) {
          const call = ts.isCallExpression(decorator.node.expression)
            ? decorator.node.expression
            : null;
          const targetExpression = call?.arguments[0];
          const handlerEvidenceId = evidenceForNode(decorator.node, 'decorator', true);
          if (handlerEvidenceId === null) continue;
          const timing = handlerTiming(call?.arguments[1]);
          if (!timing.known) {
            const methodRecord = ensureMethod(located);
            addDiagnostic({
              code: 'EVENT_EMITTER_CONFIGURATION_UNKNOWN',
              subjectId: methodRecord.id,
              evidenceIds: [handlerEvidenceId],
              message: '@OnEvent() listener options are dynamic or unsupported.',
            });
          }
          const expressions =
            targetExpression === undefined
              ? null
              : (staticArray(targetExpression, input.checker) ?? [targetExpression]);
          if (
            expressions === null ||
            expressions.length === 0 ||
            expressions.length > MAX_HANDLER_TARGETS
          ) {
            const target = resolveEventTarget(
              targetExpression ?? decorator.node.expression,
              input.checker,
              sourceByAbsolutePath,
            );
            pendingHandlers.push({
              located,
              target,
              handlerEvidenceId,
              ruleId: timing.ruleId,
              timing: timing.timing,
            });
            continue;
          }
          for (const expression of expressions) {
            pendingHandlers.push({
              located,
              target: resolveEventTarget(expression, input.checker, sourceByAbsolutePath),
              handlerEvidenceId,
              ruleId: timing.ruleId,
              timing: timing.timing,
            });
          }
        }
      }
    }
  }

  for (const pending of pendingHandlers) {
    const method = ensureMethod(pending.located);
    const owner = classById.get(method.classId)!;
    const candidateApplications = applicationsForClass(owner.id);
    const applicationConfigurations = candidateApplications.map((application) => ({
      application,
      configuration: configurationForApplication(application.id),
    }));
    const provenApplications = applicationConfigurations
      .filter(({ configuration }) => configuration.state === 'known')
      .map(({ application }) => application);
    const unknownApplications = applicationConfigurations.filter(
      ({ configuration }) => configuration.state === 'unknown',
    );
    let registrationState: HandlerRegistrationState =
      provenApplications.length > 0
        ? 'proven_registered'
        : unknownApplications.length > 0 || applicationById.size === 0 || hasUnknownApplicationRoot
          ? 'registration_unknown'
          : 'declared_candidate';
    let handlerTarget = pending.target.target;
    let configurationEvidenceIds: readonly string[] | undefined;
    if (pending.target.wildcardShaped) {
      const knownConfigurations = applicationConfigurations.flatMap(({ configuration }) =>
        configuration.state === 'known' ? [configuration] : [],
      );
      const configurationKeys = new Set(
        knownConfigurations.map(({ value }) => `${String(value.wildcard)}:${value.delimiter}`),
      );
      const configurationComplete =
        candidateApplications.length > 0 &&
        knownConfigurations.length === candidateApplications.length &&
        configurationKeys.size === 1;
      if (!configurationComplete) {
        handlerTarget = { targetKind: 'event', identityKind: 'dynamic', value: null };
        if (candidateApplications.length > 0) registrationState = 'registration_unknown';
      } else {
        const configuration = knownConfigurations[0]!;
        if (
          configuration.value.wildcard &&
          handlerTarget.value !== null &&
          validInProcessEventPattern(handlerTarget.value, configuration.value.delimiter)
        ) {
          handlerTarget = {
            ...handlerTarget,
            pattern: { kind: 'wildcard', delimiter: configuration.value.delimiter },
          };
          configurationEvidenceIds = [
            ...new Set(knownConfigurations.flatMap(({ evidenceIds }) => evidenceIds)),
          ].sort();
        } else if (configuration.value.wildcard) {
          handlerTarget = { targetKind: 'event', identityKind: 'dynamic', value: null };
        }
      }
    }
    const applicationId =
      provenApplications.length === 1
        ? provenApplications[0]!.id
        : applicationContextForClass(owner.id);
    const handlerId = makeInteractionHandlerId({
      kind: 'in_process_event',
      methodId: method.id,
      targetKey: interactionTargetKey(handlerTarget),
      applicationId,
      handlerEvidenceId: pending.handlerEvidenceId,
    });
    const handler: InProcessEventHandlerRecord = {
      id: handlerId,
      kind: 'in_process_event',
      methodId: method.id,
      applicationId,
      registrationState,
      target: handlerTarget,
      ruleId: pending.ruleId,
      handlerEvidenceId: pending.handlerEvidenceId,
      ...(configurationEvidenceIds === undefined ? {} : { configurationEvidenceIds }),
    };
    handlerById.set(handler.id, handler);
    addAssertion({
      id: makeAssertionId({
        subjectId: handler.id,
        predicate: 'HANDLER_IMPLEMENTED_BY',
        objectId: method.id,
        ruleId: pending.ruleId,
      }),
      subjectId: handler.id,
      predicate: 'HANDLER_IMPLEMENTED_BY',
      objectId: method.id,
      status: 'resolved',
      ruleId: pending.ruleId,
      evidenceIds: [pending.handlerEvidenceId],
    });
    if (handlerTarget.identityKind === 'dynamic') {
      addDiagnostic({
        code: 'INTERACTION_TARGET_DYNAMIC',
        subjectId: handler.id,
        evidenceIds: [pending.handlerEvidenceId],
        message:
          '@OnEvent() event identity is dynamic, has unproven wildcard configuration, or is unsupported.',
      });
    }
    if (registrationState === 'registration_unknown') {
      addDiagnostic({
        code: 'EVENT_HANDLER_REGISTRATION_UNKNOWN',
        subjectId: handler.id,
        evidenceIds: [pending.handlerEvidenceId],
      });
    }
  }

  const receiverBindingsByClass = new Map<
    ts.ClassDeclaration,
    ReadonlyMap<string, ReceiverBinding>
  >();
  for (const indexedClass of input.sourceIndex.classes) {
    if (recognizedRoles(indexedClass).length === 0) continue;
    receiverBindingsByClass.set(
      indexedClass.node,
      collectReceiverBindings(indexedClass, input.checker),
    );
  }

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const bindings = receiverBindingsByClass.get(indexedClass.node);
      if (bindings === undefined || bindings.size === 0) continue;
      for (const method of indexedClass.methods) {
        const located = { source, indexedClass, method };
        const visit = (node: ts.Node): void => {
          if (nestedFunctionBoundary(node, method.node)) return;
          if (!ts.isCallExpression(node)) {
            ts.forEachChild(node, visit);
            return;
          }
          const callee = unwrapExpression(node.expression);
          if (
            !ts.isPropertyAccessExpression(callee) ||
            !['emit', 'emitAsync'].includes(callee.name.text) ||
            !isThisMember(unwrapExpression(callee.expression))
          ) {
            ts.forEachChild(node, visit);
            return;
          }
          const receiver = unwrapExpression(callee.expression);
          if (!isThisMember(receiver)) return;
          const binding = bindings.get(receiver.name.text);
          if (binding === undefined) return;
          const methodRecord = ensureMethod(located);
          const bindingEvidenceId = evidenceForNode(
            binding.resolutionNode,
            'type_reference',
            false,
          );
          const callEvidenceId = evidenceForNode(callee, 'call_site', true);
          if (callEvidenceId === null) return;
          if (binding.status === 'ambiguous') {
            addDiagnostic({
              code: 'INTERACTION_RECEIVER_AMBIGUOUS',
              subjectId: methodRecord.id,
              evidenceIds: [
                callEvidenceId,
                ...(bindingEvidenceId === null ? [] : [bindingEvidenceId]),
              ],
            });
            return;
          }
          const resolvedTarget = resolveEventTarget(
            node.arguments[0] ?? callee,
            input.checker,
            sourceByAbsolutePath,
          );
          const target: ResolvedEventTarget = resolvedTarget.wildcardShaped
            ? {
                ...resolvedTarget,
                target: { targetKind: 'event', identityKind: 'dynamic', value: null },
                dynamic: true,
              }
            : resolvedTarget;
          const targetEvidenceIds = target.evidenceNodes.flatMap((evidenceNode) => {
            const id = evidenceForNode(evidenceNode, 'resolution_basis', false);
            return id === null ? [] : [id];
          });
          const evidenceIds = [
            ...new Set([
              callEvidenceId,
              ...(bindingEvidenceId === null ? [] : [bindingEvidenceId]),
              ...targetEvidenceIds,
            ]),
          ].sort();
          const applicationId = applicationContextForClass(methodRecord.classId);
          const ruleId =
            callee.name.text === 'emitAsync'
              ? EVENT_EMITTER_INTERACTION_RULE_IDS.emitAsync
              : EVENT_EMITTER_INTERACTION_RULE_IDS.emit;
          const interactionId = makeInteractionId({
            kind: 'in_process_event',
            sourceMethodId: methodRecord.id,
            targetKey: interactionTargetKey(target.target),
            applicationId,
            initiationEvidenceId: callEvidenceId,
          });
          const interaction: InProcessEventInteractionRecord = {
            id: interactionId,
            kind: 'in_process_event',
            sourceMethodId: methodRecord.id,
            applicationId,
            direction: 'outbound',
            activation: 'eager',
            boundary: 'in_process',
            dispatchTiming: callee.name.text === 'emitAsync' ? 'asynchronous' : 'synchronous',
            target: target.target,
            ruleId,
            evidenceIds,
          };
          interactionById.set(interaction.id, interaction);
          addAssertion({
            id: makeAssertionId({
              subjectId: methodRecord.id,
              predicate: 'METHOD_INITIATES_INTERACTION',
              objectId: interaction.id,
              ruleId,
            }),
            subjectId: methodRecord.id,
            predicate: 'METHOD_INITIATES_INTERACTION',
            objectId: interaction.id,
            status: 'resolved',
            ruleId,
            evidenceIds,
          });
          if (target.dynamic) {
            addDiagnostic({
              code: 'INTERACTION_TARGET_DYNAMIC',
              subjectId: interaction.id,
              evidenceIds,
              message:
                'EventEmitter2 emission identity is dynamic, wildcard-shaped, or unsupported.',
            });
          }
        };
        if (method.node.body !== undefined) ts.forEachChild(method.node.body, visit);
      }
    }
  }

  const handlerTimingById = new Map<string, InteractionDispatchTiming>();
  for (const pending of pendingHandlers) {
    const method = ensureMethod(pending.located);
    for (const handler of handlerById.values()) {
      if (
        handler.methodId === method.id &&
        handler.target.identityKind === pending.target.target.identityKind &&
        handler.target.value === pending.target.target.value &&
        handler.handlerEvidenceId === pending.handlerEvidenceId
      ) {
        handlerTimingById.set(handler.id, pending.timing);
      }
    }
  }
  for (const interaction of [...interactionById.values()]) {
    if (interaction.target.identityKind === 'dynamic') continue;
    const matchingHandlers = [...handlerById.values()]
      .filter(
        (handler) =>
          inProcessEventTargetsMatch(interaction.target, handler.target) &&
          (interaction.applicationId === null ||
            handler.applicationId === null ||
            interaction.applicationId === handler.applicationId),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const retained = matchingHandlers.slice(0, input.maxFanOutPerInteraction);
    if (matchingHandlers.length > retained.length) {
      addDiagnostic({
        code: 'INTERACTION_TRACE_LIMIT_REACHED',
        subjectId: interaction.id,
        evidenceIds: interaction.evidenceIds,
        message: `Exact event fan-out ${matchingHandlers.length} exceeds configured limit ${input.maxFanOutPerInteraction}.`,
      });
    }
    for (const handler of retained) {
      const evidenceIds = [
        ...new Set([
          ...interaction.evidenceIds,
          handler.handlerEvidenceId,
          ...(handler.configurationEvidenceIds ?? []),
        ]),
      ].sort();
      const ruleId =
        handler.target.pattern === undefined ? EVENT_MATCH_RULE_ID : EVENT_WILDCARD_MATCH_RULE_ID;
      addAssertion({
        id: makeAssertionId({
          subjectId: interaction.id,
          predicate: 'INTERACTION_MATCHES_LOCAL_HANDLER',
          objectId: handler.id,
          ruleId,
        }),
        subjectId: interaction.id,
        predicate: 'INTERACTION_MATCHES_LOCAL_HANDLER',
        objectId: handler.id,
        status: 'resolved',
        ruleId,
        evidenceIds,
      });
    }
    if (
      interaction.ruleId === EVENT_EMITTER_INTERACTION_RULE_IDS.emit &&
      retained.some((handler) => handlerTimingById.get(handler.id) !== 'synchronous')
    ) {
      interactionById.set(interaction.id, { ...interaction, dispatchTiming: 'unknown' });
    }
  }

  return {
    classes: [...classById.values()],
    methods: [...methodById.values()],
    applications: [...applicationById.values()],
    interactions: [...interactionById.values()],
    handlers: [...handlerById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
    state: diagnosticById.size === 0 ? 'complete' : 'incomplete',
  };
}
