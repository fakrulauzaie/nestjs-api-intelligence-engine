import ts from 'typescript';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  jobQueueBranchSelectorKey,
  type JobQueueBranchControlFlow,
  type JobQueueBranchSelector,
  type JobQueueHandlerBranchRecord,
  type JobQueueHandlerDispatchRecord,
} from '../model/job-queue-branches.js';
import { makeJobQueueHandlerBranchId, makeJobQueueHandlerDispatchId } from '../model/ids.js';
import { resolveSimpleString } from '../ts-index/constants.js';
import { resolveAliasedSymbol } from '../ts-index/symbols.js';
import type { IndexedMethod } from '../ts-index/source-index.js';

export const BULLMQ_BRANCH_RULE_IDS = {
  dispatch: 'queue.bullmq.dispatch.v1',
  switchBranch: 'queue.bullmq.dispatch.switch-branch.v1',
  ifBranch: 'queue.bullmq.dispatch.if-branch.v1',
  commonPrelude: 'queue.bullmq.dispatch.common-prelude.v1',
  commonFinally: 'queue.bullmq.dispatch.common-finally.v1',
  unmatched: 'queue.bullmq.dispatch.unmatched.v1',
  unsupported: 'queue.bullmq.dispatch.unsupported-region.v1',
  effect: 'queue.bullmq.dispatch.branch-effect.v1',
} as const;

type EvidenceForNode = (
  node: ts.Node,
  role: EvidenceRecord['role'],
  snippet: boolean,
) => string | null;

interface BranchDraft {
  readonly selector: JobQueueBranchSelector;
  readonly controlFlow: JobQueueBranchControlFlow;
  readonly nodes: readonly ts.Node[];
  readonly ruleId: string;
  readonly continuesAfterSwitch?: boolean;
}

export interface BullMqHandlerBranchExtraction {
  readonly dispatch: JobQueueHandlerDispatchRecord | null;
  readonly branches: readonly JobQueueHandlerBranchRecord[];
  readonly state: 'none' | 'complete' | 'partial' | 'unsupported';
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

function sameSymbol(checker: ts.TypeChecker, left: ts.Node, right: ts.Symbol): boolean {
  return resolveAliasedSymbol(checker, checker.getSymbolAtLocation(left)) === right;
}

function isExactJobName(
  expression: ts.Expression,
  parameterSymbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  const current = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(current) || current.name.text !== 'name') return false;
  const receiver = unwrapExpression(current.expression);
  return ts.isIdentifier(receiver) && sameSymbol(checker, receiver, parameterSymbol);
}

function nestedFunctionBoundary(node: ts.Node, root: ts.MethodDeclaration): boolean {
  return node !== root && ts.isFunctionLike(node);
}

function firstJobNameReference(
  method: IndexedMethod,
  parameterSymbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null || nestedFunctionBoundary(node, method.node)) return;
    if (ts.isExpression(node) && isExactJobName(node, parameterSymbol, checker)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (method.node.body !== undefined) ts.forEachChild(method.node.body, visit);
  return found;
}

function jobNameIsMutated(
  method: IndexedMethod,
  parameterSymbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  let mutated = false;
  const visit = (node: ts.Node): void => {
    if (mutated || nestedFunctionBoundary(node, method.node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isExactJobName(node.left, parameterSymbol, checker)
    ) {
      mutated = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) &&
      isExactJobName(node.operand, parameterSymbol, checker)
    ) {
      mutated = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (method.node.body !== undefined) ts.forEachChild(method.node.body, visit);
  return mutated;
}

function containsBranchControlFlow(method: IndexedMethod): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || nestedFunctionBoundary(node, method.node)) return;
    if (ts.isSwitchStatement(node) || ts.isIfStatement(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (method.node.body !== undefined) ts.forEachChild(method.node.body, visit);
  return found;
}

type Termination = 'break' | 'return' | 'throw' | 'none';

function terminationOfStatement(statement: ts.Statement | undefined): Termination {
  if (statement === undefined) return 'none';
  if (ts.isBlock(statement)) return terminationOfStatements(statement.statements);
  if (ts.isBreakStatement(statement)) return 'break';
  if (ts.isReturnStatement(statement)) return 'return';
  if (ts.isThrowStatement(statement)) return 'throw';
  return 'none';
}

function terminationOfStatements(statements: readonly ts.Statement[]): Termination {
  return terminationOfStatement(statements.at(-1));
}

function resolveCaseLabel(
  clause: ts.CaseOrDefaultClause,
  checker: ts.TypeChecker,
): { readonly kind: 'default' } | { readonly kind: 'exact'; readonly value: string } | null {
  if (ts.isDefaultClause(clause)) return { kind: 'default' };
  const resolved = resolveSimpleString(clause.expression, checker);
  return resolved.status === 'resolved' ? { kind: 'exact', value: resolved.value } : null;
}

function appendContinuation(
  drafts: readonly BranchDraft[],
  continuation: readonly ts.Statement[],
): BranchDraft[] {
  if (continuation.length === 0) return [...drafts];
  return drafts.map((draft) =>
    draft.continuesAfterSwitch === true
      ? { ...draft, nodes: [...draft.nodes, ...continuation] }
      : draft,
  );
}

function switchDrafts(input: {
  readonly statement: ts.SwitchStatement;
  readonly prelude: readonly ts.Statement[];
  readonly continuation: readonly ts.Statement[];
  readonly finallyBlock: ts.Block | null;
  readonly checker: ts.TypeChecker;
}): readonly BranchDraft[] {
  const drafts: BranchDraft[] = [];
  if (input.prelude.length > 0) {
    drafts.push({
      selector: { kind: 'all_jobs' },
      controlFlow: 'common_prelude',
      nodes: input.prelude,
      ruleId: BULLMQ_BRANCH_RULE_IDS.commonPrelude,
    });
  }

  const clauses = input.statement.caseBlock.clauses;
  const exactJobs = new Set<string>();
  let pending: ts.CaseOrDefaultClause[] = [];
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index]!;
    pending.push(clause);
    if (clause.statements.length === 0) continue;

    const termination = terminationOfStatements(clause.statements);
    if (termination === 'none' && index < clauses.length - 1) {
      const unsafe = [...pending];
      while (index < clauses.length - 1) {
        index += 1;
        const next = clauses[index]!;
        unsafe.push(next);
        if (next.statements.length > 0 && terminationOfStatements(next.statements) !== 'none') {
          break;
        }
      }
      drafts.push({
        selector: { kind: 'unknown' },
        controlFlow: 'unsupported_region',
        nodes: unsafe,
        ruleId: BULLMQ_BRANCH_RULE_IDS.unsupported,
      });
      pending = [];
      continue;
    }

    const labels = pending.map((candidate) => resolveCaseLabel(candidate, input.checker));
    const hasDefault = labels.some((label) => label?.kind === 'default');
    const values = labels.flatMap((label) => (label?.kind === 'exact' ? [label.value] : []));
    for (const value of values) exactJobs.add(value);
    const supported = labels.every((label) => label !== null) && !(hasDefault && values.length > 0);
    if (!supported) {
      drafts.push({
        selector: { kind: 'unknown' },
        controlFlow: 'unsupported_region',
        nodes: pending,
        ruleId: BULLMQ_BRANCH_RULE_IDS.unsupported,
      });
    } else if (hasDefault) {
      drafts.push({
        selector: { kind: 'unmatched_jobs', excludedJobs: [] },
        controlFlow: 'default_branch',
        nodes: pending,
        ruleId: BULLMQ_BRANCH_RULE_IDS.unmatched,
        continuesAfterSwitch: termination === 'break' || termination === 'none',
      });
    } else {
      drafts.push({
        selector: { kind: 'exact_jobs', jobs: [...new Set(values)].sort() },
        controlFlow: 'switch_case',
        nodes: pending,
        ruleId: BULLMQ_BRANCH_RULE_IDS.switchBranch,
        continuesAfterSwitch: termination === 'break' || termination === 'none',
      });
    }
    pending = [];
  }

  if (pending.length > 0) {
    const labels = pending.map((candidate) => resolveCaseLabel(candidate, input.checker));
    const values = labels.flatMap((label) => (label?.kind === 'exact' ? [label.value] : []));
    for (const value of values) exactJobs.add(value);
    drafts.push({
      selector: labels.every((label) => label?.kind === 'exact')
        ? { kind: 'exact_jobs', jobs: [...new Set(values)].sort() }
        : { kind: 'unknown' },
      controlFlow: labels.every((label) => label?.kind === 'exact')
        ? 'switch_case'
        : 'unsupported_region',
      nodes: pending,
      ruleId: labels.every((label) => label?.kind === 'exact')
        ? BULLMQ_BRANCH_RULE_IDS.switchBranch
        : BULLMQ_BRANCH_RULE_IDS.unsupported,
      continuesAfterSwitch: true,
    });
  }

  const excludedJobs = [...exactJobs].sort();
  const hasUnmatched = drafts.some(({ selector }) => selector.kind === 'unmatched_jobs');
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    if (draft.selector.kind === 'unmatched_jobs') {
      drafts[index] = {
        ...draft,
        selector: { kind: 'unmatched_jobs', excludedJobs },
      };
    }
  }
  if (!hasUnmatched && !drafts.some(({ selector }) => selector.kind === 'unknown')) {
    drafts.push({
      selector: { kind: 'unmatched_jobs', excludedJobs },
      controlFlow: 'unmatched_fallthrough',
      nodes: [input.statement.expression],
      ruleId: BULLMQ_BRANCH_RULE_IDS.unmatched,
      continuesAfterSwitch: true,
    });
  }

  const withContinuation = appendContinuation(drafts, input.continuation);
  if (input.finallyBlock !== null) {
    withContinuation.push({
      selector: { kind: 'all_jobs' },
      controlFlow: 'common_finally',
      nodes: [input.finallyBlock],
      ruleId: BULLMQ_BRANCH_RULE_IDS.commonFinally,
    });
  }
  return withContinuation;
}

function exactEqualityTarget(input: {
  readonly condition: ts.Expression;
  readonly parameterSymbol: ts.Symbol;
  readonly checker: ts.TypeChecker;
}): string | null {
  const current = unwrapExpression(input.condition);
  if (
    !ts.isBinaryExpression(current) ||
    current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return null;
  }
  const leftIsJob = isExactJobName(current.left, input.parameterSymbol, input.checker);
  const rightIsJob = isExactJobName(current.right, input.parameterSymbol, input.checker);
  if (leftIsJob === rightIsJob) return null;
  const target = resolveSimpleString(leftIsJob ? current.right : current.left, input.checker);
  return target.status === 'resolved' ? target.value : null;
}

function ifDrafts(input: {
  readonly statements: readonly ts.Statement[];
  readonly firstIfIndex: number;
  readonly parameterSymbol: ts.Symbol;
  readonly checker: ts.TypeChecker;
}): readonly BranchDraft[] {
  const drafts: BranchDraft[] = [];
  const prelude = input.statements.slice(0, input.firstIfIndex);
  if (prelude.length > 0) {
    drafts.push({
      selector: { kind: 'all_jobs' },
      controlFlow: 'common_prelude',
      nodes: prelude,
      ruleId: BULLMQ_BRANCH_RULE_IDS.commonPrelude,
    });
  }
  const excludedJobs = new Set<string>();
  let cursor = input.firstIfIndex;
  while (cursor < input.statements.length && ts.isIfStatement(input.statements[cursor]!)) {
    const statement = input.statements[cursor] as ts.IfStatement;
    if (statement.elseStatement !== undefined) {
      drafts.push({
        selector: { kind: 'unknown' },
        controlFlow: 'unsupported_region',
        nodes: [statement],
        ruleId: BULLMQ_BRANCH_RULE_IDS.unsupported,
      });
      cursor += 1;
      break;
    }
    const target = exactEqualityTarget({
      condition: statement.expression,
      parameterSymbol: input.parameterSymbol,
      checker: input.checker,
    });
    const termination = terminationOfStatement(statement.thenStatement);
    if (target === null || (termination !== 'return' && termination !== 'throw')) {
      drafts.push({
        selector: { kind: 'unknown' },
        controlFlow: 'unsupported_region',
        nodes: [statement],
        ruleId: BULLMQ_BRANCH_RULE_IDS.unsupported,
      });
      cursor += 1;
      break;
    }
    excludedJobs.add(target);
    drafts.push({
      selector: { kind: 'exact_jobs', jobs: [target] },
      controlFlow: 'if_branch',
      nodes: [statement.thenStatement],
      ruleId: BULLMQ_BRANCH_RULE_IDS.ifBranch,
    });
    cursor += 1;
  }
  const remaining = input.statements.slice(cursor);
  if (!drafts.some(({ selector }) => selector.kind === 'unknown')) {
    drafts.push({
      selector: { kind: 'unmatched_jobs', excludedJobs: [...excludedJobs].sort() },
      controlFlow: 'unmatched_fallthrough',
      nodes: remaining.length > 0 ? remaining : [input.statements[input.firstIfIndex]!],
      ruleId: BULLMQ_BRANCH_RULE_IDS.unmatched,
    });
  } else if (remaining.length > 0) {
    const unknown = drafts.findLast(({ selector }) => selector.kind === 'unknown')!;
    const index = drafts.indexOf(unknown);
    drafts[index] = { ...unknown, nodes: [...unknown.nodes, ...remaining] };
  }
  return drafts;
}

function evidenceIdsForNodes(
  nodes: readonly ts.Node[],
  evidenceForNode: EvidenceForNode,
): string[] {
  return [
    ...new Set(
      nodes.flatMap((node) => {
        const id = evidenceForNode(node, 'resolution_basis', true);
        return id === null ? [] : [id];
      }),
    ),
  ].sort();
}

export function extractBullMqHandlerBranches(input: {
  readonly method: IndexedMethod;
  readonly handlerId: string;
  readonly checker: ts.TypeChecker;
  readonly evidenceForNode: EvidenceForNode;
}): BullMqHandlerBranchExtraction {
  const body = input.method.node.body;
  const parameter = input.method.node.parameters[0];
  if (body === undefined || parameter === undefined || !ts.isIdentifier(parameter.name)) {
    return { dispatch: null, branches: [], state: 'none' };
  }
  const parameterSymbol = resolveAliasedSymbol(
    input.checker,
    input.checker.getSymbolAtLocation(parameter.name),
  );
  if (parameterSymbol === null) return { dispatch: null, branches: [], state: 'none' };
  const firstReference = firstJobNameReference(input.method, parameterSymbol, input.checker);
  if (firstReference === null) return { dispatch: null, branches: [], state: 'none' };
  if (!containsBranchControlFlow(input.method)) {
    return { dispatch: null, branches: [], state: 'none' };
  }

  let discriminant: ts.Node = firstReference;
  let drafts: readonly BranchDraft[] = [];
  const topLevel = [...body.statements];
  const directSwitchIndex = topLevel.findIndex(
    (statement) =>
      ts.isSwitchStatement(statement) &&
      isExactJobName(statement.expression, parameterSymbol, input.checker),
  );
  if (directSwitchIndex >= 0) {
    const statement = topLevel[directSwitchIndex] as ts.SwitchStatement;
    discriminant = statement.expression;
    drafts = switchDrafts({
      statement,
      prelude: topLevel.slice(0, directSwitchIndex),
      continuation: topLevel.slice(directSwitchIndex + 1),
      finallyBlock: null,
      checker: input.checker,
    });
  } else {
    const tryIndex = topLevel.findIndex(
      (statement) =>
        ts.isTryStatement(statement) &&
        statement.catchClause === undefined &&
        statement.tryBlock.statements.some(
          (child) =>
            ts.isSwitchStatement(child) &&
            isExactJobName(child.expression, parameterSymbol, input.checker),
        ),
    );
    if (tryIndex >= 0) {
      const tryStatement = topLevel[tryIndex] as ts.TryStatement;
      const tryStatements = [...tryStatement.tryBlock.statements];
      const switchIndex = tryStatements.findIndex(
        (statement) =>
          ts.isSwitchStatement(statement) &&
          isExactJobName(statement.expression, parameterSymbol, input.checker),
      );
      const statement = tryStatements[switchIndex] as ts.SwitchStatement;
      discriminant = statement.expression;
      drafts = switchDrafts({
        statement,
        prelude: [...topLevel.slice(0, tryIndex), ...tryStatements.slice(0, switchIndex)],
        continuation: [...tryStatements.slice(switchIndex + 1), ...topLevel.slice(tryIndex + 1)],
        finallyBlock: tryStatement.finallyBlock ?? null,
        checker: input.checker,
      });
    } else {
      const firstIfIndex = topLevel.findIndex((statement) => ts.isIfStatement(statement));
      if (firstIfIndex >= 0) {
        const firstIf = topLevel[firstIfIndex] as ts.IfStatement;
        discriminant = firstIf.expression;
        drafts = ifDrafts({
          statements: topLevel,
          firstIfIndex,
          parameterSymbol,
          checker: input.checker,
        });
      }
    }
  }

  if (drafts.length === 0 || jobNameIsMutated(input.method, parameterSymbol, input.checker)) {
    drafts = [
      {
        selector: { kind: 'unknown' },
        controlFlow: 'unsupported_region',
        nodes: [body],
        ruleId: BULLMQ_BRANCH_RULE_IDS.unsupported,
      },
    ];
  }

  const dispatchEvidenceId = input.evidenceForNode(discriminant, 'resolution_basis', true);
  if (dispatchEvidenceId === null) return { dispatch: null, branches: [], state: 'none' };
  const dispatchId = makeJobQueueHandlerDispatchId({
    handlerId: input.handlerId,
    discriminantEvidenceId: dispatchEvidenceId,
    ruleId: BULLMQ_BRANCH_RULE_IDS.dispatch,
  });
  const branches = drafts.flatMap((draft) => {
    const evidenceIds = evidenceIdsForNodes(draft.nodes, input.evidenceForNode);
    if (evidenceIds.length === 0) return [];
    return [
      {
        id: makeJobQueueHandlerBranchId({
          dispatchId,
          selectorKey: jobQueueBranchSelectorKey(draft.selector),
          controlFlow: draft.controlFlow,
          branchEvidenceId: evidenceIds[0]!,
          ruleId: draft.ruleId,
        }),
        dispatchId,
        selector: draft.selector,
        controlFlow: draft.controlFlow,
        ruleId: draft.ruleId,
        evidenceIds,
      } satisfies JobQueueHandlerBranchRecord,
    ];
  });
  const unknownCount = branches.filter(({ selector }) => selector.kind === 'unknown').length;
  const state =
    unknownCount === 0 ? 'complete' : unknownCount === branches.length ? 'unsupported' : 'partial';
  const dispatch: JobQueueHandlerDispatchRecord = {
    id: dispatchId,
    handlerId: input.handlerId,
    state,
    branchIds: branches.map(({ id }) => id),
    ruleId: BULLMQ_BRANCH_RULE_IDS.dispatch,
    evidenceIds: [dispatchEvidenceId],
  };
  return { dispatch, branches, state };
}
