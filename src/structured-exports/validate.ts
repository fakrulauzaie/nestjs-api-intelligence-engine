import {
  analysisHasAuthorizationFacts,
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import type {
  ControlEvidenceDocument,
  OpenApiEnrichmentResultDocument,
  OpenApiIntelExtension,
} from './model.js';
import {
  CONTROL_EVIDENCE_SCHEMA_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V2_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V3_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V4_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V5_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V4_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V5_VERSION,
} from './model.js';
import {
  controlEvidenceDocumentSchema,
  openApiEnrichmentResultSchema,
  openApiIntelExtensionSchema,
} from './schemas.js';

export class StructuredExportIntegrityError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Structured export integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'StructuredExportIntegrityError';
    this.issues = issues;
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function assertValidOpenApiIntelExtension(input: unknown): OpenApiIntelExtension {
  return openApiIntelExtensionSchema.parse(input);
}

export function assertValidOpenApiEnrichmentResult(
  input: unknown,
  analysis?: AnalysisDocument,
): OpenApiEnrichmentResultDocument {
  const document = openApiEnrichmentResultSchema.parse(input);
  const summary = {
    operations: document.operations.length,
    resolved: document.operations.filter(({ resolution }) => resolution === 'resolved').length,
    ambiguous: document.operations.filter(({ resolution }) => resolution === 'ambiguous').length,
    unresolved: document.operations.filter(({ resolution }) => resolution === 'unresolved').length,
    unmatched: document.operations.filter(({ resolution }) => resolution === 'unmatched').length,
    unmatchedAnalysisEndpoints: document.unmatchedAnalysisEndpoints.length,
  };
  const issues = Object.entries(summary).flatMap(([key, value]) =>
    document.summary[key as keyof typeof summary] === value
      ? []
      : [`summary.${key} does not match the operation collection.`],
  );
  const operationKeys = document.operations.map(
    ({ openApiPath, httpMethod }) => `${httpMethod}:${openApiPath}`,
  );
  if (new Set(operationKeys).size !== operationKeys.length) {
    issues.push('The OpenAPI sidecar contains duplicate source operation slots.');
  }
  if (analysis !== undefined) {
    const hasDistributedInteractionRecords =
      analysisHasInteractionFacts(analysis) &&
      (analysis.interactions.some(({ kind }) => kind === 'job_queue') ||
        analysis.interactions.some(({ kind }) => kind === 'microservice_message') ||
        analysis.interactionHandlers.some(
          ({ kind }) => kind === 'job_queue' || kind === 'microservice_message',
        ));
    const expectedSchemaVersion = analysisHasAuthorizationFacts(analysis)
      ? OPENAPI_ENRICHMENT_SCHEMA_V5_VERSION
      : analysisHasJobQueueBranchFacts(analysis)
        ? OPENAPI_ENRICHMENT_SCHEMA_V4_VERSION
        : hasDistributedInteractionRecords
          ? OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION
          : analysisHasInteractionFacts(analysis)
            ? OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION
            : OPENAPI_ENRICHMENT_SCHEMA_VERSION;
    if (document.schemaVersion !== expectedSchemaVersion) {
      issues.push('The OpenAPI sidecar schema version does not match its analysis capabilities.');
    }
    if (
      document.analysisId !== analysis.analysisRun.id ||
      document.analysisSchemaVersion !== analysis.schemaVersion
    ) {
      issues.push('The OpenAPI sidecar snapshot reference does not match the canonical analysis.');
    }
    const endpointIds = new Set(analysis.endpoints.map(({ id }) => id));
    const evidenceIds = new Set(analysis.evidence.map(({ id }) => id));
    for (const operation of document.operations) {
      if (operation.analysisEndpointIds.some((id) => !endpointIds.has(id))) {
        issues.push(
          `OpenAPI operation ${operation.httpMethod} ${operation.openApiPath} references an unknown endpoint.`,
        );
      }
      if (operation.evidenceIds.some((id) => !evidenceIds.has(id))) {
        issues.push(
          `OpenAPI operation ${operation.httpMethod} ${operation.openApiPath} references unknown evidence.`,
        );
      }
      if (operation.resolution === 'resolved' && operation.analysisEndpointIds.length !== 1) {
        issues.push(
          `Resolved OpenAPI operation ${operation.httpMethod} ${operation.openApiPath} must have one endpoint.`,
        );
      }
    }
    if (
      document.unmatchedAnalysisEndpoints.some(({ endpointId }) => !endpointIds.has(endpointId))
    ) {
      issues.push('The OpenAPI sidecar contains a non-canonical unmatched endpoint.');
    }
  }
  if (issues.length > 0) throw new StructuredExportIntegrityError(issues);
  return document;
}

export function assertValidControlEvidenceDocument(input: {
  readonly document: unknown;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
}): ControlEvidenceDocument {
  const document = controlEvidenceDocumentSchema.parse(input.document);
  const issues: string[] = [];
  const hasDistributedInteractionRecords =
    analysisHasInteractionFacts(input.analysis) &&
    (input.analysis.interactions.some(({ kind }) => kind === 'job_queue') ||
      input.analysis.interactions.some(({ kind }) => kind === 'microservice_message') ||
      input.analysis.interactionHandlers.some(
        ({ kind }) => kind === 'job_queue' || kind === 'microservice_message',
      ));
  const expectedSchemaVersion = analysisHasAuthorizationFacts(input.analysis)
    ? CONTROL_EVIDENCE_SCHEMA_V5_VERSION
    : analysisHasJobQueueBranchFacts(input.analysis)
      ? CONTROL_EVIDENCE_SCHEMA_V4_VERSION
      : hasDistributedInteractionRecords
        ? CONTROL_EVIDENCE_SCHEMA_V3_VERSION
        : analysisHasInteractionFacts(input.analysis)
          ? CONTROL_EVIDENCE_SCHEMA_V2_VERSION
          : CONTROL_EVIDENCE_SCHEMA_VERSION;
  if (document.schemaVersion !== expectedSchemaVersion) {
    issues.push('The matrix schema version does not match its analysis capabilities.');
  }
  if (
    document.analysis.id !== input.analysis.analysisRun.id ||
    document.analysis.schemaVersion !== input.analysis.schemaVersion
  ) {
    issues.push('The matrix snapshot reference does not match the canonical analysis.');
  }
  const expectedPolicyState = input.policyResults === undefined ? 'not_supplied' : 'supplied';
  if (
    document.policy.state !== expectedPolicyState ||
    document.policy.schemaVersion !== (input.policyResults?.schemaVersion ?? null)
  ) {
    issues.push('The matrix policy reference does not match its validated policy input.');
  }
  const endpointIds = input.analysis.endpoints.map(({ id }) => id).sort();
  const rowIds = document.rows.map(({ endpointId }) => endpointId).sort();
  if (new Set(rowIds).size !== rowIds.length || rowIds.join('|') !== endpointIds.join('|')) {
    issues.push('The matrix must contain exactly one row for every canonical endpoint.');
  }

  const allowedEvidenceIds = new Set([
    ...input.analysis.evidence.map(({ id }) => id),
    ...(input.policyResults?.results.flatMap(({ evidenceIds }) => evidenceIds) ?? []),
  ]);
  const canonicalTableNames = new Set(input.analysis.tables.map(({ name }) => name));
  const canonicalInteractionIds = new Set(
    analysisHasInteractionFacts(input.analysis)
      ? input.analysis.interactions.map(({ id }) => id)
      : [],
  );
  const canonicalBranchIds = new Set(
    analysisHasJobQueueBranchFacts(input.analysis)
      ? input.analysis.interactionHandlerBranches.map(({ id }) => id)
      : [],
  );
  for (const row of document.rows) {
    if (
      row.analysisId !== document.analysis.id ||
      row.analysisSchemaVersion !== document.analysis.schemaVersion ||
      row.toolName !== document.analysis.toolName ||
      row.toolVersion !== document.analysis.toolVersion
    ) {
      issues.push(`Endpoint row ${row.endpointId} has inconsistent snapshot metadata.`);
    }
    for (const table of [...row.dbReads, ...row.dbWrites]) {
      if (!canonicalTableNames.has(table)) {
        issues.push(`Endpoint row ${row.endpointId} references non-canonical table ${table}.`);
      }
    }
    for (const effect of row.localCausalEffects ?? []) {
      if (!canonicalTableNames.has(effect.table)) {
        issues.push(
          `Endpoint row ${row.endpointId} references non-canonical local-effect table ${effect.table}.`,
        );
      }
    }
    for (const effect of row.distributedConditionalEffects ?? []) {
      if (!canonicalTableNames.has(effect.table)) {
        issues.push(
          `Endpoint row ${row.endpointId} references non-canonical distributed-effect table ${effect.table}.`,
        );
      }
    }
    for (const interaction of [
      ...(row.outboundInteractions ?? []),
      ...(row.localInteractions ?? []),
      ...(row.distributedInteractions ?? []),
    ]) {
      if (!canonicalInteractionIds.has(interaction.interactionId)) {
        issues.push(
          `Endpoint row ${row.endpointId} references non-canonical interaction ${interaction.interactionId}.`,
        );
      }
    }
    if ((row.jobQueueBranchIds ?? []).some((id) => !canonicalBranchIds.has(id))) {
      issues.push(`Endpoint row ${row.endpointId} references a non-canonical job-queue branch.`);
    }
    for (const evidenceId of row.evidenceIds) {
      if (!allowedEvidenceIds.has(evidenceId)) {
        issues.push(`Endpoint row ${row.endpointId} references unknown evidence ${evidenceId}.`);
      }
    }
    const rowEvidence = new Set(row.evidenceIds);
    const nestedEvidence = [
      ...row.directGuards.flatMap(({ evidenceIds }) => evidenceIds),
      ...row.globalGuards.flatMap(({ evidenceIds }) => evidenceIds),
      ...row.requestColumnInfluences.flatMap(({ evidenceIds }) => evidenceIds),
      ...row.policyOutcomes.flatMap(({ evidenceIds }) => evidenceIds),
      ...(row.outboundInteractions ?? []).flatMap(({ evidenceIds }) => evidenceIds),
      ...(row.localInteractions ?? []).flatMap(({ evidenceIds }) => evidenceIds),
      ...(row.localCausalEffects ?? []).flatMap(({ evidenceIds }) => evidenceIds),
      ...(row.distributedInteractions ?? []).flatMap(({ evidenceIds }) => evidenceIds),
      ...(row.distributedConditionalEffects ?? []).flatMap(({ evidenceIds }) => evidenceIds),
      ...(row.authorizationRequirements ?? []).flatMap(({ evidenceIds }) => evidenceIds),
    ];
    if (nestedEvidence.some((id) => !rowEvidence.has(id))) {
      issues.push(`Endpoint row ${row.endpointId} omits nested supporting evidence.`);
    }
    if (row.evidenceIds.join('|') !== sortedUnique(row.evidenceIds).join('|')) {
      issues.push(`Endpoint row ${row.endpointId} evidence IDs are not unique and ordered.`);
    }
  }
  if (issues.length > 0) throw new StructuredExportIntegrityError(sortedUnique(issues));
  return document;
}
