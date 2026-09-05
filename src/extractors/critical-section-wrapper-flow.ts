import ts from 'typescript';
import type { IndexedMethod, IndexedParameter, SourceIndex } from '../ts-index/source-index.js';
import { resolveAliasedSymbol } from '../ts-index/symbols.js';
import { unwrapExpression } from './outbound-http.js';

export const CRITICAL_SECTION_CALLBACK_FLOW_EVIDENCE_ROLES = [
  'call_site',
  'callback_argument',
  'callback_parameter',
  'parameter_forwarding',
  'callback_invocation',
  'redlock_terminal',
] as const;

export type CriticalSectionCallbackFlowEvidenceRole =
  (typeof CRITICAL_SECTION_CALLBACK_FLOW_EVIDENCE_ROLES)[number];

export interface CriticalSectionCallbackFlowEvidenceNode {
  readonly role: CriticalSectionCallbackFlowEvidenceRole;
  readonly node: ts.Node;
}

/**
 * An internal proof that one exact method parameter is called directly within one
 * package-proven Redlock callback. This is not a canonical analysis record and does
 * not, by itself, authorize any caller callback or claim runtime execution.
 */
export interface DirectCriticalSectionCallbackParameterSummary {
  readonly method: IndexedMethod;
  readonly parameter: IndexedParameter;
  readonly callbackParameterIndex: number;
  readonly terminalCall: ts.CallExpression;
  readonly criticalSectionCallback: ts.ArrowFunction | ts.FunctionExpression;
  readonly callbackInvocations: readonly ts.CallExpression[];
  readonly evidenceNodes: readonly CriticalSectionCallbackFlowEvidenceNode[];
}

export const CRITICAL_SECTION_WRAPPER_FLOW_RELATIONS = [
  'forwarded_unchanged',
  'invoked_in_proven_section',
] as const;
export type CriticalSectionWrapperFlowRelation =
  (typeof CRITICAL_SECTION_WRAPPER_FLOW_RELATIONS)[number];

export interface CriticalSectionWrapperForwardingStep {
  readonly relation: 'forwarded_unchanged';
  readonly method: IndexedMethod;
  readonly parameter: IndexedParameter;
  readonly callbackParameterIndex: number;
  readonly call: ts.CallExpression;
  readonly argument: ts.Expression;
}

export interface CriticalSectionWrapperTerminalStep {
  readonly relation: 'invoked_in_proven_section';
  readonly method: IndexedMethod;
  readonly parameter: IndexedParameter;
  readonly callbackParameterIndex: number;
  readonly invocations: readonly ts.CallExpression[];
}

export type CriticalSectionWrapperFlowStep =
  | CriticalSectionWrapperForwardingStep
  | CriticalSectionWrapperTerminalStep;

/**
 * An internal, bounded proof that an exact method parameter reaches a direct Redlock
 * terminal through zero or more unchanged positional forwarding calls.
 */
export interface CriticalSectionCallbackParameterFlowSummary {
  readonly method: IndexedMethod;
  readonly parameter: IndexedParameter;
  readonly callbackParameterIndex: number;
  readonly forwardingHopCount: number;
  readonly flow: readonly CriticalSectionWrapperFlowStep[];
  readonly terminalCall: ts.CallExpression;
  readonly criticalSectionCallback: ts.ArrowFunction | ts.FunctionExpression;
  readonly evidenceNodes: readonly CriticalSectionCallbackFlowEvidenceNode[];
}

/**
 * One exact repository call whose inline callback argument is proven to flow into
 * at least one package-proven Redlock critical section. Multiple terminal proofs
 * are grouped because this record authorizes one lexical callback boundary rather
 * than claiming how many locks are acquired at runtime.
 */
export interface VerifiedCriticalSectionWrapperCallSiteProjection {
  readonly sourceMethod: IndexedMethod;
  readonly targetMethod: IndexedMethod;
  readonly call: ts.CallExpression;
  readonly callbackArgumentIndex: number;
  readonly callback: ts.ArrowFunction | ts.FunctionExpression;
  readonly flowSummaries: readonly CriticalSectionCallbackParameterFlowSummary[];
  readonly evidenceNodes: readonly CriticalSectionCallbackFlowEvidenceNode[];
}

export const CRITICAL_SECTION_WRAPPER_CALL_SITE_ISSUE_KINDS = [
  'callback_flow_unproven',
  'target_ambiguous',
  'target_candidate_limit',
] as const;
export type CriticalSectionWrapperCallSiteIssueKind =
  (typeof CRITICAL_SECTION_WRAPPER_CALL_SITE_ISSUE_KINDS)[number];

export interface CriticalSectionWrapperCallSiteIssue {
  readonly kind: CriticalSectionWrapperCallSiteIssueKind;
  readonly sourceMethod: IndexedMethod;
  readonly call: ts.CallExpression;
  readonly callbackArgumentIndex: number;
  readonly candidateMethods: readonly IndexedMethod[];
}

export interface CriticalSectionWrapperCallSiteAnalysis {
  readonly projections: readonly VerifiedCriticalSectionWrapperCallSiteProjection[];
  readonly issues: readonly CriticalSectionWrapperCallSiteIssue[];
}

export const CRITICAL_SECTION_WRAPPER_FLOW_ISSUE_KINDS = [
  'candidate_limit',
  'cycle',
  'hop_limit',
  'state_limit',
] as const;
export type CriticalSectionWrapperFlowIssueKind =
  (typeof CRITICAL_SECTION_WRAPPER_FLOW_ISSUE_KINDS)[number];

export interface CriticalSectionWrapperFlowIssue {
  readonly kind: CriticalSectionWrapperFlowIssueKind;
  readonly method: IndexedMethod;
  readonly callbackParameterIndex: number;
  readonly call: ts.CallExpression;
}

export interface CriticalSectionCallbackParameterPropagation {
  readonly summaries: readonly CriticalSectionCallbackParameterFlowSummary[];
  readonly issues: readonly CriticalSectionWrapperFlowIssue[];
  readonly state: 'complete' | 'bounded';
}

export const DEFAULT_CRITICAL_SECTION_WRAPPER_MAX_FORWARDING_HOPS = 3;
export const DEFAULT_CRITICAL_SECTION_WRAPPER_MAX_FLOW_STATES = 1_024;
export const DEFAULT_CRITICAL_SECTION_WRAPPER_MAX_TARGET_CANDIDATES = 16;

interface ForwardingEdge {
  readonly sourceMethod: IndexedMethod;
  readonly sourceParameter: IndexedParameter;
  readonly sourceParameterIndex: number;
  readonly targetMethod: IndexedMethod;
  readonly targetParameterIndex: number;
  readonly call: ts.CallExpression;
  readonly argument: ts.Expression;
}

export function sortDirectCriticalSectionCallbackParameterSummaries(
  summaries: readonly DirectCriticalSectionCallbackParameterSummary[],
): DirectCriticalSectionCallbackParameterSummary[] {
  return [...summaries].sort((left, right) => {
    const fileOrder = left.method.node
      .getSourceFile()
      .fileName.localeCompare(right.method.node.getSourceFile().fileName);
    if (fileOrder !== 0) return fileOrder;
    const methodOrder = left.method.node.getStart() - right.method.node.getStart();
    if (methodOrder !== 0) return methodOrder;
    const terminalOrder = left.terminalCall.getStart() - right.terminalCall.getStart();
    return terminalOrder !== 0
      ? terminalOrder
      : left.callbackParameterIndex - right.callbackParameterIndex;
  });
}

function eligibleCallbackParameter(
  parameter: IndexedParameter,
  checker: ts.TypeChecker,
): ts.Symbol | null {
  if (
    !ts.isIdentifier(parameter.node.name) ||
    parameter.node.dotDotDotToken !== undefined ||
    parameter.node.initializer !== undefined ||
    checker.getTypeAtLocation(parameter.node).getCallSignatures().length === 0
  ) {
    return null;
  }
  return parameter.symbol;
}

function directInvokedParameterIndex(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  parameterIndexBySymbol: ReadonlyMap<ts.Symbol, number>,
): number | null {
  if (call.questionDotToken !== undefined) return null;
  const callee = unwrapExpression(call.expression);
  if (!ts.isIdentifier(callee)) return null;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(callee));
  return symbol === null ? null : (parameterIndexBySymbol.get(symbol) ?? null);
}

function compareNodes(left: ts.Node, right: ts.Node): number {
  const fileOrder = left.getSourceFile().fileName.localeCompare(right.getSourceFile().fileName);
  return fileOrder !== 0 ? fileOrder : left.getStart() - right.getStart();
}

function methodParameterKey(method: IndexedMethod, parameterIndex: number): string {
  const node = method.node;
  return `${node.getSourceFile().fileName.replaceAll('\\', '/')}:${node.getStart()}:${parameterIndex}`;
}

function terminalKey(call: ts.CallExpression): string {
  return `${call.getSourceFile().fileName.replaceAll('\\', '/')}:${call.getStart()}`;
}

function flowSummaryKey(summary: CriticalSectionCallbackParameterFlowSummary): string {
  return `${methodParameterKey(summary.method, summary.callbackParameterIndex)}:${terminalKey(summary.terminalCall)}`;
}

function flowProofKey(summary: CriticalSectionCallbackParameterFlowSummary): string {
  return summary.flow
    .map((step) =>
      step.relation === 'forwarded_unchanged'
        ? `${methodParameterKey(step.method, step.callbackParameterIndex)}:${step.call.getStart()}`
        : `${methodParameterKey(step.method, step.callbackParameterIndex)}:terminal`,
    )
    .join('>');
}

function compareFlowSummaries(
  left: CriticalSectionCallbackParameterFlowSummary,
  right: CriticalSectionCallbackParameterFlowSummary,
): number {
  const identityOrder = flowSummaryKey(left).localeCompare(flowSummaryKey(right));
  if (identityOrder !== 0) return identityOrder;
  if (left.forwardingHopCount !== right.forwardingHopCount) {
    return left.forwardingHopCount - right.forwardingHopCount;
  }
  return flowProofKey(left).localeCompare(flowProofKey(right));
}

function directFlowSummary(
  direct: DirectCriticalSectionCallbackParameterSummary,
): CriticalSectionCallbackParameterFlowSummary {
  return {
    method: direct.method,
    parameter: direct.parameter,
    callbackParameterIndex: direct.callbackParameterIndex,
    forwardingHopCount: 0,
    flow: [
      {
        relation: 'invoked_in_proven_section',
        method: direct.method,
        parameter: direct.parameter,
        callbackParameterIndex: direct.callbackParameterIndex,
        invocations: direct.callbackInvocations,
      },
    ],
    terminalCall: direct.terminalCall,
    criticalSectionCallback: direct.criticalSectionCallback,
    evidenceNodes: direct.evidenceNodes,
  };
}

function methodByDeclaration(
  sourceIndex: SourceIndex,
): ReadonlyMap<ts.MethodDeclaration, IndexedMethod> {
  return new Map(
    sourceIndex.methods.map(
      (method) => [method.node, method] satisfies readonly [ts.MethodDeclaration, IndexedMethod],
    ),
  );
}

function exactRepositoryMethodTarget(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  methodsByDeclaration: ReadonlyMap<ts.MethodDeclaration, IndexedMethod>,
  maxTargetCandidates: number,
): {
  readonly target: IndexedMethod | null;
  readonly candidates: readonly IndexedMethod[];
  readonly candidateLimitReached: boolean;
} {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return { target: null, candidates: [], candidateLimitReached: false };
  }
  const property = call.expression;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(property.name));
  const candidates = [
    ...new Set(
      (symbol?.declarations ?? [])
        .filter(ts.isMethodDeclaration)
        .map((declaration) => methodsByDeclaration.get(declaration))
        .filter(
          (method): method is IndexedMethod =>
            method !== undefined && method.node.body !== undefined,
        ),
    ),
  ].sort((left, right) => compareNodes(left.node, right.node));
  if (candidates.length > maxTargetCandidates) {
    return { target: null, candidates, candidateLimitReached: true };
  }
  const optional = call.questionDotToken !== undefined || property.questionDotToken !== undefined;
  return {
    target: !optional && candidates.length === 1 ? candidates[0]! : null,
    candidates,
    candidateLimitReached: false,
  };
}

function projectionKey(projection: VerifiedCriticalSectionWrapperCallSiteProjection): string {
  return [
    methodParameterKey(projection.sourceMethod, projection.callbackArgumentIndex),
    projection.call.getStart(),
    methodParameterKey(projection.targetMethod, projection.callbackArgumentIndex),
    projection.callback.getStart(),
  ].join(':');
}

/**
 * Projects bounded parameter-flow proofs onto exact repository call sites. Only an
 * inline callback at the proven positional argument is returned; identifiers,
 * method references, spreads, ambiguous targets, and nested call sites fail closed.
 */
export function analyzeVerifiedCriticalSectionWrapperCallSites(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly sourceMethods: readonly IndexedMethod[];
  readonly summaries: readonly CriticalSectionCallbackParameterFlowSummary[];
  readonly maxTargetCandidates?: number;
}): CriticalSectionWrapperCallSiteAnalysis {
  if (input.summaries.length === 0 || input.sourceMethods.length === 0) {
    return { projections: [], issues: [] };
  }
  const maxTargetCandidates =
    input.maxTargetCandidates ?? DEFAULT_CRITICAL_SECTION_WRAPPER_MAX_TARGET_CANDIDATES;
  if (!Number.isInteger(maxTargetCandidates) || maxTargetCandidates < 1) {
    throw new RangeError('maxTargetCandidates must be a positive integer.');
  }

  const methodsByDeclaration = methodByDeclaration(input.sourceIndex);
  const summariesByMethodAndParameter = new Map<
    ts.MethodDeclaration,
    Map<number, CriticalSectionCallbackParameterFlowSummary[]>
  >();
  for (const summary of input.summaries) {
    const byParameter = summariesByMethodAndParameter.get(summary.method.node) ?? new Map();
    const summaries = byParameter.get(summary.callbackParameterIndex) ?? [];
    summaries.push(summary);
    byParameter.set(summary.callbackParameterIndex, summaries);
    summariesByMethodAndParameter.set(summary.method.node, byParameter);
  }

  const projectionByKey = new Map<string, VerifiedCriticalSectionWrapperCallSiteProjection>();
  const issueByKey = new Map<string, CriticalSectionWrapperCallSiteIssue>();
  for (const sourceMethod of input.sourceMethods) {
    if (sourceMethod.node.body === undefined) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) {
        const resolution = exactRepositoryMethodTarget(
          node,
          input.checker,
          methodsByDeclaration,
          maxTargetCandidates,
        );
        const candidateMethods = resolution.candidates.filter((candidate) =>
          summariesByMethodAndParameter.has(candidate.node),
        );
        const firstCandidateParameter = candidateMethods
          .flatMap((candidate) => [
            ...(summariesByMethodAndParameter.get(candidate.node)?.keys() ?? []),
          ])
          .sort((left, right) => left - right)[0];
        if (firstCandidateParameter !== undefined && resolution.candidateLimitReached) {
          const issue: CriticalSectionWrapperCallSiteIssue = {
            kind: 'target_candidate_limit',
            sourceMethod,
            call: node,
            callbackArgumentIndex: firstCandidateParameter,
            candidateMethods,
          };
          issueByKey.set(callSiteIssueKey(issue), issue);
        } else if (firstCandidateParameter !== undefined && resolution.candidates.length > 1) {
          const issue: CriticalSectionWrapperCallSiteIssue = {
            kind: 'target_ambiguous',
            sourceMethod,
            call: node,
            callbackArgumentIndex: firstCandidateParameter,
            candidateMethods,
          };
          issueByKey.set(callSiteIssueKey(issue), issue);
        } else if (firstCandidateParameter !== undefined && resolution.target === null) {
          const issue: CriticalSectionWrapperCallSiteIssue = {
            kind: 'callback_flow_unproven',
            sourceMethod,
            call: node,
            callbackArgumentIndex: firstCandidateParameter,
            candidateMethods,
          };
          issueByKey.set(callSiteIssueKey(issue), issue);
        }

        const target = resolution.target;
        const byParameter =
          target === null ? undefined : summariesByMethodAndParameter.get(target.node);
        if (target !== null && byParameter !== undefined) {
          for (const [callbackArgumentIndex, summaries] of byParameter) {
            const argument = node.arguments[callbackArgumentIndex];
            const callback = argument === undefined ? null : unwrapExpression(argument);
            if (
              node.arguments.some(ts.isSpreadElement) ||
              callback === null ||
              (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
            ) {
              const issue: CriticalSectionWrapperCallSiteIssue = {
                kind: 'callback_flow_unproven',
                sourceMethod,
                call: node,
                callbackArgumentIndex,
                candidateMethods: [target],
              };
              issueByKey.set(callSiteIssueKey(issue), issue);
              continue;
            }
            const flowSummaries = [...summaries].sort(compareFlowSummaries);
            const projection: VerifiedCriticalSectionWrapperCallSiteProjection = {
              sourceMethod,
              targetMethod: target,
              call: node,
              callbackArgumentIndex,
              callback,
              flowSummaries,
              evidenceNodes: [
                { role: 'call_site', node: node.expression },
                { role: 'callback_argument', node: callback },
                ...flowSummaries.flatMap((summary) => summary.evidenceNodes),
              ],
            };
            projectionByKey.set(projectionKey(projection), projection);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceMethod.node.body);
  }

  return {
    projections: [...projectionByKey.values()].sort((left, right) =>
      projectionKey(left).localeCompare(projectionKey(right)),
    ),
    issues: [...issueByKey.values()].sort((left, right) =>
      callSiteIssueKey(left).localeCompare(callSiteIssueKey(right)),
    ),
  };
}

function callSiteIssueKey(issue: CriticalSectionWrapperCallSiteIssue): string {
  return [
    issue.kind,
    methodParameterKey(issue.sourceMethod, issue.callbackArgumentIndex),
    issue.call.getStart(),
  ].join(':');
}

export function projectVerifiedCriticalSectionWrapperCallSites(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly sourceMethods: readonly IndexedMethod[];
  readonly summaries: readonly CriticalSectionCallbackParameterFlowSummary[];
  readonly maxTargetCandidates?: number;
}): readonly VerifiedCriticalSectionWrapperCallSiteProjection[] {
  return analyzeVerifiedCriticalSectionWrapperCallSites(input).projections;
}

function directSourceParameterIndex(
  argument: ts.Expression,
  checker: ts.TypeChecker,
  parameterIndexBySymbol: ReadonlyMap<ts.Symbol, number>,
): number | null {
  const unwrapped = unwrapExpression(argument);
  if (!ts.isIdentifier(unwrapped)) return null;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(unwrapped));
  return symbol === null ? null : (parameterIndexBySymbol.get(symbol) ?? null);
}

function forwardingEdges(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly maxTargetCandidates: number;
}): {
  readonly edges: readonly ForwardingEdge[];
  readonly candidateLimitIssues: readonly CriticalSectionWrapperFlowIssue[];
} {
  const methodsByDeclaration = methodByDeclaration(input.sourceIndex);
  const edges: ForwardingEdge[] = [];
  const candidateLimitIssues: CriticalSectionWrapperFlowIssue[] = [];

  for (const method of input.sourceIndex.methods) {
    if (method.node.body === undefined) continue;
    const parameterIndexBySymbol = new Map<ts.Symbol, number>();
    method.parameters.forEach((parameter, index) => {
      const symbol = eligibleCallbackParameter(parameter, input.checker);
      if (symbol !== null) parameterIndexBySymbol.set(symbol, index);
    });
    if (parameterIndexBySymbol.size === 0) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) {
        const resolution = exactRepositoryMethodTarget(
          node,
          input.checker,
          methodsByDeclaration,
          input.maxTargetCandidates,
        );
        if (resolution.candidateLimitReached) {
          const firstParameterIndex = node.arguments
            .flatMap((argument) => {
              const index = directSourceParameterIndex(
                argument,
                input.checker,
                parameterIndexBySymbol,
              );
              return index === null ? [] : [index];
            })
            .sort((left, right) => left - right)[0];
          if (firstParameterIndex !== undefined) {
            candidateLimitIssues.push({
              kind: 'candidate_limit',
              method,
              callbackParameterIndex: firstParameterIndex,
              call: node,
            });
          }
        }
        const target = resolution.target;
        if (target !== null && !node.arguments.some(ts.isSpreadElement)) {
          node.arguments.forEach((argument, targetParameterIndex) => {
            const sourceParameterIndex = directSourceParameterIndex(
              argument,
              input.checker,
              parameterIndexBySymbol,
            );
            if (sourceParameterIndex === null) return;
            const sourceParameter = method.parameters[sourceParameterIndex];
            const targetParameter = target.parameters[targetParameterIndex];
            if (
              sourceParameter === undefined ||
              targetParameter === undefined ||
              eligibleCallbackParameter(targetParameter, input.checker) === null
            ) {
              return;
            }
            edges.push({
              sourceMethod: method,
              sourceParameter,
              sourceParameterIndex,
              targetMethod: target,
              targetParameterIndex,
              call: node,
              argument,
            });
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(method.node.body);
  }

  return {
    edges: edges.sort((left, right) => {
      const sourceOrder = methodParameterKey(
        left.sourceMethod,
        left.sourceParameterIndex,
      ).localeCompare(methodParameterKey(right.sourceMethod, right.sourceParameterIndex));
      if (sourceOrder !== 0) return sourceOrder;
      const callOrder = compareNodes(left.call, right.call);
      return callOrder !== 0 ? callOrder : left.targetParameterIndex - right.targetParameterIndex;
    }),
    candidateLimitIssues,
  };
}

function issueKey(issue: CriticalSectionWrapperFlowIssue): string {
  return `${issue.kind}:${methodParameterKey(issue.method, issue.callbackParameterIndex)}:${issue.call.getStart()}`;
}

export function propagateCriticalSectionCallbackParameters(input: {
  readonly sourceIndex: SourceIndex;
  readonly checker: ts.TypeChecker;
  readonly directSummaries: readonly DirectCriticalSectionCallbackParameterSummary[];
  readonly maxForwardingHops?: number;
  readonly maxFlowStates?: number;
  readonly maxTargetCandidates?: number;
}): CriticalSectionCallbackParameterPropagation {
  const maxForwardingHops =
    input.maxForwardingHops ?? DEFAULT_CRITICAL_SECTION_WRAPPER_MAX_FORWARDING_HOPS;
  const maxFlowStates = input.maxFlowStates ?? DEFAULT_CRITICAL_SECTION_WRAPPER_MAX_FLOW_STATES;
  const maxTargetCandidates =
    input.maxTargetCandidates ?? DEFAULT_CRITICAL_SECTION_WRAPPER_MAX_TARGET_CANDIDATES;
  if (!Number.isInteger(maxForwardingHops) || maxForwardingHops < 0) {
    throw new RangeError('maxForwardingHops must be a non-negative integer.');
  }
  if (!Number.isInteger(maxFlowStates) || maxFlowStates < 1) {
    throw new RangeError('maxFlowStates must be a positive integer.');
  }
  if (!Number.isInteger(maxTargetCandidates) || maxTargetCandidates < 1) {
    throw new RangeError('maxTargetCandidates must be a positive integer.');
  }
  // Most repositories do not use Redlock. Without a package-proven terminal there is
  // no eligible wrapper fact to propagate, so avoid a repository-wide forwarding pass.
  if (input.directSummaries.length === 0) {
    return { summaries: [], issues: [], state: 'complete' };
  }

  const indexed = forwardingEdges({
    sourceIndex: input.sourceIndex,
    checker: input.checker,
    maxTargetCandidates,
  });
  const issueByKey = new Map<string, CriticalSectionWrapperFlowIssue>();
  for (const issue of indexed.candidateLimitIssues) issueByKey.set(issueKey(issue), issue);
  const summaryByKey = new Map<string, CriticalSectionCallbackParameterFlowSummary>();
  let stateLimitReached = false;
  for (const direct of sortDirectCriticalSectionCallbackParameterSummaries(input.directSummaries)) {
    const summary = directFlowSummary(direct);
    const key = flowSummaryKey(summary);
    if (!summaryByKey.has(key) && summaryByKey.size >= maxFlowStates) {
      const issue: CriticalSectionWrapperFlowIssue = {
        kind: 'state_limit',
        method: direct.method,
        callbackParameterIndex: direct.callbackParameterIndex,
        call: direct.terminalCall,
      };
      issueByKey.set(issueKey(issue), issue);
      stateLimitReached = true;
      break;
    }
    summaryByKey.set(key, summary);
  }

  let changed = true;
  while (changed && !stateLimitReached) {
    changed = false;
    const currentSummaries = [...summaryByKey.values()].sort(compareFlowSummaries);
    for (const edge of indexed.edges) {
      for (const targetSummary of currentSummaries) {
        if (
          targetSummary.method.node !== edge.targetMethod.node ||
          targetSummary.callbackParameterIndex !== edge.targetParameterIndex
        ) {
          continue;
        }
        const sourceStateKey = methodParameterKey(edge.sourceMethod, edge.sourceParameterIndex);
        const targetPathKeys = new Set(
          targetSummary.flow.map((step) =>
            methodParameterKey(step.method, step.callbackParameterIndex),
          ),
        );
        if (targetPathKeys.has(sourceStateKey)) {
          const issue: CriticalSectionWrapperFlowIssue = {
            kind: 'cycle',
            method: edge.sourceMethod,
            callbackParameterIndex: edge.sourceParameterIndex,
            call: edge.call,
          };
          issueByKey.set(issueKey(issue), issue);
          continue;
        }
        if (targetSummary.forwardingHopCount >= maxForwardingHops) {
          const issue: CriticalSectionWrapperFlowIssue = {
            kind: 'hop_limit',
            method: edge.sourceMethod,
            callbackParameterIndex: edge.sourceParameterIndex,
            call: edge.call,
          };
          issueByKey.set(issueKey(issue), issue);
          continue;
        }

        const candidate: CriticalSectionCallbackParameterFlowSummary = {
          method: edge.sourceMethod,
          parameter: edge.sourceParameter,
          callbackParameterIndex: edge.sourceParameterIndex,
          forwardingHopCount: targetSummary.forwardingHopCount + 1,
          flow: [
            {
              relation: 'forwarded_unchanged',
              method: edge.sourceMethod,
              parameter: edge.sourceParameter,
              callbackParameterIndex: edge.sourceParameterIndex,
              call: edge.call,
              argument: edge.argument,
            },
            ...targetSummary.flow,
          ],
          terminalCall: targetSummary.terminalCall,
          criticalSectionCallback: targetSummary.criticalSectionCallback,
          evidenceNodes: [
            { role: 'callback_parameter', node: edge.sourceParameter.node },
            { role: 'parameter_forwarding', node: edge.call },
            ...targetSummary.evidenceNodes,
          ],
        };
        const key = flowSummaryKey(candidate);
        const existing = summaryByKey.get(key);
        if (existing !== undefined && compareFlowSummaries(existing, candidate) <= 0) continue;
        if (existing === undefined && summaryByKey.size >= maxFlowStates) {
          const issue: CriticalSectionWrapperFlowIssue = {
            kind: 'state_limit',
            method: edge.sourceMethod,
            callbackParameterIndex: edge.sourceParameterIndex,
            call: edge.call,
          };
          issueByKey.set(issueKey(issue), issue);
          stateLimitReached = true;
          break;
        }
        summaryByKey.set(key, candidate);
        changed = true;
      }
      if (stateLimitReached) break;
    }
  }

  const issues = [...issueByKey.values()].sort((left, right) =>
    issueKey(left).localeCompare(issueKey(right)),
  );
  return {
    summaries: [...summaryByKey.values()].sort(compareFlowSummaries),
    issues,
    state: issues.length === 0 ? 'complete' : 'bounded',
  };
}

export function summarizeDirectCriticalSectionCallbackParameters(input: {
  readonly checker: ts.TypeChecker;
  readonly method: IndexedMethod;
  readonly terminalCall: ts.CallExpression;
  readonly criticalSectionCallback: ts.ArrowFunction | ts.FunctionExpression;
}): readonly DirectCriticalSectionCallbackParameterSummary[] {
  const parameterIndexBySymbol = new Map<ts.Symbol, number>();
  input.method.parameters.forEach((parameter, index) => {
    const symbol = eligibleCallbackParameter(parameter, input.checker);
    if (symbol !== null) parameterIndexBySymbol.set(symbol, index);
  });
  if (parameterIndexBySymbol.size === 0) return [];

  const invocationsByParameter = new Map<number, ts.CallExpression[]>();
  const visit = (node: ts.Node): void => {
    // The supplied callback is already package-proven by the caller. Functions nested
    // inside its body remain boundaries until another analysis explicitly proves them.
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const parameterIndex = directInvokedParameterIndex(
        node,
        input.checker,
        parameterIndexBySymbol,
      );
      if (parameterIndex !== null) {
        const current = invocationsByParameter.get(parameterIndex) ?? [];
        current.push(node);
        invocationsByParameter.set(parameterIndex, current);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(input.criticalSectionCallback.body);

  return [...invocationsByParameter.entries()]
    .sort(([left], [right]) => left - right)
    .map(([callbackParameterIndex, invocations]) => {
      const parameter = input.method.parameters[callbackParameterIndex]!;
      const callbackInvocations = [...invocations].sort(compareNodes);
      return {
        method: input.method,
        parameter,
        callbackParameterIndex,
        terminalCall: input.terminalCall,
        criticalSectionCallback: input.criticalSectionCallback,
        callbackInvocations,
        evidenceNodes: [
          { role: 'redlock_terminal', node: input.terminalCall.expression },
          { role: 'callback_argument', node: input.criticalSectionCallback },
          { role: 'callback_parameter', node: parameter.node },
          ...callbackInvocations.map((node) => ({
            role: 'callback_invocation' as const,
            node,
          })),
        ],
      };
    });
}
