import { describe, expect, it } from 'vitest';
import { normalizeAnalysisDocument } from '../../../src/analysis/normalize-document.js';
import { buildAnalysisSemanticProjection } from '../../../src/comparison/projection.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import {
  makeApplicationId,
  makeAssertionId,
  makeInteractionId,
  makeInteractionHandlerId,
  makeModuleId,
} from '../../../src/model/ids.js';
import {
  inProcessEventTargetsMatch,
  INTERACTION_KINDS,
  interactionTargetKey,
  validInProcessEventPattern,
} from '../../../src/model/interactions.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { analysisDocumentSchema } from '../../../src/model/schemas.js';
import { buildInteractionAssertionIndexes } from '../../../src/tracing/interaction-indexes.js';
import {
  createMinimalAnalysisDocument,
  createMinimalAnalysisDocumentV2,
  createMinimalAnalysisDocumentV3,
  createMinimalAnalysisDocumentV4,
} from '../../helpers/minimal-analysis.js';

function withOutboundInteraction() {
  const analysis = createMinimalAnalysisDocumentV3();
  const method = analysis.methods[0]!;
  const evidenceIds = [analysis.evidence[2]!.id, analysis.evidence[1]!.id];
  const target = {
    targetKind: 'http' as const,
    method: 'GET' as const,
    url: { resolution: 'exact' as const, value: 'https://example.test/health' },
    queryKeys: ['z', 'a'],
  };
  const interactionId = makeInteractionId({
    kind: 'outbound_http',
    sourceMethodId: method.id,
    targetKey: interactionTargetKey(target),
    applicationId: null,
    initiationEvidenceId: evidenceIds[0]!,
  });
  const assertionId = makeAssertionId({
    subjectId: method.id,
    predicate: 'METHOD_INITIATES_INTERACTION',
    objectId: interactionId,
    ruleId: 'phase30.fixture.http.v1',
  });
  return {
    ...analysis,
    interactions: [
      {
        id: interactionId,
        kind: 'outbound_http' as const,
        sourceMethodId: method.id,
        applicationId: null,
        direction: 'outbound' as const,
        activation: 'eager' as const,
        boundary: 'external_or_unobserved' as const,
        dispatchTiming: 'asynchronous' as const,
        target,
        ruleId: 'phase30.fixture.http.v1',
        evidenceIds,
      },
    ],
    assertions: [
      ...analysis.assertions,
      {
        id: assertionId,
        subjectId: method.id,
        predicate: 'METHOD_INITIATES_INTERACTION' as const,
        objectId: interactionId,
        status: 'resolved' as const,
        ruleId: 'phase30.fixture.http.v1',
        evidenceIds,
      },
    ],
    interactionAnalysis: {
      ...analysis.interactionAnalysis,
      supportedKinds: ['outbound_http'] as const,
      enabledKinds: ['outbound_http'] as const,
      state: 'complete' as const,
    },
  };
}

describe('analysis v3 interaction substrate', () => {
  it('matches configured EventEmitter2 namespace wildcards without regex inference', () => {
    const event = (value: string) => ({
      targetKind: 'event' as const,
      identityKind: 'string' as const,
      value,
    });
    const pattern = (value: string, delimiter = '.') => ({
      ...event(value),
      pattern: { kind: 'wildcard' as const, delimiter },
    });

    expect(inProcessEventTargetsMatch(event('order.created'), pattern('order.*'))).toBe(true);
    expect(inProcessEventTargetsMatch(event('order.item.created'), pattern('order.*'))).toBe(false);
    expect(inProcessEventTargetsMatch(event('order'), pattern('order.**'))).toBe(true);
    expect(inProcessEventTargetsMatch(event('order.item.created'), pattern('order.**'))).toBe(true);
    expect(inProcessEventTargetsMatch(event('order::created'), pattern('order::*', '::'))).toBe(
      true,
    );
    expect(validInProcessEventPattern('order.cre*', '.')).toBe(false);
    expect(validInProcessEventPattern('order.*', '')).toBe(false);
  });

  it('keeps older fact families unavailable instead of inventing empty collections', () => {
    const v1 = normalizeAnalysisDocument(createMinimalAnalysisDocument());
    const v2 = normalizeAnalysisDocument(createMinimalAnalysisDocumentV2());
    const v3 = normalizeAnalysisDocument(createMinimalAnalysisDocumentV3());
    const v4 = normalizeAnalysisDocument(createMinimalAnalysisDocumentV4());

    expect(v1.facts).toEqual({
      v2Families: 'unavailable',
      interactionFamilies: 'unavailable',
      jobQueueBranchFamilies: 'unavailable',
      authorizationFamilies: 'unavailable',
      resourceAccessFamilies: 'unavailable',
      criticalSectionFamilies: 'unavailable',
    });
    expect(v1.v2).toBeNull();
    expect(v2.facts).toEqual({
      v2Families: 'available',
      interactionFamilies: 'unavailable',
      jobQueueBranchFamilies: 'unavailable',
      authorizationFamilies: 'unavailable',
      resourceAccessFamilies: 'unavailable',
      criticalSectionFamilies: 'unavailable',
    });
    expect(v2.v3).toBeNull();
    expect(v3.facts).toEqual({
      v2Families: 'available',
      interactionFamilies: 'available',
      jobQueueBranchFamilies: 'unavailable',
      authorizationFamilies: 'unavailable',
      resourceAccessFamilies: 'unavailable',
      criticalSectionFamilies: 'unavailable',
    });
    expect(v3.v3?.interactions).toEqual([]);
    expect(v4.facts).toEqual({
      v2Families: 'available',
      interactionFamilies: 'available',
      jobQueueBranchFamilies: 'available',
      authorizationFamilies: 'unavailable',
      resourceAccessFamilies: 'unavailable',
      criticalSectionFamilies: 'unavailable',
    });
    expect(v4.v4?.interactionHandlerBranches).toEqual([]);
  });

  it('accepts a linked outbound interaction and builds generic deterministic adjacency', () => {
    const analysis = withOutboundInteraction();
    const validated = validateAnalysisDocument(analysis);
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const indexes = buildInteractionAssertionIndexes(validated.data);
    expect(indexes.initiatedByMethod.get(analysis.methods[0]!.id)).toHaveLength(1);
    expect(indexes.handlersByInteraction.size).toBe(0);
    expect(indexes.implementationByHandler.size).toBe(0);

    const projection = buildAnalysisSemanticProjection(validated.data);
    expect(projection.semanticKeyById.get(analysis.interactions[0]!.id)?.kind).toBe('interaction');
    expect(
      projection.assertions.some(({ predicate }) => predicate === 'METHOD_INITIATES_INTERACTION'),
    ).toBe(true);

    const shuffled = {
      ...analysis,
      interactions: [
        {
          ...analysis.interactions[0]!,
          evidenceIds: analysis.interactions[0]!.evidenceIds.toReversed(),
          target: {
            ...analysis.interactions[0]!.target,
            queryKeys: analysis.interactions[0]!.target.queryKeys.toReversed(),
          },
        },
      ],
    };
    expect(serializeCanonicalAnalysis(shuffled)).toBe(serializeCanonicalAnalysis(analysis));
  });

  it('rejects malformed target unions, false capabilities, and missing linkage', () => {
    const analysis = withOutboundInteraction();
    expect(
      analysisDocumentSchema.safeParse({
        ...analysis,
        interactions: [
          {
            ...analysis.interactions[0]!,
            target: { ...analysis.interactions[0]!.target, invented: true },
          },
        ],
      }).success,
    ).toBe(false);

    const falseCapability = validateAnalysisDocument({
      ...createMinimalAnalysisDocumentV3(),
      interactionAnalysis: {
        schemaKinds: [...INTERACTION_KINDS],
        supportedKinds: [],
        enabledKinds: ['job_queue'],
        state: 'complete',
      },
    });
    expect(falseCapability.success).toBe(false);
    if (!falseCapability.success) {
      expect(falseCapability.issues.map(({ code }) => code)).toContain(
        'INTERACTION_CAPABILITY_MISMATCH',
      );
    }

    const missingLink = validateAnalysisDocument({
      ...analysis,
      assertions: analysis.assertions.slice(0, 1),
    });
    expect(missingLink.success).toBe(false);
    if (!missingLink.success) {
      expect(missingLink.issues.map(({ code }) => code)).toContain(
        'INTERACTION_ASSERTION_MISMATCH',
      );
    }
  });

  it('validates application roots and independently inventoried local handlers', () => {
    const analysis = createMinimalAnalysisDocumentV3();
    const sourceClass = { ...analysis.classes[0]!, roles: ['controller', 'module'] as const };
    const moduleId = makeModuleId(sourceClass.id);
    const evidenceId = analysis.evidence[2]!.id;
    const applicationId = makeApplicationId({
      kind: 'http',
      rootModuleId: moduleId,
      bootstrapEvidenceId: evidenceId,
    });
    const target = {
      targetKind: 'event' as const,
      identityKind: 'string' as const,
      value: 'health.checked',
    };
    const interactionId = makeInteractionId({
      kind: 'in_process_event',
      sourceMethodId: analysis.methods[0]!.id,
      targetKey: interactionTargetKey(target),
      applicationId,
      initiationEvidenceId: evidenceId,
    });
    const handlerId = makeInteractionHandlerId({
      kind: 'in_process_event',
      methodId: analysis.methods[0]!.id,
      targetKey: interactionTargetKey(target),
      applicationId,
      handlerEvidenceId: evidenceId,
    });
    const assertion = (
      subjectId: string,
      predicate:
        | 'APPLICATION_USES_ROOT_MODULE'
        | 'METHOD_INITIATES_INTERACTION'
        | 'INTERACTION_MATCHES_LOCAL_HANDLER'
        | 'HANDLER_IMPLEMENTED_BY',
      objectId: string,
    ) => ({
      id: makeAssertionId({ subjectId, predicate, objectId, ruleId: 'phase30.fixture.event.v1' }),
      subjectId,
      predicate,
      objectId,
      status: 'resolved' as const,
      ruleId: 'phase30.fixture.event.v1',
      evidenceIds: [evidenceId],
    });
    const expanded = {
      ...analysis,
      classes: [sourceClass],
      modules: [
        {
          id: moduleId,
          classId: sourceClass.id,
          isGlobal: false,
          metadataCompleteness: 'complete' as const,
          declarationEvidenceId: sourceClass.declarationEvidenceId,
        },
      ],
      applications: [
        {
          id: applicationId,
          kind: 'http' as const,
          rootModuleId: moduleId,
          rootResolution: 'resolved' as const,
          transportState: 'not_applicable' as const,
          transport: null,
          bootstrapEvidenceId: evidenceId,
        },
      ],
      interactions: [
        {
          id: interactionId,
          kind: 'in_process_event' as const,
          sourceMethodId: analysis.methods[0]!.id,
          applicationId,
          direction: 'outbound' as const,
          activation: 'eager' as const,
          boundary: 'in_process' as const,
          dispatchTiming: 'synchronous' as const,
          target,
          ruleId: 'phase30.fixture.event.v1',
          evidenceIds: [evidenceId],
        },
      ],
      interactionHandlers: [
        {
          id: handlerId,
          kind: 'in_process_event' as const,
          methodId: analysis.methods[0]!.id,
          applicationId,
          registrationState: 'proven_registered' as const,
          target,
          ruleId: 'phase30.fixture.event.v1',
          handlerEvidenceId: evidenceId,
        },
      ],
      assertions: [
        ...analysis.assertions,
        assertion(applicationId, 'APPLICATION_USES_ROOT_MODULE', moduleId),
        assertion(analysis.methods[0]!.id, 'METHOD_INITIATES_INTERACTION', interactionId),
        assertion(interactionId, 'INTERACTION_MATCHES_LOCAL_HANDLER', handlerId),
        assertion(handlerId, 'HANDLER_IMPLEMENTED_BY', analysis.methods[0]!.id),
      ],
      interactionAnalysis: {
        ...analysis.interactionAnalysis,
        supportedKinds: ['in_process_event'] as const,
        enabledKinds: ['in_process_event'] as const,
        state: 'complete' as const,
      },
    };

    expect(validateAnalysisDocument(expanded).success).toBe(true);
    const brokenRoot = validateAnalysisDocument({
      ...expanded,
      applications: [{ ...expanded.applications[0]!, rootResolution: 'unknown' }],
    });
    expect(brokenRoot.success).toBe(false);
    if (!brokenRoot.success) {
      expect(brokenRoot.issues.map(({ code }) => code)).toContain('APPLICATION_STATE_MISMATCH');
    }

    const unsupportedImplementation = validateAnalysisDocument({
      ...expanded,
      assertions: expanded.assertions.map((candidate) =>
        candidate.predicate === 'HANDLER_IMPLEMENTED_BY'
          ? { ...candidate, status: 'unsupported' as const }
          : candidate,
      ),
    });
    expect(unsupportedImplementation.success).toBe(false);
    if (!unsupportedImplementation.success) {
      expect(unsupportedImplementation.issues.map(({ code }) => code)).toContain(
        'INTERACTION_ASSERTION_MISMATCH',
      );
    }

    const mismatchedTarget = validateAnalysisDocument({
      ...expanded,
      interactionHandlers: [
        {
          ...expanded.interactionHandlers[0]!,
          target: {
            targetKind: 'event' as const,
            identityKind: 'string' as const,
            value: 'health.different',
          },
        },
      ],
    });
    expect(mismatchedTarget.success).toBe(false);
    if (!mismatchedTarget.success) {
      expect(mismatchedTarget.issues.map(({ code }) => code)).toContain(
        'INTERACTION_ASSERTION_MISMATCH',
      );
    }
  });
});
