import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { makeAssertionId, makeResourceAccessId } from '../model/ids.js';
import {
  resourceTargetKey,
  type ResourceAccessRecord,
  type ResourceKind,
  type ResourceOperation,
  type ResourceTarget,
  type ResourceTargetSegment,
  type ResourceTechnology,
} from '../model/resource-access.js';
import { resolveSimpleString } from '../ts-index/constants.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import {
  createClassRecord,
  createDeclarationEvidence,
  createMethodRecord,
} from './canonical-records.js';
import { packageMember, unwrapExpression } from './outbound-http.js';
import { isPackageDecorator } from './package-symbols.js';

export const CACHE_MANAGER_RESOURCE_RULE_ID = 'resource.cache-manager.direct.v1';
export const IOREDIS_RESOURCE_RULE_ID = 'resource.ioredis.direct.v1';

const CACHE_MANAGER_MODULE = 'cache-manager';
const IOREDIS_MODULE = 'ioredis';
const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_BULLMQ_MODULE = '@nestjs/bullmq';
const MAX_TARGET_CODE_POINTS = 512;
const MAX_TEMPLATE_EXPRESSIONS = 15;
const MAX_BATCH_KEYS = 16;

interface LocatedMethod {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly method: IndexedMethod;
}

export interface TargetResolution {
  readonly target: ResourceTarget;
  readonly evidenceNodes: readonly ts.Node[];
  readonly issue: Extract<
    DiagnosticCode,
    'RESOURCE_ACCESS_TARGET_DYNAMIC' | 'RESOURCE_ACCESS_TARGET_LIMIT_EXCEEDED'
  > | null;
}

interface OperationDescription {
  readonly resourceKind: ResourceKind;
  readonly operation: ResourceOperation;
}

export interface ResourceAccessExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly resourceAccesses: readonly ResourceAccessRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly state: 'complete' | 'incomplete';
}

const CACHE_OPERATIONS = new Map<string, OperationDescription>([
  ['get', { resourceKind: 'cache_entry', operation: 'read' }],
  ['set', { resourceKind: 'cache_entry', operation: 'write' }],
  ['del', { resourceKind: 'cache_entry', operation: 'delete' }],
  ['wrap', { resourceKind: 'cache_entry', operation: 'read_write' }],
]);

const REDIS_OPERATIONS = new Map<string, OperationDescription>([
  ['get', { resourceKind: 'redis_key', operation: 'read' }],
  ['exists', { resourceKind: 'redis_key', operation: 'read' }],
  ['ttl', { resourceKind: 'redis_key', operation: 'read' }],
  ['pttl', { resourceKind: 'redis_key', operation: 'read' }],
  ['type', { resourceKind: 'redis_key', operation: 'read' }],
  ['set', { resourceKind: 'redis_key', operation: 'write' }],
  ['setex', { resourceKind: 'redis_key', operation: 'write' }],
  ['psetex', { resourceKind: 'redis_key', operation: 'write' }],
  ['incr', { resourceKind: 'redis_key', operation: 'write' }],
  ['incrby', { resourceKind: 'redis_key', operation: 'write' }],
  ['decr', { resourceKind: 'redis_key', operation: 'write' }],
  ['decrby', { resourceKind: 'redis_key', operation: 'write' }],
  ['append', { resourceKind: 'redis_key', operation: 'write' }],
  ['del', { resourceKind: 'redis_key', operation: 'delete' }],
  ['unlink', { resourceKind: 'redis_key', operation: 'delete' }],
  ['expire', { resourceKind: 'redis_key', operation: 'expire' }],
  ['pexpire', { resourceKind: 'redis_key', operation: 'expire' }],
  ['expireat', { resourceKind: 'redis_key', operation: 'expire' }],
  ['pexpireat', { resourceKind: 'redis_key', operation: 'expire' }],
  ['persist', { resourceKind: 'redis_key', operation: 'expire' }],
  ['hget', { resourceKind: 'redis_hash', operation: 'read' }],
  ['hgetall', { resourceKind: 'redis_hash', operation: 'read' }],
  ['hexists', { resourceKind: 'redis_hash', operation: 'read' }],
  ['hset', { resourceKind: 'redis_hash', operation: 'write' }],
  ['hincrby', { resourceKind: 'redis_hash', operation: 'write' }],
  ['hincrbyfloat', { resourceKind: 'redis_hash', operation: 'write' }],
  ['hdel', { resourceKind: 'redis_hash', operation: 'delete' }],
  ['scan', { resourceKind: 'redis_keyspace', operation: 'scan' }],
  ['hscan', { resourceKind: 'redis_hash', operation: 'scan' }],
]);

const UNSUPPORTED_REDIS_OPERATIONS = new Set([
  'pipeline',
  'multi',
  'exec',
  'eval',
  'evalsha',
  'publish',
  'subscribe',
  'psubscribe',
  'unsubscribe',
  'punsubscribe',
  'monitor',
  'keys',
  'scanstream',
]);

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
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
    ) ||
    indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_BULLMQ_MODULE, 'Processor'),
    )
      ? (['provider'] as const)
      : []),
  ];
}

function nodeProcessSymbol(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  if (identifier.text !== 'process') return false;
  const symbol = checker.getSymbolAtLocation(identifier);
  const declarations = symbol?.declarations ?? [];
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      const path = declaration.getSourceFile().fileName.replaceAll('\\', '/').toLowerCase();
      return declaration.getSourceFile().isDeclarationFile && path.includes('/@types/node/');
    })
  );
}

function symbolicToken(expression: ts.Expression, checker: ts.TypeChecker): string | null {
  const current = unwrapExpression(expression);
  if (
    ts.isPropertyAccessExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    nodeProcessSymbol(current.expression.expression, checker) &&
    current.expression.name.text === 'env'
  ) {
    return `process.env.${current.name.text}`;
  }
  if (
    ts.isElementAccessExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    nodeProcessSymbol(current.expression.expression, checker) &&
    current.expression.name.text === 'env' &&
    current.argumentExpression !== undefined
  ) {
    const key = resolveSimpleString(current.argumentExpression, checker);
    return key.status === 'resolved' ? `process.env.${key.value}` : null;
  }
  if (
    ts.isPropertyAccessExpression(current) &&
    current.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return `this.${current.name.text}`;
  }
  return null;
}

function mergeLiteralSegments(segments: readonly ResourceTargetSegment[]): ResourceTargetSegment[] {
  const merged: ResourceTargetSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (segment.kind === 'literal' && previous?.kind === 'literal') {
      merged[merged.length - 1] = { kind: 'literal', value: previous.value + segment.value };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function templateTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): TargetResolution | null {
  const current = unwrapExpression(expression);
  const evidenceNodes: ts.Node[] = [expression];
  const segments: ResourceTargetSegment[] = [];
  let placeholder = 0;
  const addDynamic = (value: ts.Expression): void => {
    const symbolic = symbolicToken(value, checker);
    if (symbolic === null) {
      segments.push({ kind: 'placeholder', index: placeholder });
      placeholder += 1;
    } else {
      segments.push({ kind: 'symbolic', token: symbolic });
    }
    evidenceNodes.push(value);
  };
  if (ts.isTemplateExpression(current)) {
    if (current.templateSpans.length > MAX_TEMPLATE_EXPRESSIONS) {
      return {
        target: { kind: 'dynamic' },
        evidenceNodes,
        issue: 'RESOURCE_ACCESS_TARGET_LIMIT_EXCEEDED',
      };
    }
    segments.push({ kind: 'literal', value: current.head.text.normalize('NFC') });
    for (const span of current.templateSpans) {
      addDynamic(span.expression);
      segments.push({ kind: 'literal', value: span.literal.text.normalize('NFC') });
    }
  } else if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const leaves: ts.Expression[] = [];
    const flatten = (node: ts.Expression): void => {
      const child = unwrapExpression(node);
      if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        flatten(child.left);
        flatten(child.right);
      } else {
        leaves.push(child);
      }
    };
    flatten(current);
    if (leaves.length > MAX_TEMPLATE_EXPRESSIONS * 2) {
      return {
        target: { kind: 'dynamic' },
        evidenceNodes,
        issue: 'RESOURCE_ACCESS_TARGET_LIMIT_EXCEEDED',
      };
    }
    for (const leaf of leaves) {
      const exact = resolveSimpleString(leaf, checker);
      if (exact.status === 'resolved') {
        segments.push({ kind: 'literal', value: exact.value.normalize('NFC') });
        evidenceNodes.push(...exact.evidenceNodes);
      } else {
        addDynamic(leaf);
      }
    }
  } else {
    return null;
  }
  const merged = mergeLiteralSegments(segments);
  const staticLength = merged.reduce(
    (total, segment) => total + (segment.kind === 'literal' ? [...segment.value].length : 0),
    0,
  );
  if (staticLength > MAX_TARGET_CODE_POINTS || merged.length > 32) {
    return {
      target: { kind: 'dynamic' },
      evidenceNodes,
      issue: 'RESOURCE_ACCESS_TARGET_LIMIT_EXCEEDED',
    };
  }
  if (!merged.some(({ kind }) => kind === 'literal' || kind === 'symbolic')) return null;
  return {
    target: { kind: 'template', segments: merged },
    evidenceNodes,
    issue: null,
  };
}

export function resolveResourceTarget(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
): TargetResolution {
  if (expression === undefined) {
    return {
      target: { kind: 'dynamic' },
      evidenceNodes: [],
      issue: 'RESOURCE_ACCESS_TARGET_DYNAMIC',
    };
  }
  const exact = resolveSimpleString(expression, checker);
  if (exact.status === 'resolved') {
    const value = exact.value.normalize('NFC');
    return [...value].length <= MAX_TARGET_CODE_POINTS
      ? { target: { kind: 'exact', value }, evidenceNodes: exact.evidenceNodes, issue: null }
      : {
          target: { kind: 'dynamic' },
          evidenceNodes: exact.evidenceNodes,
          issue: 'RESOURCE_ACCESS_TARGET_LIMIT_EXCEEDED',
        };
  }
  const template = templateTarget(expression, checker);
  if (template !== null) return template;
  const symbolic = symbolicToken(expression, checker);
  return symbolic === null
    ? {
        target: { kind: 'dynamic' },
        evidenceNodes: [expression],
        issue: 'RESOURCE_ACCESS_TARGET_DYNAMIC',
      }
    : {
        target: { kind: 'symbolic', token: symbolic },
        evidenceNodes: [expression],
        issue: null,
      };
}

function matchArgument(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  start: number,
): ts.Expression | undefined {
  for (let index = start; index < call.arguments.length - 1; index += 1) {
    const option = resolveSimpleString(call.arguments[index]!, checker);
    if (option.status === 'resolved' && option.value.toUpperCase() === 'MATCH') {
      return call.arguments[index + 1];
    }
  }
  return undefined;
}

function nestedFunctionBoundary(
  node: ts.Node,
  root: ts.MethodDeclaration,
  allowedNestedFunctions: ReadonlySet<ts.Node>,
): boolean {
  return node !== root && ts.isFunctionLike(node) && !allowedNestedFunctions.has(node);
}

export function extractResourceAccesses(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
  readonly allowedNestedFunctions?: ReadonlySet<ts.Node>;
}): ResourceAccessExtraction {
  const allowedNestedFunctions = input.allowedNestedFunctions ?? new Set();
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );
  const classById = new Map<string, ClassRecord>();
  const methodById = new Map<string, MethodRecord>();
  const accessById = new Map<string, ResourceAccessRecord>();
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
    const sourceClass = createClassRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId: classEvidenceId,
      roles: recognizedRoles(located.indexedClass),
    });
    classById.set(sourceClass.id, sourceClass);
    const methodEvidenceId = addEvidence(
      createDeclarationEvidence(located.source, located.method.node, input.evidenceSnippetLimit),
    );
    const method = createMethodRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      method: located.method,
      classId: sourceClass.id,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId: methodEvidenceId,
    });
    methodById.set(method.id, method);
    return method;
  };
  const addDiagnostic = (
    located: LocatedMethod,
    code: DiagnosticCode,
    evidenceIds: readonly string[],
  ): void => {
    const method = ensureMethod(located);
    const diagnostic = createDiagnostic({ code, subjectId: method.id, evidenceIds });
    diagnosticById.set(diagnostic.id, diagnostic);
  };
  const publish = (inputRecord: {
    readonly located: LocatedMethod;
    readonly call: ts.CallExpression;
    readonly technology: ResourceTechnology;
    readonly api: string;
    readonly description: OperationDescription;
    readonly target: TargetResolution;
    readonly selector: TargetResolution | null;
    readonly ruleId: string;
  }): void => {
    const method = ensureMethod(inputRecord.located);
    const callEvidenceId = evidenceForNode(inputRecord.call.expression, 'call_site', true);
    if (callEvidenceId === null) return;
    const basisIds = [
      ...inputRecord.target.evidenceNodes,
      ...(inputRecord.selector?.evidenceNodes ?? []),
    ].flatMap((node) => {
      const id = evidenceForNode(node, 'resolution_basis', false);
      return id === null ? [] : [id];
    });
    const evidenceIds = [...new Set([callEvidenceId, ...basisIds])].sort();
    const id = makeResourceAccessId({
      sourceMethodId: method.id,
      technology: inputRecord.technology,
      resourceKind: inputRecord.description.resourceKind,
      operation: inputRecord.description.operation,
      api: inputRecord.api,
      targetKey: resourceTargetKey(inputRecord.target.target),
      selectorKey:
        inputRecord.selector === null ? null : resourceTargetKey(inputRecord.selector.target),
      callEvidenceId,
      ruleId: inputRecord.ruleId,
    });
    const record: ResourceAccessRecord = {
      id,
      resourceKind: inputRecord.description.resourceKind,
      operation: inputRecord.description.operation,
      technology: inputRecord.technology,
      api: inputRecord.api,
      sourceMethodId: method.id,
      target: inputRecord.target.target,
      selector: inputRecord.selector?.target ?? null,
      ruleId: inputRecord.ruleId,
      evidenceIds,
    };
    accessById.set(id, record);
    const assertion: AssertionRecord = {
      id: makeAssertionId({
        subjectId: method.id,
        predicate: 'METHOD_ACCESSES_RESOURCE',
        objectId: id,
        ruleId: inputRecord.ruleId,
      }),
      subjectId: method.id,
      predicate: 'METHOD_ACCESSES_RESOURCE',
      objectId: id,
      status: 'resolved',
      ruleId: inputRecord.ruleId,
      evidenceIds,
    };
    assertionById.set(assertion.id, assertion);
    for (const issue of [inputRecord.target.issue, inputRecord.selector?.issue ?? null]) {
      if (issue !== null) addDiagnostic(inputRecord.located, issue, evidenceIds);
    }
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      if (recognizedRoles(indexedClass).length === 0) continue;
      for (const method of indexedClass.methods) {
        const located = { source, indexedClass, method };
        const visit = (node: ts.Node): void => {
          if (nestedFunctionBoundary(node, method.node, allowedNestedFunctions)) return;
          if (ts.isCallExpression(node)) {
            const callee = unwrapExpression(node.expression);
            if (ts.isPropertyAccessExpression(callee)) {
              const api = callee.name.text.toLowerCase();
              if (packageMember(callee, input.checker, CACHE_MANAGER_MODULE)) {
                const description = CACHE_OPERATIONS.get(api);
                if (description === undefined) {
                  const evidenceId = evidenceForNode(node.expression, 'call_site', true);
                  if (evidenceId !== null) {
                    addDiagnostic(located, 'RESOURCE_ACCESS_OPERATION_UNSUPPORTED', [evidenceId]);
                  }
                } else {
                  publish({
                    located,
                    call: node,
                    technology: 'cache_manager',
                    api,
                    description,
                    target: resolveResourceTarget(node.arguments[0], input.checker),
                    selector: null,
                    ruleId: CACHE_MANAGER_RESOURCE_RULE_ID,
                  });
                }
              } else if (packageMember(callee, input.checker, IOREDIS_MODULE)) {
                const description = REDIS_OPERATIONS.get(api);
                if (description === undefined) {
                  if (UNSUPPORTED_REDIS_OPERATIONS.has(api)) {
                    const evidenceId = evidenceForNode(node.expression, 'call_site', true);
                    if (evidenceId !== null) {
                      addDiagnostic(located, 'RESOURCE_ACCESS_OPERATION_UNSUPPORTED', [evidenceId]);
                    }
                  }
                } else if (api === 'del' || api === 'unlink') {
                  if (node.arguments.length > MAX_BATCH_KEYS) {
                    const evidenceId = evidenceForNode(node.expression, 'call_site', true);
                    if (evidenceId !== null) {
                      addDiagnostic(located, 'RESOURCE_ACCESS_TARGET_LIMIT_EXCEEDED', [evidenceId]);
                    }
                  } else {
                    for (const argument of node.arguments) {
                      publish({
                        located,
                        call: node,
                        technology: 'ioredis',
                        api,
                        description,
                        target: resolveResourceTarget(argument, input.checker),
                        selector: null,
                        ruleId: IOREDIS_RESOURCE_RULE_ID,
                      });
                    }
                  }
                } else if (api === 'scan') {
                  publish({
                    located,
                    call: node,
                    technology: 'ioredis',
                    api,
                    description,
                    target: resolveResourceTarget(
                      matchArgument(node, input.checker, 1),
                      input.checker,
                    ),
                    selector: null,
                    ruleId: IOREDIS_RESOURCE_RULE_ID,
                  });
                } else if (api === 'hscan') {
                  publish({
                    located,
                    call: node,
                    technology: 'ioredis',
                    api,
                    description,
                    target: resolveResourceTarget(node.arguments[0], input.checker),
                    selector: resolveResourceTarget(
                      matchArgument(node, input.checker, 2),
                      input.checker,
                    ),
                    ruleId: IOREDIS_RESOURCE_RULE_ID,
                  });
                } else {
                  publish({
                    located,
                    call: node,
                    technology: 'ioredis',
                    api,
                    description,
                    target: resolveResourceTarget(node.arguments[0], input.checker),
                    selector: null,
                    ruleId: IOREDIS_RESOURCE_RULE_ID,
                  });
                }
              }
            }
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
    resourceAccesses: [...accessById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
    state: diagnosticById.size === 0 ? 'complete' : 'incomplete',
  };
}
