import { basename, resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  interactionTargetKey,
  OUTBOUND_HTTP_METHODS,
  type OutboundHttpInteractionRecord,
  type OutboundHttpMethod,
  type OutboundHttpTarget,
  type TextInteractionTarget,
} from '../model/interactions.js';
import { makeAssertionId, makeInteractionId } from '../model/ids.js';
import {
  resolveImportedExpressionIdentity,
  type ResolvedImportedExpressionIdentity,
} from '../ts-index/decorators.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import { resolveAliasedSymbol, symbolDeclarationFile } from '../ts-index/symbols.js';
import {
  createClassRecord,
  createDeclarationEvidence,
  createMethodRecord,
} from './canonical-records.js';
import { declarationBelongsToPackage, isPackageDecorator } from './package-symbols.js';

export const OUTBOUND_HTTP_AXIOS_RULE_ID = 'http.outbound.axios.eager.v1';
export const OUTBOUND_HTTP_FETCH_RULE_ID = 'http.outbound.fetch.eager.v1';
export const OUTBOUND_HTTP_UNDICI_RULE_ID = 'http.outbound.undici-fetch.eager.v1';

const AXIOS_MODULE = 'axios';
const UNDICI_MODULE = 'undici';
const NEST_AXIOS_MODULE = '@nestjs/axios';
const NEST_COMMON_MODULE = '@nestjs/common';
export const MAX_HTTP_TARGET_CODE_POINTS = 2_048;
export const MAX_HTTP_TEMPLATE_EXPRESSIONS = 20;
export const MAX_HTTP_QUERY_KEYS = 100;

const AXIOS_METHODS = new Map<string, OutboundHttpMethod>([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['head', 'HEAD'],
]);
const STATIC_HTTP_METHODS = new Set<string>(
  OUTBOUND_HTTP_METHODS.filter((value) => value !== 'UNKNOWN'),
);

export interface OutboundHttpExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly interactions: readonly OutboundHttpInteractionRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly state: 'complete' | 'incomplete';
}

interface LocatedMethod {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly method: IndexedMethod;
}

export interface TargetResolution {
  readonly target: TextInteractionTarget;
  readonly queryKeys: readonly string[];
  readonly evidenceNodes: readonly ts.Node[];
  readonly issue: 'dynamic' | 'limit' | null;
}

interface InstanceBinding {
  readonly base: TargetResolution | null;
  readonly configurationSupported: boolean;
  readonly evidenceNodes: readonly ts.Node[];
}

export interface ObjectConfiguration {
  readonly state: 'resolved' | 'unsupported';
  readonly object: ts.ObjectLiteralExpression | null;
  readonly evidenceNodes: readonly ts.Node[];
}

export interface RequestDescription {
  readonly target: OutboundHttpTarget;
  readonly evidenceNodes: readonly ts.Node[];
  readonly issues: readonly DiagnosticCode[];
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
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

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function hasUnsupportedObjectShape(object: ts.ObjectLiteralExpression): boolean {
  return object.properties.some(
    (property) =>
      ts.isSpreadAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property) ||
      ('name' in property &&
        property.name !== undefined &&
        staticPropertyName(property.name) === null),
  );
}

export function objectConfiguration(expression: ts.Expression | undefined): ObjectConfiguration {
  if (expression === undefined) {
    return { state: 'resolved', object: null, evidenceNodes: [] };
  }
  const unwrapped = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped) || hasUnsupportedObjectShape(unwrapped)) {
    return { state: 'unsupported', object: null, evidenceNodes: [expression] };
  }
  return { state: 'resolved', object: unwrapped, evidenceNodes: [expression] };
}

export function propertyExpression(
  object: ts.ObjectLiteralExpression | null,
  propertyName: string,
): ts.Expression | undefined {
  if (object === null) return undefined;
  let result: ts.Expression | undefined;
  for (const property of object.properties) {
    if (!('name' in property) || property.name === undefined) continue;
    if (staticPropertyName(property.name) !== propertyName) continue;
    if (ts.isPropertyAssignment(property)) result = property.initializer;
    else if (ts.isShorthandPropertyAssignment(property)) result = property.name;
  }
  return result;
}

function hasProperty(
  object: ts.ObjectLiteralExpression | null,
  propertyNames: ReadonlySet<string>,
): boolean {
  if (object === null) return false;
  return object.properties.some(
    (property) =>
      'name' in property &&
      property.name !== undefined &&
      propertyNames.has(staticPropertyName(property.name) ?? ''),
  );
}

function stripUrlUserInfo(value: string): string {
  const schemeEnd = value.indexOf('://');
  const authorityStart = schemeEnd >= 0 ? schemeEnd + 3 : value.startsWith('//') ? 2 : -1;
  if (authorityStart < 0) return value;
  const authorityEndCandidate = value.indexOf('/', authorityStart);
  const authorityEnd = authorityEndCandidate < 0 ? value.length : authorityEndCandidate;
  const authority = value.slice(authorityStart, authorityEnd);
  const at = authority.lastIndexOf('@');
  return at < 0
    ? value
    : `${value.slice(0, authorityStart)}${authority.slice(at + 1)}${value.slice(authorityEnd)}`;
}

export function sanitizeTargetValue(
  rawValue: string,
  resolution: Exclude<TextInteractionTarget['resolution'], 'dynamic'>,
): Pick<TargetResolution, 'target' | 'queryKeys' | 'issue'> {
  if ([...rawValue].length > MAX_HTTP_TARGET_CODE_POINTS) {
    return {
      target: { resolution: 'dynamic', value: null },
      queryKeys: [],
      issue: 'limit',
    };
  }
  const withoutFragment = rawValue.split('#', 1)[0] ?? '';
  const queryStart = withoutFragment.indexOf('?');
  const path = stripUrlUserInfo(
    (queryStart < 0 ? withoutFragment : withoutFragment.slice(0, queryStart)).normalize('NFC'),
  );
  const query = queryStart < 0 ? '' : withoutFragment.slice(queryStart + 1);
  const queryKeys = uniqueSorted(
    query
      .split('&')
      .map((part) => part.split('=', 1)[0] ?? '')
      .filter((key) => key.length > 0 && !/[{}]/u.test(key))
      .slice(0, MAX_HTTP_QUERY_KEYS),
  );
  if (path.length === 0) {
    return {
      target: { resolution: 'dynamic', value: null },
      queryKeys,
      issue: 'dynamic',
    };
  }
  return { target: { resolution, value: path }, queryKeys, issue: null };
}

function constInitializer(
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

export function resolveTextTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  allowConst = true,
): TargetResolution {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    const normalized = sanitizeTargetValue(unwrapped.text, 'exact');
    return { ...normalized, evidenceNodes: [expression] };
  }
  if (ts.isTemplateExpression(unwrapped)) {
    if (unwrapped.templateSpans.length > MAX_HTTP_TEMPLATE_EXPRESSIONS) {
      return {
        target: { resolution: 'dynamic', value: null },
        queryKeys: [],
        evidenceNodes: [expression],
        issue: 'limit',
      };
    }
    const rawValue = [
      unwrapped.head.text,
      ...unwrapped.templateSpans.flatMap((span, index) => [`{${index}}`, span.literal.text]),
    ].join('');
    const staticText = rawValue.replaceAll(/\{\d+\}/gu, '');
    if (staticText.length === 0) {
      return {
        target: { resolution: 'dynamic', value: null },
        queryKeys: [],
        evidenceNodes: [expression],
        issue: 'dynamic',
      };
    }
    const normalized = sanitizeTargetValue(rawValue, 'template');
    return { ...normalized, evidenceNodes: [expression] };
  }
  if (allowConst && ts.isIdentifier(unwrapped)) {
    const declaration = constInitializer(unwrapped, checker);
    if (declaration !== null && declaration.initializer !== undefined) {
      const initializer = unwrapExpression(declaration.initializer);
      if (!ts.isIdentifier(initializer)) {
        const resolution = resolveTextTarget(declaration.initializer, checker, false);
        return {
          ...resolution,
          evidenceNodes: [expression, declaration, ...resolution.evidenceNodes],
        };
      }
    }
  }
  return {
    target: { resolution: 'dynamic', value: null },
    queryKeys: [],
    evidenceNodes: [expression],
    issue: 'dynamic',
  };
}

function isAbsoluteTarget(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value) || value.startsWith('//');
}

export function joinTarget(
  base: TargetResolution | null,
  request: TargetResolution,
): TargetResolution {
  if (request.target.value !== null && isAbsoluteTarget(request.target.value)) return request;
  if (base === null) return request;
  const evidenceNodes = [...base.evidenceNodes, ...request.evidenceNodes];
  const queryKeys = uniqueSorted([...base.queryKeys, ...request.queryKeys]);
  if (base.target.value === null || request.target.value === null) {
    return {
      target: { resolution: 'dynamic', value: null },
      queryKeys,
      evidenceNodes,
      issue: base.issue === 'limit' || request.issue === 'limit' ? 'limit' : 'dynamic',
    };
  }
  const normalizedValue = `${base.target.value.replace(/\/+$/u, '')}/${request.target.value.replace(/^\/+/u, '')}`;
  if ([...normalizedValue].length > MAX_HTTP_TARGET_CODE_POINTS) {
    return {
      target: { resolution: 'dynamic', value: null },
      queryKeys,
      evidenceNodes,
      issue: 'limit',
    };
  }
  return {
    target: {
      resolution:
        base.target.resolution === 'symbolic' || request.target.resolution === 'symbolic'
          ? 'symbolic'
          : base.target.resolution === 'template' || request.target.resolution === 'template'
            ? 'template'
            : 'exact',
      value: normalizedValue,
    },
    queryKeys,
    evidenceNodes,
    issue: base.issue ?? request.issue,
  };
}

function methodResolution(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
  defaultMethod: OutboundHttpMethod,
): { method: OutboundHttpMethod; evidenceNodes: readonly ts.Node[]; dynamic: boolean } {
  if (expression === undefined) {
    return { method: defaultMethod, evidenceNodes: [], dynamic: false };
  }
  const resolved = resolveTextTarget(expression, checker);
  const value = resolved.target.value?.toUpperCase() ?? null;
  return value !== null && STATIC_HTTP_METHODS.has(value)
    ? { method: value as OutboundHttpMethod, evidenceNodes: resolved.evidenceNodes, dynamic: false }
    : { method: 'UNKNOWN', evidenceNodes: resolved.evidenceNodes, dynamic: true };
}

export function queryKeysFromParams(expression: ts.Expression | undefined): {
  readonly keys: readonly string[];
  readonly supported: boolean;
  readonly evidenceNodes: readonly ts.Node[];
} {
  if (expression === undefined) return { keys: [], supported: true, evidenceNodes: [] };
  const unwrapped = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped) || hasUnsupportedObjectShape(unwrapped)) {
    return { keys: [], supported: false, evidenceNodes: [expression] };
  }
  const keys = unwrapped.properties.flatMap((property) => {
    if (!('name' in property) || property.name === undefined) return [];
    const key = staticPropertyName(property.name);
    return key === null || key.length === 0 ? [] : [key];
  });
  return {
    keys: uniqueSorted(keys).slice(0, MAX_HTTP_QUERY_KEYS),
    supported: keys.length <= MAX_HTTP_QUERY_KEYS,
    evidenceNodes: [expression],
  };
}

function packageIdentity(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
  moduleSpecifier: string,
  exportedNames: ReadonlySet<string>,
): ResolvedImportedExpressionIdentity | null {
  const identity = resolveImportedExpressionIdentity(expression, checker);
  return identity.moduleSpecifier === moduleSpecifier &&
    exportedNames.has(identity.exportedName) &&
    identity.symbol !== null &&
    declarationBelongsToPackage(identity.declarationFile, moduleSpecifier)
    ? identity
    : null;
}

function importDeclarationFor(node: ts.Node): ts.ImportDeclaration | null {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return null;
}

function hasImportOrigin(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  moduleSpecifier: string,
  exportedNames: ReadonlySet<string>,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) return false;
  const alias = checker.getSymbolAtLocation(unwrapped);
  return (alias?.declarations ?? []).some((declaration) => {
    const imported = importDeclarationFor(declaration);
    if (
      imported === null ||
      !ts.isStringLiteral(imported.moduleSpecifier) ||
      imported.moduleSpecifier.text !== moduleSpecifier
    ) {
      return false;
    }
    if (ts.isImportClause(declaration) && declaration.name !== undefined) {
      return exportedNames.has('default');
    }
    if (ts.isImportSpecifier(declaration)) {
      return exportedNames.has(declaration.propertyName?.text ?? declaration.name.text);
    }
    return false;
  });
}

function isAxiosBinding(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  return hasImportOrigin(expression, checker, AXIOS_MODULE, new Set(['default', 'axios']));
}

function callableBelongsToPackage(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  moduleSpecifier: string,
): boolean {
  return checker
    .getTypeAtLocation(expression)
    .getCallSignatures()
    .some((signature) =>
      declarationBelongsToPackage(
        signature.getDeclaration()?.getSourceFile().fileName ?? null,
        moduleSpecifier,
      ),
    );
}

function isUndiciFetch(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const unwrapped = unwrapExpression(expression);
  return (
    (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) &&
    packageIdentity(unwrapped, checker, UNDICI_MODULE, new Set(['fetch'])) !== null
  );
}

function isUnshadowedGlobalFetch(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped) || unwrapped.text !== 'fetch') return false;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(unwrapped));
  const declarations = symbol?.declarations ?? [];
  if (declarations.length === 0) return false;
  return declarations.every((declaration) => {
    const source = declaration.getSourceFile();
    if (!source.isDeclarationFile) return false;
    const normalized = source.fileName.replaceAll('\\', '/').toLowerCase();
    const fileName = basename(normalized);
    return (
      fileName === 'lib.dom.d.ts' ||
      fileName === 'lib.webworker.d.ts' ||
      normalized.includes('/@types/node/') ||
      normalized.includes('/undici-types/')
    );
  });
}

export function packageMember(
  access: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
  moduleSpecifier: string,
): boolean {
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(access.name));
  return declarationBelongsToPackage(symbolDeclarationFile(symbol), moduleSpecifier);
}

export function referenceSymbol(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.Symbol | null {
  const unwrapped = unwrapExpression(expression);
  const node = ts.isPropertyAccessExpression(unwrapped) ? unwrapped.name : unwrapped;
  return resolveAliasedSymbol(checker, checker.getSymbolAtLocation(node));
}

export function axiosConfiguration(
  expression: ts.Expression | undefined,
): ObjectConfiguration & { readonly behaviorSupported: boolean } {
  const configuration = objectConfiguration(expression);
  const behaviorSupported =
    configuration.state === 'resolved' &&
    !hasProperty(configuration.object, new Set(['adapter', 'transport', 'allowAbsoluteUrls']));
  return { ...configuration, behaviorSupported };
}

export function requestFromParts(input: {
  readonly urlExpression: ts.Expression | undefined;
  readonly methodExpression?: ts.Expression | undefined;
  readonly defaultMethod: OutboundHttpMethod;
  readonly base: TargetResolution | null;
  readonly configuration: ObjectConfiguration & { readonly behaviorSupported: boolean };
  readonly checker: ts.TypeChecker;
  readonly resolveTarget?:
    | ((expression: ts.Expression, checker: ts.TypeChecker) => TargetResolution)
    | undefined;
}): RequestDescription {
  const issues: DiagnosticCode[] = [];
  const config = input.configuration;
  const resolveTarget = input.resolveTarget ?? resolveTextTarget;
  if (config.state === 'unsupported' || !config.behaviorSupported) {
    issues.push('OUTBOUND_HTTP_CONFIG_UNSUPPORTED');
  }
  const configUrl = propertyExpression(config.object, 'url');
  const targetExpression = input.urlExpression ?? configUrl;
  const requestTarget =
    targetExpression === undefined
      ? ({
          target: { resolution: 'dynamic', value: null },
          queryKeys: [],
          evidenceNodes: [...config.evidenceNodes],
          issue: 'dynamic',
        } satisfies TargetResolution)
      : resolveTarget(targetExpression, input.checker);
  const configBaseExpression = propertyExpression(config.object, 'baseURL');
  const configBase =
    configBaseExpression === undefined
      ? input.base
      : resolveTarget(configBaseExpression, input.checker);
  const joined =
    config.state === 'unsupported' || !config.behaviorSupported
      ? {
          target: { resolution: 'dynamic', value: null } as const,
          queryKeys: [],
          evidenceNodes: [...config.evidenceNodes, ...requestTarget.evidenceNodes],
          issue: 'dynamic' as const,
        }
      : joinTarget(configBase, requestTarget);
  if (joined.issue === 'limit') issues.push('OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED');
  else if (joined.target.value === null) issues.push('OUTBOUND_HTTP_TARGET_DYNAMIC');

  const method = methodResolution(
    input.methodExpression ?? propertyExpression(config.object, 'method'),
    input.checker,
    input.defaultMethod,
  );
  if (method.dynamic) issues.push('OUTBOUND_HTTP_METHOD_DYNAMIC');
  const params = queryKeysFromParams(propertyExpression(config.object, 'params'));
  if (!params.supported) issues.push('OUTBOUND_HTTP_CONFIG_UNSUPPORTED');

  return {
    target: {
      targetKind: 'http',
      method: method.method,
      url: joined.target,
      queryKeys: uniqueSorted([...joined.queryKeys, ...params.keys]),
    },
    evidenceNodes: [...joined.evidenceNodes, ...method.evidenceNodes, ...params.evidenceNodes],
    issues: uniqueSorted(issues) as DiagnosticCode[],
  };
}

function axiosCreateBinding(
  initializer: ts.Expression,
  checker: ts.TypeChecker,
): InstanceBinding | null {
  const unwrapped = unwrapExpression(initializer);
  if (
    !ts.isCallExpression(unwrapped) ||
    !ts.isPropertyAccessExpression(unwrapped.expression) ||
    unwrapped.expression.name.text !== 'create' ||
    !isAxiosBinding(unwrapped.expression.expression, checker) ||
    !packageMember(unwrapped.expression, checker, AXIOS_MODULE)
  ) {
    return null;
  }
  const configuration = axiosConfiguration(unwrapped.arguments[0]);
  const baseExpression = propertyExpression(configuration.object, 'baseURL');
  return {
    base: baseExpression === undefined ? null : resolveTextTarget(baseExpression, checker),
    configurationSupported: configuration.state === 'resolved' && configuration.behaviorSupported,
    evidenceNodes: [unwrapped.expression, ...configuration.evidenceNodes],
  };
}

function nestedFunctionBoundary(
  node: ts.Node,
  root: ts.MethodDeclaration,
  allowedNestedFunctions: ReadonlySet<ts.Node>,
): boolean {
  return node !== root && ts.isFunctionLike(node) && !allowedNestedFunctions.has(node);
}

function withInstanceEvidence(
  description: RequestDescription,
  instance: InstanceBinding | undefined,
): RequestDescription {
  return instance === undefined
    ? description
    : {
        ...description,
        evidenceNodes: [...instance.evidenceNodes, ...description.evidenceNodes],
      };
}

export function extractOutboundHttp(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
  readonly allowedNestedFunctions?: ReadonlySet<ts.Node>;
}): OutboundHttpExtraction {
  const allowedNestedFunctions = input.allowedNestedFunctions ?? new Set();
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );
  const instanceBySymbol = new Map<ts.Symbol, InstanceBinding>();
  const collectInstances = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const immutable = ts.isVariableDeclaration(node)
        ? ts.isVariableDeclarationList(node.parent) &&
          (node.parent.flags & ts.NodeFlags.Const) !== 0
        : (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ??
          false);
      if (immutable) {
        const binding = axiosCreateBinding(node.initializer, input.checker);
        const symbol = resolveAliasedSymbol(
          input.checker,
          input.checker.getSymbolAtLocation(node.name),
        );
        if (binding !== null && symbol !== null) instanceBySymbol.set(symbol, binding);
      }
    }
    ts.forEachChild(node, collectInstances);
  };
  for (const source of input.sourceIndex.sourceFiles) collectInstances(source.sourceFile);

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
    if (snippet) return addEvidence(record);
    return addEvidence({ ...record, snippet: undefined });
  };
  const rolesForClass = (located: LocatedMethod): readonly ClassRole[] => [
    ...(located.indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Controller'),
    )
      ? (['controller'] as const)
      : []),
    ...(located.indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Injectable'),
    )
      ? (['provider'] as const)
      : []),
  ];
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
      roles: rolesForClass(located),
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
  ): void => {
    const method = ensureMethod(located);
    const callEvidenceId = evidenceForNode(call.expression, 'call_site', true);
    if (callEvidenceId === null) return;
    const supportingEvidenceIds = description.evidenceNodes.flatMap((node) => {
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
      activation: 'eager',
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
    for (const code of description.issues) {
      addDiagnostic(located, code, evidenceIds);
    }
  };

  const analyzeAxios = (located: LocatedMethod, call: ts.CallExpression): boolean => {
    const callee = unwrapExpression(call.expression);
    if (ts.isElementAccessExpression(callee)) {
      const receiverSymbol = referenceSymbol(callee.expression, input.checker);
      if (
        isAxiosBinding(callee.expression, input.checker) ||
        (receiverSymbol !== null && instanceBySymbol.has(receiverSymbol))
      ) {
        const callEvidenceId = evidenceForNode(callee, 'call_site', true);
        addDiagnostic(
          located,
          'OUTBOUND_HTTP_METHOD_DYNAMIC',
          callEvidenceId === null ? [] : [callEvidenceId],
          'A computed Axios member is outside the supported request-method set.',
        );
        return true;
      }
      return false;
    }

    if (ts.isPropertyAccessExpression(callee)) {
      const methodName = callee.name.text;
      if (methodName === 'create' && isAxiosBinding(callee.expression, input.checker)) return true;
      const direct = isAxiosBinding(callee.expression, input.checker);
      const receiverSymbol = referenceSymbol(callee.expression, input.checker);
      const instance = receiverSymbol === null ? undefined : instanceBySymbol.get(receiverSymbol);
      const packageProven = packageMember(callee, input.checker, AXIOS_MODULE);
      if ((!direct && instance === undefined) || !packageProven) {
        const nestAxiosRef =
          ts.isPropertyAccessExpression(callee.expression) &&
          callee.expression.name.text === 'axiosRef' &&
          packageMember(callee.expression, input.checker, NEST_AXIOS_MODULE);
        if (nestAxiosRef) return false;
        if (
          !direct &&
          instance === undefined &&
          packageProven &&
          (AXIOS_METHODS.has(methodName) || methodName === 'request')
        ) {
          const callEvidenceId = evidenceForNode(callee, 'call_site', true);
          addDiagnostic(
            located,
            'OUTBOUND_HTTP_RECEIVER_UNSUPPORTED',
            callEvidenceId === null ? [] : [callEvidenceId],
          );
          return true;
        }
        return false;
      }
      const base = instance?.base ?? null;
      const bindingSupported = instance?.configurationSupported ?? true;
      if (methodName === 'request') {
        const configuration = axiosConfiguration(call.arguments[0]);
        publish(
          located,
          call,
          OUTBOUND_HTTP_AXIOS_RULE_ID,
          withInstanceEvidence(
            requestFromParts({
              urlExpression: undefined,
              defaultMethod: 'GET',
              base,
              configuration: {
                ...configuration,
                behaviorSupported: configuration.behaviorSupported && bindingSupported,
              },
              checker: input.checker,
            }),
            instance,
          ),
        );
        return true;
      }
      const method = AXIOS_METHODS.get(methodName);
      if (method === undefined) return false;
      const configIndex = method === 'POST' || method === 'PUT' || method === 'PATCH' ? 2 : 1;
      const configuration = axiosConfiguration(call.arguments[configIndex]);
      publish(
        located,
        call,
        OUTBOUND_HTTP_AXIOS_RULE_ID,
        withInstanceEvidence(
          requestFromParts({
            urlExpression: call.arguments[0],
            defaultMethod: method,
            base,
            configuration: {
              ...configuration,
              behaviorSupported: configuration.behaviorSupported && bindingSupported,
            },
            checker: input.checker,
          }),
          instance,
        ),
      );
      return true;
    }

    const receiverSymbol = referenceSymbol(callee, input.checker);
    const instance = receiverSymbol === null ? undefined : instanceBySymbol.get(receiverSymbol);
    const direct = isAxiosBinding(callee, input.checker);
    if (!direct && instance === undefined) return false;
    if (direct && !callableBelongsToPackage(callee, input.checker, AXIOS_MODULE)) return false;
    const firstArgument = call.arguments[0];
    const firstUnwrapped =
      firstArgument === undefined ? undefined : unwrapExpression(firstArgument);
    if (firstUnwrapped !== undefined && ts.isObjectLiteralExpression(firstUnwrapped)) {
      const configuration = axiosConfiguration(firstArgument);
      publish(
        located,
        call,
        OUTBOUND_HTTP_AXIOS_RULE_ID,
        withInstanceEvidence(
          requestFromParts({
            urlExpression: undefined,
            defaultMethod: 'GET',
            base: instance?.base ?? null,
            configuration: {
              ...configuration,
              behaviorSupported:
                configuration.behaviorSupported && (instance?.configurationSupported ?? true),
            },
            checker: input.checker,
          }),
          instance,
        ),
      );
      return true;
    }
    const configuration = axiosConfiguration(call.arguments[1]);
    publish(
      located,
      call,
      OUTBOUND_HTTP_AXIOS_RULE_ID,
      withInstanceEvidence(
        requestFromParts({
          urlExpression: firstArgument,
          defaultMethod: 'GET',
          base: instance?.base ?? null,
          configuration: {
            ...configuration,
            behaviorSupported:
              configuration.behaviorSupported && (instance?.configurationSupported ?? true),
          },
          checker: input.checker,
        }),
        instance,
      ),
    );
    return true;
  };

  const analyzeFetch = (located: LocatedMethod, call: ts.CallExpression): boolean => {
    const callee = unwrapExpression(call.expression);
    const ruleId = isUndiciFetch(callee, input.checker)
      ? OUTBOUND_HTTP_UNDICI_RULE_ID
      : isUnshadowedGlobalFetch(callee, input.checker)
        ? OUTBOUND_HTTP_FETCH_RULE_ID
        : null;
    if (ruleId === null) return false;
    const configuration = objectConfiguration(call.arguments[1]);
    const methodExpression = propertyExpression(configuration.object, 'method');
    const request = requestFromParts({
      urlExpression: call.arguments[0],
      methodExpression,
      defaultMethod: 'GET',
      base: null,
      configuration: {
        ...configuration,
        behaviorSupported: configuration.state === 'resolved',
      },
      checker: input.checker,
    });
    publish(located, call, ruleId, request);
    return true;
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      for (const method of indexedClass.methods) {
        const located = { source, indexedClass, method };
        const visit = (node: ts.Node): void => {
          if (nestedFunctionBoundary(node, method.node, allowedNestedFunctions)) return;
          if (ts.isCallExpression(node)) {
            if (!analyzeFetch(located, node)) analyzeAxios(located, node);
          }
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
