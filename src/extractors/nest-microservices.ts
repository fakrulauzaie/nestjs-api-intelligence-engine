import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord, AssertionStatus } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord, ModuleRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  interactionTargetKey,
  microserviceMessageTargetsMatch,
  type ApplicationRecord,
  type HandlerRegistrationState,
  type InteractionActivationState,
  type MicroserviceMessageHandlerRecord,
  type MicroserviceMessageInteractionRecord,
  type MicroserviceMessageMode,
  type MicroserviceMessageTarget,
  type MicroservicePatternKind,
  type NestMicroserviceTransport,
  type TextInteractionTarget,
} from '../model/interactions.js';
import {
  makeApplicationId,
  makeAssertionId,
  makeClassId,
  makeInteractionHandlerId,
  makeInteractionId,
} from '../model/ids.js';
import { resolveSimpleString } from '../ts-index/constants.js';
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

export const NEST_MICROSERVICE_RULE_IDS = {
  application: 'nest.application.microservice-root.v1',
  hybridApplication: 'nest.application.hybrid-microservice-root.v1',
  send: 'microservice.client-proxy.send.v1',
  emit: 'microservice.client-proxy.emit.v1',
  messageHandler: 'microservice.message-pattern.v1',
  eventHandler: 'microservice.event-pattern.v1',
  requestMatch: 'microservice.request-response-candidate.v1',
  requestAmbiguousMatch: 'microservice.request-response-ambiguous-candidate.v1',
  eventMatch: 'microservice.event-candidate.v1',
} as const;

const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_CORE_MODULE = '@nestjs/core';
const NEST_MICROSERVICES_MODULE = '@nestjs/microservices';
const RXJS_MODULE = 'rxjs';
const ROUTE_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Options',
  'Head',
  'All',
]);
const MAX_PATTERN_DEPTH = 8;
const MAX_PATTERN_NODES = 200;

interface LocatedMethod {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly method: IndexedMethod;
}

interface ResolvedTextTarget {
  readonly target: TextInteractionTarget;
  readonly evidenceNodes: readonly ts.Node[];
}

interface ResolvedPattern {
  readonly patternKind: MicroservicePatternKind;
  readonly canonicalPattern: string | null;
  readonly evidenceNodes: readonly ts.Node[];
}

interface ClientRegistration {
  readonly moduleId: string;
  readonly token: ResolvedTextTarget;
  readonly transport: NestMicroserviceTransport | null;
  readonly evidenceNode: ts.Node;
}

interface ClientBinding {
  readonly status: 'resolved' | 'ambiguous';
  readonly token: ResolvedTextTarget;
  readonly resolutionNode: ts.Node;
}

interface BoundClientContext {
  readonly transport: NestMicroserviceTransport | null;
  readonly evidenceNodes: readonly ts.Node[];
  readonly ambiguous: boolean;
}

interface HybridBootstrap {
  readonly rootModule: ModuleRecord | null;
  readonly createCall: ts.CallExpression;
}

export interface NestMicroserviceExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly applications: readonly ApplicationRecord[];
  readonly interactions: readonly MicroserviceMessageInteractionRecord[];
  readonly handlers: readonly MicroserviceMessageHandlerRecord[];
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
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    !('name' in property) ||
    property.name === undefined ||
    ts.isComputedPropertyName(property.name)
  ) {
    return null;
  }
  return ts.isIdentifier(property.name) ||
    ts.isStringLiteral(property.name) ||
    ts.isNumericLiteral(property.name)
    ? property.name.text
    : null;
}

function constInitializer(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.Expression | null {
  const current = unwrapExpression(expression);
  if (!ts.isIdentifier(current) && !ts.isPropertyAccessExpression(current)) return null;
  const symbol = resolvedSymbolAt(checker, current);
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
  if (
    !ts.isArrayLiteralExpression(current) ||
    current.elements.some(
      (element) => ts.isSpreadElement(element) || ts.isOmittedExpression(element),
    )
  ) {
    return null;
  }
  return current.elements;
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

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  const matches = object.properties.filter((property) => propertyName(property) === name);
  return matches.length === 1 && ts.isPropertyAssignment(matches[0]!) ? matches[0]! : null;
}

function packageClassType(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  className: string,
): boolean {
  const current = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (!ts.isTypeReferenceNode(current)) return false;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(current.typeName));
  return (
    symbol?.name === className &&
    (symbol.declarations ?? []).some((declaration) =>
      declarationBelongsToPackage(declaration.getSourceFile().fileName, NEST_MICROSERVICES_MODULE),
    )
  );
}

function unionContainsPackageClass(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  className: string,
): boolean {
  const current = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  return ts.isUnionTypeNode(current)
    ? current.types.some((child) => packageClassType(child, checker, className))
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

function resolveTextTarget(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
): ResolvedTextTarget {
  if (expression === undefined) {
    return { target: { resolution: 'dynamic', value: null }, evidenceNodes: [] };
  }
  const resolution = resolveSimpleString(expression, checker);
  return resolution.status === 'resolved'
    ? {
        target: { resolution: 'exact', value: resolution.value },
        evidenceNodes: resolution.evidenceNodes,
      }
    : {
        target: { resolution: 'dynamic', value: null },
        evidenceNodes: resolution.evidenceNodes,
      };
}

function collectClientBindings(
  indexedClass: IndexedClass,
  checker: ts.TypeChecker,
): ReadonlyMap<string, ClientBinding> {
  const bindings = new Map<string, ClientBinding>();
  const constructor = constructorToAnalyze(indexedClass);
  if (constructor === null) return bindings;
  const assignments = assignmentCounts(indexedClass);
  const explicitAssignments = explicitParameterMemberAssignments(constructor, checker);
  for (const parameter of constructor.parameters) {
    const typeNode = parameter.node.type;
    if (typeNode === undefined) continue;
    const exact = packageClassType(typeNode, checker, 'ClientProxy');
    const ambiguousType = unionContainsPackageClass(typeNode, checker, 'ClientProxy');
    if (!exact && !ambiguousType) continue;
    const inject = parameter.decorators.find((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Inject'),
    );
    const member = memberBindingForParameter(parameter, explicitAssignments);
    if (inject === undefined || member === null) continue;
    const call = ts.isCallExpression(inject.node.expression) ? inject.node.expression : null;
    const expectedAssignments = ts.isParameter(member.resolutionNode) ? 0 : 1;
    bindings.set(member.memberName, {
      status:
        exact && (assignments.get(member.memberName) ?? 0) === expectedAssignments
          ? 'resolved'
          : 'ambiguous',
      token: resolveTextTarget(call?.arguments[0], checker),
      resolutionNode: member.resolutionNode,
    });
  }
  return bindings;
}

function resolveTransport(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
): NestMicroserviceTransport | null {
  if (expression === undefined) return null;
  const current = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(current)) return null;
  const owner = unwrapExpression(current.expression);
  if (
    !ts.isLeftHandSideExpression(owner) ||
    !isPackageExpression(
      resolveImportedExpressionIdentity(owner, checker),
      NEST_MICROSERVICES_MODULE,
      'Transport',
    )
  ) {
    return null;
  }
  const transports: Partial<Record<string, NestMicroserviceTransport>> = {
    TCP: 'tcp',
    REDIS: 'redis',
    RMQ: 'rmq',
    KAFKA: 'kafka',
  };
  return transports[current.name.text] ?? null;
}

function transportFromOptions(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
): NestMicroserviceTransport | null {
  if (expression === undefined) return null;
  const object = staticObject(expression, checker);
  if (
    object === null ||
    object.properties.some(
      (property) => ts.isSpreadAssignment(property) || propertyName(property) === null,
    )
  ) {
    return null;
  }
  return resolveTransport(objectProperty(object, 'transport')?.initializer, checker);
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function staticJsonValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  state: { count: number },
  visited: ReadonlySet<ts.Symbol> = new Set(),
  depth = 0,
): JsonValue | undefined {
  state.count += 1;
  if (depth > MAX_PATTERN_DEPTH || state.count > MAX_PATTERN_NODES) return undefined;
  const current = unwrapExpression(expression);
  const simpleString = resolveSimpleString(current, checker);
  if (simpleString.status === 'resolved') return simpleString.value;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(current.operand)
  ) {
    return -Number(current.operand.text);
  }
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const constant = checker.getConstantValue(current);
    if (typeof constant === 'string' || typeof constant === 'number') return constant;
  }
  if (ts.isArrayLiteralExpression(current)) {
    if (
      current.elements.some(
        (element) => ts.isSpreadElement(element) || ts.isOmittedExpression(element),
      )
    ) {
      return undefined;
    }
    const values: JsonValue[] = [];
    for (const element of current.elements) {
      const value = staticJsonValue(element, checker, state, visited, depth + 1);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }
  if (ts.isObjectLiteralExpression(current)) {
    const result: Record<string, JsonValue> = {};
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = propertyName(property);
      if (name === null || Object.hasOwn(result, name)) return undefined;
      const value = staticJsonValue(property.initializer, checker, state, visited, depth + 1);
      if (value === undefined) return undefined;
      result[name] = value;
    }
    return result;
  }
  if (!ts.isIdentifier(current) && !ts.isPropertyAccessExpression(current)) return undefined;
  const symbol = resolvedSymbolAt(checker, current);
  if (symbol === null || visited.has(symbol)) return undefined;
  const declarations = symbol.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0]!;
  if (
    !ts.isVariableDeclarationList(declaration.parent) ||
    (declaration.parent.flags & ts.NodeFlags.Const) === 0 ||
    declaration.initializer === undefined
  ) {
    return undefined;
  }
  return staticJsonValue(
    declaration.initializer,
    checker,
    state,
    new Set([...visited, symbol]),
    depth + 1,
  );
}

function resolvePattern(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
): ResolvedPattern {
  if (expression === undefined) {
    return { patternKind: 'dynamic', canonicalPattern: null, evidenceNodes: [] };
  }
  const value = staticJsonValue(expression, checker, { count: 0 });
  if (value === undefined) {
    return { patternKind: 'dynamic', canonicalPattern: null, evidenceNodes: [expression] };
  }
  return {
    patternKind: Array.isArray(value)
      ? 'array'
      : value !== null && typeof value === 'object'
        ? 'object'
        : 'scalar',
    canonicalPattern: canonicalJson(value),
    evidenceNodes: [expression],
  };
}

function nestFactoryMethod(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  methodName: 'create' | 'createMicroservice',
): boolean {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== methodName) return false;
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

function clientsModuleRegister(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'register') return false;
  const owner = unwrapExpression(callee.expression);
  return (
    ts.isLeftHandSideExpression(owner) &&
    isPackageExpression(
      resolveImportedExpressionIdentity(owner, checker),
      NEST_MICROSERVICES_MODULE,
      'ClientsModule',
    )
  );
}

function packageMember(
  expression: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
  moduleName: string,
): boolean {
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(expression.name));
  return (symbol?.declarations ?? []).some((declaration) =>
    declarationBelongsToPackage(declaration.getSourceFile().fileName, moduleName),
  );
}

function rxjsFunction(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  names: ReadonlySet<string>,
): boolean {
  const expression = unwrapExpression(call.expression);
  if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) return false;
  const identity = resolveImportedExpressionIdentity(expression, checker);
  return (
    identity.moduleSpecifier === RXJS_MODULE &&
    names.has(identity.exportedName) &&
    identity.symbol !== null &&
    declarationBelongsToPackage(identity.declarationFile, RXJS_MODULE)
  );
}

function nodeContains(container: ts.Node, target: ts.Node): boolean {
  return (
    container.getSourceFile() === target.getSourceFile() &&
    target.getStart() >= container.getStart() &&
    target.getEnd() <= container.getEnd()
  );
}

function isControllerRoute(located: LocatedMethod): boolean {
  return (
    located.indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Controller'),
    ) &&
    located.method.decorators.some((decorator) =>
      [...ROUTE_DECORATORS].some((name) => isPackageDecorator(decorator, NEST_COMMON_MODULE, name)),
    )
  );
}

function activationForSend(
  call: ts.CallExpression,
  located: LocatedMethod,
  checker: ts.TypeChecker,
): { readonly state: InteractionActivationState; readonly evidenceNodes: readonly ts.Node[] } {
  let current: ts.Node = call;
  let unknownBoundary: ts.Node | null = null;
  while (current.parent !== undefined && current.parent !== located.method.node.body) {
    const parent = current.parent;
    if (ts.isCallExpression(parent)) {
      const firstArgument = parent.arguments[0];
      if (
        firstArgument !== undefined &&
        nodeContains(firstArgument, call) &&
        unknownBoundary === null &&
        rxjsFunction(parent, checker, new Set(['firstValueFrom', 'lastValueFrom']))
      ) {
        return { state: 'proven_activated', evidenceNodes: [parent.expression] };
      }
      if (
        ts.isPropertyAccessExpression(parent.expression) &&
        parent.expression.name.text === 'subscribe' &&
        nodeContains(parent.expression.expression, call) &&
        unknownBoundary === null &&
        packageMember(parent.expression, checker, RXJS_MODULE)
      ) {
        return { state: 'proven_activated', evidenceNodes: [parent.expression] };
      }
      const supportedPipe =
        ts.isPropertyAccessExpression(parent.expression) &&
        parent.expression.name.text === 'pipe' &&
        nodeContains(parent.expression.expression, call) &&
        packageMember(parent.expression, checker, RXJS_MODULE);
      if (!supportedPipe && parent !== call) unknownBoundary ??= parent.expression;
    } else if (
      ts.isVariableDeclaration(parent) ||
      (ts.isBinaryExpression(parent) && nodeContains(parent.right, call)) ||
      ts.isAwaitExpression(parent)
    ) {
      unknownBoundary ??= parent;
    } else if (ts.isReturnStatement(parent)) {
      if (isControllerRoute(located) && unknownBoundary === null) {
        return { state: 'proven_activated', evidenceNodes: [parent] };
      }
      unknownBoundary ??= parent;
    }
    current = parent;
  }
  return unknownBoundary === null
    ? { state: 'constructed_cold', evidenceNodes: [] }
    : { state: 'unknown', evidenceNodes: [unknownBoundary] };
}

function nestedFunctionBoundary(
  node: ts.Node,
  root: ts.MethodDeclaration,
  allowedNestedFunctions: ReadonlySet<ts.Node>,
): boolean {
  return node !== root && ts.isFunctionLike(node) && !allowedNestedFunctions.has(node);
}

export function extractNestMicroservices(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
  readonly modules: readonly ModuleRecord[];
  readonly moduleAssertions: readonly AssertionRecord[];
  readonly maxFanOutPerInteraction: number;
  readonly allowedNestedFunctions?: ReadonlySet<ts.Node>;
}): NestMicroserviceExtraction {
  const allowedNestedFunctions = input.allowedNestedFunctions ?? new Set();
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
  const interactionById = new Map<string, MicroserviceMessageInteractionRecord>();
  const handlerById = new Map<string, MicroserviceMessageHandlerRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticById = new Map<string, DiagnosticRecord>();

  const addEvidence = (record: EvidenceRecord): string => {
    evidenceById.set(record.id, record);
    return record.id;
  };
  const evidenceForNode = (
    node: ts.Node,
    role: EvidenceRecord['role'],
    _snippet: boolean,
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
    return addEvidence(record);
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
  const addDiagnostic = (diagnosticInput: {
    code: DiagnosticCode;
    subjectId?: string;
    message?: string;
    evidenceIds: readonly string[];
  }): void => {
    const diagnostic = createDiagnostic(diagnosticInput);
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

  const rootModuleForExpression = (expression: ts.Expression | undefined): ModuleRecord | null => {
    if (expression === undefined) return null;
    const symbol = resolvedSymbolAt(input.checker, unwrapExpression(expression));
    const location = symbol === null ? undefined : classLocationBySymbol.get(symbol);
    return location === undefined
      ? null
      : (moduleByIndexedClass.get(location.indexedClass.node) ?? null);
  };
  const publishApplication = (applicationInput: {
    kind: 'microservice' | 'hybrid';
    rootModule: ModuleRecord | null;
    transport: NestMicroserviceTransport | null;
    evidenceNode: ts.Node;
    ruleId: string;
  }): void => {
    const bootstrapEvidenceId = evidenceForNode(applicationInput.evidenceNode, 'call_site', true);
    if (bootstrapEvidenceId === null) return;
    const applicationId = makeApplicationId({
      kind: applicationInput.kind,
      rootModuleId: applicationInput.rootModule?.id ?? null,
      bootstrapEvidenceId,
    });
    const application: ApplicationRecord = {
      id: applicationId,
      kind: applicationInput.kind,
      rootModuleId: applicationInput.rootModule?.id ?? null,
      rootResolution: applicationInput.rootModule === null ? 'unknown' : 'resolved',
      transportState: applicationInput.transport === null ? 'unknown' : 'resolved',
      transport: applicationInput.transport,
      bootstrapEvidenceId,
    };
    applicationById.set(application.id, application);
    if (applicationInput.rootModule !== null) {
      addAssertion({
        id: makeAssertionId({
          subjectId: application.id,
          predicate: 'APPLICATION_USES_ROOT_MODULE',
          objectId: applicationInput.rootModule.id,
          ruleId: applicationInput.ruleId,
        }),
        subjectId: application.id,
        predicate: 'APPLICATION_USES_ROOT_MODULE',
        objectId: applicationInput.rootModule.id,
        status: 'resolved',
        ruleId: applicationInput.ruleId,
        evidenceIds: [bootstrapEvidenceId],
      });
    }
    if (applicationInput.transport === null) {
      addDiagnostic({
        code: 'MICROSERVICE_TRANSPORT_UNKNOWN',
        subjectId: application.id,
        evidenceIds: [bootstrapEvidenceId],
      });
    }
  };

  const hybridBootstraps = new Map<ts.Symbol, HybridBootstrap>();
  for (const source of input.sourceIndex.sourceFiles) {
    const collect = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined
      ) {
        const initializer = unwrapExpression(node.initializer);
        if (
          ts.isCallExpression(initializer) &&
          nestFactoryMethod(initializer, input.checker, 'create')
        ) {
          const symbol = resolvedSymbolAt(input.checker, node.name);
          if (symbol !== null) {
            hybridBootstraps.set(symbol, {
              rootModule: rootModuleForExpression(initializer.arguments[0]),
              createCall: initializer,
            });
          }
        }
      }
      ts.forEachChild(node, collect);
    };
    ts.forEachChild(source.sourceFile, collect);
  }
  for (const source of input.sourceIndex.sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (!ts.isCallExpression(node)) {
        ts.forEachChild(node, visit);
        return;
      }
      if (nestFactoryMethod(node, input.checker, 'createMicroservice')) {
        publishApplication({
          kind: 'microservice',
          rootModule: rootModuleForExpression(node.arguments[0]),
          transport: transportFromOptions(node.arguments[1], input.checker),
          evidenceNode: node.expression,
          ruleId: NEST_MICROSERVICE_RULE_IDS.application,
        });
      } else {
        const callee = unwrapExpression(node.expression);
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'connectMicroservice') {
          const receiver = unwrapExpression(callee.expression);
          const symbol =
            ts.isIdentifier(receiver) || ts.isPropertyAccessExpression(receiver)
              ? resolvedSymbolAt(input.checker, receiver)
              : null;
          const bootstrap = symbol === null ? undefined : hybridBootstraps.get(symbol);
          if (bootstrap !== undefined) {
            publishApplication({
              kind: 'hybrid',
              rootModule: bootstrap.rootModule,
              transport: transportFromOptions(node.arguments[0], input.checker),
              evidenceNode: callee,
              ruleId: NEST_MICROSERVICE_RULE_IDS.hybridApplication,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source.sourceFile, visit);
  }

  const clientRegistrations: ClientRegistration[] = [];
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
      const metadata =
        call?.arguments[0] === undefined ? null : staticObject(call.arguments[0], input.checker);
      const importsProperty = metadata === null ? null : objectProperty(metadata, 'imports');
      const imports =
        importsProperty === null ? [] : staticArray(importsProperty.initializer, input.checker);
      if (imports === null) continue;
      for (const importExpression of imports) {
        const candidate = unwrapExpression(importExpression);
        if (!ts.isCallExpression(candidate) || !clientsModuleRegister(candidate, input.checker))
          continue;
        const registrations =
          candidate.arguments[0] === undefined
            ? null
            : staticArray(candidate.arguments[0], input.checker);
        if (registrations === null) continue;
        for (const registrationExpression of registrations) {
          const registration = staticObject(registrationExpression, input.checker);
          if (registration === null) continue;
          const name = objectProperty(registration, 'name');
          if (name === null) continue;
          clientRegistrations.push({
            moduleId: module.id,
            token: resolveTextTarget(name.initializer, input.checker),
            transport: resolveTransport(
              objectProperty(registration, 'transport')?.initializer,
              input.checker,
            ),
            evidenceNode: candidate.expression,
          });
        }
      }
    }
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
  const applicationContextForClass = (classId: string): ApplicationRecord | null => {
    const applications = applicationsForClass(classId);
    return applications.length === 1 ? applications[0]! : null;
  };
  const clientContextForClass = (
    classId: string,
    token: ResolvedTextTarget,
  ): BoundClientContext => {
    const declaringModules = new Set(modulesByClass.get(classId) ?? []);
    const candidates = clientRegistrations.filter(
      (registration) =>
        declaringModules.has(registration.moduleId) &&
        token.target.resolution === 'exact' &&
        registration.token.target.resolution === 'exact' &&
        registration.token.target.value === token.target.value,
    );
    const transports = new Set(
      candidates.flatMap(({ transport }) => (transport === null ? [] : [transport])),
    );
    return {
      transport: candidates.length > 0 && transports.size === 1 ? [...transports][0]! : null,
      evidenceNodes: candidates.map(({ evidenceNode }) => evidenceNode),
      ambiguous: candidates.length !== 1 || transports.size !== 1,
    };
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      for (const method of indexedClass.methods) {
        const located = { source, indexedClass, method };
        for (const decorator of method.decorators) {
          const message = isPackageDecorator(
            decorator,
            NEST_MICROSERVICES_MODULE,
            'MessagePattern',
          );
          const event = isPackageDecorator(decorator, NEST_MICROSERVICES_MODULE, 'EventPattern');
          if (!message && !event) continue;
          const call = ts.isCallExpression(decorator.node.expression)
            ? decorator.node.expression
            : null;
          const handlerEvidenceId = evidenceForNode(decorator.node, 'decorator', true);
          if (handlerEvidenceId === null) continue;
          const methodRecord = ensureMethod(located);
          const owner = classById.get(methodRecord.classId)!;
          const application = applicationContextForClass(owner.id);
          const controller = owner.roles.includes('controller');
          const mode: MicroserviceMessageMode = message ? 'request_response' : 'event';
          const pattern = resolvePattern(call?.arguments[0], input.checker);
          const explicitTransport = resolveTransport(call?.arguments[1], input.checker);
          const transport = explicitTransport ?? application?.transport ?? null;
          const registrationState: HandlerRegistrationState =
            controller &&
            application !== null &&
            application.rootResolution === 'resolved' &&
            application.transportState === 'resolved'
              ? 'proven_registered'
              : controller && applicationById.size > 0
                ? 'declared_candidate'
                : 'registration_unknown';
          const target: MicroserviceMessageTarget = {
            targetKind: 'message',
            mode,
            patternKind: pattern.patternKind,
            canonicalPattern: pattern.canonicalPattern,
            clientToken: { resolution: 'dynamic', value: null },
            transport,
          };
          const ruleId = message
            ? NEST_MICROSERVICE_RULE_IDS.messageHandler
            : NEST_MICROSERVICE_RULE_IDS.eventHandler;
          const handlerId = makeInteractionHandlerId({
            kind: 'microservice_message',
            methodId: methodRecord.id,
            targetKey: interactionTargetKey(target),
            applicationId: application?.id ?? null,
            handlerEvidenceId,
          });
          const handler: MicroserviceMessageHandlerRecord = {
            id: handlerId,
            kind: 'microservice_message',
            methodId: methodRecord.id,
            applicationId: application?.id ?? null,
            registrationState,
            target,
            ruleId,
            handlerEvidenceId,
          };
          handlerById.set(handler.id, handler);
          addAssertion({
            id: makeAssertionId({
              subjectId: handler.id,
              predicate: 'HANDLER_IMPLEMENTED_BY',
              objectId: methodRecord.id,
              ruleId,
            }),
            subjectId: handler.id,
            predicate: 'HANDLER_IMPLEMENTED_BY',
            objectId: methodRecord.id,
            status: 'resolved',
            ruleId,
            evidenceIds: [handlerEvidenceId],
          });
          if (pattern.patternKind === 'dynamic') {
            addDiagnostic({
              code: 'INTERACTION_TARGET_DYNAMIC',
              subjectId: handler.id,
              evidenceIds: [handlerEvidenceId],
              message: 'Nest microservice handler pattern is dynamic or not canonical JSON.',
            });
          }
          if (transport === null) {
            addDiagnostic({
              code: 'MICROSERVICE_TRANSPORT_UNKNOWN',
              subjectId: handler.id,
              evidenceIds: [handlerEvidenceId],
            });
          }
          if (registrationState === 'registration_unknown') {
            addDiagnostic({
              code: 'MICROSERVICE_HANDLER_REGISTRATION_UNKNOWN',
              subjectId: handler.id,
              evidenceIds: [handlerEvidenceId],
            });
          }
        }
      }
    }
  }

  const bindingsByClass = new Map<ts.ClassDeclaration, ReadonlyMap<string, ClientBinding>>();
  for (const indexedClass of input.sourceIndex.classes) {
    if (recognizedRoles(indexedClass).length === 0) continue;
    const bindings = collectClientBindings(indexedClass, input.checker);
    if (bindings.size > 0) bindingsByClass.set(indexedClass.node, bindings);
  }
  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const bindings = bindingsByClass.get(indexedClass.node);
      if (bindings === undefined) continue;
      for (const method of indexedClass.methods) {
        const located = { source, indexedClass, method };
        const visit = (node: ts.Node): void => {
          if (nestedFunctionBoundary(node, method.node, allowedNestedFunctions)) return;
          if (!ts.isCallExpression(node)) {
            ts.forEachChild(node, visit);
            return;
          }
          const callee = unwrapExpression(node.expression);
          if (
            !ts.isPropertyAccessExpression(callee) ||
            !['send', 'emit'].includes(callee.name.text) ||
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
          const callEvidenceId = evidenceForNode(callee, 'call_site', true);
          const bindingEvidenceId = evidenceForNode(
            binding.resolutionNode,
            'type_reference',
            false,
          );
          if (callEvidenceId === null) return;
          if (binding.status === 'ambiguous') {
            addDiagnostic({
              code: 'INTERACTION_RECEIVER_AMBIGUOUS',
              subjectId: methodRecord.id,
              evidenceIds: [
                callEvidenceId,
                ...(bindingEvidenceId === null ? [] : [bindingEvidenceId]),
              ],
              message: 'ClientProxy receiver has both package and unsupported type possibilities.',
            });
            return;
          }
          const owner = classById.get(methodRecord.classId)!;
          const application = applicationContextForClass(owner.id);
          const clientContext = clientContextForClass(owner.id, binding.token);
          const pattern = resolvePattern(node.arguments[0], input.checker);
          const mode: MicroserviceMessageMode =
            callee.name.text === 'send' ? 'request_response' : 'event';
          const activation =
            mode === 'event'
              ? { state: 'eager' as const, evidenceNodes: [] as readonly ts.Node[] }
              : activationForSend(node, located, input.checker);
          const target: MicroserviceMessageTarget = {
            targetKind: 'message',
            mode,
            patternKind: pattern.patternKind,
            canonicalPattern: pattern.canonicalPattern,
            clientToken: binding.token.target,
            transport: clientContext.transport,
          };
          const supportingEvidenceIds = [
            ...binding.token.evidenceNodes,
            ...clientContext.evidenceNodes,
            ...pattern.evidenceNodes,
            ...activation.evidenceNodes,
          ].flatMap((evidenceNode) => {
            const id = evidenceForNode(evidenceNode, 'resolution_basis', false);
            return id === null ? [] : [id];
          });
          const evidenceIds = [
            ...new Set([
              callEvidenceId,
              ...(bindingEvidenceId === null ? [] : [bindingEvidenceId]),
              ...supportingEvidenceIds,
            ]),
          ].sort();
          const ruleId =
            mode === 'event' ? NEST_MICROSERVICE_RULE_IDS.emit : NEST_MICROSERVICE_RULE_IDS.send;
          const interactionId = makeInteractionId({
            kind: 'microservice_message',
            sourceMethodId: methodRecord.id,
            targetKey: interactionTargetKey(target),
            applicationId: application?.id ?? null,
            initiationEvidenceId: callEvidenceId,
          });
          const uncertainTarget =
            pattern.patternKind === 'dynamic' ||
            binding.token.target.resolution === 'dynamic' ||
            clientContext.transport === null;
          const interaction: MicroserviceMessageInteractionRecord = {
            id: interactionId,
            kind: 'microservice_message',
            sourceMethodId: methodRecord.id,
            applicationId: application?.id ?? null,
            direction: 'outbound',
            activation: activation.state,
            boundary: uncertainTarget ? 'unknown' : 'external_or_unobserved',
            dispatchTiming: 'asynchronous',
            target,
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
          if (pattern.patternKind === 'dynamic' || binding.token.target.resolution === 'dynamic') {
            addDiagnostic({
              code: 'INTERACTION_TARGET_DYNAMIC',
              subjectId: interaction.id,
              evidenceIds,
              message: 'Nest microservice pattern or client token is dynamic or unsupported.',
            });
          }
          if (clientContext.ambiguous || clientContext.transport === null) {
            addDiagnostic({
              code: 'MICROSERVICE_TRANSPORT_UNKNOWN',
              subjectId: interaction.id,
              evidenceIds,
            });
          }
          if (activation.state === 'unknown') {
            addDiagnostic({
              code: 'MICROSERVICE_ACTIVATION_UNKNOWN',
              subjectId: interaction.id,
              evidenceIds,
            });
          }
        };
        if (method.node.body !== undefined) ts.forEachChild(method.node.body, visit);
      }
    }
  }

  for (const interaction of [...interactionById.values()]) {
    if (
      interaction.target.patternKind === 'dynamic' ||
      interaction.target.clientToken.resolution !== 'exact' ||
      interaction.applicationId === null
    ) {
      continue;
    }
    const patternCompatibleHandlers = [...handlerById.values()].filter(
      (handler) =>
        handler.target.mode === interaction.target.mode &&
        handler.target.canonicalPattern !== null &&
        handler.target.canonicalPattern === interaction.target.canonicalPattern &&
        handler.applicationId === interaction.applicationId,
    );
    const matchingHandlers = patternCompatibleHandlers
      .filter((handler) => microserviceMessageTargetsMatch(interaction.target, handler.target))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (
      matchingHandlers.length === 0 &&
      patternCompatibleHandlers.some(
        (handler) =>
          interaction.target.transport !== null &&
          handler.target.transport !== null &&
          interaction.target.transport !== handler.target.transport,
      )
    ) {
      addDiagnostic({
        code: 'MICROSERVICE_TRANSPORT_MISMATCH',
        subjectId: interaction.id,
        evidenceIds: [
          ...interaction.evidenceIds,
          ...patternCompatibleHandlers.map(({ handlerEvidenceId }) => handlerEvidenceId),
        ],
      });
    }
    const retained = matchingHandlers.slice(0, input.maxFanOutPerInteraction);
    if (matchingHandlers.length > retained.length) {
      addDiagnostic({
        code: 'INTERACTION_TRACE_LIMIT_REACHED',
        subjectId: interaction.id,
        evidenceIds: interaction.evidenceIds,
        message: `Nest microservice handler candidate count ${matchingHandlers.length} exceeds configured limit ${input.maxFanOutPerInteraction}.`,
      });
    }
    if (retained.length > 0) {
      interactionById.set(interaction.id, {
        ...interaction,
        boundary: 'broker_or_worker_boundary',
      });
    }
    const requestAmbiguous = interaction.target.mode === 'request_response' && retained.length > 1;
    if (requestAmbiguous) {
      addDiagnostic({
        code: 'MICROSERVICE_REQUEST_HANDLER_AMBIGUOUS',
        subjectId: interaction.id,
        evidenceIds: [
          ...interaction.evidenceIds,
          ...retained.map(({ handlerEvidenceId }) => handlerEvidenceId),
        ],
      });
    }
    for (const handler of retained) {
      const status: AssertionStatus = requestAmbiguous ? 'ambiguous' : 'resolved';
      const ruleId =
        interaction.target.mode === 'event'
          ? NEST_MICROSERVICE_RULE_IDS.eventMatch
          : requestAmbiguous
            ? NEST_MICROSERVICE_RULE_IDS.requestAmbiguousMatch
            : NEST_MICROSERVICE_RULE_IDS.requestMatch;
      const evidenceIds = [
        ...new Set([...interaction.evidenceIds, handler.handlerEvidenceId]),
      ].sort();
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
        status,
        ruleId,
        evidenceIds,
      });
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
