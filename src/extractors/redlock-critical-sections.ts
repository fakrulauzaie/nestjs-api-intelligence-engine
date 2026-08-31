import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { CriticalSectionRecord } from '../model/critical-sections.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { makeAssertionId, makeCriticalSectionId, makeResourceAccessId } from '../model/ids.js';
import { resolveResourceTarget, type TargetResolution } from './resource-access.js';
import { resourceTargetKey, type ResourceAccessRecord } from '../model/resource-access.js';
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
import { packageMember, unwrapExpression } from './outbound-http.js';
import { isPackageDecorator } from './package-symbols.js';

export const REDLOCK_CRITICAL_SECTION_RULE_ID = 'resource.redlock.using.v1';
const REDLOCK_MODULE = 'redlock';
const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_BULLMQ_MODULE = '@nestjs/bullmq';
const MAX_LOCK_RESOURCES = 16;

interface LocatedMethod {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly method: IndexedMethod;
}

export interface RedlockCriticalSectionExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly resourceAccesses: readonly ResourceAccessRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly criticalSections: readonly CriticalSectionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly allowedNestedFunctions: ReadonlySet<ts.FunctionLikeDeclaration>;
  readonly state: 'complete' | 'incomplete';
}

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

function immutableArrayInitializer(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.ArrayLiteralExpression | null {
  const current = unwrapExpression(expression);
  if (ts.isArrayLiteralExpression(current)) return current;
  if (!ts.isIdentifier(current)) return null;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(current));
  const declarations = symbol?.declarations?.filter(ts.isVariableDeclaration) ?? [];
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  if (
    declaration.initializer === undefined ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    (declaration.parent.flags & ts.NodeFlags.Const) === 0
  ) {
    return null;
  }
  const initializer = unwrapExpression(declaration.initializer);
  return ts.isArrayLiteralExpression(initializer) ? initializer : null;
}

function lockTargets(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
): {
  readonly targets: readonly TargetResolution[];
  readonly issue: {
    readonly code: Extract<
      DiagnosticCode,
      'CRITICAL_SECTION_TARGET_DYNAMIC' | 'CRITICAL_SECTION_TARGET_LIMIT_EXCEEDED'
    >;
    readonly node: ts.Node | null;
  } | null;
} {
  const dynamic = (
    code: Extract<
      DiagnosticCode,
      'CRITICAL_SECTION_TARGET_DYNAMIC' | 'CRITICAL_SECTION_TARGET_LIMIT_EXCEEDED'
    >,
  ): ReturnType<typeof lockTargets> => ({
    targets: [
      {
        target: { kind: 'dynamic' },
        evidenceNodes: expression === undefined ? [] : [expression],
        issue: null,
      },
    ],
    issue: { code, node: expression ?? null },
  });
  if (expression === undefined) {
    return dynamic('CRITICAL_SECTION_TARGET_DYNAMIC');
  }
  const array = immutableArrayInitializer(expression, checker);
  if (array === null || array.elements.some(ts.isSpreadElement) || array.elements.length === 0) {
    return dynamic('CRITICAL_SECTION_TARGET_DYNAMIC');
  }
  if (array.elements.length > MAX_LOCK_RESOURCES) {
    return dynamic('CRITICAL_SECTION_TARGET_LIMIT_EXCEEDED');
  }
  return {
    targets: array.elements.map((element) => resolveResourceTarget(element, checker)),
    issue: null,
  };
}

export function extractRedlockCriticalSections(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
}): RedlockCriticalSectionExtraction {
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
  const sectionById = new Map<string, CriticalSectionRecord>();
  const evidenceById = new Map<string, EvidenceRecord>();
  const diagnosticById = new Map<string, DiagnosticRecord>();
  const allowedNestedFunctions = new Set<ts.FunctionLikeDeclaration>();

  const addEvidence = (record: EvidenceRecord): string => {
    evidenceById.set(record.id, record);
    return record.id;
  };
  const evidenceForNode = (
    node: ts.Node,
    role: EvidenceRecord['role'],
    snippet = true,
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
    const owner = createClassRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId: classEvidenceId,
      roles: recognizedRoles(located.indexedClass),
    });
    classById.set(owner.id, owner);
    const methodEvidenceId = addEvidence(
      createDeclarationEvidence(located.source, located.method.node, input.evidenceSnippetLimit),
    );
    const method = createMethodRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      method: located.method,
      classId: owner.id,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId: methodEvidenceId,
    });
    methodById.set(method.id, method);
    return method;
  };
  const addDiagnostic = (
    methodId: string,
    code: DiagnosticCode,
    evidenceIds: readonly string[],
  ): void => {
    const diagnostic = createDiagnostic({ code, subjectId: methodId, evidenceIds });
    diagnosticById.set(diagnostic.id, diagnostic);
  };

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      if (recognizedRoles(indexedClass).length === 0) continue;
      for (const indexedMethod of indexedClass.methods) {
        if (indexedMethod.node.body === undefined) continue;
        const located = { source, indexedClass, method: indexedMethod };
        const visit = (node: ts.Node): void => {
          if (node !== indexedMethod.node && ts.isFunctionLike(node)) return;
          if (ts.isCallExpression(node)) {
            const callee = unwrapExpression(node.expression);
            if (
              ts.isPropertyAccessExpression(callee) &&
              callee.name.text === 'using' &&
              packageMember(callee, input.checker, REDLOCK_MODULE)
            ) {
              const method = ensureMethod(located);
              const callEvidenceId = evidenceForNode(node.expression, 'call_site');
              if (callEvidenceId === null) return;
              const callbackExpression = node.arguments.at(-1);
              const callback =
                callbackExpression !== undefined &&
                (ts.isArrowFunction(callbackExpression) ||
                  ts.isFunctionExpression(callbackExpression))
                  ? callbackExpression
                  : null;
              if (callback === null) {
                addDiagnostic(method.id, 'CRITICAL_SECTION_CALLBACK_UNSUPPORTED', [callEvidenceId]);
                return;
              }
              const callbackEvidenceId = evidenceForNode(callback, 'resolution_basis', false);
              if (callbackEvidenceId === null) return;
              const resolution = lockTargets(node.arguments[0], input.checker);
              if (resolution.issue !== null) {
                const basisId =
                  resolution.issue.node === null
                    ? null
                    : evidenceForNode(resolution.issue.node, 'resolution_basis', false);
                addDiagnostic(method.id, resolution.issue.code, [
                  callEvidenceId,
                  ...(basisId === null ? [] : [basisId]),
                ]);
              }
              const lockResourceAccessIds: string[] = [];
              for (const target of resolution.targets) {
                const basisIds = target.evidenceNodes.flatMap((targetNode) => {
                  const id = evidenceForNode(targetNode, 'resolution_basis', false);
                  return id === null ? [] : [id];
                });
                const evidenceIds = [...new Set([callEvidenceId, ...basisIds])].sort();
                const accessId = makeResourceAccessId({
                  sourceMethodId: method.id,
                  technology: 'redlock',
                  resourceKind: 'distributed_lock',
                  operation: 'critical_section',
                  api: 'using',
                  targetKey: resourceTargetKey(target.target),
                  selectorKey: null,
                  callEvidenceId,
                  ruleId: REDLOCK_CRITICAL_SECTION_RULE_ID,
                });
                accessById.set(accessId, {
                  id: accessId,
                  resourceKind: 'distributed_lock',
                  operation: 'critical_section',
                  technology: 'redlock',
                  api: 'using',
                  sourceMethodId: method.id,
                  target: target.target,
                  selector: null,
                  ruleId: REDLOCK_CRITICAL_SECTION_RULE_ID,
                  evidenceIds,
                });
                const assertion: AssertionRecord = {
                  id: makeAssertionId({
                    subjectId: method.id,
                    predicate: 'METHOD_ACCESSES_RESOURCE',
                    objectId: accessId,
                    ruleId: REDLOCK_CRITICAL_SECTION_RULE_ID,
                  }),
                  subjectId: method.id,
                  predicate: 'METHOD_ACCESSES_RESOURCE',
                  objectId: accessId,
                  status: 'resolved',
                  ruleId: REDLOCK_CRITICAL_SECTION_RULE_ID,
                  evidenceIds,
                };
                assertionById.set(assertion.id, assertion);
                lockResourceAccessIds.push(accessId);
                if (target.issue !== null) addDiagnostic(method.id, target.issue, evidenceIds);
              }
              const sectionId = makeCriticalSectionId({
                sourceMethodId: method.id,
                lockResourceAccessIds,
                callbackEvidenceId,
                ruleId: REDLOCK_CRITICAL_SECTION_RULE_ID,
              });
              sectionById.set(sectionId, {
                id: sectionId,
                sourceMethodId: method.id,
                lockResourceAccessIds,
                callbackKind: ts.isArrowFunction(callback) ? 'inline_arrow' : 'inline_function',
                callbackEvidenceId,
                effectAssertionIds: [],
                ruleId: REDLOCK_CRITICAL_SECTION_RULE_ID,
                evidenceIds: [callEvidenceId, callbackEvidenceId],
              });
              allowedNestedFunctions.add(callback);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(indexedMethod.node.body);
      }
    }
  }

  return {
    classes: [...classById.values()],
    methods: [...methodById.values()],
    resourceAccesses: [...accessById.values()],
    assertions: [...assertionById.values()],
    criticalSections: [...sectionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
    allowedNestedFunctions,
    state: diagnosticById.size === 0 ? 'complete' : 'incomplete',
  };
}
