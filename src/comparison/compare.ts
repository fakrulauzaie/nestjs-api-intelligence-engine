import { canonicalStringify } from '../model/ordering.js';
import {
  DIFF_SCHEMA_VERSION,
  DIFF_SCHEMA_V2_VERSION,
  type AssertionSnapshot,
  type AssertionStatusChange,
  type DiagnosticChange,
  type DiagnosticChangeReason,
  type DiagnosticSnapshot,
  type DiffAmbiguity,
  type DiffDocument,
  type EndpointChange,
  type EndpointChangeReason,
  type EndpointGuardFact,
  type EndpointHandlerFact,
  type EndpointSnapshot,
  type EndpointTerminalFact,
  type InteractionChange,
  type InteractionChangeReason,
  type InteractionHandlerChange,
  type InteractionHandlerChangeReason,
  type InteractionHandlerSnapshot,
} from './model.js';
import {
  buildAnalysisSemanticProjection,
  type AnalysisSemanticProjection,
  type ProjectionSemanticCollision,
} from './projection.js';
import { compareSemanticKeys, type SemanticKey } from './semantic-key.js';
import { assertValidDiffDocument } from './validate.js';
import type { AnalysisDocument } from '../model/analysis.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function groupsByKey<T>(values: readonly T[], keyFor: (value: T) => SemanticKey): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value).encoded;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function combineSides(
  left: DiffAmbiguity['side'],
  right: DiffAmbiguity['side'],
): DiffAmbiguity['side'] {
  return left === right ? left : 'both';
}

function endpointIds(endpoints: readonly EndpointSnapshot[]): string[] {
  return endpoints.map(({ endpointId }) => endpointId).sort(compareStrings);
}

function addAmbiguity(index: Map<string, DiffAmbiguity>, ambiguity: DiffAmbiguity): void {
  const identity = `${ambiguity.kind}:${ambiguity.recordKind}:${ambiguity.key.encoded}`;
  const existing = index.get(identity);
  const beforeCandidateIds = [
    ...new Set([...(existing?.beforeCandidateIds ?? []), ...ambiguity.beforeCandidateIds]),
  ].sort(compareStrings);
  const afterCandidateIds = [
    ...new Set([...(existing?.afterCandidateIds ?? []), ...ambiguity.afterCandidateIds]),
  ].sort(compareStrings);
  index.set(identity, {
    ...ambiguity,
    side: existing === undefined ? ambiguity.side : combineSides(existing.side, ambiguity.side),
    beforeCandidateIds,
    afterCandidateIds,
  });
}

function addProjectionCollisions(
  ambiguityByKey: Map<string, DiffAmbiguity>,
  before: readonly ProjectionSemanticCollision[],
  after: readonly ProjectionSemanticCollision[],
): void {
  for (const collision of before) {
    if (['assertion', 'diagnostic', 'endpoint'].includes(collision.recordKind)) continue;
    addAmbiguity(ambiguityByKey, {
      kind: 'semantic_key',
      side: 'before',
      recordKind: collision.recordKind,
      key: collision.key,
      beforeCandidateIds: collision.candidateIds,
      afterCandidateIds: [],
    });
  }
  for (const collision of after) {
    if (['assertion', 'diagnostic', 'endpoint'].includes(collision.recordKind)) continue;
    addAmbiguity(ambiguityByKey, {
      kind: 'semantic_key',
      side: 'after',
      recordKind: collision.recordKind,
      key: collision.key,
      beforeCandidateIds: [],
      afterCandidateIds: collision.candidateIds,
    });
  }
}

function handlerProjection(handlers: readonly EndpointHandlerFact[]): unknown {
  return handlers.map(({ methodKey, status, ruleId }) => ({
    methodKey: methodKey?.encoded ?? null,
    status,
    ruleId,
  }));
}

function guardProjection(guards: readonly EndpointGuardFact[]): unknown {
  return guards.map(({ guardKey, scope, status, ruleId }) => ({
    guardKey: guardKey.encoded,
    scope,
    status,
    ruleId,
  }));
}

function terminalProjection(terminals: readonly EndpointTerminalFact[]): unknown {
  return terminals.map(({ key, status }) => ({ key: key.encoded, status }));
}

function endpointModificationReasons(
  before: EndpointSnapshot,
  after: EndpointSnapshot,
): EndpointChangeReason[] {
  const reasons: EndpointChangeReason[] = [];
  if (
    before.identityStatus !== after.identityStatus ||
    canonicalStringify(handlerProjection(before.handlers)) !==
      canonicalStringify(handlerProjection(after.handlers))
  ) {
    reasons.push('handler');
  }
  if (
    before.directGuards.availability !== after.directGuards.availability ||
    canonicalStringify(guardProjection(before.directGuards.guards)) !==
      canonicalStringify(guardProjection(after.directGuards.guards))
  ) {
    reasons.push('direct_guards');
  }
  if (
    before.effectiveGuards.availability !== after.effectiveGuards.availability ||
    canonicalStringify(guardProjection(before.effectiveGuards.guards)) !==
      canonicalStringify(guardProjection(after.effectiveGuards.guards))
  ) {
    reasons.push('effective_guards');
  }
  if (
    before.terminals.availability !== after.terminals.availability ||
    canonicalStringify(terminalProjection(before.terminals.values)) !==
      canonicalStringify(terminalProjection(after.terminals.values))
  ) {
    reasons.push('terminals');
  }
  return reasons;
}

function compareEndpoints(input: {
  before: AnalysisSemanticProjection;
  after: AnalysisSemanticProjection;
  ambiguityByKey: Map<string, DiffAmbiguity>;
}): EndpointChange[] {
  const beforeRouteGroups = groupsByKey(input.before.endpoints, ({ routeSlotKey }) => routeSlotKey);
  const afterRouteGroups = groupsByKey(input.after.endpoints, ({ routeSlotKey }) => routeSlotKey);
  const routeKeys = [...new Set([...beforeRouteGroups.keys(), ...afterRouteGroups.keys()])].sort(
    compareStrings,
  );
  const blockedEndpointIds = new Set<string>();

  for (const routeKey of routeKeys) {
    const beforeGroup = beforeRouteGroups.get(routeKey) ?? [];
    const afterGroup = afterRouteGroups.get(routeKey) ?? [];
    if (beforeGroup.length > 1 || afterGroup.length > 1) {
      for (const endpoint of [...beforeGroup, ...afterGroup])
        blockedEndpointIds.add(endpoint.endpointId);
      addAmbiguity(input.ambiguityByKey, {
        kind: 'endpoint_route_slot',
        side:
          beforeGroup.length > 1 && afterGroup.length > 1
            ? 'both'
            : beforeGroup.length > 1
              ? 'before'
              : 'after',
        recordKind: 'endpoint',
        key: (beforeGroup[0] ?? afterGroup[0])!.routeSlotKey,
        beforeCandidateIds: endpointIds(beforeGroup),
        afterCandidateIds: endpointIds(afterGroup),
      });
    }
  }

  for (const side of [input.before, input.after]) {
    for (const endpoint of side.endpoints) {
      if (endpoint.identityStatus !== 'ambiguous' || blockedEndpointIds.has(endpoint.endpointId)) {
        continue;
      }
      blockedEndpointIds.add(endpoint.endpointId);
      addAmbiguity(input.ambiguityByKey, {
        kind: 'endpoint_exact_key',
        side: side === input.before ? 'before' : 'after',
        recordKind: 'endpoint',
        key: endpoint.routeSlotKey,
        beforeCandidateIds: side === input.before ? [endpoint.endpointId] : [],
        afterCandidateIds: side === input.after ? [endpoint.endpointId] : [],
      });
    }
  }

  const beforeAvailable = input.before.endpoints.filter(
    ({ endpointId }) => !blockedEndpointIds.has(endpointId),
  );
  const afterAvailable = input.after.endpoints.filter(
    ({ endpointId }) => !blockedEndpointIds.has(endpointId),
  );
  const usedBefore = new Set<string>();
  const usedAfter = new Set<string>();
  const matched: [EndpointSnapshot, EndpointSnapshot][] = [];

  const beforeExact = groupsByKey(
    beforeAvailable.filter(({ exactKey }) => exactKey !== null),
    ({ exactKey }) => exactKey!,
  );
  const afterExact = groupsByKey(
    afterAvailable.filter(({ exactKey }) => exactKey !== null),
    ({ exactKey }) => exactKey!,
  );
  for (const key of [...new Set([...beforeExact.keys(), ...afterExact.keys()])].sort(
    compareStrings,
  )) {
    const beforeGroup = beforeExact.get(key) ?? [];
    const afterGroup = afterExact.get(key) ?? [];
    if (beforeGroup.length > 1 || afterGroup.length > 1) {
      addAmbiguity(input.ambiguityByKey, {
        kind: 'endpoint_exact_key',
        side:
          beforeGroup.length > 1 && afterGroup.length > 1
            ? 'both'
            : beforeGroup.length > 1
              ? 'before'
              : 'after',
        recordKind: 'endpoint',
        key: (beforeGroup[0] ?? afterGroup[0])!.exactKey!,
        beforeCandidateIds: endpointIds(beforeGroup),
        afterCandidateIds: endpointIds(afterGroup),
      });
      for (const endpoint of [...beforeGroup, ...afterGroup])
        blockedEndpointIds.add(endpoint.endpointId);
    } else if (beforeGroup.length === 1 && afterGroup.length === 1) {
      const beforeEndpoint = beforeGroup[0]!;
      const afterEndpoint = afterGroup[0]!;
      usedBefore.add(beforeEndpoint.endpointId);
      usedAfter.add(afterEndpoint.endpointId);
      matched.push([beforeEndpoint, afterEndpoint]);
    }
  }

  const beforeRemaining = beforeAvailable.filter(
    ({ endpointId }) => !usedBefore.has(endpointId) && !blockedEndpointIds.has(endpointId),
  );
  const afterRemaining = afterAvailable.filter(
    ({ endpointId }) => !usedAfter.has(endpointId) && !blockedEndpointIds.has(endpointId),
  );
  const beforeRemainingRoutes = groupsByKey(beforeRemaining, ({ routeSlotKey }) => routeSlotKey);
  const afterRemainingRoutes = groupsByKey(afterRemaining, ({ routeSlotKey }) => routeSlotKey);
  for (const key of [...beforeRemainingRoutes.keys()].sort(compareStrings)) {
    const beforeGroup = beforeRemainingRoutes.get(key) ?? [];
    const afterGroup = afterRemainingRoutes.get(key) ?? [];
    if (beforeGroup.length !== 1 || afterGroup.length !== 1) continue;
    const beforeEndpoint = beforeGroup[0]!;
    const afterEndpoint = afterGroup[0]!;
    usedBefore.add(beforeEndpoint.endpointId);
    usedAfter.add(afterEndpoint.endpointId);
    matched.push([beforeEndpoint, afterEndpoint]);
  }

  const changes: EndpointChange[] = [];
  for (const [beforeEndpoint, afterEndpoint] of matched) {
    const reasons = endpointModificationReasons(beforeEndpoint, afterEndpoint);
    if (reasons.length === 0) continue;
    changes.push({
      change: 'modified',
      routeSlotKey: beforeEndpoint.routeSlotKey,
      reasons,
      before: beforeEndpoint,
      after: afterEndpoint,
    });
  }
  for (const endpoint of input.before.endpoints) {
    if (usedBefore.has(endpoint.endpointId)) continue;
    changes.push({
      change: 'removed',
      routeSlotKey: endpoint.routeSlotKey,
      reasons: ['endpoint_removed'],
      before: endpoint,
      after: null,
    });
  }
  for (const endpoint of input.after.endpoints) {
    if (usedAfter.has(endpoint.endpointId)) continue;
    changes.push({
      change: 'added',
      routeSlotKey: endpoint.routeSlotKey,
      reasons: ['endpoint_added'],
      before: null,
      after: endpoint,
    });
  }

  return changes.sort((left, right) =>
    `${left.routeSlotKey.encoded}:${left.change}:${left.before?.endpointId ?? ''}:${left.after?.endpointId ?? ''}`.localeCompare(
      `${right.routeSlotKey.encoded}:${right.change}:${right.before?.endpointId ?? ''}:${right.after?.endpointId ?? ''}`,
    ),
  );
}

function assertionIds(assertions: readonly AssertionSnapshot[]): string[] {
  return assertions.map(({ assertionId }) => assertionId).sort(compareStrings);
}

function compareAssertions(input: {
  before: AnalysisSemanticProjection;
  after: AnalysisSemanticProjection;
  ambiguityByKey: Map<string, DiffAmbiguity>;
}): AssertionStatusChange[] {
  const beforeGroups = groupsByKey(input.before.assertions, ({ key }) => key);
  const afterGroups = groupsByKey(input.after.assertions, ({ key }) => key);
  const changes: AssertionStatusChange[] = [];
  for (const key of [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort(
    compareStrings,
  )) {
    const beforeGroup = beforeGroups.get(key) ?? [];
    const afterGroup = afterGroups.get(key) ?? [];
    if (beforeGroup.length > 1 || afterGroup.length > 1) {
      addAmbiguity(input.ambiguityByKey, {
        kind: 'assertion_key',
        side:
          beforeGroup.length > 1 && afterGroup.length > 1
            ? 'both'
            : beforeGroup.length > 1
              ? 'before'
              : 'after',
        recordKind: 'assertion',
        key: (beforeGroup[0] ?? afterGroup[0])!.key,
        beforeCandidateIds: assertionIds(beforeGroup),
        afterCandidateIds: assertionIds(afterGroup),
      });
    } else if (
      beforeGroup.length === 1 &&
      afterGroup.length === 1 &&
      beforeGroup[0]!.status !== afterGroup[0]!.status
    ) {
      changes.push({ key: beforeGroup[0]!.key, before: beforeGroup[0]!, after: afterGroup[0]! });
    }
  }
  return changes.sort((left, right) => compareSemanticKeys(left.key, right.key));
}

function diagnosticIds(diagnostics: readonly DiagnosticSnapshot[]): string[] {
  return diagnostics.map(({ diagnosticId }) => diagnosticId).sort(compareStrings);
}

function diagnosticReasons(
  before: DiagnosticSnapshot,
  after: DiagnosticSnapshot,
): DiagnosticChangeReason[] {
  const reasons: DiagnosticChangeReason[] = [];
  if (before.severity !== after.severity) reasons.push('severity');
  if (before.message !== after.message) reasons.push('message');
  if (
    canonicalStringify(before.evidenceKeys.map(({ encoded }) => encoded)) !==
    canonicalStringify(after.evidenceKeys.map(({ encoded }) => encoded))
  ) {
    reasons.push('evidence');
  }
  return reasons;
}

function compareDiagnostics(input: {
  before: AnalysisSemanticProjection;
  after: AnalysisSemanticProjection;
  ambiguityByKey: Map<string, DiffAmbiguity>;
}): DiagnosticChange[] {
  const beforeGroups = groupsByKey(input.before.diagnostics, ({ key }) => key);
  const afterGroups = groupsByKey(input.after.diagnostics, ({ key }) => key);
  const changes: DiagnosticChange[] = [];
  for (const key of [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort(
    compareStrings,
  )) {
    const beforeGroup = beforeGroups.get(key) ?? [];
    const afterGroup = afterGroups.get(key) ?? [];
    if (beforeGroup.length > 1 || afterGroup.length > 1) {
      addAmbiguity(input.ambiguityByKey, {
        kind: 'diagnostic_key',
        side:
          beforeGroup.length > 1 && afterGroup.length > 1
            ? 'both'
            : beforeGroup.length > 1
              ? 'before'
              : 'after',
        recordKind: 'diagnostic',
        key: (beforeGroup[0] ?? afterGroup[0])!.key,
        beforeCandidateIds: diagnosticIds(beforeGroup),
        afterCandidateIds: diagnosticIds(afterGroup),
      });
      continue;
    }
    if (beforeGroup.length === 0) {
      changes.push({
        change: 'new',
        key: afterGroup[0]!.key,
        reasons: ['diagnostic_added'],
        before: null,
        after: afterGroup[0]!,
      });
      continue;
    }
    if (afterGroup.length === 0) {
      changes.push({
        change: 'resolved',
        key: beforeGroup[0]!.key,
        reasons: ['diagnostic_resolved'],
        before: beforeGroup[0]!,
        after: null,
      });
      continue;
    }
    const reasons = diagnosticReasons(beforeGroup[0]!, afterGroup[0]!);
    if (reasons.length > 0) {
      changes.push({
        change: 'changed',
        key: beforeGroup[0]!.key,
        reasons,
        before: beforeGroup[0]!,
        after: afterGroup[0]!,
      });
    }
  }
  return changes.sort((left, right) =>
    `${left.key.encoded}:${left.change}`.localeCompare(`${right.key.encoded}:${right.change}`),
  );
}

function compareInteractionSnapshots(input: {
  before: AnalysisSemanticProjection;
  after: AnalysisSemanticProjection;
  ambiguityByKey: Map<string, DiffAmbiguity>;
}): InteractionChange[] {
  const beforeGroups = groupsByKey(input.before.interactions, ({ key }) => key);
  const afterGroups = groupsByKey(input.after.interactions, ({ key }) => key);
  const changes: InteractionChange[] = [];
  for (const key of [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort(
    compareStrings,
  )) {
    const beforeGroup = beforeGroups.get(key) ?? [];
    const afterGroup = afterGroups.get(key) ?? [];
    if (beforeGroup.length > 1 || afterGroup.length > 1) {
      addAmbiguity(input.ambiguityByKey, {
        kind: 'semantic_key',
        side:
          beforeGroup.length > 1 && afterGroup.length > 1
            ? 'both'
            : beforeGroup.length > 1
              ? 'before'
              : 'after',
        recordKind: 'interaction',
        key: (beforeGroup[0] ?? afterGroup[0])!.key,
        beforeCandidateIds: beforeGroup.map(({ interactionId }) => interactionId),
        afterCandidateIds: afterGroup.map(({ interactionId }) => interactionId),
      });
      continue;
    }
    if (beforeGroup.length === 0) {
      changes.push({
        change: 'added',
        key: afterGroup[0]!.key,
        reasons: ['interaction_added'],
        before: null,
        after: afterGroup[0]!,
      });
      continue;
    }
    if (afterGroup.length === 0) {
      changes.push({
        change: 'removed',
        key: beforeGroup[0]!.key,
        reasons: ['interaction_removed'],
        before: beforeGroup[0]!,
        after: null,
      });
      continue;
    }
    const before = beforeGroup[0]!;
    const after = afterGroup[0]!;
    const reasons: InteractionChangeReason[] = [];
    if (before.activation !== after.activation) reasons.push('activation');
    if (before.boundary !== after.boundary) reasons.push('boundary');
    if (before.dispatchTiming !== after.dispatchTiming) reasons.push('dispatch_timing');
    if (before.ruleId !== after.ruleId) reasons.push('rule');
    if (reasons.length > 0) {
      changes.push({ change: 'modified', key: before.key, reasons, before, after });
    }
  }
  return changes.sort((left, right) =>
    `${left.key.encoded}:${left.change}`.localeCompare(`${right.key.encoded}:${right.change}`),
  );
}

function compareInteractionHandlerSnapshots(input: {
  before: AnalysisSemanticProjection;
  after: AnalysisSemanticProjection;
  ambiguityByKey: Map<string, DiffAmbiguity>;
}): InteractionHandlerChange[] {
  const beforeGroups = groupsByKey(input.before.interactionHandlers, ({ key }) => key);
  const afterGroups = groupsByKey(input.after.interactionHandlers, ({ key }) => key);
  const changes: InteractionHandlerChange[] = [];
  for (const key of [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort(
    compareStrings,
  )) {
    const beforeGroup = beforeGroups.get(key) ?? [];
    const afterGroup = afterGroups.get(key) ?? [];
    if (beforeGroup.length > 1 || afterGroup.length > 1) {
      addAmbiguity(input.ambiguityByKey, {
        kind: 'semantic_key',
        side:
          beforeGroup.length > 1 && afterGroup.length > 1
            ? 'both'
            : beforeGroup.length > 1
              ? 'before'
              : 'after',
        recordKind: 'interaction_handler',
        key: (beforeGroup[0] ?? afterGroup[0])!.key,
        beforeCandidateIds: beforeGroup.map(({ handlerId }) => handlerId),
        afterCandidateIds: afterGroup.map(({ handlerId }) => handlerId),
      });
      continue;
    }
    if (beforeGroup.length === 0) {
      changes.push({
        change: 'added',
        key: afterGroup[0]!.key,
        reasons: ['handler_added'],
        before: null,
        after: afterGroup[0]!,
      });
      continue;
    }
    if (afterGroup.length === 0) {
      changes.push({
        change: 'removed',
        key: beforeGroup[0]!.key,
        reasons: ['handler_removed'],
        before: beforeGroup[0]!,
        after: null,
      });
      continue;
    }
    const before: InteractionHandlerSnapshot = beforeGroup[0]!;
    const after: InteractionHandlerSnapshot = afterGroup[0]!;
    const reasons: InteractionHandlerChangeReason[] = [];
    if (before.registrationState !== after.registrationState) reasons.push('registration_state');
    if (before.ruleId !== after.ruleId) reasons.push('rule');
    if (reasons.length > 0) {
      changes.push({ change: 'modified', key: before.key, reasons, before, after });
    }
  }
  return changes.sort((left, right) =>
    `${left.key.encoded}:${left.change}`.localeCompare(`${right.key.encoded}:${right.change}`),
  );
}

export function compareAnalysisDocuments(
  beforeAnalysis: AnalysisDocument,
  afterAnalysis: AnalysisDocument,
): DiffDocument {
  const before = buildAnalysisSemanticProjection(beforeAnalysis);
  const after = buildAnalysisSemanticProjection(afterAnalysis);
  const ambiguityByKey = new Map<string, DiffAmbiguity>();
  addProjectionCollisions(ambiguityByKey, before.collisions, after.collisions);

  const endpointChanges = compareEndpoints({ before, after, ambiguityByKey });
  const assertionStatusChanges = compareAssertions({ before, after, ambiguityByKey });
  const diagnosticChanges = compareDiagnostics({ before, after, ambiguityByKey });
  const interactionChanges = compareInteractionSnapshots({ before, after, ambiguityByKey });
  const interactionHandlerChanges = compareInteractionHandlerSnapshots({
    before,
    after,
    ambiguityByKey,
  });
  const ambiguities = [...ambiguityByKey.values()].sort((left, right) =>
    `${left.kind}:${left.recordKind}:${left.key.encoded}`.localeCompare(
      `${right.kind}:${right.recordKind}:${right.key.encoded}`,
    ),
  );

  const v2 = beforeAnalysis.schemaVersion === '3.0.0' || afterAnalysis.schemaVersion === '3.0.0';
  return assertValidDiffDocument({
    schemaVersion: v2 ? DIFF_SCHEMA_V2_VERSION : DIFF_SCHEMA_VERSION,
    before: before.input,
    after: after.input,
    summary: {
      endpointsAdded: endpointChanges.filter(({ change }) => change === 'added').length,
      endpointsRemoved: endpointChanges.filter(({ change }) => change === 'removed').length,
      endpointsModified: endpointChanges.filter(({ change }) => change === 'modified').length,
      assertionStatusChanged: assertionStatusChanges.length,
      diagnosticsNew: diagnosticChanges.filter(({ change }) => change === 'new').length,
      diagnosticsResolved: diagnosticChanges.filter(({ change }) => change === 'resolved').length,
      diagnosticsChanged: diagnosticChanges.filter(({ change }) => change === 'changed').length,
      ambiguities: ambiguities.length,
      ...(v2
        ? {
            interactionsAdded: interactionChanges.filter(({ change }) => change === 'added').length,
            interactionsRemoved: interactionChanges.filter(({ change }) => change === 'removed')
              .length,
            interactionsModified: interactionChanges.filter(({ change }) => change === 'modified')
              .length,
            interactionHandlersAdded: interactionHandlerChanges.filter(
              ({ change }) => change === 'added',
            ).length,
            interactionHandlersRemoved: interactionHandlerChanges.filter(
              ({ change }) => change === 'removed',
            ).length,
            interactionHandlersModified: interactionHandlerChanges.filter(
              ({ change }) => change === 'modified',
            ).length,
          }
        : {}),
    },
    endpointChanges,
    assertionStatusChanges,
    diagnosticChanges,
    ...(v2 ? { interactionChanges, interactionHandlerChanges } : {}),
    ambiguities,
  });
}
