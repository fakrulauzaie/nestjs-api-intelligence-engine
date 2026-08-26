import { describe, expect, it } from 'vitest';
import type {
  AnalysisDocument,
  AnalysisDocumentV2,
  AssertionStatus,
  DiagnosticRecord,
} from '../../../src/model/index.js';
import { createStableId } from '../../../src/model/ids.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import type { PolicyRuleId } from '../../../src/policy/model.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

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
});
