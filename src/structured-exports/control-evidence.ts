import { buildEffectiveEndpointGuards } from '../guards/effective.js';
import {
  analysisHasAuthorizationFacts,
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import { buildEndpointExportFacts } from './endpoint-facts.js';
import {
  CONTROL_EVIDENCE_SCHEMA_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V2_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V3_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V4_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V5_VERSION,
  type ControlEvidenceDocument,
  type ControlEvidenceGuard,
} from './model.js';
import { canonicalizeControlEvidenceDocument } from './ordering.js';
import { assertValidControlEvidenceDocument } from './validate.js';

export class StructuredExportInputStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredExportInputStateError';
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function buildControlEvidenceDocument(input: {
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
}): ControlEvidenceDocument {
  const { analysis, policyResults } = input;
  if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
    throw new StructuredExportInputStateError(
      `Analysis state ${analysis.resultState} cannot produce control evidence.`,
    );
  }
  if (
    policyResults !== undefined &&
    policyResults.analysis.analysisId !== analysis.analysisRun.id
  ) {
    throw new StructuredExportInputStateError(
      'Policy results refer to a different canonical analysis snapshot.',
    );
  }
  const facts = buildEndpointExportFacts({
    analysis,
    ...(policyResults === undefined ? {} : { policyResults }),
  });
  const hasDistributedInteractionRecords =
    analysisHasInteractionFacts(analysis) &&
    (analysis.interactions.some(({ kind }) => kind === 'job_queue') ||
      analysis.interactions.some(({ kind }) => kind === 'microservice_message') ||
      analysis.interactionHandlers.some(
        ({ kind }) => kind === 'job_queue' || kind === 'microservice_message',
      ));
  const schemaVersion = analysisHasAuthorizationFacts(analysis)
    ? CONTROL_EVIDENCE_SCHEMA_V5_VERSION
    : analysisHasJobQueueBranchFacts(analysis)
      ? CONTROL_EVIDENCE_SCHEMA_V4_VERSION
      : hasDistributedInteractionRecords
        ? CONTROL_EVIDENCE_SCHEMA_V3_VERSION
        : analysisHasInteractionFacts(analysis)
          ? CONTROL_EVIDENCE_SCHEMA_V2_VERSION
          : CONTROL_EVIDENCE_SCHEMA_VERSION;
  const rows = [...facts.values()].map((record) => {
    const guardView = buildEffectiveEndpointGuards(analysis, record.endpoint.endpointId);
    const mapGuard = (guard: (typeof guardView.effectiveGuards)[number]): ControlEvidenceGuard => ({
      name: guard.name,
      scope: guard.scope,
      status: guard.status,
      evidenceIds: guard.evidenceIds,
    });
    const directGuards = guardView.directGuards.map(mapGuard);
    const globalGuards = guardView.globalGuards.map(mapGuard);
    const guardEvidence = [...directGuards, ...globalGuards].flatMap(
      ({ evidenceIds }) => evidenceIds,
    );
    const evidenceIds = sortedUnique([...record.evidenceIds, ...guardEvidence]);
    const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
    const sourcesById = new Map(analysis.sourceFiles.map((source) => [source.id, source]));
    const sourceLocations = sortedUnique([
      ...record.sourceLocations,
      ...evidenceIds.flatMap((id) => {
        const evidence = evidenceById.get(id);
        const source = evidence === undefined ? undefined : sourcesById.get(evidence.fileId);
        return evidence === undefined || source === undefined
          ? []
          : [`${source.path}:${evidence.startLine}:${evidence.startColumn}`];
      }),
    ]);
    return {
      analysisId: analysis.analysisRun.id,
      analysisSchemaVersion: analysis.schemaVersion,
      toolName: analysis.analysisRun.tool.name,
      toolVersion: analysis.analysisRun.tool.version,
      endpointId: record.endpoint.endpointId,
      httpMethod: record.endpoint.httpMethod,
      path: record.endpoint.path,
      handler: record.endpoint.handlerQualifiedName,
      selectionStatus: record.endpoint.selectionStatus,
      directGuardState: guardView.directGuardState,
      globalGuardState: guardView.globalGuardState,
      effectiveGuardState: guardView.effectiveGuardState,
      directGuards,
      globalGuards,
      mutationClassification: record.mutationClassification,
      dbReads: record.dbReads,
      dbWrites: record.dbWrites,
      ...(analysisHasInteractionFacts(analysis)
        ? {
            outboundInteractions: record.outboundInteractions,
            localInteractions: record.localInteractions,
            localCausalEffects: record.localCausalEffects,
            ...(schemaVersion === CONTROL_EVIDENCE_SCHEMA_V3_VERSION ||
            schemaVersion === CONTROL_EVIDENCE_SCHEMA_V4_VERSION ||
            schemaVersion === CONTROL_EVIDENCE_SCHEMA_V5_VERSION
              ? {
                  distributedInteractions: record.distributedInteractions,
                  distributedConditionalEffects: record.distributedConditionalEffects,
                }
              : {}),
            ...(schemaVersion === CONTROL_EVIDENCE_SCHEMA_V4_VERSION ||
            schemaVersion === CONTROL_EVIDENCE_SCHEMA_V5_VERSION
              ? { jobQueueBranchIds: record.jobQueueBranchIds }
              : {}),
          }
        : {}),
      ...(schemaVersion === CONTROL_EVIDENCE_SCHEMA_V5_VERSION
        ? { authorizationRequirements: record.authorizationRequirements }
        : {}),
      requestColumnInfluences: record.requestColumnInfluences,
      diagnosticCodes: record.diagnostics.map(({ code }) => code),
      incompletenessCodes: record.incompletenessCodes,
      policyOutcomes: record.policyOutcomes,
      evidenceIds,
      sourceLocations,
    };
  });
  const document = canonicalizeControlEvidenceDocument({
    schemaVersion,
    analysis: {
      id: analysis.analysisRun.id,
      schemaVersion: analysis.schemaVersion,
      resultState: analysis.resultState,
      repositoryRevision: analysis.analysisRun.repositoryRevision,
      toolName: analysis.analysisRun.tool.name,
      toolVersion: analysis.analysisRun.tool.version,
      typescriptVersion: analysis.analysisRun.tool.typescriptVersion,
    },
    policy: {
      state: policyResults === undefined ? 'not_supplied' : 'supplied',
      schemaVersion: policyResults?.schemaVersion ?? null,
    },
    rows,
  });
  return assertValidControlEvidenceDocument({
    document,
    analysis,
    ...(policyResults === undefined ? {} : { policyResults }),
  });
}
