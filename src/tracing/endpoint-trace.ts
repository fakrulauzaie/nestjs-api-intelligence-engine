import { createDiagnostic } from '../diagnostics/catalogue.js';
import { normalizeRoutePath } from '../extractors/route-paths.js';
import { buildEffectiveEndpointGuards } from '../guards/effective.js';
import type {
  AnalysisDocument,
  AnalysisResultState,
  EndpointTraceGuard,
  EndpointTraceStep,
  EndpointTraceTerminal,
  EndpointTraceView,
  TraceCausalClass,
} from '../model/analysis.js';
import { analysisHasInteractionFacts, analysisHasJobQueueBranchFacts } from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type { EndpointRecord, HttpMethod } from '../model/entities.js';
import { canonicalizeEndpointTrace } from '../model/ordering.js';
import { endpointTraceViewSchema } from '../model/schemas.js';
import { buildTraceAssertionIndexes } from './assertion-indexes.js';
import { buildInteractionAssertionIndexes } from './interaction-indexes.js';
import { selectJobQueueBranches } from './job-queue-branch-selection.js';

export interface EndpointSelector {
  readonly httpMethod: HttpMethod;
  readonly path: string;
}

export interface NormalizedEndpointSelector {
  readonly httpMethod: HttpMethod;
  readonly path: string;
}

export type EndpointSelectionResult =
  | {
      readonly status: 'resolved';
      readonly selector: NormalizedEndpointSelector;
      readonly endpoint: EndpointRecord;
    }
  | {
      readonly status: 'not_found';
      readonly selector: NormalizedEndpointSelector;
    }
  | {
      readonly status: 'ambiguous';
      readonly selector: NormalizedEndpointSelector;
      readonly candidates: readonly EndpointRecord[];
    };

export type EndpointTraceBuildResult =
  | {
      readonly status: 'resolved';
      readonly selector: NormalizedEndpointSelector;
      readonly trace: EndpointTraceView;
      readonly diagnostics: readonly DiagnosticRecord[];
    }
  | {
      readonly status: 'not_found';
      readonly selector: NormalizedEndpointSelector;
    }
  | {
      readonly status: 'ambiguous';
      readonly selector: NormalizedEndpointSelector;
      readonly candidates: readonly EndpointRecord[];
    }
  | {
      readonly status: 'analysis_failure';
      readonly resultState: Extract<AnalysisResultState, 'failed' | 'canceled'>;
    };

function assertionStep(assertion: AssertionRecord): EndpointTraceStep {
  return {
    fromId: assertion.subjectId,
    relation: assertion.predicate,
    toId: assertion.objectId,
    status: assertion.status,
    ruleId: assertion.ruleId,
    evidenceIds: assertion.evidenceIds,
  };
}

function traversable(assertion: AssertionRecord): boolean {
  return (
    assertion.objectId !== null &&
    (assertion.status === 'resolved' || assertion.status === 'ambiguous')
  );
}

export function selectEndpoint(
  analysis: AnalysisDocument,
  selector: EndpointSelector,
): EndpointSelectionResult {
  const normalized = {
    httpMethod: selector.httpMethod,
    path: normalizeRoutePath(selector.path),
  };
  const candidates = analysis.endpoints
    .filter(
      (endpoint) =>
        endpoint.httpMethod === normalized.httpMethod && endpoint.path === normalized.path,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0) return { status: 'not_found', selector: normalized };
  if (candidates.length > 1) return { status: 'ambiguous', selector: normalized, candidates };
  return { status: 'resolved', selector: normalized, endpoint: candidates[0]! };
}

export function buildEndpointTrace(
  analysis: AnalysisDocument,
  selector: EndpointSelector,
): EndpointTraceBuildResult {
  if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
    return { status: 'analysis_failure', resultState: analysis.resultState };
  }

  const selection = selectEndpoint(analysis, selector);
  if (selection.status !== 'resolved') return selection;

  const maximumDepth = analysis.analysisRun.configuration.maxCallDepth;
  if (!Number.isInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 3) {
    throw new RangeError('Maximum endpoint-trace call depth must be an integer from 1 to 3.');
  }

  const indexes = buildTraceAssertionIndexes(analysis.assertions);
  const interactionIndexes = buildInteractionAssertionIndexes(analysis);
  const interactionById = new Map(
    analysisHasInteractionFacts(analysis)
      ? analysis.interactions.map((interaction) => [interaction.id, interaction])
      : [],
  );
  const handlerById = new Map(
    analysisHasInteractionFacts(analysis)
      ? analysis.interactionHandlers.map((handler) => [handler.id, handler])
      : [],
  );
  const interactionConfiguration = analysisHasInteractionFacts(analysis)
    ? (analysis.analysisRun.configuration.interactions ?? {
        maxInteractionHops: 2,
        maxFanOutPerInteraction: 50,
        maxInteractionTraceStates: 1_000,
      })
    : {
        maxInteractionHops: 0,
        maxFanOutPerInteraction: Number.MAX_SAFE_INTEGER,
        maxInteractionTraceStates: Number.MAX_SAFE_INTEGER,
      };
  const tablesById = new Map(analysis.tables.map((table) => [table.id, table]));
  const guardView = buildEffectiveEndpointGuards(analysis, selection.endpoint.id);
  const guards: EndpointTraceGuard[] = guardView.effectiveGuards.map((guard) => ({
    guardId: guard.guardId,
    name: guard.name,
    scope: guard.scope,
    status: guard.status,
    evidenceIds: guard.evidenceIds,
  }));
  const stepByAssertionId = new Map<string, EndpointTraceStep>();
  const terminalByKey = new Map<string, EndpointTraceTerminal>();
  const reachedMethodIds = new Set<string>();
  const relevantSubjectIds = new Set([selection.endpoint.id]);
  const initiatedInteractionIds = new Set<string>();
  const selectedJobQueueBranchIds = new Set<string>();
  const generatedDiagnostics: DiagnosticRecord[] = [];
  const seenStates = new Set<string>();
  interface TraceState {
    readonly methodId: string;
    readonly depth: number;
    readonly interactionHop: number;
    readonly causalClass: TraceCausalClass;
    readonly pathMethodIds: ReadonlySet<string>;
    /** Restricts only the current method's direct assertions; downstream calls reset it. */
    readonly directAssertionIds: ReadonlySet<string> | null;
  }
  const queue: TraceState[] = [];
  let traceStateLimitReported = false;
  const enqueue = (state: TraceState, evidenceIds: readonly string[]): void => {
    const filterKey =
      state.directAssertionIds === null ? '*' : [...state.directAssertionIds].sort().join(',');
    const key = `${state.methodId}:${state.depth}:${state.interactionHop}:${state.causalClass}:${filterKey}`;
    if (seenStates.has(key)) return;
    if (seenStates.size >= interactionConfiguration.maxInteractionTraceStates) {
      if (!traceStateLimitReported) {
        generatedDiagnostics.push(
          createDiagnostic({
            code: 'INTERACTION_TRACE_LIMIT_REACHED',
            subjectId: state.methodId,
            message: `Endpoint interaction trace reached configured state limit ${interactionConfiguration.maxInteractionTraceStates}.`,
            evidenceIds,
          }),
        );
        traceStateLimitReported = true;
      }
      return;
    }
    seenStates.add(key);
    reachedMethodIds.add(state.methodId);
    relevantSubjectIds.add(state.methodId);
    queue.push(state);
  };

  const implementations = indexes.implementationsByEndpoint.get(selection.endpoint.id) ?? [];
  for (const assertion of implementations) {
    stepByAssertionId.set(assertion.id, assertionStep(assertion));
    if (!traversable(assertion)) continue;
    const methodId = assertion.objectId!;
    enqueue(
      {
        methodId,
        depth: 0,
        interactionHop: 0,
        causalClass: 'synchronous',
        pathMethodIds: new Set([methodId]),
        directAssertionIds: null,
      },
      assertion.evidenceIds,
    );
  }
  queue.sort((left, right) => left.methodId.localeCompare(right.methodId));

  const depthLimitedMethods = new Map<string, string[]>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor]!;
    const { methodId, depth, interactionHop, causalClass } = state;
    const appliesDirectly = (assertion: AssertionRecord): boolean =>
      state.directAssertionIds === null || state.directAssertionIds.has(assertion.id);
    for (const assertion of (indexes.interactionsByMethod.get(methodId) ?? []).filter(
      appliesDirectly,
    )) {
      stepByAssertionId.set(assertion.id, assertionStep(assertion));
      if (!traversable(assertion)) continue;
      const interactionId = assertion.objectId!;
      initiatedInteractionIds.add(interactionId);
      relevantSubjectIds.add(interactionId);
      const interaction = interactionById.get(interactionId);
      if (
        interaction?.kind !== 'in_process_event' &&
        interaction?.kind !== 'job_queue' &&
        interaction?.kind !== 'microservice_message'
      )
        continue;
      const allMatches = interactionIndexes.handlersByInteraction.get(interactionId) ?? [];
      const matches = allMatches.slice(0, interactionConfiguration.maxFanOutPerInteraction);
      if (allMatches.length > matches.length) {
        generatedDiagnostics.push(
          createDiagnostic({
            code: 'INTERACTION_TRACE_LIMIT_REACHED',
            subjectId: interactionId,
            message: `Endpoint interaction trace fan-out ${allMatches.length} exceeds configured limit ${interactionConfiguration.maxFanOutPerInteraction}.`,
            evidenceIds: allMatches.flatMap((match) => match.evidenceIds),
          }),
        );
      }
      for (const match of matches) {
        stepByAssertionId.set(match.id, assertionStep(match));
        if (!traversable(match)) continue;
        if (
          interaction.kind === 'microservice_message' &&
          interaction.target.mode === 'request_response' &&
          match.status !== 'resolved'
        )
          continue;
        const handlerId = match.objectId!;
        relevantSubjectIds.add(handlerId);
        const handler = handlerById.get(handlerId);
        for (const implementation of interactionIndexes.implementationByHandler.get(handlerId) ??
          []) {
          stepByAssertionId.set(implementation.id, assertionStep(implementation));
          if (!traversable(implementation) || handler === undefined) continue;
          if (handler.registrationState !== 'proven_registered') continue;
          const targetMethodId = implementation.objectId!;
          if (state.pathMethodIds.has(targetMethodId)) {
            generatedDiagnostics.push(
              createDiagnostic({
                code: 'INTERACTION_CYCLE_TRUNCATED',
                subjectId: targetMethodId,
                message:
                  'A local or distributed interaction cycle was terminated before revisiting a method.',
                evidenceIds: [...match.evidenceIds, ...implementation.evidenceIds],
              }),
            );
            continue;
          }
          if (interactionHop >= interactionConfiguration.maxInteractionHops) {
            generatedDiagnostics.push(
              createDiagnostic({
                code: 'INTERACTION_TRACE_LIMIT_REACHED',
                subjectId: interactionId,
                message: `Endpoint interaction trace stopped at configured hop limit ${interactionConfiguration.maxInteractionHops}.`,
                evidenceIds: match.evidenceIds,
              }),
            );
            continue;
          }
          const nextCausalClass: TraceCausalClass | null =
            interaction.kind === 'job_queue' ||
            interaction.kind === 'microservice_message' ||
            causalClass === 'distributed_conditional'
              ? 'distributed_conditional'
              : interaction.dispatchTiming === 'asynchronous' || handler.ruleId.includes('.async.')
                ? 'local_interaction_asynchronous'
                : handler.ruleId.includes('.sync.')
                  ? 'local_interaction_synchronous'
                  : null;
          if (nextCausalClass === null) continue;
          const branchSelection =
            analysisHasJobQueueBranchFacts(analysis) && interaction.kind === 'job_queue'
              ? selectJobQueueBranches({
                  analysis,
                  handlerId,
                  producerJob: interaction.target.job,
                })
              : null;
          for (const branchId of branchSelection?.branchIds ?? []) {
            selectedJobQueueBranchIds.add(branchId);
            relevantSubjectIds.add(branchId);
          }
          enqueue(
            {
              methodId: targetMethodId,
              depth: 0,
              interactionHop: interactionHop + 1,
              causalClass: nextCausalClass,
              pathMethodIds: new Set([...state.pathMethodIds, targetMethodId]),
              directAssertionIds: branchSelection?.sourceAssertionIds ?? null,
            },
            [...match.evidenceIds, ...implementation.evidenceIds],
          );
        }
      }
    }
    for (const assertion of (indexes.tableAccessByMethod.get(methodId) ?? []).filter(
      appliesDirectly,
    )) {
      stepByAssertionId.set(assertion.id, assertionStep(assertion));
      if (!traversable(assertion)) continue;
      const table = tablesById.get(assertion.objectId!);
      if (table === undefined) continue;
      const direction = assertion.predicate === 'METHOD_READS_TABLE' ? 'READ' : 'WRITE';
      const terminal: EndpointTraceTerminal = {
        methodId,
        direction,
        tableId: table.id,
        tableName: table.name,
        ...(analysisHasInteractionFacts(analysis) ? { causalClass } : {}),
      };
      terminalByKey.set(
        `${methodId}:${direction}:${table.id}:${terminal.causalClass ?? ''}`,
        terminal,
      );
    }

    const calls = (indexes.callsByMethod.get(methodId) ?? []).filter(appliesDirectly);
    if (depth >= maximumDepth) {
      const evidenceIds = calls.filter(traversable).flatMap((assertion) => assertion.evidenceIds);
      if (evidenceIds.length > 0) {
        depthLimitedMethods.set(methodId, [
          ...(depthLimitedMethods.get(methodId) ?? []),
          ...evidenceIds,
        ]);
      }
      continue;
    }
    for (const assertion of calls) {
      stepByAssertionId.set(assertion.id, assertionStep(assertion));
      if (!traversable(assertion)) continue;
      const targetId = assertion.objectId!;
      if (state.pathMethodIds.has(targetId)) continue;
      enqueue(
        {
          methodId: targetId,
          depth: depth + 1,
          interactionHop,
          causalClass,
          pathMethodIds: new Set([...state.pathMethodIds, targetId]),
          directAssertionIds: null,
        },
        assertion.evidenceIds,
      );
    }
  }

  for (const [methodId, evidenceIds] of depthLimitedMethods) {
    generatedDiagnostics.push(
      createDiagnostic({
        code: 'CALL_DEPTH_LIMIT',
        subjectId: methodId,
        message: `Endpoint trace stopped at configured call depth ${maximumDepth}.`,
        evidenceIds: [...new Set(evidenceIds)],
      }),
    );
  }

  for (const methodId of reachedMethodIds) relevantSubjectIds.add(methodId);
  const diagnosticById = new Map<string, DiagnosticRecord>();
  for (const diagnostic of analysis.diagnostics) {
    if (
      (diagnostic.subjectId !== undefined && relevantSubjectIds.has(diagnostic.subjectId)) ||
      (diagnostic.subjectId === undefined && diagnostic.code === 'AUTH_GLOBAL_POLICY_UNKNOWN')
    ) {
      diagnosticById.set(diagnostic.id, diagnostic);
    }
  }
  for (const diagnostic of generatedDiagnostics) diagnosticById.set(diagnostic.id, diagnostic);
  const diagnostics = [...diagnosticById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const terminalValues = [...terminalByKey.values()];
  const initiatedInteractions = [...initiatedInteractionIds].flatMap((id) => {
    const interaction = interactionById.get(id);
    return interaction === undefined ? [] : [interaction];
  });
  const distributedInteractionIds = initiatedInteractions
    .filter(({ kind }) => kind === 'job_queue' || kind === 'microservice_message')
    .map(({ id }) => id);
  const trace = endpointTraceViewSchema.parse(
    canonicalizeEndpointTrace({
      schemaVersion: analysis.schemaVersion,
      analysisId: analysis.analysisRun.id,
      endpoint: selection.endpoint,
      directGuardState: guardView.directGuardState,
      globalGuardState: guardView.globalGuardState,
      effectiveGuardState: guardView.effectiveGuardState,
      guards,
      steps: [...stepByAssertionId.values()],
      terminals: terminalValues,
      diagnosticIds: diagnostics.map((diagnostic) => diagnostic.id),
      ...(!analysisHasInteractionFacts(analysis)
        ? {}
        : {
            causalSummary: {
              synchronousEffects: terminalValues.filter(
                ({ causalClass }) => causalClass === 'synchronous',
              ),
              localInteractionEffects: terminalValues.filter(({ causalClass }) =>
                ['local_interaction_synchronous', 'local_interaction_asynchronous'].includes(
                  causalClass ?? '',
                ),
              ),
              distributedConditionalEffects: terminalValues.filter(
                ({ causalClass }) => causalClass === 'distributed_conditional',
              ),
              outboundInteractionIds: initiatedInteractions
                .filter(({ kind }) => kind === 'outbound_http')
                .map(({ id }) => id),
              localInteractionIds: initiatedInteractions
                .filter(({ kind }) => kind === 'in_process_event')
                .map(({ id }) => id),
              ...(distributedInteractionIds.length === 0 ? {} : { distributedInteractionIds }),
              ...(!analysisHasJobQueueBranchFacts(analysis) || selectedJobQueueBranchIds.size === 0
                ? {}
                : { jobQueueBranchIds: [...selectedJobQueueBranchIds] }),
              completeness: {
                state: diagnostics.length === 0 ? ('complete' as const) : ('incomplete' as const),
                diagnosticCodes: [...new Set(diagnostics.map(({ code }) => code))],
              },
            },
          }),
    }),
  );
  return { status: 'resolved', selector: selection.selector, trace, diagnostics };
}
