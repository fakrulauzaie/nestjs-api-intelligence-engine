import { describe, expect, it } from 'vitest';
import type {
  AnalysisDocument,
  AnalysisDocumentV2,
  AssertionStatus,
  DiagnosticRecord,
} from '../../../src/model/index.js';
import {
  createStableId,
  makeAssertionId,
  makeInteractionHandlerId,
  makeInteractionId,
} from '../../../src/model/ids.js';
import { interactionTargetKey } from '../../../src/model/interactions.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import type { PolicyRuleId } from '../../../src/policy/model.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';
import {
  createMinimalAnalysisDocument,
  createMinimalAnalysisDocumentV3,
} from '../../helpers/minimal-analysis.js';

function configuration(ruleId: PolicyRuleId) {
  return normalizePolicyConfiguration({
    version: 1,
    rules: {
      [ruleId]:
        ruleId === 'no-new-diagnostics'
          ? ['error', { minimumSeverity: 'warning', onUnknown: 'error' }]
          : ['error', { onUnknown: 'error' }],
    },
  });
}

function withWrite(status: AssertionStatus): AnalysisDocumentV2 {
  const base = createMinimalAnalysisDocument();
  const method = base.methods[0]!;
  const tableId = createStableId('table', ['policy-note']);
  return {
    ...base,
    schemaVersion: '2.0.0',
    resultState: status === 'resolved' ? 'completed' : 'completed_with_gaps',
    tables: [
      {
        id: tableId,
        name: 'policy_note',
        nameSource: 'explicit',
      },
    ],
    assertions: [
      ...base.assertions,
      {
        id: createStableId('assertion', ['policy-write', status]),
        subjectId: method.id,
        predicate: 'METHOD_WRITES_TABLE',
        objectId: tableId,
        status,
        ruleId: 'typeorm.repository.save.v1',
        evidenceIds: [method.declarationEvidenceId],
      },
    ],
    modules: [],
    globalGuardRegistrations: [],
    contractTypes: [],
    contractFields: [],
    requestParameters: [],
    responseContracts: [],
    entityColumns: [],
    requestFieldOrigins: [],
    columnInfluences: [],
    globalGuardAnalysis: {
      completeness: 'complete',
      state: 'none_proven',
    },
  };
}

function withGap(analysis: AnalysisDocument): AnalysisDocument {
  const method = analysis.methods[0]!;
  const diagnostic: DiagnosticRecord = {
    id: createStableId('diagnostic', ['policy-call-gap']),
    code: 'CALL_TARGET_UNRESOLVED',
    severity: 'warning',
    message: 'A persistence-relevant call target is unresolved.',
    subjectId: method.id,
    evidenceIds: [method.declarationEvidenceId],
  };
  return { ...analysis, resultState: 'completed_with_gaps', diagnostics: [diagnostic] };
}

function outcome(ruleId: PolicyRuleId, analysis: AnalysisDocument, baseline?: AnalysisDocument) {
  return evaluatePolicies({
    analysis,
    configuration: configuration(ruleId),
    ...(baseline === undefined ? {} : { baseline }),
  }).results.map((result) => result.outcome);
}

describe('Phase 16 built-in policy rules', () => {
  it('reports every outcome for direct controller repository access', () => {
    expect(outcome('no-repository-access-in-controller', withWrite('resolved'))).toEqual(['fail']);
    expect(outcome('no-repository-access-in-controller', withWrite('ambiguous'))).toEqual([
      'unknown',
    ]);
    expect(outcome('no-repository-access-in-controller', createMinimalAnalysisDocument())).toEqual([
      'pass',
    ]);
    const downstream = withWrite('resolved');
    const controllerMethod = downstream.methods[0]!;
    const providerClassId = createStableId('class', ['policy-provider']);
    const providerMethodId = createStableId('method', ['policy-provider-write']);
    const movedWrite = downstream.assertions.find(
      ({ predicate }) => predicate === 'METHOD_WRITES_TABLE',
    )!;
    expect(
      outcome('no-repository-access-in-controller', {
        ...downstream,
        classes: [
          ...downstream.classes,
          {
            id: providerClassId,
            sourceFileId: downstream.sourceFiles[0]!.id,
            qualifiedName: 'PolicyService',
            displayName: 'PolicyService',
            roles: ['provider'],
            declarationEvidenceId: downstream.classes[0]!.declarationEvidenceId,
          },
        ],
        methods: [
          ...downstream.methods,
          {
            id: providerMethodId,
            classId: providerClassId,
            qualifiedName: 'PolicyService.write',
            displayName: 'write',
            signature: 'write(): void',
            declarationEvidenceId: controllerMethod.declarationEvidenceId,
          },
        ],
        assertions: [
          ...downstream.assertions.filter(({ id }) => id !== movedWrite.id),
          { ...movedWrite, subjectId: providerMethodId },
          {
            id: createStableId('assertion', ['policy-controller-service-call']),
            subjectId: controllerMethod.id,
            predicate: 'METHOD_CALLS_METHOD',
            objectId: providerMethodId,
            status: 'resolved',
            ruleId: 'nest.call.injected-member.v1',
            evidenceIds: [controllerMethod.declarationEvidenceId],
          },
        ],
      }),
    ).toEqual(['pass']);
    const noController = createMinimalAnalysisDocument();
    expect(
      outcome('no-repository-access-in-controller', {
        ...noController,
        classes: noController.classes.map((value) => ({ ...value, roles: ['provider'] })),
      }),
    ).toEqual(['not_applicable']);
  });

  it('reports every outcome for guards on proven write endpoints', () => {
    expect(outcome('require-guard-on-write-endpoint', withWrite('resolved'))).toEqual(['fail']);

    const guarded = withWrite('resolved');
    const sourceClass = guarded.classes[0]!;
    const endpoint = guarded.endpoints[0]!;
    const guardId = createStableId('guard', ['policy-guard']);
    expect(
      outcome('require-guard-on-write-endpoint', {
        ...guarded,
        classes: guarded.classes.map((value) => ({
          ...value,
          roles: value.id === sourceClass.id ? ['controller', 'guard'] : value.roles,
        })),
        guards: [{ id: guardId, classId: sourceClass.id, displayName: 'PolicyGuard' }],
        assertions: [
          ...guarded.assertions,
          {
            id: createStableId('assertion', ['policy-guard-assertion']),
            subjectId: endpoint.id,
            predicate: 'ENDPOINT_USES_GUARD',
            objectId: guardId,
            status: 'resolved',
            ruleId: 'nest.guard.method.v1',
            evidenceIds: [sourceClass.declarationEvidenceId],
          },
        ],
      }),
    ).toEqual(['pass']);

    const unknownGlobal = withWrite('resolved');
    expect(
      outcome('require-guard-on-write-endpoint', {
        ...unknownGlobal,
        globalGuardAnalysis: { completeness: 'incomplete', state: 'unknown' },
      }),
    ).toEqual(['unknown']);
    expect(outcome('require-guard-on-write-endpoint', createMinimalAnalysisDocument())).toEqual([
      'not_applicable',
    ]);
  });

  it('reports every outcome for complete write traces', () => {
    expect(outcome('require-complete-write-trace', withWrite('resolved'))).toEqual(['pass']);
    expect(outcome('require-complete-write-trace', withGap(withWrite('resolved')))).toEqual([
      'fail',
    ]);
    expect(outcome('require-complete-write-trace', withWrite('ambiguous'))).toEqual(['unknown']);
    expect(outcome('require-complete-write-trace', createMinimalAnalysisDocument())).toEqual([
      'not_applicable',
    ]);
  });

  it('reports every outcome for baseline diagnostic policy', () => {
    const minimal = createMinimalAnalysisDocument();
    expect(outcome('no-new-diagnostics', minimal, minimal)).toEqual(['pass']);
    expect(
      outcome(
        'no-new-diagnostics',
        createComparisonAnalysisSnapshot('after'),
        createComparisonAnalysisSnapshot('before'),
      ),
    ).toEqual(['fail']);

    const duplicateDiagnostic = (identity: string): DiagnosticRecord => ({
      id: createStableId('diagnostic', [identity]),
      code: 'CALL_TARGET_UNRESOLVED',
      severity: 'warning',
      message: 'Duplicate semantic diagnostic.',
      evidenceIds: [],
    });
    expect(
      outcome(
        'no-new-diagnostics',
        {
          ...minimal,
          resultState: 'completed_with_gaps',
          diagnostics: [duplicateDiagnostic('one'), duplicateDiagnostic('two')],
        },
        minimal,
      ),
    ).toEqual(['unknown']);
    expect(outcome('no-new-diagnostics', minimal)).toEqual(['not_applicable']);
  });

  it('uses onUnknown severity without converting the outcome to a failure', () => {
    const results = evaluatePolicies({
      analysis: withWrite('ambiguous'),
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: {
          'require-guard-on-write-endpoint': ['warn', { onUnknown: 'error' }],
        },
      }),
    });
    expect(results.results[0]).toMatchObject({
      outcome: 'unknown',
      severity: 'error',
      blocking: true,
    });
  });

  it('evaluates only canonical interaction target and activation evidence', () => {
    const base = createMinimalAnalysisDocumentV3();
    const sourceMethodId = base.methods[0]!.id;
    const evidenceIds = [base.evidence[0]!.id];
    const staticTarget = {
      targetKind: 'http' as const,
      method: 'GET' as const,
      url: { resolution: 'exact' as const, value: 'https://example.test/health' },
      queryKeys: [],
    };
    const dynamicTarget = {
      targetKind: 'http' as const,
      method: 'UNKNOWN' as const,
      url: { resolution: 'dynamic' as const, value: null },
      queryKeys: [],
    };
    const coldTarget = {
      targetKind: 'message' as const,
      mode: 'request_response' as const,
      patternKind: 'scalar' as const,
      canonicalPattern: '"lookup"',
      clientToken: { resolution: 'exact' as const, value: 'LOOKUP_CLIENT' },
      transport: null,
    };
    const interactionId = (
      kind: 'outbound_http' | 'microservice_message',
      target: typeof staticTarget | typeof dynamicTarget | typeof coldTarget,
    ) =>
      makeInteractionId({
        kind,
        sourceMethodId,
        targetKey: interactionTargetKey(target),
        applicationId: null,
        initiationEvidenceId: evidenceIds[0]!,
      });
    const staticId = interactionId('outbound_http', staticTarget);
    const dynamicId = interactionId('outbound_http', dynamicTarget);
    const coldId = interactionId('microservice_message', coldTarget);
    const initiation = (objectId: string, ruleId: string) => ({
      id: makeAssertionId({
        subjectId: sourceMethodId,
        predicate: 'METHOD_INITIATES_INTERACTION',
        objectId,
        ruleId,
      }),
      subjectId: sourceMethodId,
      predicate: 'METHOD_INITIATES_INTERACTION' as const,
      objectId,
      status: 'resolved' as const,
      ruleId,
      evidenceIds,
    });
    const analysis = {
      ...base,
      interactionAnalysis: {
        ...base.interactionAnalysis,
        supportedKinds: ['outbound_http', 'microservice_message'],
        enabledKinds: ['outbound_http', 'microservice_message'],
        state: 'complete',
      },
      interactions: [
        {
          id: staticId,
          sourceMethodId,
          applicationId: null,
          direction: 'outbound',
          kind: 'outbound_http',
          activation: 'eager',
          boundary: 'external_or_unobserved',
          dispatchTiming: 'asynchronous',
          target: staticTarget,
          ruleId: 'test.policy.http.v1',
          evidenceIds,
        },
        {
          id: dynamicId,
          sourceMethodId,
          applicationId: null,
          direction: 'outbound',
          kind: 'outbound_http',
          activation: 'unknown',
          boundary: 'external_or_unobserved',
          dispatchTiming: 'unknown',
          target: dynamicTarget,
          ruleId: 'test.policy.http.dynamic.v1',
          evidenceIds,
        },
        {
          id: coldId,
          sourceMethodId,
          applicationId: null,
          direction: 'outbound',
          kind: 'microservice_message',
          activation: 'constructed_cold',
          boundary: 'broker_or_worker_boundary',
          dispatchTiming: 'asynchronous',
          target: coldTarget,
          ruleId: 'test.policy.message.v1',
          evidenceIds,
        },
      ],
      assertions: [
        ...base.assertions,
        initiation(staticId, 'test.policy.http.v1'),
        initiation(dynamicId, 'test.policy.http.dynamic.v1'),
        initiation(coldId, 'test.policy.message.v1'),
      ],
    } satisfies AnalysisDocument;

    expect(outcome('forbid-dynamic-interaction-target', analysis)).toEqual([
      'unknown',
      'pass',
      'fail',
    ]);
    expect(outcome('require-proven-interaction-activation', analysis)).toEqual([
      'fail',
      'pass',
      'unknown',
    ]);
  });

  it('requires a local handler only for closed-world in-process events', () => {
    const base = createMinimalAnalysisDocumentV3();
    const sourceMethodId = base.methods[0]!.id;
    const evidenceId = base.evidence[0]!.id;
    const target = (value: string) => ({
      targetKind: 'event' as const,
      identityKind: 'string' as const,
      value,
    });
    const eventId = (value: string) =>
      makeInteractionId({
        kind: 'in_process_event',
        sourceMethodId,
        targetKey: interactionTargetKey(target(value)),
        applicationId: null,
        initiationEvidenceId: evidenceId,
      });
    const matchedId = eventId('order.created');
    const missingId = eventId('order.missing');
    const handlerId = makeInteractionHandlerId({
      kind: 'in_process_event',
      methodId: sourceMethodId,
      targetKey: interactionTargetKey(target('order.created')),
      applicationId: null,
      handlerEvidenceId: evidenceId,
    });
    const event = (id: string, value: string) => ({
      id,
      sourceMethodId,
      applicationId: null,
      direction: 'outbound' as const,
      kind: 'in_process_event' as const,
      activation: 'eager' as const,
      boundary: 'in_process' as const,
      dispatchTiming: 'asynchronous' as const,
      target: target(value),
      ruleId: 'test.policy.event.v1',
      evidenceIds: [evidenceId],
    });
    const analysis = {
      ...base,
      interactionAnalysis: {
        ...base.interactionAnalysis,
        supportedKinds: ['in_process_event'],
        enabledKinds: ['in_process_event'],
        state: 'complete',
      },
      interactions: [event(matchedId, 'order.created'), event(missingId, 'order.missing')],
      interactionHandlers: [
        {
          id: handlerId,
          methodId: sourceMethodId,
          applicationId: null,
          kind: 'in_process_event' as const,
          target: target('order.created'),
          registrationState: 'proven_registered' as const,
          ruleId: 'test.policy.event-handler.v1',
          handlerEvidenceId: evidenceId,
        },
      ],
      assertions: [
        ...base.assertions,
        ...[matchedId, missingId].map((objectId) => ({
          id: makeAssertionId({
            subjectId: sourceMethodId,
            predicate: 'METHOD_INITIATES_INTERACTION',
            objectId,
            ruleId: 'test.policy.event.v1',
          }),
          subjectId: sourceMethodId,
          predicate: 'METHOD_INITIATES_INTERACTION' as const,
          objectId,
          status: 'resolved' as const,
          ruleId: 'test.policy.event.v1',
          evidenceIds: [evidenceId],
        })),
        {
          id: createStableId('assertion', ['policy-event-match']),
          subjectId: matchedId,
          predicate: 'INTERACTION_MATCHES_LOCAL_HANDLER' as const,
          objectId: handlerId,
          status: 'resolved' as const,
          ruleId: 'test.policy.event-match.v1',
          evidenceIds: [evidenceId],
        },
        {
          id: makeAssertionId({
            subjectId: handlerId,
            predicate: 'HANDLER_IMPLEMENTED_BY',
            objectId: sourceMethodId,
            ruleId: 'test.policy.event-handler.v1',
          }),
          subjectId: handlerId,
          predicate: 'HANDLER_IMPLEMENTED_BY' as const,
          objectId: sourceMethodId,
          status: 'resolved' as const,
          ruleId: 'test.policy.event-handler.v1',
          evidenceIds: [evidenceId],
        },
      ],
    } satisfies AnalysisDocument;

    expect(outcome('require-local-in-process-event-handler', analysis)).toEqual(['pass', 'fail']);
    expect(outcome('require-local-in-process-event-handler', base)).toEqual(['not_applicable']);
  });
});
