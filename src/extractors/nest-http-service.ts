import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  interactionTargetKey,
  type InteractionActivationState,
  type OutboundHttpInteractionRecord,
  type OutboundHttpMethod,
} from '../model/interactions.js';
import { makeAssertionId, makeInteractionId } from '../model/ids.js';
import { resolveImportedExpressionIdentity } from '../ts-index/decorators.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import { resolveAliasedSymbol } from '../ts-index/symbols.js';
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
  axiosConfiguration,
  MAX_HTTP_TARGET_CODE_POINTS,
  MAX_HTTP_TEMPLATE_EXPRESSIONS,
  packageMember,
  requestFromParts,
  sanitizeTargetValue,
  uniqueSorted,
  unwrapExpression,
  type RequestDescription,
  type TargetResolution,
} from './outbound-http.js';
import { declarationBelongsToPackage, isPackageDecorator } from './package-symbols.js';

export const NEST_HTTP_SERVICE_RULE_ID = 'http.outbound.nest-http-service.cold.v1';
export const NEST_HTTP_AXIOS_REF_RULE_ID = 'http.outbound.nest-axios-ref.eager.v1';

const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_AXIOS_MODULE = '@nestjs/axios';
const NEST_CONFIG_MODULE = '@nestjs/config';
const AXIOS_MODULE = 'axios';
const RXJS_MODULE = 'rxjs';
const MAX_SYMBOLIC_DEPTH = 8;
const MAX_SYMBOLIC_PARTS = 32;
const MAX_SYMBOL_TOKEN_CODE_POINTS = 128;
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
const HTTP_METHODS = new Map<string, OutboundHttpMethod>([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['head', 'HEAD'],
]);

interface LocatedMethod {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly method: IndexedMethod;
}

interface ServiceBinding {
  readonly status: 'resolved' | 'ambiguous';
  readonly resolutionNode: ts.Node;
}

interface ClassBindings {
  readonly httpMembers: ReadonlyMap<string, ServiceBinding>;
  readonly symbolicInitializers: ReadonlyMap<ts.Symbol, ts.Expression>;
}

interface SymbolicPart {
  readonly kind: 'static' | 'symbolic' | 'dynamic';
  readonly value: string;
}

interface SymbolicParts {
  readonly parts: readonly SymbolicPart[];
  readonly evidenceNodes: readonly ts.Node[];
  readonly fatalDynamic: boolean;
  readonly limit: boolean;
}

interface ActivationResolution {
  readonly state: InteractionActivationState;
  readonly evidenceNodes: readonly ts.Node[];
  readonly issue: DiagnosticCode | null;
}

export interface NestHttpServiceExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly interactions: readonly OutboundHttpInteractionRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly state: 'complete' | 'incomplete';
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function packageClassType(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  moduleSpecifier: string,
  className: string,
): boolean {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (!ts.isTypeReferenceNode(unwrapped)) return false;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(unwrapped.typeName));
  return (
    symbol?.name === className &&
    (symbol.declarations ?? []).some((declaration) =>
      declarationBelongsToPackage(declaration.getSourceFile().fileName, moduleSpecifier),
    )
  );
}

function unionContainsPackageClass(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  moduleSpecifier: string,
  className: string,
): boolean {
  const unwrapped = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  return ts.isUnionTypeNode(unwrapped)
    ? unwrapped.types.some((child) => packageClassType(child, checker, moduleSpecifier, className))
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

function readonlyProperty(
  member: ts.ClassElement,
): member is ts.PropertyDeclaration & { readonly name: ts.Identifier } {
  return (
    ts.isPropertyDeclaration(member) &&
    ts.isIdentifier(member.name) &&
    (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
  );
}

function directConstructorAssignments(
  indexedClass: IndexedClass,
): ReadonlyMap<string, readonly ts.BinaryExpression[]> {
  const assignments = new Map<string, ts.BinaryExpression[]>();
  for (const constructor of indexedClass.constructors) {
    for (const statement of constructor.node.body?.statements ?? []) {
      if (
        !ts.isExpressionStatement(statement) ||
        !ts.isBinaryExpression(statement.expression) ||
        statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
        !isThisMember(statement.expression.left)
      ) {
        continue;
      }
      const name = statement.expression.left.name.text;
      assignments.set(name, [...(assignments.get(name) ?? []), statement.expression]);
    }
  }
  return assignments;
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

function symbolicInitializers(
  indexedClass: IndexedClass,
  checker: ts.TypeChecker,
): ReadonlyMap<ts.Symbol, ts.Expression> {
  const result = new Map<ts.Symbol, ts.Expression>();
  const assignments = directConstructorAssignments(indexedClass);
  const counts = assignmentCounts(indexedClass);
  for (const member of indexedClass.node.members) {
    if (!readonlyProperty(member)) continue;
    const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(member.name));
    if (symbol === null) continue;
    const name = member.name.text;
    if (member.initializer !== undefined && (counts.get(name) ?? 0) === 0) {
      result.set(symbol, member.initializer);
      continue;
    }
    const candidates = assignments.get(name) ?? [];
    if (member.initializer === undefined && candidates.length === 1 && counts.get(name) === 1) {
      result.set(symbol, candidates[0]!.right);
    }
  }
  return result;
}

function collectBindings(indexedClass: IndexedClass, checker: ts.TypeChecker): ClassBindings {
  const httpMembers = new Map<string, ServiceBinding>();
  const assignments = assignmentCounts(indexedClass);
  const constructor = constructorToAnalyze(indexedClass);
  if (constructor !== null) {
    const explicitAssignments = explicitParameterMemberAssignments(constructor, checker);
    for (const parameter of constructor.parameters) {
      const member = memberBindingForParameter(parameter, explicitAssignments);
      const typeNode = parameter.node.type;
      if (member === null || typeNode === undefined) continue;
      if (packageClassType(typeNode, checker, NEST_AXIOS_MODULE, 'HttpService')) {
        const expectedAssignments = ts.isParameter(member.resolutionNode) ? 0 : 1;
        const overriddenToken = parameter.decorators.some((decorator) =>
          isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Inject'),
        );
        httpMembers.set(member.memberName, {
          status:
            overriddenToken || (assignments.get(member.memberName) ?? 0) !== expectedAssignments
              ? 'ambiguous'
              : 'resolved',
          resolutionNode: member.resolutionNode,
        });
      } else if (unionContainsPackageClass(typeNode, checker, NEST_AXIOS_MODULE, 'HttpService')) {
        httpMembers.set(member.memberName, {
          status: 'ambiguous',
          resolutionNode: member.resolutionNode,
        });
      }
    }
  }
  return {
    httpMembers,
    symbolicInitializers: symbolicInitializers(indexedClass, checker),
  };
}

function constDeclaration(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): ts.VariableDeclaration | null {
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(identifier));
  const declarations = symbol?.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  return ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
    declaration.initializer !== undefined
    ? declaration
    : null;
}

function staticToken(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): { readonly value: string; readonly evidenceNodes: readonly ts.Node[] } | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    const value = unwrapped.text.normalize('NFC');
    return [...value].length <= MAX_SYMBOL_TOKEN_CODE_POINTS && /^[A-Za-z0-9_.:/-]+$/u.test(value)
      ? { value, evidenceNodes: [expression] }
      : null;
  }
  if (ts.isIdentifier(unwrapped)) {
    const declaration = constDeclaration(unwrapped, checker);
    if (declaration?.initializer !== undefined) {
      const resolved = staticToken(declaration.initializer, checker);
      return resolved === null
        ? null
        : {
            value: resolved.value,
            evidenceNodes: [expression, declaration, ...resolved.evidenceNodes],
          };
    }
  }
  return null;
}

function isUnshadowedNodeProcess(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  if (identifier.text !== 'process') return false;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(identifier));
  const declarations = symbol?.declarations ?? [];
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      const source = declaration.getSourceFile();
      const normalized = source.fileName.replaceAll('\\', '/').toLowerCase();
      return source.isDeclarationFile && normalized.includes('/node_modules/@types/node/');
    })
  );
}

function environmentToken(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): { readonly value: string; readonly evidenceNodes: readonly ts.Node[] } | null {
  const unwrapped = unwrapExpression(expression);
  let environment: ts.Expression | null = null;
  let key: string | null = null;
  if (ts.isPropertyAccessExpression(unwrapped)) {
    environment = unwrapped.expression;
    key = unwrapped.name.text;
  } else if (
    ts.isElementAccessExpression(unwrapped) &&
    unwrapped.argumentExpression !== undefined &&
    ts.isStringLiteral(unwrapExpression(unwrapped.argumentExpression))
  ) {
    environment = unwrapped.expression;
    key = (unwrapExpression(unwrapped.argumentExpression) as ts.StringLiteral).text;
  }
  if (
    environment === null ||
    key === null ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ||
    [...key].length > MAX_SYMBOL_TOKEN_CODE_POINTS
  ) {
    return null;
  }
  const envAccess = unwrapExpression(environment);
  return ts.isPropertyAccessExpression(envAccess) &&
    envAccess.name.text === 'env' &&
    ts.isIdentifier(unwrapExpression(envAccess.expression)) &&
    isUnshadowedNodeProcess(unwrapExpression(envAccess.expression) as ts.Identifier, checker)
    ? { value: key, evidenceNodes: [expression] }
    : null;
}

function symbolicParts(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  bindings: ClassBindings,
  depth: number,
  visitedSymbols: ReadonlySet<ts.Symbol>,
  insideTemplate: boolean,
): SymbolicParts {
  if (depth > MAX_SYMBOLIC_DEPTH) {
    return { parts: [], evidenceNodes: [expression], fatalDynamic: true, limit: true };
  }
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return {
      parts: [{ kind: 'static', value: unwrapped.text }],
      evidenceNodes: [expression],
      fatalDynamic: false,
      limit: false,
    };
  }

  const environment = environmentToken(unwrapped, checker);
  if (environment !== null) {
    return {
      parts: [{ kind: 'symbolic', value: `{env:${environment.value}}` }],
      evidenceNodes: environment.evidenceNodes,
      fatalDynamic: false,
      limit: false,
    };
  }

  if (
    ts.isCallExpression(unwrapped) &&
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    unwrapped.expression.name.text === 'get' &&
    packageMember(unwrapped.expression, checker, NEST_CONFIG_MODULE)
  ) {
    const tokenExpression = unwrapped.arguments[0];
    const token = tokenExpression === undefined ? null : staticToken(tokenExpression, checker);
    return token === null
      ? { parts: [], evidenceNodes: [expression], fatalDynamic: true, limit: false }
      : {
          parts: [{ kind: 'symbolic', value: `{config:${token.value}}` }],
          evidenceNodes: [expression, ...token.evidenceNodes],
          fatalDynamic: false,
          limit: false,
        };
  }

  if (ts.isIdentifier(unwrapped)) {
    const declaration = constDeclaration(unwrapped, checker);
    if (declaration?.initializer !== undefined) {
      const resolved = symbolicParts(
        declaration.initializer,
        checker,
        bindings,
        depth + 1,
        visitedSymbols,
        insideTemplate,
      );
      return {
        ...resolved,
        evidenceNodes: [expression, declaration, ...resolved.evidenceNodes],
      };
    }
    return {
      parts: [{ kind: 'dynamic', value: '' }],
      evidenceNodes: [expression],
      fatalDynamic: !insideTemplate,
      limit: false,
    };
  }

  if (isThisMember(unwrapped)) {
    const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(unwrapped.name));
    const initializer = symbol === null ? undefined : bindings.symbolicInitializers.get(symbol);
    if (symbol === null || initializer === undefined || visitedSymbols.has(symbol)) {
      return { parts: [], evidenceNodes: [expression], fatalDynamic: true, limit: false };
    }
    const resolved = symbolicParts(
      initializer,
      checker,
      bindings,
      depth + 1,
      new Set([...visitedSymbols, symbol]),
      insideTemplate,
    );
    return { ...resolved, evidenceNodes: [expression, initializer, ...resolved.evidenceNodes] };
  }

  if (ts.isTemplateExpression(unwrapped)) {
    if (unwrapped.templateSpans.length > MAX_HTTP_TEMPLATE_EXPRESSIONS) {
      return { parts: [], evidenceNodes: [expression], fatalDynamic: true, limit: true };
    }
    const children: SymbolicParts[] = [];
    const parts: SymbolicPart[] = [{ kind: 'static', value: unwrapped.head.text }];
    for (const span of unwrapped.templateSpans) {
      const child = symbolicParts(
        span.expression,
        checker,
        bindings,
        depth + 1,
        visitedSymbols,
        true,
      );
      children.push(child);
      parts.push(...child.parts, { kind: 'static', value: span.literal.text });
    }
    return {
      parts,
      evidenceNodes: [expression, ...children.flatMap((child) => child.evidenceNodes)],
      fatalDynamic: children.some((child) => child.fatalDynamic),
      limit: children.some((child) => child.limit) || parts.length > MAX_SYMBOLIC_PARTS,
    };
  }

  if (
    ts.isBinaryExpression(unwrapped) &&
    unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = symbolicParts(unwrapped.left, checker, bindings, depth + 1, visitedSymbols, true);
    const right = symbolicParts(
      unwrapped.right,
      checker,
      bindings,
      depth + 1,
      visitedSymbols,
      true,
    );
    const parts = [...left.parts, ...right.parts];
    return {
      parts,
      evidenceNodes: [expression, ...left.evidenceNodes, ...right.evidenceNodes],
      fatalDynamic: left.fatalDynamic || right.fatalDynamic,
      limit: left.limit || right.limit || parts.length > MAX_SYMBOLIC_PARTS,
    };
  }

  return {
    parts: [{ kind: 'dynamic', value: '' }],
    evidenceNodes: [expression],
    fatalDynamic: !insideTemplate || ts.isCallExpression(unwrapped),
    limit: false,
  };
}

function resolveSymbolicTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  bindings: ClassBindings,
): TargetResolution {
  const resolved = symbolicParts(expression, checker, bindings, 0, new Set(), false);
  if (resolved.limit) {
    return {
      target: { resolution: 'dynamic', value: null },
      queryKeys: [],
      evidenceNodes: resolved.evidenceNodes,
      issue: 'limit',
    };
  }
  if (
    resolved.fatalDynamic ||
    resolved.parts.length === 0 ||
    resolved.parts.every((part) => part.kind === 'dynamic')
  ) {
    return {
      target: { resolution: 'dynamic', value: null },
      queryKeys: [],
      evidenceNodes: resolved.evidenceNodes,
      issue: 'dynamic',
    };
  }
  let dynamicIndex = 0;
  const rawValue = resolved.parts
    .map((part) => (part.kind === 'dynamic' ? `{${dynamicIndex++}}` : part.value))
    .join('');
  if ([...rawValue].length > MAX_HTTP_TARGET_CODE_POINTS) {
    return {
      target: { resolution: 'dynamic', value: null },
      queryKeys: [],
      evidenceNodes: resolved.evidenceNodes,
      issue: 'limit',
    };
  }
  const resolution = resolved.parts.some((part) => part.kind === 'symbolic')
    ? 'symbolic'
    : resolved.parts.some((part) => part.kind === 'dynamic')
      ? 'template'
      : 'exact';
  const normalized = sanitizeTargetValue(rawValue, resolution);
  return { ...normalized, evidenceNodes: resolved.evidenceNodes };
}

function nodeContains(container: ts.Node, target: ts.Node): boolean {
  return (
    container.getSourceFile() === target.getSourceFile() &&
    target.getStart() >= container.getStart() &&
    target.getEnd() <= container.getEnd()
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

function activationFor(
  call: ts.CallExpression,
  located: LocatedMethod,
  checker: ts.TypeChecker,
): ActivationResolution {
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
        return {
          state: 'proven_activated',
          evidenceNodes: [parent.expression],
          issue: null,
        };
      }
      if (
        ts.isPropertyAccessExpression(parent.expression) &&
        parent.expression.name.text === 'subscribe' &&
        nodeContains(parent.expression.expression, call) &&
        unknownBoundary === null &&
        packageMember(parent.expression, checker, RXJS_MODULE)
      ) {
        return {
          state: 'proven_activated',
          evidenceNodes: [parent.expression],
          issue: null,
        };
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
        return {
          state: 'proven_activated',
          evidenceNodes: [parent],
          issue: null,
        };
      }
      unknownBoundary ??= parent;
    }
    current = parent;
  }
  return unknownBoundary === null
    ? { state: 'constructed_cold', evidenceNodes: [], issue: null }
    : {
        state: 'unknown',
        evidenceNodes: [unknownBoundary],
        issue: 'OUTBOUND_HTTP_ACTIVATION_UNKNOWN',
      };
}

function nestedFunctionBoundary(node: ts.Node, root: ts.MethodDeclaration): boolean {
  return node !== root && ts.isFunctionLike(node);
}

export function extractNestHttpService(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
}): NestHttpServiceExtraction {
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );
  const bindingsByClass = new Map<ts.ClassDeclaration, ClassBindings>();
  for (const indexedClass of input.sourceIndex.classes) {
    if (recognizedRoles(indexedClass).length === 0) continue;
    bindingsByClass.set(indexedClass.node, collectBindings(indexedClass, input.checker));
  }

  const classById = new Map<string, ClassRecord>();
  const methodById = new Map<string, MethodRecord>();
  const interactionById = new Map<string, OutboundHttpInteractionRecord>();
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
  const ensureMethod = (located: LocatedMethod): MethodRecord => {
    const classEvidenceId = addEvidence(
      createDeclarationEvidence(
        located.source,
        located.indexedClass.node,
        input.evidenceSnippetLimit,
      ),
    );
    const classRecord = createClassRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId: classEvidenceId,
      roles: recognizedRoles(located.indexedClass),
    });
    classById.set(classRecord.id, classRecord);
    const methodEvidenceId = addEvidence(
      createDeclarationEvidence(located.source, located.method.node, input.evidenceSnippetLimit),
    );
    const methodRecord = createMethodRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      method: located.method,
      classId: classRecord.id,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId: methodEvidenceId,
    });
    methodById.set(methodRecord.id, methodRecord);
    return methodRecord;
  };
  const addDiagnostic = (
    located: LocatedMethod,
    code: DiagnosticCode,
    evidenceIds: readonly string[],
    message?: string,
  ): void => {
    const method = ensureMethod(located);
    const diagnostic = createDiagnostic({
      code,
      subjectId: method.id,
      evidenceIds,
      ...(message === undefined ? {} : { message }),
    });
    diagnosticById.set(diagnostic.id, diagnostic);
  };
  const publish = (
    located: LocatedMethod,
    call: ts.CallExpression,
    ruleId: string,
    description: RequestDescription,
    activation: ActivationResolution,
  ): void => {
    const method = ensureMethod(located);
    const callEvidenceId = evidenceForNode(call.expression, 'call_site', true);
    if (callEvidenceId === null) return;
    const supportingEvidenceIds = [
      ...description.evidenceNodes,
      ...activation.evidenceNodes,
    ].flatMap((node) => {
      const id = evidenceForNode(node, 'resolution_basis', false);
      return id === null ? [] : [id];
    });
    const evidenceIds = uniqueSorted([callEvidenceId, ...supportingEvidenceIds]);
    const interactionId = makeInteractionId({
      kind: 'outbound_http',
      sourceMethodId: method.id,
      targetKey: interactionTargetKey(description.target),
      applicationId: null,
      initiationEvidenceId: callEvidenceId,
    });
    const interaction: OutboundHttpInteractionRecord = {
      id: interactionId,
      kind: 'outbound_http',
      sourceMethodId: method.id,
      applicationId: null,
      direction: 'outbound',
      activation: activation.state,
      boundary: 'external_or_unobserved',
      dispatchTiming: 'asynchronous',
      target: description.target,
      ruleId,
      evidenceIds,
    };
    interactionById.set(interaction.id, interaction);
    const assertion: AssertionRecord = {
      id: makeAssertionId({
        subjectId: method.id,
        predicate: 'METHOD_INITIATES_INTERACTION',
        objectId: interaction.id,
        ruleId,
      }),
      subjectId: method.id,
      predicate: 'METHOD_INITIATES_INTERACTION',
      objectId: interaction.id,
      status: 'resolved',
      ruleId,
      evidenceIds,
    };
    assertionById.set(assertion.id, assertion);
    for (const code of uniqueSorted([
      ...description.issues,
      ...(activation.issue === null ? [] : [activation.issue]),
    ]) as DiagnosticCode[]) {
      addDiagnostic(located, code, evidenceIds);
    }
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const bindings = bindingsByClass.get(indexedClass.node);
      if (bindings === undefined || bindings.httpMembers.size === 0) continue;
      for (const method of indexedClass.methods) {
        const located = { source, indexedClass, method };
        const requestDescription = (parts: Parameters<typeof requestFromParts>[0]) =>
          requestFromParts({
            ...parts,
            resolveTarget: (expression, checker) =>
              resolveSymbolicTarget(expression, checker, bindings),
          });
        const receiverBinding = (expression: ts.Expression): ServiceBinding | undefined => {
          const unwrapped = unwrapExpression(expression);
          return isThisMember(unwrapped)
            ? bindings.httpMembers.get(unwrapped.name.text)
            : undefined;
        };
        const diagnoseAmbiguousReceiver = (
          binding: ServiceBinding,
          call: ts.CallExpression,
        ): void => {
          const evidenceIds = [call.expression, binding.resolutionNode].flatMap((node) => {
            const id = evidenceForNode(node, 'resolution_basis', false);
            return id === null ? [] : [id];
          });
          addDiagnostic(located, 'OUTBOUND_HTTP_RECEIVER_UNSUPPORTED', evidenceIds);
        };
        const analyzeAxiosRef = (call: ts.CallExpression): boolean => {
          const callee = unwrapExpression(call.expression);
          if (!ts.isPropertyAccessExpression(callee)) return false;
          if (
            callee.name.text === 'axiosRef' &&
            packageMember(callee, input.checker, NEST_AXIOS_MODULE)
          ) {
            const binding = receiverBinding(callee.expression);
            if (binding === undefined) return false;
            if (binding.status === 'ambiguous') {
              diagnoseAmbiguousReceiver(binding, call);
              return true;
            }
            const firstArgument = call.arguments[0];
            const firstUnwrapped =
              firstArgument === undefined ? undefined : unwrapExpression(firstArgument);
            const configuration = axiosConfiguration(
              firstUnwrapped !== undefined && ts.isObjectLiteralExpression(firstUnwrapped)
                ? firstArgument
                : call.arguments[1],
            );
            const description = requestDescription({
              urlExpression:
                firstUnwrapped !== undefined && ts.isObjectLiteralExpression(firstUnwrapped)
                  ? undefined
                  : firstArgument,
              defaultMethod: 'GET',
              base: null,
              configuration,
              checker: input.checker,
            });
            publish(located, call, NEST_HTTP_AXIOS_REF_RULE_ID, description, {
              state: 'eager',
              evidenceNodes: [callee],
              issue: null,
            });
            return true;
          }
          const reference = unwrapExpression(callee.expression);
          if (
            !ts.isPropertyAccessExpression(reference) ||
            reference.name.text !== 'axiosRef' ||
            !packageMember(reference, input.checker, NEST_AXIOS_MODULE)
          ) {
            return false;
          }
          const binding = receiverBinding(reference.expression);
          if (binding === undefined) return false;
          if (binding.status === 'ambiguous') {
            diagnoseAmbiguousReceiver(binding, call);
            return true;
          }
          if (!packageMember(callee, input.checker, AXIOS_MODULE)) return false;
          const methodName = callee.name.text;
          let description: RequestDescription;
          if (methodName === 'request') {
            description = requestDescription({
              urlExpression: undefined,
              defaultMethod: 'GET',
              base: null,
              configuration: axiosConfiguration(call.arguments[0]),
              checker: input.checker,
            });
          } else {
            const httpMethod = HTTP_METHODS.get(methodName);
            if (httpMethod === undefined) return false;
            const configIndex =
              httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH' ? 2 : 1;
            description = requestDescription({
              urlExpression: call.arguments[0],
              defaultMethod: httpMethod,
              base: null,
              configuration: axiosConfiguration(call.arguments[configIndex]),
              checker: input.checker,
            });
          }
          publish(located, call, NEST_HTTP_AXIOS_REF_RULE_ID, description, {
            state: 'eager',
            evidenceNodes: [reference],
            issue: null,
          });
          return true;
        };
        const analyzeHttpService = (call: ts.CallExpression): boolean => {
          const callee = unwrapExpression(call.expression);
          if (!ts.isPropertyAccessExpression(callee)) return false;
          const binding = receiverBinding(callee.expression);
          if (binding === undefined) return false;
          const methodName = callee.name.text;
          if (methodName !== 'request' && !HTTP_METHODS.has(methodName)) return false;
          if (binding.status === 'ambiguous') {
            diagnoseAmbiguousReceiver(binding, call);
            return true;
          }
          if (!packageMember(callee, input.checker, NEST_AXIOS_MODULE)) return false;
          let description: RequestDescription;
          if (methodName === 'request') {
            description = requestDescription({
              urlExpression: undefined,
              defaultMethod: 'GET',
              base: null,
              configuration: axiosConfiguration(call.arguments[0]),
              checker: input.checker,
            });
          } else {
            const httpMethod = HTTP_METHODS.get(methodName)!;
            const configIndex =
              httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH' ? 2 : 1;
            description = requestDescription({
              urlExpression: call.arguments[0],
              defaultMethod: httpMethod,
              base: null,
              configuration: axiosConfiguration(call.arguments[configIndex]),
              checker: input.checker,
            });
          }
          publish(
            located,
            call,
            NEST_HTTP_SERVICE_RULE_ID,
            description,
            activationFor(call, located, input.checker),
          );
          return true;
        };
        const visit = (node: ts.Node): void => {
          if (nestedFunctionBoundary(node, method.node)) return;
          if (ts.isCallExpression(node) && !analyzeAxiosRef(node)) analyzeHttpService(node);
          ts.forEachChild(node, visit);
        };
        if (method.node.body !== undefined) visit(method.node.body);
      }
    }
  }

  return {
    classes: [...classById.values()],
    methods: [...methodById.values()],
    interactions: [...interactionById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
    state: diagnosticById.size === 0 ? 'complete' : 'incomplete',
  };
}
