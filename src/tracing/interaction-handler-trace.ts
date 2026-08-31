import { createDiagnostic } from '../diagnostics/catalogue.js';
import type {
  AnalysisDocument,
  AnalysisResultState,
  EndpointTraceStep,
  EndpointTraceTerminal,
  InteractionHandlerTraceView,
  ResourceAccessTraceTerminal,
  TraceCausalClass,
} from '../model/analysis.js';
import {
  analysisHasCriticalSectionFacts,
  analysisHasInteractionFacts,
  analysisHasResourceAccessFacts,
} from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { CriticalSectionRecord } from '../model/critical-sections.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import { canonicalizeInteractionHandlerTrace } from '../model/ordering.js';
import { interactionHandlerTraceViewSchema } from '../model/schemas.js';
import { buildTraceAssertionIndexes } from './assertion-indexes.js';
import { buildInteractionAssertionIndexes } from './interaction-indexes.js';

export type InteractionHandlerTraceBuildResult =
  | {
      readonly status: 'resolved';
      readonly trace: InteractionHandlerTraceView;
      readonly diagnostics: readonly DiagnosticRecord[];
    }
  | { readonly status: 'not_found'; readonly handlerId: string }
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

interface HandlerTraceState {
  readonly methodId: string;
  readonly depth: number;
  readonly interactionHop: number;
  readonly causalClass: TraceCausalClass | null;
  readonly pathMethodIds: ReadonlySet<string>;
  readonly directAssertionIds: ReadonlySet<string> | null;
}

export function buildInteractionHandlerTrace(
  analysis: AnalysisDocument,
  handlerId: string,
): InteractionHandlerTraceBuildResult {
  if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
    return { status: 'analysis_failure', resultState: analysis.resultState };
  }
  if (!analysisHasInteractionFacts(analysis)) return { status: 'not_found', handlerId };
  const handler = analysis.interactionHandlers.find(({ id }) => id === handlerId);
  if (handler === undefined) return { status: 'not_found', handlerId };

  const configuration = analysis.analysisRun.configuration.interactions ?? {
    maxInteractionHops: 2,
    maxFanOutPerInteraction: 50,
    maxInteractionTraceStates: 1_000,
  };
  const indexes = buildTraceAssertionIndexes(analysis.assertions);
  const interactionIndexes = buildInteractionAssertionIndexes(analysis);
  const interactions = new Map(analysis.interactions.map((record) => [record.id, record]));
  const handlers = new Map(analysis.interactionHandlers.map((record) => [record.id, record]));
  const tables = new Map(analysis.tables.map((record) => [record.id, record]));
  const resourceAccesses = new Map(
    analysisHasResourceAccessFacts(analysis)
      ? analysis.resourceAccesses.map((record) => [record.id, record])
      : [],
  );
  const scopedEffectAssertionIds = new Set(
    analysisHasCriticalSectionFacts(analysis)
      ? analysis.criticalSections.flatMap(({ effectAssertionIds }) => effectAssertionIds)
      : [],
  );
  const lockAssertionIdsByAccessId = new Map(
    analysis.assertions
      .filter(
        ({ predicate, objectId }) => predicate === 'METHOD_ACCESSES_RESOURCE' && objectId !== null,
      )
      .map((assertion) => [assertion.objectId!, assertion.id]),
  );
  const criticalSectionsByMethod = new Map<string, CriticalSectionRecord[]>();
  if (analysisHasCriticalSectionFacts(analysis)) {
    for (const section of analysis.criticalSections) {
      const existing = criticalSectionsByMethod.get(section.sourceMethodId) ?? [];
      existing.push(section);
      criticalSectionsByMethod.set(section.sourceMethodId, existing);
    }
  }
  const steps = new Map<string, EndpointTraceStep>();
  const terminals = new Map<string, EndpointTraceTerminal>();
  const resourceTerminals = new Map<string, ResourceAccessTraceTerminal>();
  const diagnostics = new Map<string, DiagnosticRecord>();
  const relevantIds = new Set([handler.id, handler.methodId]);
  const seenStates = new Set<string>();
  const queue: HandlerTraceState[] = [];
  let stateLimitReported = false;
  const addGeneratedDiagnostic = (diagnostic: DiagnosticRecord): void => {
    diagnostics.set(diagnostic.id, diagnostic);
  };
  const enqueue = (state: HandlerTraceState, evidenceIds: readonly string[]): void => {
    const filterKey =
      state.directAssertionIds === null ? '*' : [...state.directAssertionIds].sort().join(',');
    const key = `${state.methodId}:${state.depth}:${state.interactionHop}:${state.causalClass ?? 'unknown'}:${filterKey}`;
    if (seenStates.has(key)) return;
    if (seenStates.size >= configuration.maxInteractionTraceStates) {
      if (!stateLimitReported) {
        addGeneratedDiagnostic(
          createDiagnostic({
            code: 'INTERACTION_TRACE_LIMIT_REACHED',
            subjectId: state.methodId,
            message: `Handler interaction trace reached configured state limit ${configuration.maxInteractionTraceStates}.`,
            evidenceIds,
          }),
        );
        stateLimitReported = true;
      }
      return;
    }
    seenStates.add(key);
    relevantIds.add(state.methodId);
    queue.push(state);
  };

  const initialCausalClass: TraceCausalClass | null =
    handler.kind === 'job_queue' || handler.kind === 'microservice_message'
      ? 'distributed_conditional'
      : handler.ruleId.includes('.async.')
        ? 'local_interaction_asynchronous'
        : handler.ruleId.includes('.sync.')
          ? 'local_interaction_synchronous'
          : null;
  for (const implementation of interactionIndexes.implementationByHandler.get(handler.id) ?? []) {
    steps.set(implementation.id, assertionStep(implementation));
    if (!traversable(implementation)) continue;
    enqueue(
      {
        methodId: implementation.objectId!,
        depth: 0,
        interactionHop: 0,
        causalClass: initialCausalClass,
        pathMethodIds: new Set([implementation.objectId!]),
        directAssertionIds: null,
      },
      implementation.evidenceIds,
    );
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor]!;
    const appliesDirectly = (assertion: AssertionRecord): boolean =>
      (state.directAssertionIds === null || state.directAssertionIds.has(assertion.id)) &&
      (state.directAssertionIds !== null || !scopedEffectAssertionIds.has(assertion.id));
    for (const section of criticalSectionsByMethod.get(state.methodId) ?? []) {
      const lockAssertionIds = section.lockResourceAccessIds.flatMap((accessId) => {
        const assertionId = lockAssertionIdsByAccessId.get(accessId);
        return assertionId === undefined ? [] : [assertionId];
      });
      if (
        section.effectAssertionIds.length === 0 ||
        !lockAssertionIds.some((id) =>
          state.directAssertionIds === null ? true : state.directAssertionIds.has(id),
        )
      ) {
        continue;
      }
      relevantIds.add(section.id);
      enqueue(
        {
          methodId: state.methodId,
          depth: state.depth,
          interactionHop: state.interactionHop,
          causalClass:
            state.causalClass === 'distributed_conditional'
              ? 'distributed_conditional'
              : 'critical_section_conditional',
          pathMethodIds: state.pathMethodIds,
          directAssertionIds: new Set(section.effectAssertionIds),
        },
        section.evidenceIds,
      );
    }
    for (const assertion of (indexes.tableAccessByMethod.get(state.methodId) ?? []).filter(
      appliesDirectly,
    )) {
      steps.set(assertion.id, assertionStep(assertion));
      if (!traversable(assertion)) continue;
      const table = tables.get(assertion.objectId!);
      if (table === undefined) continue;
      const direction = assertion.predicate === 'METHOD_READS_TABLE' ? 'READ' : 'WRITE';
      const terminal: EndpointTraceTerminal = {
        methodId: state.methodId,
        direction,
        tableId: table.id,
        tableName: table.name,
        ...(state.causalClass === null ? {} : { causalClass: state.causalClass }),
      };
      terminals.set(
        `${terminal.methodId}:${terminal.direction}:${terminal.tableId}:${terminal.causalClass ?? ''}`,
        terminal,
      );
    }
    for (const assertion of (indexes.resourceAccessByMethod.get(state.methodId) ?? []).filter(
      appliesDirectly,
    )) {
      steps.set(assertion.id, assertionStep(assertion));
      if (!traversable(assertion)) continue;
      const access = resourceAccesses.get(assertion.objectId!);
      if (access === undefined) continue;
      relevantIds.add(access.id);
      const causalClass =
        state.causalClass ??
        (handler.kind === 'in_process_event'
          ? 'local_interaction_synchronous'
          : 'distributed_conditional');
      const terminal: ResourceAccessTraceTerminal = {
        methodId: state.methodId,
        resourceAccessId: access.id,
        resourceKind: access.resourceKind,
        operation: access.operation,
        technology: access.technology,
        target: access.target,
        selector: access.selector,
        causalClass,
      };
      resourceTerminals.set(
        `${terminal.methodId}:${terminal.resourceAccessId}:${causalClass}`,
        terminal,
      );
    }

    const calls = (indexes.callsByMethod.get(state.methodId) ?? []).filter(appliesDirectly);
    if (state.depth >= analysis.analysisRun.configuration.maxCallDepth) {
      const evidenceIds = calls.filter(traversable).flatMap((assertion) => assertion.evidenceIds);
      if (evidenceIds.length > 0) {
        addGeneratedDiagnostic(
          createDiagnostic({
            code: 'CALL_DEPTH_LIMIT',
            subjectId: state.methodId,
            message: `Handler trace stopped at configured call depth ${analysis.analysisRun.configuration.maxCallDepth}.`,
            evidenceIds,
          }),
        );
      }
    } else {
      for (const assertion of calls) {
        steps.set(assertion.id, assertionStep(assertion));
        if (!traversable(assertion) || state.pathMethodIds.has(assertion.objectId!)) continue;
        enqueue(
          {
            methodId: assertion.objectId!,
            depth: state.depth + 1,
            interactionHop: state.interactionHop,
            causalClass: state.causalClass,
            pathMethodIds: new Set([...state.pathMethodIds, assertion.objectId!]),
            directAssertionIds: null,
          },
          assertion.evidenceIds,
        );
      }
    }

    for (const initiation of (indexes.interactionsByMethod.get(state.methodId) ?? []).filter(
      appliesDirectly,
    )) {
      steps.set(initiation.id, assertionStep(initiation));
      if (!traversable(initiation)) continue;
      const interaction = interactions.get(initiation.objectId!);
      if (
        interaction?.kind !== 'in_process_event' &&
        interaction?.kind !== 'job_queue' &&
        interaction?.kind !== 'microservice_message'
      )
        continue;
      relevantIds.add(interaction.id);
      const allMatches = interactionIndexes.handlersByInteraction.get(interaction.id) ?? [];
      const matches = allMatches.slice(0, configuration.maxFanOutPerInteraction);
      if (allMatches.length > matches.length) {
        addGeneratedDiagnostic(
          createDiagnostic({
            code: 'INTERACTION_TRACE_LIMIT_REACHED',
            subjectId: interaction.id,
            message: `Handler interaction trace fan-out ${allMatches.length} exceeds configured limit ${configuration.maxFanOutPerInteraction}.`,
            evidenceIds: allMatches.flatMap((match) => match.evidenceIds),
          }),
        );
      }
      for (const match of matches) {
        steps.set(match.id, assertionStep(match));
        if (!traversable(match)) continue;
        if (
          interaction.kind === 'microservice_message' &&
          interaction.target.mode === 'request_response' &&
          match.status !== 'resolved'
        )
          continue;
        const matchedHandler = handlers.get(match.objectId!);
        if (matchedHandler === undefined) continue;
        relevantIds.add(matchedHandler.id);
        for (const implementation of interactionIndexes.implementationByHandler.get(
          matchedHandler.id,
        ) ?? []) {
          steps.set(implementation.id, assertionStep(implementation));
          if (
            !traversable(implementation) ||
            matchedHandler.registrationState !== 'proven_registered'
          ) {
            continue;
          }
          const methodId = implementation.objectId!;
          if (state.pathMethodIds.has(methodId)) {
            addGeneratedDiagnostic(
              createDiagnostic({
                code: 'INTERACTION_CYCLE_TRUNCATED',
                subjectId: methodId,
                message:
                  'A local or distributed interaction cycle was terminated before revisiting a method.',
                evidenceIds: [...match.evidenceIds, ...implementation.evidenceIds],
              }),
            );
            continue;
          }
          if (state.interactionHop >= configuration.maxInteractionHops) {
            addGeneratedDiagnostic(
              createDiagnostic({
                code: 'INTERACTION_TRACE_LIMIT_REACHED',
                subjectId: interaction.id,
                message: `Handler interaction trace stopped at configured hop limit ${configuration.maxInteractionHops}.`,
                evidenceIds: match.evidenceIds,
              }),
            );
            continue;
          }
          const causalClass: TraceCausalClass | null =
            interaction.kind === 'job_queue' ||
            interaction.kind === 'microservice_message' ||
            state.causalClass === 'distributed_conditional'
              ? 'distributed_conditional'
              : state.causalClass === 'critical_section_conditional'
                ? 'critical_section_conditional'
                : interaction.dispatchTiming === 'asynchronous' ||
                    matchedHandler.ruleId.includes('.async.')
                  ? 'local_interaction_asynchronous'
                  : matchedHandler.ruleId.includes('.sync.')
                    ? 'local_interaction_synchronous'
                    : null;
          enqueue(
            {
              methodId,
              depth: 0,
              interactionHop: state.interactionHop + 1,
              causalClass,
              pathMethodIds: new Set([...state.pathMethodIds, methodId]),
              directAssertionIds: null,
            },
            [...match.evidenceIds, ...implementation.evidenceIds],
          );
        }
      }
    }
  }

  for (const diagnostic of analysis.diagnostics) {
    if (diagnostic.subjectId !== undefined && relevantIds.has(diagnostic.subjectId)) {
      diagnostics.set(diagnostic.id, diagnostic);
    }
  }
  const orderedDiagnostics = [...diagnostics.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const trace = interactionHandlerTraceViewSchema.parse(
    canonicalizeInteractionHandlerTrace({
      schemaVersion: analysis.schemaVersion,
      analysisId: analysis.analysisRun.id,
      handler,
      steps: [...steps.values()],
      terminals: [...terminals.values()],
      ...(analysisHasResourceAccessFacts(analysis)
        ? { resourceTerminals: [...resourceTerminals.values()] }
        : {}),
      diagnosticIds: orderedDiagnostics.map(({ id }) => id),
    }),
  );
  return { status: 'resolved', trace, diagnostics: orderedDiagnostics };
}
