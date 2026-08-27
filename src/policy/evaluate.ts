import { compareAnalysisDocuments } from '../comparison/compare.js';
import type { EndpointSnapshot } from '../comparison/model.js';
import type { AnalysisSemanticProjection } from '../comparison/projection.js';
import { buildAnalysisSemanticProjection } from '../comparison/projection.js';
import { createSemanticKey } from '../comparison/semantic-key.js';
import { buildEffectiveEndpointGuards } from '../guards/effective.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticSeverity } from '../model/diagnostics.js';
import type { ClassRecord } from '../model/entities.js';
import type { InProcessEventInteractionRecord, InteractionRecord } from '../model/interactions.js';
import { interactionTargetKey } from '../model/interactions.js';
import { buildEndpointTrace, type EndpointTraceBuildResult } from '../tracing/endpoint-trace.js';
import {
  POLICY_RESULTS_SCHEMA_VERSION,
  POLICY_RULE_VERSIONS,
  type NormalizedPolicyConfiguration,
  type NormalizedPolicyRuleConfiguration,
  type PolicyInputReference,
  type PolicyOutcome,
  type PolicyReasonCode,
  type PolicyResult,
  type PolicyResultsDocument,
  type PolicySubject,
} from './model.js';
import { canonicalizePolicyResults } from './ordering.js';
import { assertValidPolicyResultsDocument } from './validate.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'ALL']);
const WRITE_TRACE_DIAGNOSTICS = new Set([
  'DI_TOKEN_UNSUPPORTED',
  'CALL_TARGET_UNRESOLVED',
  'CALL_DEPTH_LIMIT',
  'TYPEORM_ENTITY_UNRESOLVED',
  'TYPEORM_OPERATION_UNSUPPORTED',
  'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS',
  'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED',
  'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED',
  'TYPEORM_QUERY_BUILDER_TERMINAL_MISSING',
  'TYPEORM_RAW_SQL_DIALECT_UNSELECTED',
  'TYPEORM_RAW_SQL_RECEIVER_AMBIGUOUS',
  'TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED',
  'TYPEORM_RAW_SQL_LIMIT_EXCEEDED',
  'TYPEORM_RAW_SQL_PARSE_FAILED',
  'TYPEORM_RAW_SQL_STATEMENT_UNSUPPORTED',
]);
const DIAGNOSTIC_SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
};

interface EvaluationContext {
  readonly analysis: AnalysisDocument;
  readonly projection: AnalysisSemanticProjection;
}

interface EndpointContext {
  readonly snapshots: readonly EndpointSnapshot[];
  readonly subject: PolicySubject;
}

interface TraceAssessment {
  readonly trace: EndpointTraceBuildResult;
  readonly hasGap: boolean;
  readonly gapDiagnosticIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function inputReference(analysis: AnalysisDocument): PolicyInputReference {
  if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
    throw new PolicyInputStateError(analysis.analysisRun.id, analysis.resultState);
  }
  return {
    analysisId: analysis.analysisRun.id,
    analysisSchemaVersion: analysis.schemaVersion,
    resultState: analysis.resultState,
  };
}

export class PolicyInputStateError extends Error {
  constructor(analysisId: string, state: 'failed' | 'canceled') {
    super(`Policy evaluation requires a completed analysis; ${analysisId} is ${state}.`);
    this.name = 'PolicyInputStateError';
  }
}

function policyResult(input: {
  readonly configuration: NormalizedPolicyRuleConfiguration;
  readonly outcome: PolicyOutcome;
  readonly reasonCode: PolicyReasonCode;
  readonly message: string;
  readonly subject: PolicySubject;
  readonly evidenceIds?: readonly string[];
}): PolicyResult {
  const severity =
    input.outcome === 'unknown' ? input.configuration.onUnknown : input.configuration.severity;
  return {
    ruleId: input.configuration.ruleId,
    ruleVersion: POLICY_RULE_VERSIONS[input.configuration.ruleId],
    severity,
    outcome: input.outcome,
    blocking: (input.outcome === 'fail' || input.outcome === 'unknown') && severity === 'error',
    reasonCode: input.reasonCode,
    message: input.message,
    subject: {
      ...input.subject,
      canonicalIds: sortedUnique(input.subject.canonicalIds),
    },
    evidenceIds: sortedUnique(input.evidenceIds ?? []),
  };
}

function summary(results: readonly PolicyResult[]): PolicyResultsDocument['summary'] {
  const actionable = results.filter(({ outcome }) => outcome === 'fail' || outcome === 'unknown');
  return {
    passed: results.filter(({ outcome }) => outcome === 'pass').length,
    failed: results.filter(({ outcome }) => outcome === 'fail').length,
    unknown: results.filter(({ outcome }) => outcome === 'unknown').length,
    notApplicable: results.filter(({ outcome }) => outcome === 'not_applicable').length,
    warnings: actionable.filter(({ severity }) => severity === 'warn').length,
    errors: actionable.filter(({ severity }) => severity === 'error').length,
    blocking: results.filter(({ blocking }) => blocking).length,
  };
}

function analysisSubject(analysis: AnalysisDocument): PolicySubject {
  return {
    semanticKey: createSemanticKey('analysis', ['root']),
    displayName: 'analysis',
    canonicalIds: [analysis.analysisRun.id],
  };
}

function controllerGroups(context: EvaluationContext): readonly {
  readonly controllers: readonly ClassRecord[];
  readonly subject: PolicySubject;
}[] {
  const groups = new Map<string, ClassRecord[]>();
  for (const sourceClass of context.analysis.classes) {
    if (!sourceClass.roles.includes('controller')) continue;
    const key = context.projection.semanticKeyById.get(sourceClass.id);
    if (key === undefined) continue;
    groups.set(key.encoded, [...(groups.get(key.encoded) ?? []), sourceClass]);
  }
  return [...groups.values()]
    .map((controllers) => {
      const first = controllers[0]!;
      return {
        controllers,
        subject: {
          semanticKey: context.projection.semanticKeyById.get(first.id)!,
          displayName: first.qualifiedName,
          canonicalIds: controllers.map(({ id }) => id),
        },
      };
    })
    .sort((left, right) =>
      left.subject.semanticKey.encoded.localeCompare(right.subject.semanticKey.encoded),
    );
}

function evaluateRepositoryRule(
  context: EvaluationContext,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  const groups = controllerGroups(context);
  if (groups.length === 0) {
    return [
      policyResult({
        configuration,
        outcome: 'not_applicable',
        reasonCode: 'no_controller_subjects',
        message: 'No controller subjects were found.',
        subject: analysisSubject(context.analysis),
      }),
    ];
  }

  const methodsByClass = new Map<string, string[]>();
  for (const method of context.analysis.methods) {
    methodsByClass.set(method.classId, [...(methodsByClass.get(method.classId) ?? []), method.id]);
  }
  const assertionById = new Map(context.analysis.assertions.map((value) => [value.id, value]));

  return groups.map(({ controllers, subject }) => {
    if (controllers.length > 1) {
      return policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'controller_repository_access_unknown',
        message: 'Controller identity is ambiguous, so direct repository access is unknown.',
        subject,
      });
    }

    const controller = controllers[0]!;
    const methodIds = new Set(methodsByClass.get(controller.id) ?? []);
    const relevantAssertions = context.analysis.assertions.filter(
      (assertion) =>
        (assertion.predicate === 'CLASS_INJECTS_REPOSITORY' &&
          assertion.subjectId === controller.id) ||
        ((assertion.predicate === 'METHOD_READS_TABLE' ||
          assertion.predicate === 'METHOD_WRITES_TABLE') &&
          methodIds.has(assertion.subjectId)),
    );
    const relevantDiagnostics = context.analysis.diagnostics.filter(
      (diagnostic) =>
        (diagnostic.code === 'DI_TOKEN_UNSUPPORTED' ||
          diagnostic.code === 'TYPEORM_ENTITY_UNRESOLVED') &&
        diagnostic.subjectId !== undefined &&
        (diagnostic.subjectId === controller.id || methodIds.has(diagnostic.subjectId)),
    );
    const unsupportedOperations = context.analysis.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === 'TYPEORM_OPERATION_UNSUPPORTED' &&
        diagnostic.subjectId !== undefined &&
        methodIds.has(diagnostic.subjectId),
    );
    const resolved = relevantAssertions.filter(({ status }) => status === 'resolved');
    if (resolved.length > 0 || unsupportedOperations.length > 0) {
      const directAssertions = [
        ...resolved,
        ...unsupportedOperations.flatMap((diagnostic) => {
          const assertion = context.analysis.assertions.find(
            (candidate) =>
              candidate.subjectId === diagnostic.subjectId &&
              candidate.predicate === 'CLASS_INJECTS_REPOSITORY',
          );
          return assertion === undefined ? [] : [assertionById.get(assertion.id)!];
        }),
      ];
      return policyResult({
        configuration,
        outcome: 'fail',
        reasonCode: 'direct_repository_access',
        message: 'The controller has proven direct repository injection or table-access facts.',
        subject: {
          ...subject,
          canonicalIds: [
            ...subject.canonicalIds,
            ...directAssertions.flatMap((assertion) =>
              assertion.objectId === null ? [assertion.id] : [assertion.id, assertion.objectId],
            ),
          ],
        },
        evidenceIds: [
          ...resolved.flatMap(({ evidenceIds }) => evidenceIds),
          ...unsupportedOperations.flatMap(({ evidenceIds }) => evidenceIds),
        ],
      });
    }

    const uncertainAssertions = relevantAssertions.filter(({ status }) => status !== 'resolved');
    if (uncertainAssertions.length > 0 || relevantDiagnostics.length > 0) {
      return policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'controller_repository_access_unknown',
        message:
          'Repository access in the controller crosses an unresolved or unsupported boundary.',
        subject,
        evidenceIds: [
          ...uncertainAssertions.flatMap(({ evidenceIds }) => evidenceIds),
          ...relevantDiagnostics.flatMap(({ evidenceIds }) => evidenceIds),
        ],
      });
    }

    return policyResult({
      configuration,
      outcome: 'pass',
      reasonCode: 'no_direct_repository_access',
      message: 'No direct repository injection or table-access fact was found in the controller.',
      subject,
    });
  });
}

function endpointGroups(context: EvaluationContext): EndpointContext[] {
  const groups = new Map<string, EndpointSnapshot[]>();
  for (const endpoint of context.projection.endpoints) {
    const key = endpoint.exactKey ?? endpoint.routeSlotKey;
    groups.set(key.encoded, [...(groups.get(key.encoded) ?? []), endpoint]);
  }
  return [...groups.values()]
    .map((snapshots): EndpointContext => {
      const first = snapshots[0]!;
      return {
        snapshots,
        subject: {
          semanticKey: first.exactKey ?? first.routeSlotKey,
          displayName: `${first.httpMethod} ${first.path}`,
          canonicalIds: snapshots.map(({ endpointId }) => endpointId),
        },
      };
    })
    .sort((left, right) =>
      left.subject.semanticKey.encoded.localeCompare(right.subject.semanticKey.encoded),
    );
}

function assessTrace(context: EvaluationContext, endpoint: EndpointSnapshot): TraceAssessment {
  const trace = buildEndpointTrace(context.analysis, {
    httpMethod: endpoint.httpMethod,
    path: endpoint.path,
  });
  if (trace.status !== 'resolved') {
    return { trace, hasGap: true, gapDiagnosticIds: [], evidenceIds: [] };
  }

  const relevantSubjectIds = new Set<string>([endpoint.endpointId]);
  for (const step of trace.trace.steps) {
    relevantSubjectIds.add(step.fromId);
    if (step.toId !== null) relevantSubjectIds.add(step.toId);
  }
  const classByMethod = new Map(
    context.analysis.methods.map((method) => [method.id, method.classId]),
  );
  for (const subjectId of [...relevantSubjectIds]) {
    const classId = classByMethod.get(subjectId);
    if (classId !== undefined) relevantSubjectIds.add(classId);
  }
  const diagnostics = context.analysis.diagnostics.filter(
    (diagnostic) =>
      WRITE_TRACE_DIAGNOSTICS.has(diagnostic.code) &&
      diagnostic.subjectId !== undefined &&
      relevantSubjectIds.has(diagnostic.subjectId),
  );
  const nonResolvedSteps = trace.trace.steps.filter(({ status }) => status !== 'resolved');
  return {
    trace,
    hasGap: nonResolvedSteps.length > 0 || diagnostics.length > 0,
    gapDiagnosticIds: diagnostics.map(({ id }) => id),
    evidenceIds: [
      ...nonResolvedSteps.flatMap(({ evidenceIds }) => evidenceIds),
      ...diagnostics.flatMap(({ evidenceIds }) => evidenceIds),
    ],
  };
}

function endpointTerminals(snapshot: EndpointSnapshot) {
  const writes = snapshot.terminals.values.filter(({ direction }) => direction === 'WRITE');
  return {
    resolved: writes.filter(({ status }) => status === 'resolved'),
    ambiguous: writes.filter(({ status }) => status === 'ambiguous'),
  };
}

function terminalEvidence(snapshot: EndpointSnapshot): string[] {
  return snapshot.terminals.values
    .filter(({ direction }) => direction === 'WRITE')
    .flatMap(({ contributors }) => contributors.flatMap(({ evidenceIds }) => evidenceIds));
}

function terminalIds(snapshot: EndpointSnapshot): string[] {
  return snapshot.terminals.values
    .filter(({ direction }) => direction === 'WRITE')
    .flatMap((terminal) => [
      terminal.tableId,
      ...terminal.contributors.map(({ assertionId }) => assertionId),
    ]);
}

function evaluateGuardRule(
  context: EvaluationContext,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  const groups = endpointGroups(context);
  if (groups.length === 0) {
    return [
      policyResult({
        configuration,
        outcome: 'not_applicable',
        reasonCode: 'endpoint_has_no_write',
        message: 'No endpoint subjects were found.',
        subject: analysisSubject(context.analysis),
      }),
    ];
  }
  return groups.map(({ snapshots, subject }) => {
    if (snapshots.length !== 1) {
      return policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'write_reachability_unknown',
        message: 'Endpoint identity is ambiguous, so write reachability is unknown.',
        subject,
      });
    }
    const snapshot = snapshots[0]!;
    const writes = endpointTerminals(snapshot);
    if (writes.resolved.length === 0 && writes.ambiguous.length === 0) {
      return policyResult({
        configuration,
        outcome: 'not_applicable',
        reasonCode: 'endpoint_has_no_write',
        message: 'The endpoint has no reachable write terminal.',
        subject,
      });
    }
    if (writes.resolved.length === 0) {
      return policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'write_reachability_unknown',
        message: 'The endpoint has only ambiguous reachable write terminals.',
        subject: { ...subject, canonicalIds: [...subject.canonicalIds, ...terminalIds(snapshot)] },
        evidenceIds: terminalEvidence(snapshot),
      });
    }

    const guards = buildEffectiveEndpointGuards(context.analysis, snapshot.endpointId);
    const resolvedGuards = guards.effectiveGuards.filter(({ status }) => status === 'resolved');
    const guardCanonicalIds = guards.effectiveGuards.flatMap(({ guardId, assertionId }) => [
      guardId,
      assertionId,
    ]);
    const evidenceIds = [
      ...terminalEvidence(snapshot),
      ...guards.effectiveGuards.flatMap(({ evidenceIds: values }) => values),
    ];
    const guardedSubject = {
      ...subject,
      canonicalIds: [...subject.canonicalIds, ...terminalIds(snapshot), ...guardCanonicalIds],
    };
    if (resolvedGuards.length > 0) {
      return policyResult({
        configuration,
        outcome: 'pass',
        reasonCode: 'write_endpoint_guard_declared',
        message: 'The write endpoint has a proven direct or application-global guard declaration.',
        subject: guardedSubject,
        evidenceIds,
      });
    }
    if (
      guards.effectiveGuards.some(({ status }) => status !== 'resolved') ||
      guards.effectiveGuardState === 'unknown'
    ) {
      return policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'write_endpoint_guard_unknown',
        message: 'The write endpoint guard policy is unresolved or globally unknown.',
        subject: guardedSubject,
        evidenceIds,
      });
    }
    return policyResult({
      configuration,
      outcome: 'fail',
      reasonCode: 'write_endpoint_guard_missing',
      message: 'No supported guard declaration was proven for the write endpoint.',
      subject: guardedSubject,
      evidenceIds,
    });
  });
}

function evaluateCompleteTraceRule(
  context: EvaluationContext,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  const groups = endpointGroups(context);
  if (groups.length === 0) {
    return [
      policyResult({
        configuration,
        outcome: 'not_applicable',
        reasonCode: 'no_write_trace_subject',
        message: 'No endpoint subjects were found.',
        subject: analysisSubject(context.analysis),
      }),
    ];
  }
  return groups.map(({ snapshots, subject }) => {
    if (snapshots.length !== 1) {
      return policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'write_trace_unknown',
        message: 'Endpoint identity is ambiguous, so write-trace completeness is unknown.',
        subject,
      });
    }
    const snapshot = snapshots[0]!;
    const writes = endpointTerminals(snapshot);
    const assessment = assessTrace(context, snapshot);
    const assessedSubject = {
      ...subject,
      canonicalIds: [
        ...subject.canonicalIds,
        ...terminalIds(snapshot),
        ...assessment.gapDiagnosticIds,
      ],
    };
    const evidenceIds = [...terminalEvidence(snapshot), ...assessment.evidenceIds];
    if (writes.resolved.length > 0 && assessment.hasGap) {
      return policyResult({
        configuration,
        outcome: 'fail',
        reasonCode: 'write_trace_incomplete',
        message:
          'A proven write endpoint also reaches an ambiguous, unresolved, unsupported, or depth-limited branch.',
        subject: assessedSubject,
        evidenceIds,
      });
    }
    if (writes.resolved.length > 0) {
      return policyResult({
        configuration,
        outcome: 'pass',
        reasonCode: 'write_trace_complete',
        message: 'The proven reachable write trace has no supported persistence-analysis gaps.',
        subject: assessedSubject,
        evidenceIds,
      });
    }
    if (
      writes.ambiguous.length > 0 ||
      (WRITE_METHODS.has(snapshot.httpMethod) && assessment.hasGap)
    ) {
      return policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'write_trace_unknown',
        message: 'Potential write-trace completeness cannot be established across an analysis gap.',
        subject: assessedSubject,
        evidenceIds,
      });
    }
    return policyResult({
      configuration,
      outcome: 'not_applicable',
      reasonCode: 'no_write_trace_subject',
      message: 'The endpoint has no proven or ambiguous reachable write terminal.',
      subject: assessedSubject,
      evidenceIds,
    });
  });
}

function evaluateDiagnosticRule(
  context: EvaluationContext,
  baseline: AnalysisDocument | undefined,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  const subject = analysisSubject(context.analysis);
  if (baseline === undefined) {
    return [
      policyResult({
        configuration,
        outcome: 'not_applicable',
        reasonCode: 'baseline_not_supplied',
        message: 'No baseline analysis was supplied for diagnostic comparison.',
        subject,
      }),
    ];
  }
  const diff = compareAnalysisDocuments(baseline, context.analysis);
  const minimumSeverity = configuration.minimumSeverity ?? 'warning';
  const newDiagnostics = diff.diagnosticChanges.filter(
    (change) =>
      change.change === 'new' &&
      change.after !== null &&
      DIAGNOSTIC_SEVERITY_RANK[change.after.severity] >= DIAGNOSTIC_SEVERITY_RANK[minimumSeverity],
  );
  if (newDiagnostics.length > 0) {
    return [
      policyResult({
        configuration,
        outcome: 'fail',
        reasonCode: 'new_diagnostics_found',
        message: `${newDiagnostics.length} new diagnostic(s) meet the ${minimumSeverity} severity threshold.`,
        subject: {
          ...subject,
          canonicalIds: [
            ...subject.canonicalIds,
            ...newDiagnostics.flatMap((change) =>
              change.after === null ? [] : [change.after.diagnosticId],
            ),
          ],
        },
        evidenceIds: newDiagnostics.flatMap((change) => change.after?.evidenceIds ?? []),
      }),
    ];
  }
  const ambiguities = diff.ambiguities.filter(
    (ambiguity) => ambiguity.kind === 'diagnostic_key' || ambiguity.recordKind === 'diagnostic',
  );
  if (ambiguities.length > 0) {
    return [
      policyResult({
        configuration,
        outcome: 'unknown',
        reasonCode: 'diagnostic_comparison_ambiguous',
        message: 'Diagnostic comparison contains ambiguous semantic identities.',
        subject: {
          ...subject,
          canonicalIds: [
            ...subject.canonicalIds,
            ...ambiguities.flatMap(({ beforeCandidateIds, afterCandidateIds }) => [
              ...beforeCandidateIds,
              ...afterCandidateIds,
            ]),
          ],
        },
      }),
    ];
  }
  return [
    policyResult({
      configuration,
      outcome: 'pass',
      reasonCode: 'no_new_diagnostics',
      message: `No new diagnostics meet the ${minimumSeverity} severity threshold.`,
      subject,
    }),
  ];
}

function interactionSubject(
  context: EvaluationContext,
  interaction: InteractionRecord,
): PolicySubject {
  const method = context.analysis.methods.find(({ id }) => id === interaction.sourceMethodId);
  return {
    semanticKey:
      context.projection.semanticKeyById.get(interaction.id) ??
      createSemanticKey('interaction', [
        interaction.sourceMethodId,
        interaction.kind,
        interactionTargetKey(interaction.target),
      ]),
    displayName: `${method?.qualifiedName ?? interaction.sourceMethodId} -> ${interaction.kind}`,
    canonicalIds: [interaction.id, interaction.sourceMethodId],
  };
}

function dynamicTargetState(interaction: InteractionRecord): 'static' | 'dynamic' | 'unknown' {
  switch (interaction.kind) {
    case 'outbound_http':
      return interaction.target.url.resolution === 'dynamic' ||
        interaction.target.method === 'UNKNOWN'
        ? 'dynamic'
        : 'static';
    case 'in_process_event':
      return interaction.target.identityKind === 'dynamic' ? 'dynamic' : 'static';
    case 'job_queue':
      return interaction.target.queue.resolution === 'dynamic' ||
        interaction.target.job.resolution === 'dynamic'
        ? 'dynamic'
        : 'static';
    case 'microservice_message':
      if (
        interaction.target.patternKind === 'dynamic' ||
        interaction.target.clientToken.resolution === 'dynamic'
      ) {
        return 'dynamic';
      }
      return interaction.target.transport === null ? 'unknown' : 'static';
  }
}

function noInteractionSubjects(
  context: EvaluationContext,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  return [
    policyResult({
      configuration,
      outcome: 'not_applicable',
      reasonCode: 'no_interaction_subjects',
      message: 'No canonical interaction subjects were found.',
      subject: analysisSubject(context.analysis),
    }),
  ];
}

function evaluateDynamicInteractionTargetRule(
  context: EvaluationContext,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  if (context.analysis.schemaVersion !== '3.0.0' || context.analysis.interactions.length === 0) {
    return noInteractionSubjects(context, configuration);
  }
  return context.analysis.interactions.map((interaction) => {
    const state = dynamicTargetState(interaction);
    return policyResult({
      configuration,
      outcome: state === 'static' ? 'pass' : state === 'dynamic' ? 'fail' : 'unknown',
      reasonCode:
        state === 'static'
          ? 'interaction_target_static'
          : state === 'dynamic'
            ? 'interaction_target_dynamic'
            : 'interaction_target_unknown',
      message:
        state === 'static'
          ? 'The interaction target is statically bounded.'
          : state === 'dynamic'
            ? 'The interaction target contains a proven dynamic component.'
            : 'The interaction target cannot be fully classified from supported static evidence.',
      subject: interactionSubject(context, interaction),
      evidenceIds: interaction.evidenceIds,
    });
  });
}

function evaluateInteractionActivationRule(
  context: EvaluationContext,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  if (context.analysis.schemaVersion !== '3.0.0' || context.analysis.interactions.length === 0) {
    return noInteractionSubjects(context, configuration);
  }
  return context.analysis.interactions.map((interaction) => {
    const state = interaction.activation;
    return policyResult({
      configuration,
      outcome:
        state === 'eager' || state === 'proven_activated'
          ? 'pass'
          : state === 'constructed_cold'
            ? 'fail'
            : 'unknown',
      reasonCode:
        state === 'eager' || state === 'proven_activated'
          ? 'interaction_activation_proven'
          : state === 'constructed_cold'
            ? 'interaction_activation_cold'
            : 'interaction_activation_unknown',
      message:
        state === 'eager' || state === 'proven_activated'
          ? `Interaction activation is ${state}.`
          : state === 'constructed_cold'
            ? 'The interaction constructs a cold operation without proven activation.'
            : 'Interaction activation is unknown.',
      subject: interactionSubject(context, interaction),
      evidenceIds: interaction.evidenceIds,
    });
  });
}

function evaluateLocalEventHandlerRule(
  context: EvaluationContext,
  configuration: NormalizedPolicyRuleConfiguration,
): PolicyResult[] {
  const analysis = context.analysis;
  const interactions =
    analysis.schemaVersion === '3.0.0'
      ? analysis.interactions.filter(
          (interaction): interaction is InProcessEventInteractionRecord =>
            interaction.kind === 'in_process_event',
        )
      : [];
  if (interactions.length === 0) {
    return [
      policyResult({
        configuration,
        outcome: 'not_applicable',
        reasonCode: 'no_in_process_event_subjects',
        message: 'No in-process event interaction subjects were found.',
        subject: analysisSubject(context.analysis),
      }),
    ];
  }
  const matchesByInteraction = new Map<string, AssertionRecord[]>();
  for (const assertion of context.analysis.assertions) {
    if (assertion.predicate !== 'INTERACTION_MATCHES_LOCAL_HANDLER') continue;
    matchesByInteraction.set(assertion.subjectId, [
      ...(matchesByInteraction.get(assertion.subjectId) ?? []),
      assertion,
    ]);
  }
  return interactions.map((interaction) => {
    const matches = matchesByInteraction.get(interaction.id) ?? [];
    const resolved = matches.filter(({ status }) => status === 'resolved');
    const uncertain =
      interaction.target.identityKind === 'dynamic' ||
      analysis.schemaVersion !== '3.0.0' ||
      analysis.interactionAnalysis.state !== 'complete' ||
      matches.some(({ status }) => status !== 'resolved');
    return policyResult({
      configuration,
      outcome: resolved.length > 0 ? 'pass' : uncertain ? 'unknown' : 'fail',
      reasonCode:
        resolved.length > 0
          ? 'local_event_handler_found'
          : uncertain
            ? 'local_event_handler_unknown'
            : 'local_event_handler_missing',
      message:
        resolved.length > 0
          ? `${resolved.length} local in-process event handler match(es) were proven.`
          : uncertain
            ? 'A local in-process event handler cannot be established across the available evidence.'
            : 'No local handler matches this statically identified in-process event.',
      subject: interactionSubject(context, interaction),
      evidenceIds: sortedUnique([
        ...interaction.evidenceIds,
        ...matches.flatMap(({ evidenceIds }) => evidenceIds),
      ]),
    });
  });
}

export function evaluatePolicies(input: {
  readonly analysis: AnalysisDocument;
  readonly configuration: NormalizedPolicyConfiguration;
  readonly baseline?: AnalysisDocument | undefined;
}): PolicyResultsDocument {
  const analysisReference = inputReference(input.analysis);
  const baselineReference = input.baseline === undefined ? null : inputReference(input.baseline);
  const context = {
    analysis: input.analysis,
    projection: buildAnalysisSemanticProjection(input.analysis),
  };
  const results = input.configuration.rules.flatMap((configuration): PolicyResult[] => {
    switch (configuration.ruleId) {
      case 'no-repository-access-in-controller':
        return evaluateRepositoryRule(context, configuration);
      case 'require-guard-on-write-endpoint':
        return evaluateGuardRule(context, configuration);
      case 'require-complete-write-trace':
        return evaluateCompleteTraceRule(context, configuration);
      case 'no-new-diagnostics':
        return evaluateDiagnosticRule(context, input.baseline, configuration);
      case 'forbid-dynamic-interaction-target':
        return evaluateDynamicInteractionTargetRule(context, configuration);
      case 'require-proven-interaction-activation':
        return evaluateInteractionActivationRule(context, configuration);
      case 'require-local-in-process-event-handler':
        return evaluateLocalEventHandlerRule(context, configuration);
    }
  });
  const document = canonicalizePolicyResults({
    schemaVersion: POLICY_RESULTS_SCHEMA_VERSION,
    analysis: analysisReference,
    baseline: baselineReference,
    configuration: input.configuration,
    summary: summary(results),
    results,
  });
  return assertValidPolicyResultsDocument(document);
}
