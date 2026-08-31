import type {
  AnalysisDocument,
  AnalysisResultState,
  DirectGuardState,
  EffectiveGuardState,
  GlobalGuardState,
  GuardScope,
} from '../model/analysis.js';
import { analysisHasInteractionFacts, analysisHasResourceAccessFacts } from '../model/analysis.js';
import type { AssertionStatus } from '../model/assertions.js';
import type { DiagnosticCode } from '../model/diagnostics.js';
import type { HttpMethod } from '../model/entities.js';
import { interactionTargetKey } from '../model/interactions.js';
import { resourceAccessLabel } from '../model/resource-access.js';
import { normalizeRoutePath } from '../extractors/route-paths.js';
import { buildEffectiveEndpointGuards } from '../guards/effective.js';
import {
  buildEndpointAuthorization,
  type EndpointAuthorizationRequirement,
} from '../authorization/endpoint-authorization.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import {
  inProcessEventTargetLabel,
  jobQueueTargetLabel,
  microserviceMessageTargetLabel,
  outboundHttpTargetLabel,
} from './interaction-labels.js';

export type EndpointSelectionStatus = 'resolved' | 'ambiguous' | 'unresolved';
export interface EndpointCatalogueFilter {
  readonly controller?: string;
  readonly route?: string;
}

export interface EndpointCatalogueGuard {
  readonly guardId: string;
  readonly name: string;
  readonly scope: GuardScope;
  readonly status: AssertionStatus;
  readonly evidence: readonly string[];
}

export interface EndpointCatalogueEntry {
  readonly endpointId: string;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly handlerMethodId: string | null;
  readonly handlerQualifiedName: string | null;
  readonly selectionStatus: EndpointSelectionStatus;
  readonly directGuardState: DirectGuardState;
  readonly globalGuardState: GlobalGuardState;
  readonly effectiveGuardState: EffectiveGuardState;
  readonly directGuards: readonly EndpointCatalogueGuard[];
  readonly globalGuards: readonly EndpointCatalogueGuard[];
  readonly guards: readonly EndpointCatalogueGuard[];
  readonly authorizationAvailability: 'available' | 'unavailable';
  readonly authorizationRequirements: readonly EndpointAuthorizationRequirement[];
  readonly evidence: readonly string[];
  readonly outboundHttpInteractions?:
    | readonly {
        readonly interactionId: string;
        readonly label: string;
        readonly resolution: 'exact' | 'template' | 'symbolic' | 'dynamic';
        readonly activation: 'eager' | 'proven_activated' | 'constructed_cold' | 'unknown';
      }[]
    | undefined;
  readonly inProcessEventInteractions?:
    | readonly {
        readonly interactionId: string;
        readonly label: string;
        readonly dispatchTiming: 'synchronous' | 'asynchronous' | 'unknown';
        readonly handlerStates: readonly string[];
        readonly handlerCandidates: readonly string[];
      }[]
    | undefined;
  readonly jobQueueInteractions?:
    | readonly {
        readonly interactionId: string;
        readonly label: string;
        readonly boundary:
          | 'in_process'
          | 'broker_or_worker_boundary'
          | 'external_or_unobserved'
          | 'unknown';
        readonly handlerStates: readonly string[];
        readonly handlerCandidates: readonly string[];
      }[]
    | undefined;
  readonly microserviceMessageInteractions?:
    | readonly {
        readonly interactionId: string;
        readonly label: string;
        readonly mode: 'request_response' | 'event';
        readonly activation: 'eager' | 'proven_activated' | 'constructed_cold' | 'unknown';
        readonly boundary:
          | 'in_process'
          | 'broker_or_worker_boundary'
          | 'external_or_unobserved'
          | 'unknown';
        readonly handlerStates: readonly string[];
        readonly handlerCandidates: readonly string[];
      }[]
    | undefined;
  readonly resourceAccesses?:
    | readonly {
        readonly resourceAccessId: string;
        readonly label: string;
        readonly resourceKind: string;
        readonly operation: string;
        readonly causalClass: string;
      }[]
    | undefined;
}

export interface EndpointCatalogueDiagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
}

export interface EndpointCatalogueView {
  readonly schemaVersion: AnalysisDocument['schemaVersion'];
  readonly analysisId: string;
  readonly resultState: AnalysisResultState;
  readonly filter: EndpointCatalogueFilter;
  readonly totalEndpointCount: number;
  readonly endpoints: readonly EndpointCatalogueEntry[];
  readonly diagnostics: readonly EndpointCatalogueDiagnostic[];
}

function compareEntries(left: EndpointCatalogueEntry, right: EndpointCatalogueEntry): number {
  return `${left.path}:${left.httpMethod}:${left.handlerQualifiedName ?? ''}:${left.endpointId}`.localeCompare(
    `${right.path}:${right.httpMethod}:${right.handlerQualifiedName ?? ''}:${right.endpointId}`,
  );
}

export function buildEndpointCatalogue(
  analysis: AnalysisDocument,
  filter: EndpointCatalogueFilter = {},
): EndpointCatalogueView {
  const methods = new Map(analysis.methods.map((method) => [method.id, method]));
  const classes = new Map(analysis.classes.map((record) => [record.id, record]));
  const sources = new Map(analysis.sourceFiles.map((source) => [source.id, source]));
  const evidence = new Map(analysis.evidence.map((record) => [record.id, record]));
  const interactionById = analysisHasInteractionFacts(analysis)
    ? new Map(analysis.interactions.map((interaction) => [interaction.id, interaction]))
    : new Map();
  const implementationByEndpoint = new Map(
    analysis.assertions
      .filter((assertion) => assertion.predicate === 'ENDPOINT_IMPLEMENTED_BY')
      .map((assertion) => [assertion.subjectId, assertion]),
  );
  const duplicateCounts = new Map<string, number>();
  for (const endpoint of analysis.endpoints) {
    const key = `${endpoint.httpMethod}:${endpoint.path}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const normalizedFilter: EndpointCatalogueFilter = {
    ...(filter.controller === undefined ? {} : { controller: filter.controller }),
    ...(filter.route === undefined ? {} : { route: normalizeRoutePath(filter.route) }),
  };
  const endpoints = analysis.endpoints
    .map((endpoint): EndpointCatalogueEntry => {
      const implementation = implementationByEndpoint.get(endpoint.id);
      const handler =
        implementation?.objectId === null || implementation?.objectId === undefined
          ? undefined
          : methods.get(implementation.objectId);
      const duplicate = (duplicateCounts.get(`${endpoint.httpMethod}:${endpoint.path}`) ?? 0) > 1;
      const references = (implementation?.evidenceIds ?? []).flatMap((evidenceId) => {
        const record = evidence.get(evidenceId);
        const source = record === undefined ? undefined : sources.get(record.fileId);
        return record === undefined || source === undefined
          ? []
          : [`${source.path}:${record.startLine}:${record.startColumn}`];
      });
      const guardView = buildEffectiveEndpointGuards(analysis, endpoint.id);
      const mapGuards = (
        values: ReturnType<typeof buildEffectiveEndpointGuards>['effectiveGuards'],
      ): EndpointCatalogueGuard[] =>
        values.map((guard) => {
          const guardEvidence = guard.evidenceIds.flatMap((evidenceId) => {
            const record = evidence.get(evidenceId);
            const source = record === undefined ? undefined : sources.get(record.fileId);
            return record === undefined || source === undefined
              ? []
              : [`${source.path}:${record.startLine}:${record.startColumn}`];
          });
          return {
            guardId: guard.guardId,
            name: guard.name,
            scope: guard.scope,
            status: guard.status,
            evidence: [...new Set(guardEvidence)].sort(),
          };
        });
      const directGuards = mapGuards(guardView.directGuards);
      const globalGuards = mapGuards(guardView.globalGuards);
      const guards = mapGuards(guardView.effectiveGuards);
      const authorization = buildEndpointAuthorization(analysis, endpoint.id);
      const trace =
        handler === undefined || duplicate
          ? null
          : buildEndpointTrace(analysis, {
              httpMethod: endpoint.httpMethod,
              path: endpoint.path,
            });
      const outboundHttpInteractions =
        trace?.status !== 'resolved'
          ? []
          : trace.trace.steps.flatMap((step) => {
              if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
              const interaction = interactionById.get(step.toId);
              return interaction?.kind === 'outbound_http'
                ? [
                    {
                      interactionId: interaction.id,
                      label: outboundHttpTargetLabel(interaction.target),
                      resolution: interaction.target.url.resolution,
                      activation: interaction.activation,
                    },
                  ]
                : [];
            });
      const handlerById = analysisHasInteractionFacts(analysis)
        ? new Map(analysis.interactionHandlers.map((handler) => [handler.id, handler]))
        : new Map();
      const handlerStatesByInteraction = new Map<string, string[]>();
      const handlerCandidatesByInteraction = new Map<string, string[]>();
      if (trace?.status === 'resolved') {
        for (const step of trace.trace.steps) {
          if (step.relation !== 'INTERACTION_MATCHES_LOCAL_HANDLER' || step.toId === null) continue;
          const handler = handlerById.get(step.toId);
          if (handler === undefined) continue;
          handlerStatesByInteraction.set(step.fromId, [
            ...(handlerStatesByInteraction.get(step.fromId) ?? []),
            handler.registrationState,
          ]);
          handlerCandidatesByInteraction.set(step.fromId, [
            ...(handlerCandidatesByInteraction.get(step.fromId) ?? []),
            `${
              handler.kind === 'in_process_event'
                ? inProcessEventTargetLabel(handler.target)
                : handler.kind === 'job_queue'
                  ? jobQueueTargetLabel(handler.target)
                  : handler.kind === 'microservice_message'
                    ? microserviceMessageTargetLabel(handler.target)
                    : interactionTargetKey(handler.target)
            } (${handler.registrationState}${handler.kind === 'microservice_message' ? `; ${step.status}` : ''})`,
          ]);
        }
      }
      const inProcessEventInteractions =
        trace?.status !== 'resolved'
          ? []
          : trace.trace.steps.flatMap((step) => {
              if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
              const interaction = interactionById.get(step.toId);
              return interaction?.kind === 'in_process_event'
                ? [
                    {
                      interactionId: interaction.id,
                      label: inProcessEventTargetLabel(interaction.target),
                      dispatchTiming: interaction.dispatchTiming,
                      handlerStates: [
                        ...new Set(handlerStatesByInteraction.get(interaction.id) ?? []),
                      ].sort(),
                      handlerCandidates: [
                        ...new Set(handlerCandidatesByInteraction.get(interaction.id) ?? []),
                      ].sort(),
                    },
                  ]
                : [];
            });
      const jobQueueInteractions =
        trace?.status !== 'resolved'
          ? []
          : trace.trace.steps.flatMap((step) => {
              if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
              const interaction = interactionById.get(step.toId);
              return interaction?.kind === 'job_queue'
                ? [
                    {
                      interactionId: interaction.id,
                      label: jobQueueTargetLabel(interaction.target),
                      boundary: interaction.boundary,
                      handlerStates: [
                        ...new Set(handlerStatesByInteraction.get(interaction.id) ?? []),
                      ].sort(),
                      handlerCandidates: [
                        ...new Set(handlerCandidatesByInteraction.get(interaction.id) ?? []),
                      ].sort(),
                    },
                  ]
                : [];
            });
      const microserviceMessageInteractions =
        trace?.status !== 'resolved'
          ? []
          : trace.trace.steps.flatMap((step) => {
              if (step.relation !== 'METHOD_INITIATES_INTERACTION' || step.toId === null) return [];
              const interaction = interactionById.get(step.toId);
              return interaction?.kind === 'microservice_message'
                ? [
                    {
                      interactionId: interaction.id,
                      label: microserviceMessageTargetLabel(interaction.target),
                      mode: interaction.target.mode,
                      activation: interaction.activation,
                      boundary: interaction.boundary,
                      handlerStates: [
                        ...new Set(handlerStatesByInteraction.get(interaction.id) ?? []),
                      ].sort(),
                      handlerCandidates: [
                        ...new Set(handlerCandidatesByInteraction.get(interaction.id) ?? []),
                      ].sort(),
                    },
                  ]
                : [];
            });
      const resourceAccessById = new Map(
        analysisHasResourceAccessFacts(analysis)
          ? analysis.resourceAccesses.map((access) => [access.id, access])
          : [],
      );
      const resourceAccesses =
        trace?.status !== 'resolved'
          ? []
          : (trace.trace.resourceTerminals ?? []).flatMap((terminal) => {
              const access = resourceAccessById.get(terminal.resourceAccessId);
              return access === undefined
                ? []
                : [
                    {
                      resourceAccessId: access.id,
                      label: resourceAccessLabel(access),
                      resourceKind: access.resourceKind,
                      operation: access.operation,
                      causalClass: terminal.causalClass,
                    },
                  ];
            });

      return {
        endpointId: endpoint.id,
        httpMethod: endpoint.httpMethod,
        path: endpoint.path,
        handlerMethodId: handler?.id ?? null,
        handlerQualifiedName: handler?.qualifiedName ?? null,
        selectionStatus:
          handler === undefined ? 'unresolved' : duplicate ? 'ambiguous' : 'resolved',
        directGuardState: guardView.directGuardState,
        globalGuardState: guardView.globalGuardState,
        effectiveGuardState: guardView.effectiveGuardState,
        directGuards,
        globalGuards,
        guards,
        authorizationAvailability: authorization.availability,
        authorizationRequirements: authorization.requirements,
        evidence: [...new Set(references)].sort(),
        ...(outboundHttpInteractions.length === 0
          ? {}
          : {
              outboundHttpInteractions: outboundHttpInteractions.sort((left, right) =>
                left.interactionId.localeCompare(right.interactionId),
              ),
            }),
        ...(inProcessEventInteractions.length === 0
          ? {}
          : {
              inProcessEventInteractions: inProcessEventInteractions.sort((left, right) =>
                left.interactionId.localeCompare(right.interactionId),
              ),
            }),
        ...(jobQueueInteractions.length === 0
          ? {}
          : {
              jobQueueInteractions: jobQueueInteractions.sort((left, right) =>
                left.interactionId.localeCompare(right.interactionId),
              ),
            }),
        ...(microserviceMessageInteractions.length === 0
          ? {}
          : {
              microserviceMessageInteractions: microserviceMessageInteractions.sort((left, right) =>
                left.interactionId.localeCompare(right.interactionId),
              ),
            }),
        ...(resourceAccesses.length === 0
          ? {}
          : {
              resourceAccesses: resourceAccesses.sort((left, right) =>
                left.resourceAccessId.localeCompare(right.resourceAccessId),
              ),
            }),
      };
    })
    .filter((endpoint) => {
      if (normalizedFilter.route !== undefined && endpoint.path !== normalizedFilter.route) {
        return false;
      }
      if (normalizedFilter.controller === undefined) return true;
      const handler =
        endpoint.handlerMethodId === null ? undefined : methods.get(endpoint.handlerMethodId);
      const controller = handler === undefined ? undefined : classes.get(handler.classId);
      return (
        controller?.displayName === normalizedFilter.controller ||
        controller?.qualifiedName === normalizedFilter.controller
      );
    })
    .sort(compareEntries);

  return {
    schemaVersion: analysis.schemaVersion,
    analysisId: analysis.analysisRun.id,
    resultState: analysis.resultState,
    filter: normalizedFilter,
    totalEndpointCount: analysis.endpoints.length,
    endpoints,
    diagnostics: analysis.diagnostics
      .map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message }))
      .sort((left, right) =>
        `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`),
      ),
  };
}

function escapeTableCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderEndpointCatalogueMarkdown(catalogue: EndpointCatalogueView): string {
  const lines = [
    '# Endpoint Catalogue',
    '',
    `Analysis: \`${catalogue.analysisId}\`  `,
    `Result: \`${catalogue.resultState}\`  `,
    `Endpoints: ${catalogue.endpoints.length} of ${catalogue.totalEndpointCount}`,
    ...(catalogue.filter.controller === undefined && catalogue.filter.route === undefined
      ? []
      : [
          `Filter: ${[
            catalogue.filter.controller === undefined
              ? undefined
              : `controller=\`${catalogue.filter.controller}\``,
            catalogue.filter.route === undefined
              ? undefined
              : `route=\`${catalogue.filter.route}\``,
          ]
            .filter((value) => value !== undefined)
            .join(', ')}`,
        ]),
    '',
    '| Method | Path | Handler | Selection | Direct guards | Global guards | Effective state | Authorization metadata | Evidence |',
    '|---|---|---|---|---|---|---|---|---|',
    ...catalogue.endpoints.map(
      (endpoint) =>
        `| ${endpoint.httpMethod} | \`${escapeTableCell(endpoint.path)}\` | ${escapeTableCell(endpoint.handlerQualifiedName ?? 'unresolved')} | ${endpoint.selectionStatus} | ${escapeTableCell(endpoint.directGuards.length === 0 ? endpoint.directGuardState : endpoint.directGuards.map((guard) => `${guard.scope}: ${guard.name}`).join('<br>'))} | ${escapeTableCell(endpoint.globalGuards.length === 0 ? endpoint.globalGuardState : endpoint.globalGuards.map((guard) => guard.name).join('<br>'))} | ${endpoint.effectiveGuardState} | ${escapeTableCell(endpoint.authorizationAvailability === 'unavailable' ? 'unavailable' : endpoint.authorizationRequirements.length === 0 ? 'none_proven' : endpoint.authorizationRequirements.map((requirement) => `${requirement.scope}: ${requirement.metadataKey} (${requirement.enforcementState}${requirement.guardName === null ? '' : `; ${requirement.guardName}`})`).join('<br>'))} | ${escapeTableCell(endpoint.evidence.join('<br>'))} |`,
    ),
  ];

  if (catalogue.diagnostics.length > 0) {
    lines.push('', '## Diagnostics', '');
    for (const diagnostic of catalogue.diagnostics) {
      lines.push(`- \`${diagnostic.code}\`: ${diagnostic.message}`);
    }
  }

  const outbound = catalogue.endpoints.flatMap((endpoint) =>
    (endpoint.outboundHttpInteractions ?? []).map((interaction) => ({ endpoint, interaction })),
  );
  if (outbound.length > 0) {
    lines.push(
      '',
      '## Outbound HTTP interactions',
      '',
      '| Endpoint | Method and target | Resolution | Activation |',
      '|---|---|---|---|',
      ...outbound.map(
        ({ endpoint, interaction }) =>
          `| ${endpoint.httpMethod} ${escapeTableCell(endpoint.path)} | ${escapeTableCell(interaction.label)} | ${interaction.resolution} | ${interaction.activation} |`,
      ),
    );
  }

  const localEvents = catalogue.endpoints.flatMap((endpoint) =>
    (endpoint.inProcessEventInteractions ?? []).map((interaction) => ({
      endpoint,
      interaction,
    })),
  );
  if (localEvents.length > 0) {
    lines.push(
      '',
      '## In-process event interactions',
      '',
      '| Endpoint | Event identity | Dispatch timing | Local handler candidates |',
      '|---|---|---|---|',
      ...localEvents.map(
        ({ endpoint, interaction }) =>
          `| ${endpoint.httpMethod} ${escapeTableCell(endpoint.path)} | ${escapeTableCell(interaction.label)} | ${interaction.dispatchTiming} | ${escapeTableCell(interaction.handlerCandidates.length === 0 ? 'none_proven' : interaction.handlerCandidates.join(', '))} |`,
      ),
    );
  }

  const jobQueues = catalogue.endpoints.flatMap((endpoint) =>
    (endpoint.jobQueueInteractions ?? []).map((interaction) => ({ endpoint, interaction })),
  );
  if (jobQueues.length > 0) {
    lines.push(
      '',
      '## BullMQ interactions',
      '',
      '| Endpoint | Queue and job | Boundary | In-repository worker candidates |',
      '|---|---|---|---|',
      ...jobQueues.map(
        ({ endpoint, interaction }) =>
          `| ${endpoint.httpMethod} ${escapeTableCell(endpoint.path)} | ${escapeTableCell(interaction.label)} | ${interaction.boundary} | ${escapeTableCell(interaction.handlerCandidates.length === 0 ? 'none_proven' : interaction.handlerCandidates.join(', '))} |`,
      ),
    );
  }

  const microserviceMessages = catalogue.endpoints.flatMap((endpoint) =>
    (endpoint.microserviceMessageInteractions ?? []).map((interaction) => ({
      endpoint,
      interaction,
    })),
  );
  if (microserviceMessages.length > 0) {
    lines.push(
      '',
      '## Nest microservice interactions',
      '',
      '| Endpoint | Mode, pattern, client, and transport | Activation | Boundary | In-repository delivery candidates |',
      '|---|---|---|---|---|',
      ...microserviceMessages.map(
        ({ endpoint, interaction }) =>
          `| ${endpoint.httpMethod} ${escapeTableCell(endpoint.path)} | ${escapeTableCell(interaction.label)} | ${interaction.activation} | ${interaction.boundary} | ${escapeTableCell(interaction.handlerCandidates.length === 0 ? 'none_proven' : interaction.handlerCandidates.join(', '))} |`,
      ),
    );
  }

  const resourceAccesses = catalogue.endpoints.flatMap((endpoint) =>
    (endpoint.resourceAccesses ?? []).map((access) => ({ endpoint, access })),
  );
  if (resourceAccesses.length > 0) {
    lines.push(
      '',
      '## Non-relational resource access',
      '',
      '| Endpoint | Resource access | Kind | Operation | Causal class |',
      '|---|---|---|---|---|',
      ...resourceAccesses.map(
        ({ endpoint, access }) =>
          `| ${endpoint.httpMethod} ${escapeTableCell(endpoint.path)} | ${escapeTableCell(access.label)} | ${access.resourceKind} | ${access.operation} | ${access.causalClass} |`,
      ),
    );
  }

  return `${lines.join('\n')}\n`;
}
