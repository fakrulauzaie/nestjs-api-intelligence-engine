import type {
  AnalysisDocument,
  EndpointTraceView,
  InteractionHandlerTraceView,
  RunDocument,
} from './analysis.js';
import type { InteractionRecord } from './interactions.js';

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortById<T extends { readonly id: string }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => compareStrings(left.id, right.id));
}

function canonicalizeInteractionRecord(record: InteractionRecord): InteractionRecord {
  const evidenceIds = [...record.evidenceIds].sort(compareStrings);
  switch (record.kind) {
    case 'outbound_http':
      return {
        ...record,
        evidenceIds,
        target: {
          ...record.target,
          queryKeys: [...record.target.queryKeys].sort(compareStrings),
        },
      };
    case 'in_process_event':
    case 'job_queue':
    case 'microservice_message':
      return { ...record, evidenceIds };
  }
}

export function canonicalizeAnalysisDocument(analysis: AnalysisDocument): AnalysisDocument {
  const orderedCommon = {
    sourceFiles: sortById(analysis.sourceFiles),
    classes: sortById(analysis.classes).map((record) => ({
      ...record,
      roles: [...record.roles].sort(compareStrings),
    })),
    methods: sortById(analysis.methods),
    endpoints: sortById(analysis.endpoints),
    guards: sortById(analysis.guards),
    repositoryBindings: sortById(analysis.repositoryBindings),
    entities: sortById(analysis.entities),
    tables: sortById(analysis.tables),
    assertions: sortById(analysis.assertions).map((record) => ({
      ...record,
      evidenceIds: [...record.evidenceIds].sort(compareStrings),
    })),
    evidence: sortById(analysis.evidence),
    diagnostics: sortById(analysis.diagnostics).map((record) => ({
      ...record,
      evidenceIds: [...record.evidenceIds].sort(compareStrings),
    })),
  };
  if (analysis.schemaVersion === '1.0.0') return { ...analysis, ...orderedCommon };
  const orderedV2 = {
    ...analysis,
    ...orderedCommon,
    modules: sortById(analysis.modules),
    globalGuardRegistrations: [...analysis.globalGuardRegistrations].sort(
      (left, right) => left.order - right.order || compareStrings(left.id, right.id),
    ),
    contractTypes: sortById(analysis.contractTypes),
    contractFields: sortById(analysis.contractFields).map((record) => ({
      ...record,
      declaredConstraints: [...record.declaredConstraints].sort((left, right) =>
        compareStrings(
          `${left.name}:${left.decoratorEvidenceId}`,
          `${right.name}:${right.decoratorEvidenceId}`,
        ),
      ),
    })),
    requestParameters: sortById(analysis.requestParameters).map((record) => ({
      ...record,
      declaredType: {
        ...record.declaredType,
        alternatives: [...record.declaredType.alternatives].sort(compareStrings),
        contractTypeIds: [...record.declaredType.contractTypeIds].sort(compareStrings),
      },
    })),
    responseContracts: sortById(analysis.responseContracts).map((record) => ({
      ...record,
      declaredType: {
        ...record.declaredType,
        alternatives: [...record.declaredType.alternatives].sort(compareStrings),
        contractTypeIds: [...record.declaredType.contractTypeIds].sort(compareStrings),
      },
    })),
    entityColumns: sortById(analysis.entityColumns),
    requestFieldOrigins: sortById(analysis.requestFieldOrigins).map((record) => ({
      ...record,
      propertyPath: [...record.propertyPath],
      contractFieldIds: [...record.contractFieldIds].sort(compareStrings),
    })),
    columnInfluences: sortById(analysis.columnInfluences).map((record) => ({
      ...record,
      propagationEvidenceIds: [...record.propagationEvidenceIds].sort(compareStrings),
      callPath: [...record.callPath],
    })),
    globalGuardAnalysis: analysis.globalGuardAnalysis,
  };
  if (analysis.schemaVersion === '2.0.0') return orderedV2;
  const orderedInteractions = {
    ...orderedV2,
    applications: sortById(analysis.applications),
    interactions: sortById(analysis.interactions).map(canonicalizeInteractionRecord),
    interactionHandlers: sortById(analysis.interactionHandlers).map((handler) =>
      handler.kind === 'in_process_event' && handler.configurationEvidenceIds !== undefined
        ? {
            ...handler,
            configurationEvidenceIds: [...handler.configurationEvidenceIds].sort(compareStrings),
          }
        : handler,
    ),
    interactionAnalysis: {
      ...analysis.interactionAnalysis,
      schemaKinds: [...analysis.interactionAnalysis.schemaKinds].sort(compareStrings),
      supportedKinds: [...analysis.interactionAnalysis.supportedKinds].sort(compareStrings),
      enabledKinds: [...analysis.interactionAnalysis.enabledKinds].sort(compareStrings),
    },
  };
  if (analysis.schemaVersion === '3.0.0') return orderedInteractions;
  const orderedBranches = {
    ...orderedInteractions,
    interactionHandlerDispatches: sortById(analysis.interactionHandlerDispatches).map(
      (dispatch) => ({
        ...dispatch,
        branchIds: [...dispatch.branchIds].sort(compareStrings),
        evidenceIds: [...dispatch.evidenceIds].sort(compareStrings),
      }),
    ),
    interactionHandlerBranches: sortById(analysis.interactionHandlerBranches).map((branch) => ({
      ...branch,
      selector:
        branch.selector.kind === 'exact_jobs'
          ? { ...branch.selector, jobs: [...branch.selector.jobs].sort(compareStrings) }
          : branch.selector.kind === 'unmatched_jobs'
            ? {
                ...branch.selector,
                excludedJobs: [...branch.selector.excludedJobs].sort(compareStrings),
              }
            : branch.selector,
      evidenceIds: [...branch.evidenceIds].sort(compareStrings),
    })),
    interactionHandlerBranchEffects: sortById(analysis.interactionHandlerBranchEffects).map(
      (effect) => ({
        ...effect,
        evidenceIds: [...effect.evidenceIds].sort(compareStrings),
      }),
    ),
  };
  if (analysis.schemaVersion === '4.0.0') return orderedBranches;
  const orderedAuthorization = {
    ...orderedBranches,
    authorizationMetadata: sortById(analysis.authorizationMetadata).map((record) => ({
      ...record,
      valueShape:
        record.valueShape.kind === 'array'
          ? {
              ...record.valueShape,
              itemTypes: [...record.valueShape.itemTypes].sort(compareStrings),
            }
          : record.valueShape.kind === 'object'
            ? { ...record.valueShape, keys: [...record.valueShape.keys].sort(compareStrings) }
            : record.valueShape,
      evidenceIds: [...record.evidenceIds].sort(compareStrings),
    })),
    authorizationEnforcements: sortById(analysis.authorizationEnforcements).map((record) => ({
      ...record,
      evidenceIds: [...record.evidenceIds].sort(compareStrings),
    })),
  };
  if (analysis.schemaVersion === '5.0.0') return orderedAuthorization;
  const orderedResources = {
    ...orderedAuthorization,
    resourceAccesses: sortById(analysis.resourceAccesses).map((record) => ({
      ...record,
      evidenceIds: [...record.evidenceIds].sort(compareStrings),
    })),
    resourceAccessAnalysis: {
      ...analysis.resourceAccessAnalysis,
      supportedTechnologies: [...analysis.resourceAccessAnalysis.supportedTechnologies].sort(
        compareStrings,
      ),
      enabledTechnologies: [...analysis.resourceAccessAnalysis.enabledTechnologies].sort(
        compareStrings,
      ),
    },
  };
  if (analysis.schemaVersion === '6.0.0') return orderedResources;
  return {
    ...orderedResources,
    criticalSections: sortById(analysis.criticalSections).map((record) => ({
      ...record,
      lockResourceAccessIds: [...record.lockResourceAccessIds].sort(compareStrings),
      effectAssertionIds: [...record.effectAssertionIds].sort(compareStrings),
      evidenceIds: [...record.evidenceIds].sort(compareStrings),
    })),
  } as AnalysisDocument;
}

export function canonicalizeRunDocument(run: RunDocument): RunDocument {
  return {
    ...run,
    ...(run.projectConfiguration === undefined
      ? {}
      : {
          projectConfiguration: {
            ...run.projectConfiguration,
            rules: [...run.projectConfiguration.rules].sort((left, right) =>
              compareStrings(left.ruleId, right.ruleId),
            ),
          },
        }),
    diagnostics: sortById(run.diagnostics).map((record) => ({
      ...record,
      evidenceIds: [...record.evidenceIds].sort(compareStrings),
    })),
  };
}

export function normalizeRunForComparison(
  run: RunDocument,
): Omit<RunDocument, 'repositoryPath' | 'startedAt' | 'endedAt' | 'durationMs'> {
  const canonical = canonicalizeRunDocument(run);
  return {
    schemaVersion: canonical.schemaVersion,
    analysisId: canonical.analysisId,
    repositoryRevision: canonical.repositoryRevision,
    resultState: canonical.resultState,
    tool: canonical.tool,
    configuration: canonical.configuration,
    diagnostics: canonical.diagnostics,
  };
}

export function canonicalizeEndpointTrace(trace: EndpointTraceView): EndpointTraceView {
  const terminalKey = (terminal: EndpointTraceView['terminals'][number]): string =>
    `${terminal.methodId}:${terminal.direction}:${terminal.tableId}:${terminal.causalClass ?? ''}`;
  const sortTerminals = (
    terminals: EndpointTraceView['terminals'],
  ): EndpointTraceView['terminals'] =>
    [...terminals].sort((left, right) => compareStrings(terminalKey(left), terminalKey(right)));
  const sortResourceTerminals = (
    terminals: NonNullable<EndpointTraceView['resourceTerminals']>,
  ): NonNullable<EndpointTraceView['resourceTerminals']> =>
    [...terminals].sort((left, right) =>
      compareStrings(
        `${left.methodId}:${left.resourceAccessId}:${left.causalClass}`,
        `${right.methodId}:${right.resourceAccessId}:${right.causalClass}`,
      ),
    );
  return {
    ...trace,
    // Guard array order is semantic: application-global registrations execute before
    // controller and method guards, and v2 registrations preserve their proven order.
    guards: trace.guards.map((guard) => ({
      ...guard,
      evidenceIds: [...guard.evidenceIds].sort(compareStrings),
    })),
    steps: [...trace.steps]
      .map((step) => ({ ...step, evidenceIds: [...step.evidenceIds].sort(compareStrings) }))
      .sort((left, right) =>
        compareStrings(
          `${left.fromId}:${left.relation}:${left.toId ?? ''}:${left.ruleId}`,
          `${right.fromId}:${right.relation}:${right.toId ?? ''}:${right.ruleId}`,
        ),
      ),
    terminals: sortTerminals(trace.terminals),
    ...(trace.resourceTerminals === undefined
      ? {}
      : { resourceTerminals: sortResourceTerminals(trace.resourceTerminals) }),
    diagnosticIds: [...trace.diagnosticIds].sort(compareStrings),
    ...(trace.causalSummary === undefined
      ? {}
      : {
          causalSummary: {
            synchronousEffects: sortTerminals(trace.causalSummary.synchronousEffects),
            localInteractionEffects: sortTerminals(trace.causalSummary.localInteractionEffects),
            ...(trace.causalSummary.criticalSectionConditionalEffects === undefined
              ? {}
              : {
                  criticalSectionConditionalEffects: sortTerminals(
                    trace.causalSummary.criticalSectionConditionalEffects,
                  ),
                }),
            distributedConditionalEffects: sortTerminals(
              trace.causalSummary.distributedConditionalEffects,
            ),
            outboundInteractionIds: [...trace.causalSummary.outboundInteractionIds].sort(
              compareStrings,
            ),
            localInteractionIds: [...trace.causalSummary.localInteractionIds].sort(compareStrings),
            ...(trace.causalSummary.distributedInteractionIds === undefined
              ? {}
              : {
                  distributedInteractionIds: [
                    ...trace.causalSummary.distributedInteractionIds,
                  ].sort(compareStrings),
                }),
            ...(trace.causalSummary.jobQueueBranchIds === undefined
              ? {}
              : {
                  jobQueueBranchIds: [...trace.causalSummary.jobQueueBranchIds].sort(
                    compareStrings,
                  ),
                }),
            completeness: {
              ...trace.causalSummary.completeness,
              diagnosticCodes: [...trace.causalSummary.completeness.diagnosticCodes].sort(
                compareStrings,
              ),
            },
          },
        }),
  };
}

export function canonicalizeInteractionHandlerTrace(
  trace: InteractionHandlerTraceView,
): InteractionHandlerTraceView {
  return {
    ...trace,
    steps: [...trace.steps]
      .map((step) => ({ ...step, evidenceIds: [...step.evidenceIds].sort(compareStrings) }))
      .sort((left, right) =>
        compareStrings(
          `${left.fromId}:${left.relation}:${left.toId ?? ''}:${left.ruleId}`,
          `${right.fromId}:${right.relation}:${right.toId ?? ''}:${right.ruleId}`,
        ),
      ),
    terminals: [...trace.terminals].sort((left, right) =>
      compareStrings(
        `${left.methodId}:${left.direction}:${left.tableId}:${left.causalClass ?? ''}`,
        `${right.methodId}:${right.direction}:${right.tableId}:${right.causalClass ?? ''}`,
      ),
    ),
    ...(trace.resourceTerminals === undefined
      ? {}
      : {
          resourceTerminals: [...trace.resourceTerminals].sort((left, right) =>
            compareStrings(
              `${left.methodId}:${left.resourceAccessId}:${left.causalClass}`,
              `${right.methodId}:${right.resourceAccessId}:${right.causalClass}`,
            ),
          ),
        }),
    diagnosticIds: [...trace.diagnosticIds].sort(compareStrings),
  };
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, child]) => [key, canonicalizeJsonValue(child)]),
    );
  }

  return value;
}

export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(canonicalizeJsonValue(value), null, 2)}\n`;
}

export function serializeCanonicalAnalysis(analysis: AnalysisDocument): string {
  return canonicalStringify(canonicalizeAnalysisDocument(analysis));
}

export function serializeCanonicalEndpointTrace(trace: EndpointTraceView): string {
  return canonicalStringify(canonicalizeEndpointTrace(trace));
}
