import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticCode, DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import type {
  JobQueueHandlerBranchRecord,
  JobQueueHandlerDispatchRecord,
} from '../model/job-queue-branches.js';
import {
  interactionTargetKey,
  jobQueueTargetsMatch,
  type JobQueueHandlerRecord,
  type JobQueueInteractionRecord,
  type JobQueueTarget,
  type TextInteractionTarget,
} from '../model/interactions.js';
import { makeAssertionId, makeInteractionHandlerId, makeInteractionId } from '../model/ids.js';
import { resolveSimpleString } from '../ts-index/constants.js';
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
  declarationBelongsToPackage,
  isPackageDecorator,
  isPackageExpression,
} from './package-symbols.js';
import { resolveImportedExpressionIdentity } from '../ts-index/decorators.js';
import { extractBullMqHandlerBranches } from './bullmq-branches.js';

export const BULLMQ_RULE_IDS = {
  producer: 'queue.bullmq.queue-add.v1',
  handler: 'queue.bullmq.worker-host.process.queue-wide.v1',
  match: 'queue.bullmq.queue-wide-candidate.v1',
} as const;

const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_BULLMQ_MODULE = '@nestjs/bullmq';
const BULLMQ_MODULE = 'bullmq';

interface LocatedMethod {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly method: IndexedMethod;
}

interface ResolvedTextTarget {
  readonly target: TextInteractionTarget;
  readonly evidenceNodes: readonly ts.Node[];
}

interface QueueBinding {
  readonly status: 'resolved' | 'ambiguous';
  readonly queue: ResolvedTextTarget;
  readonly resolutionNode: ts.Node;
}

export interface NestBullMqExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly interactions: readonly JobQueueInteractionRecord[];
  readonly handlers: readonly JobQueueHandlerRecord[];
  readonly handlerDispatches: readonly JobQueueHandlerDispatchRecord[];
  readonly handlerBranches: readonly JobQueueHandlerBranchRecord[];
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

function packageQueueType(typeNode: ts.TypeNode, checker: ts.TypeChecker): boolean {
  const current = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  if (!ts.isTypeReferenceNode(current)) return false;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(current.typeName));
  return (
    symbol?.name === 'Queue' &&
    (symbol.declarations ?? []).some((declaration) =>
      declarationBelongsToPackage(declaration.getSourceFile().fileName, BULLMQ_MODULE),
    )
  );
}

function unionContainsPackageQueue(typeNode: ts.TypeNode, checker: ts.TypeChecker): boolean {
  const current = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  return ts.isUnionTypeNode(current)
    ? current.types.some((child) => packageQueueType(child, checker))
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
    ) ||
    indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_BULLMQ_MODULE, 'Processor'),
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

function collectQueueBindings(
  indexedClass: IndexedClass,
  checker: ts.TypeChecker,
): ReadonlyMap<string, QueueBinding> {
  const bindings = new Map<string, QueueBinding>();
  const constructor = constructorToAnalyze(indexedClass);
  if (constructor === null) return bindings;
  const assignments = assignmentCounts(indexedClass);
  const explicitAssignments = explicitParameterMemberAssignments(constructor, checker);
  for (const parameter of constructor.parameters) {
    const decorator = parameter.decorators.find((candidate) =>
      isPackageDecorator(candidate, NEST_BULLMQ_MODULE, 'InjectQueue'),
    );
    const typeNode = parameter.node.type;
    if (decorator === undefined || typeNode === undefined) continue;
    const member = memberBindingForParameter(parameter, explicitAssignments);
    if (member === null) continue;
    const exactType = packageQueueType(typeNode, checker);
    const ambiguousType = unionContainsPackageQueue(typeNode, checker);
    if (!exactType && !ambiguousType) continue;
    const expectedAssignments = ts.isParameter(member.resolutionNode) ? 0 : 1;
    const call = ts.isCallExpression(decorator.node.expression) ? decorator.node.expression : null;
    bindings.set(member.memberName, {
      status:
        exactType && (assignments.get(member.memberName) ?? 0) === expectedAssignments
          ? 'resolved'
          : 'ambiguous',
      queue: resolveTextTarget(call?.arguments[0], checker),
      resolutionNode: member.resolutionNode,
    });
  }
  return bindings;
}

function extendsPackageWorkerHost(indexedClass: IndexedClass, checker: ts.TypeChecker): boolean {
  return (
    indexedClass.node.heritageClauses?.some(
      (clause) =>
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        clause.types.some((type) =>
          isPackageExpression(
            resolveImportedExpressionIdentity(type.expression, checker),
            NEST_BULLMQ_MODULE,
            'WorkerHost',
          ),
        ),
    ) ?? false
  );
}

function processorDecorator(indexedClass: IndexedClass) {
  return indexedClass.decorators.find((decorator) =>
    isPackageDecorator(decorator, NEST_BULLMQ_MODULE, 'Processor'),
  );
}

function nestedFunctionBoundary(node: ts.Node, root: ts.MethodDeclaration): boolean {
  return node !== root && ts.isFunctionLike(node);
}

export function extractNestBullMq(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly repositoryRevision: string | null;
  readonly evidenceSnippetLimit: number;
  readonly moduleAssertions: readonly AssertionRecord[];
  readonly maxFanOutPerInteraction: number;
}): NestBullMqExtraction {
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );
  const classById = new Map<string, ClassRecord>();
  const methodById = new Map<string, MethodRecord>();
  const interactionById = new Map<string, JobQueueInteractionRecord>();
  const handlerById = new Map<string, JobQueueHandlerRecord>();
  const dispatchById = new Map<string, JobQueueHandlerDispatchRecord>();
  const branchById = new Map<string, JobQueueHandlerBranchRecord>();
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

  const providedClassIds = new Set(
    input.moduleAssertions.flatMap((assertion) =>
      assertion.predicate === 'MODULE_PROVIDES_CLASS' &&
      assertion.status === 'resolved' &&
      assertion.objectId !== null
        ? [assertion.objectId]
        : [],
    ),
  );

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const decorator = processorDecorator(indexedClass);
      if (decorator === undefined || !extendsPackageWorkerHost(indexedClass, input.checker)) {
        continue;
      }
      const processMethods = indexedClass.methods.filter(({ name }) => name === 'process');
      if (processMethods.length !== 1) continue;
      const located = { source, indexedClass, method: processMethods[0]! };
      const method = ensureMethod(located);
      const owner = classById.get(method.classId)!;
      const decoratorCall = ts.isCallExpression(decorator.node.expression)
        ? decorator.node.expression
        : null;
      const queue = resolveTextTarget(decoratorCall?.arguments[0], input.checker);
      const handlerEvidenceId = evidenceForNode(decorator.node, 'declaration', true);
      if (handlerEvidenceId === null) continue;
      const target: JobQueueTarget = {
        targetKind: 'queue',
        technology: 'bullmq',
        queue: queue.target,
        job: { resolution: 'dynamic', value: null },
      };
      const registrationState = providedClassIds.has(owner.id)
        ? 'proven_registered'
        : 'registration_unknown';
      const handlerId = makeInteractionHandlerId({
        kind: 'job_queue',
        methodId: method.id,
        targetKey: interactionTargetKey(target),
        applicationId: null,
        handlerEvidenceId,
      });
      const handler: JobQueueHandlerRecord = {
        id: handlerId,
        kind: 'job_queue',
        methodId: method.id,
        applicationId: null,
        registrationState,
        target,
        ruleId: BULLMQ_RULE_IDS.handler,
        handlerEvidenceId,
      };
      handlerById.set(handler.id, handler);
      addAssertion({
        id: makeAssertionId({
          subjectId: handler.id,
          predicate: 'HANDLER_IMPLEMENTED_BY',
          objectId: method.id,
          ruleId: handler.ruleId,
        }),
        subjectId: handler.id,
        predicate: 'HANDLER_IMPLEMENTED_BY',
        objectId: method.id,
        status: 'resolved',
        ruleId: handler.ruleId,
        evidenceIds: [handlerEvidenceId],
      });
      const queueEvidenceIds = queue.evidenceNodes.flatMap((node) => {
        const id = evidenceForNode(node, 'resolution_basis', false);
        return id === null ? [] : [id];
      });
      if (queue.target.resolution === 'dynamic') {
        addDiagnostic({
          code: 'INTERACTION_TARGET_DYNAMIC',
          subjectId: handler.id,
          evidenceIds: [handlerEvidenceId, ...queueEvidenceIds],
          message: '@Processor() queue identity is dynamic or outside the bounded string rules.',
        });
      }
      if (registrationState === 'registration_unknown') {
        addDiagnostic({
          code: 'JOB_QUEUE_HANDLER_REGISTRATION_UNKNOWN',
          subjectId: handler.id,
          evidenceIds: [handlerEvidenceId],
        });
      }
      const branchExtraction = extractBullMqHandlerBranches({
        method: located.method,
        handlerId: handler.id,
        checker: input.checker,
        evidenceForNode,
      });
      if (branchExtraction.dispatch !== null) {
        dispatchById.set(branchExtraction.dispatch.id, branchExtraction.dispatch);
        for (const branch of branchExtraction.branches) branchById.set(branch.id, branch);
      }
      if (branchExtraction.state === 'partial' || branchExtraction.state === 'unsupported') {
        addDiagnostic({
          code:
            branchExtraction.state === 'partial'
              ? 'JOB_QUEUE_FILTER_PARTIAL'
              : 'JOB_QUEUE_FILTER_UNPROVEN',
          subjectId: handler.id,
          evidenceIds: [handlerEvidenceId, ...(branchExtraction.dispatch?.evidenceIds ?? [])],
        });
      }
    }
  }

  const bindingsByClass = new Map<ts.ClassDeclaration, ReadonlyMap<string, QueueBinding>>();
  for (const indexedClass of input.sourceIndex.classes) {
    const bindings = collectQueueBindings(indexedClass, input.checker);
    if (bindings.size > 0) bindingsByClass.set(indexedClass.node, bindings);
  }

  for (const source of input.sourceIndex.sourceFiles) {
    for (const indexedClass of source.classes) {
      const bindings = bindingsByClass.get(indexedClass.node);
      if (bindings === undefined) continue;
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
            callee.name.text !== 'add' ||
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
              message:
                'BullMQ Queue.add() receiver has both package and unsupported type possibilities.',
            });
            return;
          }
          const job = resolveTextTarget(node.arguments[0], input.checker);
          const target: JobQueueTarget = {
            targetKind: 'queue',
            technology: 'bullmq',
            queue: binding.queue.target,
            job: job.target,
          };
          const targetEvidenceIds = [...binding.queue.evidenceNodes, ...job.evidenceNodes].flatMap(
            (targetNode) => {
              const id = evidenceForNode(targetNode, 'resolution_basis', false);
              return id === null ? [] : [id];
            },
          );
          const evidenceIds = [
            ...new Set([
              callEvidenceId,
              ...(bindingEvidenceId === null ? [] : [bindingEvidenceId]),
              ...targetEvidenceIds,
            ]),
          ].sort();
          const interactionId = makeInteractionId({
            kind: 'job_queue',
            sourceMethodId: methodRecord.id,
            targetKey: interactionTargetKey(target),
            applicationId: null,
            initiationEvidenceId: callEvidenceId,
          });
          const interaction: JobQueueInteractionRecord = {
            id: interactionId,
            kind: 'job_queue',
            sourceMethodId: methodRecord.id,
            applicationId: null,
            direction: 'outbound',
            activation: 'eager',
            boundary: target.queue.resolution === 'dynamic' ? 'unknown' : 'external_or_unobserved',
            dispatchTiming: 'asynchronous',
            target,
            ruleId: BULLMQ_RULE_IDS.producer,
            evidenceIds,
          };
          interactionById.set(interaction.id, interaction);
          addAssertion({
            id: makeAssertionId({
              subjectId: methodRecord.id,
              predicate: 'METHOD_INITIATES_INTERACTION',
              objectId: interaction.id,
              ruleId: interaction.ruleId,
            }),
            subjectId: methodRecord.id,
            predicate: 'METHOD_INITIATES_INTERACTION',
            objectId: interaction.id,
            status: 'resolved',
            ruleId: interaction.ruleId,
            evidenceIds,
          });
          if (target.queue.resolution === 'dynamic' || target.job.resolution === 'dynamic') {
            addDiagnostic({
              code: 'INTERACTION_TARGET_DYNAMIC',
              subjectId: interaction.id,
              evidenceIds,
              message:
                'BullMQ queue or job identity is dynamic or outside the bounded string rules.',
            });
          }
        };
        if (method.node.body !== undefined) ts.forEachChild(method.node.body, visit);
      }
    }
  }

  for (const interaction of [...interactionById.values()]) {
    const matchingHandlers = [...handlerById.values()]
      .filter((handler) => jobQueueTargetsMatch(interaction.target, handler.target))
      .sort((left, right) => left.id.localeCompare(right.id));
    const retained = matchingHandlers.slice(0, input.maxFanOutPerInteraction);
    if (matchingHandlers.length > retained.length) {
      addDiagnostic({
        code: 'INTERACTION_TRACE_LIMIT_REACHED',
        subjectId: interaction.id,
        evidenceIds: interaction.evidenceIds,
        message: `BullMQ worker candidate count ${matchingHandlers.length} exceeds configured limit ${input.maxFanOutPerInteraction}.`,
      });
    }
    if (retained.length > 0) {
      interactionById.set(interaction.id, {
        ...interaction,
        boundary: 'broker_or_worker_boundary',
      });
    }
    for (const handler of retained) {
      const evidenceIds = [
        ...new Set([...interaction.evidenceIds, handler.handlerEvidenceId]),
      ].sort();
      addAssertion({
        id: makeAssertionId({
          subjectId: interaction.id,
          predicate: 'INTERACTION_MATCHES_LOCAL_HANDLER',
          objectId: handler.id,
          ruleId: BULLMQ_RULE_IDS.match,
        }),
        subjectId: interaction.id,
        predicate: 'INTERACTION_MATCHES_LOCAL_HANDLER',
        objectId: handler.id,
        status: 'resolved',
        ruleId: BULLMQ_RULE_IDS.match,
        evidenceIds,
      });
    }
  }

  return {
    classes: [...classById.values()],
    methods: [...methodById.values()],
    interactions: [...interactionById.values()],
    handlers: [...handlerById.values()],
    handlerDispatches: [...dispatchById.values()],
    handlerBranches: [...branchById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics: [...diagnosticById.values()],
    state: diagnosticById.size === 0 ? 'complete' : 'incomplete',
  };
}
