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
    ...(document.architecture === undefined
      ? {}
      : {
          architecture: {
            ...document.architecture,
            metricLegends: [...document.architecture.metricLegends].sort((left, right) =>
              compare(left.metric, right.metric),
            ),
            records: [...document.architecture.records]
              .map((record) => ({
                ...record,
                metrics: [...record.metrics].sort((left, right) =>
                  compare(left.metric, right.metric),
                ),
              }))
              .sort((left, right) =>
                compare(
                  `${left.recordKind}:${left.recordId}`,
                  `${right.recordKind}:${right.recordId}`,
                ),
              ),
            moduleOwnership: [...document.architecture.moduleOwnership]
              .map((ownership) => ({
                ...ownership,
                moduleIds: unique(ownership.moduleIds),
              }))
              .sort((left, right) =>
                compare(
                  `${left.recordKind}:${left.recordId}`,
                  `${right.recordKind}:${right.recordId}`,
                ),
              ),
            scene: {
              ...document.architecture.scene,
              nodes: [...document.architecture.scene.nodes]
                .map((node) => ({
                  ...node,
                  evidenceIds: unique(node.evidenceIds),
                  ...(node.architectureMetrics === undefined
                    ? {}
                    : {
                        architectureMetrics: [...node.architectureMetrics].sort((left, right) =>
                          compare(left.metric, right.metric),
                        ),
                      }),
                  ...(node.moduleOwnership === undefined
                    ? {}
                    : {
                        moduleOwnership: {
                          ...node.moduleOwnership,
                          moduleIds: unique(node.moduleOwnership.moduleIds),
                        },
                      }),
                }))
                .sort((left, right) =>
                  compare(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`),
                ),
              edges: [...document.architecture.scene.edges]
                .map((edge) => ({ ...edge, evidenceIds: unique(edge.evidenceIds) }))
                .sort((left, right) =>
                  compare(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`),
                ),
              evidence: [...document.architecture.scene.evidence].sort((left, right) =>
                compare(left.id, right.id),
              ),
            },
          },
        }),
    ...(document.interactionHandlers === undefined
      ? {}
      : {
          interactionHandlers: [...document.interactionHandlers]
            .map((handler) => ({
              ...handler,
              dbReads: unique(handler.dbReads),
              dbWrites: unique(handler.dbWrites),
              producerInteractionIds: unique(handler.producerInteractionIds),
              ...(handler.jobQueueDispatch === undefined
                ? {}
                : {
                    jobQueueDispatch:
                      handler.jobQueueDispatch === null
                        ? null
                        : {
                            ...handler.jobQueueDispatch,
                            branches: [...handler.jobQueueDispatch.branches]
                              .map((branch) => ({
                                ...branch,
                                effects: [...branch.effects].sort((left, right) =>
                                  compare(left.effectId, right.effectId),
                                ),
                              }))
                              .sort((left, right) => compare(left.branchId, right.branchId)),
                          },
                  }),
              diagnostics: [...handler.diagnostics]
                .map((diagnostic) => ({
                  ...diagnostic,
                  evidenceIds: unique(diagnostic.evidenceIds),
                }))
                .sort((left, right) =>
                  compare(`${left.code}:${left.message}`, `${right.code}:${right.message}`),
                ),
              scene: {
                ...handler.scene,
                nodes: [...handler.scene.nodes]
                  .map((node) => ({ ...node, evidenceIds: unique(node.evidenceIds) }))
                  .sort((left, right) =>
                    compare(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`),
                  ),
                edges: [...handler.scene.edges]
                  .map((edge) => ({ ...edge, evidenceIds: unique(edge.evidenceIds) }))
                  .sort((left, right) =>
                    compare(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`),
                  ),
                evidence: [...handler.scene.evidence].sort((left, right) =>
                  compare(left.id, right.id),
                ),
              },
            }))
            .sort((left, right) =>
              compare(
                `${left.kind}:${left.target}:${left.handlerId}`,
                `${right.kind}:${right.target}:${right.handlerId}`,
              ),
            ),
        }),
    endpoints: [...document.endpoints]
      .map((endpoint) => ({
        ...endpoint,
        guards: unique(endpoint.guards),
        dbReads: unique(endpoint.dbReads),
        dbWrites: unique(endpoint.dbWrites),
        ...(endpoint.jobQueueBranchIds === undefined
          ? {}
          : { jobQueueBranchIds: unique(endpoint.jobQueueBranchIds) }),
        ...(endpoint.authorizationRequirements === undefined
          ? {}
          : {
              authorizationRequirements: [...endpoint.authorizationRequirements]
                .map((requirement) => ({
                  ...requirement,
                  valueShape:
                    requirement.valueShape.kind === 'array'
                      ? {
                          ...requirement.valueShape,
                          itemTypes: [...new Set(requirement.valueShape.itemTypes)].sort(),
                        }
                      : requirement.valueShape.kind === 'object'
                        ? { ...requirement.valueShape, keys: unique(requirement.valueShape.keys) }
                        : requirement.valueShape,
                  evidenceIds: unique(requirement.evidenceIds),
                }))
                .sort((left, right) =>
                  compare(
                    `${left.metadataKey}:${left.scope}:${left.enforcementState}:${left.guardName ?? ''}`,
                    `${right.metadataKey}:${right.scope}:${right.enforcementState}:${right.guardName ?? ''}`,
                  ),
                ),
            }),
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
