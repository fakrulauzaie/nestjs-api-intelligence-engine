import { canonicalStringify } from '../model/ordering.js';
import type { GraphReportDocument } from './model.js';
import { assertValidGraphReportDocument } from './validate.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { ImpactDocument } from '../impact/model.js';
import type { PolicyResultsDocument } from '../policy/model.js';

function compare(left: string, right: string): number {
  return left.localeCompare(right);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compare);
}

export function canonicalizeGraphReportDocument(
  document: GraphReportDocument,
): GraphReportDocument {
  return {
    ...document,
    endpoints: [...document.endpoints]
      .map((endpoint) => ({
        ...endpoint,
        guards: unique(endpoint.guards),
        dbReads: unique(endpoint.dbReads),
        dbWrites: unique(endpoint.dbWrites),
        ...(endpoint.localCausalEffects === undefined
          ? {}
          : {
              localCausalEffects: [...endpoint.localCausalEffects]
                .map((effect) => ({ ...effect, evidenceIds: unique(effect.evidenceIds) }))
                .sort((left, right) =>
                  compare(
                    `${left.causalClass}:${left.direction}:${left.table}`,
                    `${right.causalClass}:${right.direction}:${right.table}`,
                  ),
                ),
            }),
        ...(endpoint.distributedConditionalEffects === undefined
          ? {}
          : {
              distributedConditionalEffects: [...endpoint.distributedConditionalEffects]
                .map((effect) => ({ ...effect, evidenceIds: unique(effect.evidenceIds) }))
                .sort((left, right) =>
                  compare(`${left.direction}:${left.table}`, `${right.direction}:${right.table}`),
                ),
            }),
        diagnostics: [...endpoint.diagnostics]
          .map((diagnostic) => ({
            ...diagnostic,
            evidenceIds: unique(diagnostic.evidenceIds),
          }))
          .sort((left, right) =>
            compare(`${left.code}:${left.message}`, `${right.code}:${right.message}`),
          ),
        policyOutcomes: [...endpoint.policyOutcomes]
          .map((outcome) => ({ ...outcome, evidenceIds: unique(outcome.evidenceIds) }))
          .sort((left, right) =>
            compare(`${left.ruleId}:${left.reasonCode}`, `${right.ruleId}:${right.reasonCode}`),
          ),
        impactReasons: [...endpoint.impactReasons].sort((left, right) =>
          compare(
            `${left.category}:${left.reasonCode}:${left.subject}:${left.sourceChangePath ?? ''}`,
            `${right.category}:${right.reasonCode}:${right.subject}:${right.sourceChangePath ?? ''}`,
          ),
        ),
        scene: {
          ...endpoint.scene,
          nodes: [...endpoint.scene.nodes]
            .map((node) => ({ ...node, evidenceIds: unique(node.evidenceIds) }))
            .sort((left, right) => compare(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`)),
          edges: [...endpoint.scene.edges]
            .map((edge) => ({ ...edge, evidenceIds: unique(edge.evidenceIds) }))
            .sort((left, right) => compare(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`)),
          evidence: [...endpoint.scene.evidence].sort((left, right) => compare(left.id, right.id)),
        },
      }))
      .sort((left, right) =>
        compare(
          `${left.path}:${left.httpMethod}:${left.endpointId}`,
          `${right.path}:${right.httpMethod}:${right.endpointId}`,
        ),
      ),
  };
}

export function serializeGraphReportDocument(input: {
  readonly document: GraphReportDocument;
  readonly analysis: AnalysisDocument;
  readonly policyResults?: PolicyResultsDocument | undefined;
  readonly impact?: ImpactDocument | undefined;
}): string {
  const document = canonicalizeGraphReportDocument(input.document);
  return canonicalStringify(assertValidGraphReportDocument({ ...input, document }));
}
