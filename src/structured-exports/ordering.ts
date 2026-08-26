import { canonicalStringify } from '../model/ordering.js';
import type { ControlEvidenceDocument, OpenApiEnrichmentResultDocument } from './model.js';
import {
  assertValidControlEvidenceDocument,
  assertValidOpenApiEnrichmentResult,
} from './validate.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { PolicyResultsDocument } from '../policy/model.js';

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalizeOpenApiEnrichmentResult(
  document: OpenApiEnrichmentResultDocument,
): OpenApiEnrichmentResultDocument {
  return {
    ...document,
    operations: [...document.operations]
      .map((operation) => ({
        ...operation,
        analysisEndpointIds: sortedUnique(operation.analysisEndpointIds),
        evidenceIds: sortedUnique(operation.evidenceIds),
      }))
      .sort((left, right) =>
        `${left.normalizedPath}:${left.httpMethod}:${left.openApiPath}`.localeCompare(
          `${right.normalizedPath}:${right.httpMethod}:${right.openApiPath}`,
        ),
      ),
    unmatchedAnalysisEndpoints: [...document.unmatchedAnalysisEndpoints].sort((left, right) =>
      `${left.mappedOpenApiPath}:${left.httpMethod}:${left.endpointId}`.localeCompare(
        `${right.mappedOpenApiPath}:${right.httpMethod}:${right.endpointId}`,
      ),
    ),
  };
}

export function serializeOpenApiEnrichmentResult(
  document: OpenApiEnrichmentResultDocument,
): string {
  return canonicalStringify(
    assertValidOpenApiEnrichmentResult(canonicalizeOpenApiEnrichmentResult(document)),
  );
}

export function canonicalizeControlEvidenceDocument(
  document: ControlEvidenceDocument,
): ControlEvidenceDocument {
  return {
    ...document,
    rows: [...document.rows]
      .map((row) => ({
        ...row,
        directGuards: [...row.directGuards]
          .map((guard) => ({ ...guard, evidenceIds: sortedUnique(guard.evidenceIds) }))
          .sort((left, right) =>
            `${left.scope}:${left.name}`.localeCompare(`${right.scope}:${right.name}`),
          ),
        globalGuards: [...row.globalGuards]
          .map((guard) => ({ ...guard, evidenceIds: sortedUnique(guard.evidenceIds) }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        dbReads: sortedUnique(row.dbReads),
        dbWrites: sortedUnique(row.dbWrites),
        ...(row.outboundInteractions === undefined
          ? {}
          : {
              outboundInteractions: [...row.outboundInteractions]
                .map((interaction) => ({
                  ...interaction,
                  handlerStates: [...interaction.handlerStates].sort(),
                  evidenceIds: sortedUnique(interaction.evidenceIds),
                }))
                .sort((left, right) => left.interactionId.localeCompare(right.interactionId)),
            }),
        ...(row.localInteractions === undefined
          ? {}
          : {
              localInteractions: [...row.localInteractions]
                .map((interaction) => ({
                  ...interaction,
                  handlerStates: [...interaction.handlerStates].sort(),
                  evidenceIds: sortedUnique(interaction.evidenceIds),
                }))
                .sort((left, right) => left.interactionId.localeCompare(right.interactionId)),
            }),
        ...(row.localCausalEffects === undefined
          ? {}
          : {
              localCausalEffects: [...row.localCausalEffects]
                .map((effect) => ({ ...effect, evidenceIds: sortedUnique(effect.evidenceIds) }))
                .sort((left, right) =>
                  `${left.causalClass}:${left.direction}:${left.table}`.localeCompare(
                    `${right.causalClass}:${right.direction}:${right.table}`,
                  ),
                ),
            }),
        ...(row.distributedInteractions === undefined
          ? {}
          : {
              distributedInteractions: [...row.distributedInteractions]
                .map((interaction) => ({
                  ...interaction,
                  handlerStates: [...interaction.handlerStates].sort(),
                  evidenceIds: sortedUnique(interaction.evidenceIds),
                }))
                .sort((left, right) => left.interactionId.localeCompare(right.interactionId)),
            }),
        ...(row.distributedConditionalEffects === undefined
          ? {}
          : {
              distributedConditionalEffects: [...row.distributedConditionalEffects]
                .map((effect) => ({ ...effect, evidenceIds: sortedUnique(effect.evidenceIds) }))
                .sort((left, right) =>
                  `${left.direction}:${left.table}`.localeCompare(
                    `${right.direction}:${right.table}`,
                  ),
                ),
            }),
        requestColumnInfluences: [...row.requestColumnInfluences]
          .map((influence) => ({
            ...influence,
            evidenceIds: sortedUnique(influence.evidenceIds),
          }))
          .sort((left, right) =>
            `${left.origin}:${left.column}:${left.sinkMethod}`.localeCompare(
              `${right.origin}:${right.column}:${right.sinkMethod}`,
            ),
          ),
        diagnosticCodes: sortedUnique(row.diagnosticCodes),
        incompletenessCodes: sortedUnique(row.incompletenessCodes),
        policyOutcomes: [...row.policyOutcomes]
          .map((outcome) => ({ ...outcome, evidenceIds: sortedUnique(outcome.evidenceIds) }))
          .sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
        evidenceIds: sortedUnique(row.evidenceIds),
        sourceLocations: sortedUnique(row.sourceLocations),
      }))
      .sort((left, right) =>
        `${left.path}:${left.httpMethod}:${left.handler ?? ''}:${left.endpointId}`.localeCompare(
          `${right.path}:${right.httpMethod}:${right.handler ?? ''}:${right.endpointId}`,
        ),
      ),
  };
}

export function serializeControlEvidenceDocument(input: {
  readonly document: ControlEvidenceDocument;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
}): string {
  const document = canonicalizeControlEvidenceDocument(input.document);
  return canonicalStringify(
    assertValidControlEvidenceDocument({
      document,
      analysis: input.analysis,
      ...(input.policyResults === undefined ? {} : { policyResults: input.policyResults }),
    }),
  );
}
