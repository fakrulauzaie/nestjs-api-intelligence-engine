import { normalizeRoutePath } from '../extractors/route-paths.js';
import {
  analysisHasAuthorizationFacts,
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import { buildEndpointAuthorization } from '../authorization/endpoint-authorization.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { interactionTargetKey } from '../model/interactions.js';
import {
  canonicalizeJobQueueBranchSelector,
  jobQueueBranchSelectorKey,
} from '../model/job-queue-branches.js';
import { buildEffectiveEndpointGuards } from '../guards/effective.js';
import type {
  AssertionSnapshot,
  DiagnosticSnapshot,
  DiffInputSnapshot,
  EndpointGuardFact,
  EndpointAuthorizationFact,
  EndpointHandlerFact,
  EndpointSnapshot,
  EndpointTerminalContributor,
  EndpointTerminalFact,
  InteractionHandlerSnapshot,
  InteractionSnapshot,
  JobQueueBranchEffectSnapshot,
  JobQueueBranchSnapshot,
  JobQueueDispatchSnapshot,
} from './model.js';
import { normalizeAnalysisForComparison } from './normalize.js';
import {
  compareSemanticKeys,
  createSemanticKey,
  normalizeSignature,
  type SemanticKey,
} from './semantic-key.js';

export interface ProjectionSemanticCollision {
  readonly recordKind: string;
  readonly key: SemanticKey;
  readonly candidateIds: readonly string[];
}

export interface AnalysisSemanticProjection {
  readonly input: DiffInputSnapshot;
  readonly semanticKeyById: ReadonlyMap<string, SemanticKey>;
  readonly endpoints: readonly EndpointSnapshot[];
  readonly assertions: readonly AssertionSnapshot[];
  readonly diagnostics: readonly DiagnosticSnapshot[];
  readonly interactions: readonly InteractionSnapshot[];
  readonly interactionHandlers: readonly InteractionHandlerSnapshot[];
  readonly jobQueueDispatches: readonly JobQueueDispatchSnapshot[];
  readonly jobQueueBranches: readonly JobQueueBranchSnapshot[];
  readonly jobQueueBranchEffects: readonly JobQueueBranchEffectSnapshot[];
  readonly collisions: readonly ProjectionSemanticCollision[];
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function traversable(assertion: AssertionRecord): boolean {
  return (
    assertion.objectId !== null &&
    (assertion.status === 'resolved' || assertion.status === 'ambiguous')
  );
}

function addToIndex(
  index: Map<string, AssertionRecord[]>,
  key: string,
  assertion: AssertionRecord,
): void {
  const values = index.get(key) ?? [];
  values.push(assertion);
  index.set(key, values);
}

function evidenceLocationKey(
  evidence: EvidenceRecord,
  sourcePathById: ReadonlyMap<string, string>,
): SemanticKey {
  return createSemanticKey('evidence_location', [
    sourcePathById.get(evidence.fileId) ?? '<missing-source>',
    evidence.startLine,
    evidence.startColumn,
    evidence.endLine,
    evidence.endColumn,
    evidence.role,
  ]);
}

function fullEvidenceKey(
  evidence: EvidenceRecord,
  sourcePathById: ReadonlyMap<string, string>,
): SemanticKey {
  const location = evidenceLocationKey(evidence, sourcePathById);
  return createSemanticKey('evidence', [...location.components, evidence.contentHash]);
}

function groupCollisions(
  records: readonly { readonly id: string; readonly key: SemanticKey; readonly kind: string }[],
): ProjectionSemanticCollision[] {
  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const groupKey = `${record.kind}:${record.key.encoded}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), record]);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      recordKind: group[0]!.kind,
      key: group[0]!.key,
      candidateIds: group.map(({ id }) => id).sort(compareStrings),
    }))
    .sort((left, right) =>
      `${left.recordKind}:${left.key.encoded}`.localeCompare(
        `${right.recordKind}:${right.key.encoded}`,
      ),
    );
}

function buildTerminalFacts(input: {
  analysis: AnalysisDocument;
  endpointId: string;
  implementations: ReadonlyMap<string, readonly AssertionRecord[]>;
  calls: ReadonlyMap<string, readonly AssertionRecord[]>;
  tableAccess: ReadonlyMap<string, readonly AssertionRecord[]>;
  semanticKeyById: ReadonlyMap<string, SemanticKey>;
}): EndpointTerminalFact[] {
  interface QueueItem {
    readonly methodId: string;
    readonly depth: number;
    readonly ambiguousPath: boolean;
  }
  interface MutableTerminal {
    readonly key: SemanticKey;
    readonly direction: EndpointTerminalFact['direction'];
    readonly tableId: string;
    readonly tableKey: SemanticKey;
    readonly tableName: string;
    status: EndpointTerminalFact['status'];
    readonly contributors: Map<string, EndpointTerminalContributor>;
  }

  const tableById = new Map(input.analysis.tables.map((table) => [table.id, table]));
  const queue: QueueItem[] = [];
  for (const assertion of input.implementations.get(input.endpointId) ?? []) {
    if (!traversable(assertion)) continue;
    queue.push({
      methodId: assertion.objectId!,
      depth: 0,
      ambiguousPath: assertion.status === 'ambiguous',
    });
  }

  const seen = new Set<string>();
  const terminalByKey = new Map<string, MutableTerminal>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const stateKey = `${current.methodId}:${current.depth}:${current.ambiguousPath}`;
    if (seen.has(stateKey)) continue;
    seen.add(stateKey);

    const methodKey = input.semanticKeyById.get(current.methodId);
    if (methodKey === undefined) continue;
    for (const assertion of input.tableAccess.get(current.methodId) ?? []) {
      if (!traversable(assertion)) continue;
      const table = tableById.get(assertion.objectId!);
      const tableKey = input.semanticKeyById.get(assertion.objectId!);
      if (table === undefined || tableKey === undefined) continue;
      const direction =
        assertion.predicate === 'METHOD_READS_TABLE' ? ('READ' as const) : ('WRITE' as const);
      const key = createSemanticKey('endpoint_terminal', [direction, tableKey.encoded]);
      const status =
        current.ambiguousPath || assertion.status === 'ambiguous'
          ? ('ambiguous' as const)
          : ('resolved' as const);
      const terminal = terminalByKey.get(key.encoded) ?? {
        key,
        direction,
        tableId: table.id,
        tableKey,
        tableName: table.name,
        status,
        contributors: new Map<string, EndpointTerminalContributor>(),
      };
      if (status === 'resolved') terminal.status = 'resolved';
      terminal.contributors.set(assertion.id, {
        methodId: current.methodId,
        methodKey,
        assertionId: assertion.id,
        status: assertion.status,
        evidenceIds: sortedUnique(assertion.evidenceIds),
      });
      terminalByKey.set(key.encoded, terminal);
    }

    if (current.depth >= input.analysis.analysisRun.configuration.maxCallDepth) continue;
    for (const assertion of input.calls.get(current.methodId) ?? []) {
      if (!traversable(assertion)) continue;
      queue.push({
        methodId: assertion.objectId!,
        depth: current.depth + 1,
        ambiguousPath: current.ambiguousPath || assertion.status === 'ambiguous',
      });
    }
  }

  return [...terminalByKey.values()]
    .map((terminal) => ({
      ...terminal,
      contributors: [...terminal.contributors.values()].sort((left, right) =>
        `${left.methodKey.encoded}:${left.assertionId}`.localeCompare(
          `${right.methodKey.encoded}:${right.assertionId}`,
        ),
      ),
    }))
    .sort((left, right) => compareSemanticKeys(left.key, right.key));
}

export function buildAnalysisSemanticProjection(
  input: AnalysisDocument,
): AnalysisSemanticProjection {
  const normalized = normalizeAnalysisForComparison(input);
  const analysis = normalized.analysis;

  const sourceById = new Map(analysis.sourceFiles.map((source) => [source.id, source]));
  const methodById = new Map(analysis.methods.map((method) => [method.id, method]));
  const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
  const sourcePathById = new Map(
    analysis.sourceFiles.map((source) => [source.id, source.path.normalize('NFC')]),
  );
  const semanticKeyById = new Map<string, SemanticKey>();
  const keyedRecords: { id: string; key: SemanticKey; kind: string }[] = [];
  const register = (id: string, kind: string, key: SemanticKey): void => {
    semanticKeyById.set(id, key);
    keyedRecords.push({ id, kind, key });
  };

  register(analysis.analysisRun.id, 'analysis', createSemanticKey('analysis', ['root']));
  for (const source of analysis.sourceFiles) {
    register(source.id, 'source_file', createSemanticKey('source_file', [source.path]));
  }
  for (const sourceClass of analysis.classes) {
    const source = sourceById.get(sourceClass.sourceFileId)!;
    register(
      sourceClass.id,
      'class',
      createSemanticKey('class', [source.path, sourceClass.qualifiedName]),
    );
  }
  for (const method of analysis.methods) {
    const classKey = semanticKeyById.get(method.classId)!;
    register(
      method.id,
      'method',
      createSemanticKey('method', [
        classKey.encoded,
        method.displayName,
        normalizeSignature(method.signature),
      ]),
    );
  }
  for (const guard of analysis.guards) {
    register(
      guard.id,
      'guard',
      createSemanticKey('guard', [semanticKeyById.get(guard.classId)!.encoded]),
    );
  }
  for (const binding of analysis.repositoryBindings) {
    register(
      binding.id,
      'repository_binding',
      createSemanticKey('repository_binding', [
        semanticKeyById.get(binding.ownerClassId)!.encoded,
        binding.memberName,
      ]),
    );
  }
  for (const entity of analysis.entities) {
    register(
      entity.id,
      'entity',
      createSemanticKey('entity', [semanticKeyById.get(entity.classId)!.encoded]),
    );
  }
  for (const table of analysis.tables) {
    register(table.id, 'table', createSemanticKey('table', [null, table.name, table.nameSource]));
  }
  if (analysis.schemaVersion !== '1.0.0') {
    for (const moduleRecord of analysis.modules) {
      register(
        moduleRecord.id,
        'module',
        createSemanticKey('module', [semanticKeyById.get(moduleRecord.classId)!.encoded]),
      );
    }
    for (const registration of analysis.globalGuardRegistrations) {
      register(
        registration.id,
        'global_guard_registration',
        createSemanticKey('global_guard_registration', [
          semanticKeyById.get(registration.moduleId)!.encoded,
          semanticKeyById.get(registration.guardId)!.encoded,
          registration.kind,
          registration.order,
        ]),
      );
    }
    for (const contractType of analysis.contractTypes) {
      const source = sourceById.get(contractType.sourceFileId)!;
      register(
        contractType.id,
        'contract_type',
        createSemanticKey('contract_type', [source.path, contractType.qualifiedName]),
      );
    }
    for (const field of analysis.contractFields) {
      register(
        field.id,
        'contract_field',
        createSemanticKey('contract_field', [
          semanticKeyById.get(field.contractTypeId)!.encoded,
          field.name,
        ]),
      );
    }
    for (const parameter of analysis.requestParameters) {
      register(
        parameter.id,
        'request_parameter',
        createSemanticKey('request_parameter', [
          semanticKeyById.get(parameter.methodId)!.encoded,
          parameter.parameterIndex,
          parameter.sourceKind,
        ]),
      );
    }
    for (const response of analysis.responseContracts) {
      register(
        response.id,
        'response_contract',
        createSemanticKey('response_contract', [semanticKeyById.get(response.methodId)!.encoded]),
      );
    }
    for (const column of analysis.entityColumns) {
      register(
        column.id,
        'entity_column',
        createSemanticKey('entity_column', [
          semanticKeyById.get(column.entityId)!.encoded,
          semanticKeyById.get(column.declaringClassId)!.encoded,
          column.propertyName,
        ]),
      );
    }
    for (const origin of analysis.requestFieldOrigins) {
      register(
        origin.id,
        'request_field_origin',
        createSemanticKey('request_field_origin', [
          semanticKeyById.get(origin.requestParameterId)!.encoded,
          ...origin.propertyPath,
        ]),
      );
    }
    for (const influence of analysis.columnInfluences) {
      register(
        influence.id,
        'column_influence',
        createSemanticKey('column_influence', [
          semanticKeyById.get(influence.methodId)!.encoded,
          semanticKeyById.get(influence.originId)!.encoded,
          semanticKeyById.get(influence.columnId)!.encoded,
          influence.sinkKind,
          influence.sinkPropertyName,
          influence.state,
          ...influence.callPath.flatMap((step) => [
            semanticKeyById.get(step.callerMethodId)!.encoded,
            semanticKeyById.get(step.calleeMethodId)!.encoded,
          ]),
        ]),
      );
    }
  }
  if (analysisHasInteractionFacts(analysis)) {
    for (const application of analysis.applications) {
      const bootstrapEvidence = evidenceById.get(application.bootstrapEvidenceId);
      register(
        application.id,
        'application',
        createSemanticKey('application', [
          application.kind,
          application.rootModuleId === null
            ? null
            : (semanticKeyById.get(application.rootModuleId)?.encoded ?? null),
          application.rootResolution,
          application.transportState,
          application.transport,
          bootstrapEvidence === undefined
            ? null
            : evidenceLocationKey(bootstrapEvidence, sourcePathById).encoded,
        ]),
      );
    }
    for (const interaction of analysis.interactions) {
      const locationKeys = interaction.evidenceIds
        .flatMap((evidenceId) => {
          const evidence = evidenceById.get(evidenceId);
          return evidence === undefined
            ? []
            : [evidenceLocationKey(evidence, sourcePathById).encoded];
        })
        .sort(compareStrings);
      register(
        interaction.id,
        'interaction',
        createSemanticKey('interaction', [
          semanticKeyById.get(interaction.sourceMethodId)!.encoded,
          interaction.kind,
          interactionTargetKey(interaction.target),
          interaction.applicationId === null
            ? null
            : (semanticKeyById.get(interaction.applicationId)?.encoded ?? null),
          interaction.activation,
          interaction.boundary,
          interaction.dispatchTiming,
          ...locationKeys,
        ]),
      );
    }
    for (const handler of analysis.interactionHandlers) {
      register(
        handler.id,
        'interaction_handler',
        createSemanticKey('interaction_handler', [
          semanticKeyById.get(handler.methodId)!.encoded,
          handler.kind,
          interactionTargetKey(handler.target),
          handler.applicationId === null
            ? null
            : (semanticKeyById.get(handler.applicationId)?.encoded ?? null),
          handler.registrationState,
        ]),
      );
    }
  }
  for (const evidence of analysis.evidence) {
    register(evidence.id, 'evidence', fullEvidenceKey(evidence, sourcePathById));
  }

  const implementations = new Map<string, AssertionRecord[]>();
  const calls = new Map<string, AssertionRecord[]>();
  const tableAccess = new Map<string, AssertionRecord[]>();
  for (const assertion of analysis.assertions) {
    switch (assertion.predicate) {
      case 'ENDPOINT_IMPLEMENTED_BY':
        addToIndex(implementations, assertion.subjectId, assertion);
        break;
      case 'METHOD_CALLS_METHOD':
        addToIndex(calls, assertion.subjectId, assertion);
        break;
      case 'METHOD_READS_TABLE':
      case 'METHOD_WRITES_TABLE':
        addToIndex(tableAccess, assertion.subjectId, assertion);
        break;
      default:
        break;
    }
  }
  for (const index of [implementations, calls, tableAccess]) {
    for (const values of index.values())
      values.sort((left, right) => compareStrings(left.id, right.id));
  }

  const methodCollisions = new Set(
    groupCollisions(keyedRecords)
      .filter(({ recordKind }) => recordKind === 'method')
      .flatMap(({ candidateIds }) => candidateIds),
  );
  const endpoints = analysis.endpoints.map((endpoint): EndpointSnapshot => {
    const routeSlotKey = createSemanticKey('endpoint_route_slot', [
      endpoint.httpMethod,
      normalizeRoutePath(endpoint.path),
    ]);
    const handlers = (implementations.get(endpoint.id) ?? [])
      .map((assertion): EndpointHandlerFact => {
        const method = assertion.objectId === null ? undefined : methodById.get(assertion.objectId);
        return {
          methodId: method?.id ?? null,
          methodKey: method === undefined ? null : (semanticKeyById.get(method.id) ?? null),
          qualifiedName: method?.qualifiedName ?? null,
          status: assertion.status,
          ruleId: assertion.ruleId,
          assertionId: assertion.id,
          evidenceIds: sortedUnique(assertion.evidenceIds),
        };
      })
      .sort((left, right) =>
        `${left.methodKey?.encoded ?? ''}:${left.ruleId}:${left.assertionId}`.localeCompare(
          `${right.methodKey?.encoded ?? ''}:${right.ruleId}:${right.assertionId}`,
        ),
      );
    const onlyHandler = handlers.length === 1 ? handlers[0]! : undefined;
    const handlerIdentityAmbiguous =
      onlyHandler?.status === 'ambiguous' ||
      (onlyHandler?.methodId !== null &&
        onlyHandler?.methodId !== undefined &&
        methodCollisions.has(onlyHandler.methodId));
    const identityStatus =
      handlers.length > 1 || handlerIdentityAmbiguous
        ? ('ambiguous' as const)
        : onlyHandler?.status === 'resolved' && onlyHandler.methodKey !== null
          ? ('resolved' as const)
          : ('unresolved' as const);
    const exactKey =
      identityStatus === 'resolved'
        ? createSemanticKey('endpoint_exact', [
            endpoint.httpMethod,
            normalizeRoutePath(endpoint.path),
            onlyHandler!.methodKey!.encoded,
          ])
        : null;
    register(endpoint.id, 'endpoint', exactKey ?? routeSlotKey);

    const effectiveView = buildEffectiveEndpointGuards(analysis, endpoint.id);
    const projectGuards = (values: typeof effectiveView.effectiveGuards): EndpointGuardFact[] =>
      values.flatMap((guard): EndpointGuardFact[] => {
        const guardKey = semanticKeyById.get(guard.guardId);
        if (guardKey === undefined) return [];
        return [
          {
            guardId: guard.guardId,
            guardKey,
            name: guard.name,
            scope: guard.scope,
            status: guard.status,
            ruleId: guard.ruleId,
            assertionId: guard.assertionId,
            evidenceIds: sortedUnique(guard.evidenceIds),
          },
        ];
      });
    const directGuards = projectGuards(effectiveView.directGuards);
    const effectiveGuards = projectGuards(effectiveView.effectiveGuards);
    const authorization = buildEndpointAuthorization(analysis, endpoint.id);
    const authorizationRequirements: EndpointAuthorizationFact[] = authorization.requirements.map(
      (requirement) => ({
        metadataId: requirement.metadataId,
        enforcementId: requirement.enforcementId,
        metadataKey: requirement.metadataKey,
        scope: requirement.scope,
        source: requirement.source,
        valueShape: requirement.valueShape,
        enforcementState: requirement.enforcementState,
        guardKey:
          requirement.guardId === null ? null : (semanticKeyById.get(requirement.guardId) ?? null),
        ruleId: analysisHasAuthorizationFacts(analysis)
          ? (analysis.authorizationEnforcements.find(({ id }) => id === requirement.enforcementId)
              ?.ruleId ?? '<missing-rule>')
          : '<unavailable>',
        evidenceIds: sortedUnique(requirement.evidenceIds),
      }),
    );

    return {
      endpointId: endpoint.id,
      httpMethod: endpoint.httpMethod,
      path: normalizeRoutePath(endpoint.path),
      routeSlotKey,
      exactKey,
      identityStatus,
      handlers,
      directGuards: { availability: 'available', guards: directGuards },
      effectiveGuards: {
        availability: normalized.input.facts.effectiveGuards,
        guards: normalized.input.facts.effectiveGuards === 'available' ? effectiveGuards : [],
      },
      terminals: {
        availability: 'available',
        values: buildTerminalFacts({
          analysis,
          endpointId: endpoint.id,
          implementations,
          calls,
          tableAccess,
          semanticKeyById,
        }),
      },
      ...(authorization.availability === 'available'
        ? {
            authorization: {
              availability: 'available' as const,
              requirements: authorizationRequirements,
            },
          }
        : {}),
    };
  });

  if (analysisHasAuthorizationFacts(analysis)) {
    for (const metadata of analysis.authorizationMetadata) {
      register(
        metadata.id,
        'authorization_metadata',
        createSemanticKey('authorization_metadata', [
          semanticKeyById.get(metadata.endpointId)!.encoded,
          metadata.scope,
          metadata.metadataKey,
          metadata.source,
          metadata.decorator.kind,
          metadata.decorator.moduleSpecifier,
          metadata.decorator.exportedName,
          metadata.decorator.sourceFileId === null
            ? null
            : (sourcePathById.get(metadata.decorator.sourceFileId) ?? null),
        ]),
      );
    }
    for (const enforcement of analysis.authorizationEnforcements) {
      register(
        enforcement.id,
        'authorization_enforcement',
        createSemanticKey('authorization_enforcement', [
          semanticKeyById.get(enforcement.metadataId)!.encoded,
          enforcement.guardId === null
            ? null
            : (semanticKeyById.get(enforcement.guardId)?.encoded ?? null),
          enforcement.ruleId,
        ]),
      );
    }
  }

  const assertions = analysis.assertions
    .map((assertion): AssertionSnapshot => {
      const subjectKey = semanticKeyById.get(assertion.subjectId)!;
      const objectKey =
        assertion.objectId === null ? null : (semanticKeyById.get(assertion.objectId) ?? null);
      const key = createSemanticKey('assertion', [
        subjectKey.encoded,
        assertion.predicate,
        objectKey?.encoded ?? null,
        assertion.ruleId,
      ]);
      register(assertion.id, 'assertion', key);
      return {
        assertionId: assertion.id,
        key,
        subjectKey,
        predicate: assertion.predicate,
        objectKey,
        status: assertion.status,
        ruleId: assertion.ruleId,
        evidenceIds: sortedUnique(assertion.evidenceIds),
      };
    })
    .sort((left, right) => compareSemanticKeys(left.key, right.key));

  const diagnostics = analysis.diagnostics
    .map((diagnostic): DiagnosticSnapshot => {
      const subjectKey =
        diagnostic.subjectId === undefined
          ? null
          : (semanticKeyById.get(diagnostic.subjectId) ?? null);
      const evidenceRecords = diagnostic.evidenceIds.flatMap((id) => {
        const evidence = evidenceById.get(id);
        return evidence === undefined ? [] : [evidence];
      });
      const locationKeys = evidenceRecords
        .map((evidence) => evidenceLocationKey(evidence, sourcePathById))
        .sort(compareSemanticKeys);
      const evidenceKeys = evidenceRecords
        .map((evidence) => fullEvidenceKey(evidence, sourcePathById))
        .sort(compareSemanticKeys);
      const key = createSemanticKey('diagnostic', [
        diagnostic.code,
        subjectKey?.encoded ?? null,
        ...locationKeys.map(({ encoded }) => encoded),
      ]);
      register(diagnostic.id, 'diagnostic', key);
      return {
        diagnosticId: diagnostic.id,
        key,
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        subjectKey,
        evidenceIds: sortedUnique(diagnostic.evidenceIds),
        evidenceKeys,
      };
    })
    .sort((left, right) => compareSemanticKeys(left.key, right.key));

  const interactions: InteractionSnapshot[] = analysisHasInteractionFacts(analysis)
    ? analysis.interactions
        .map((interaction) => {
          const sourceMethodKey = semanticKeyById.get(interaction.sourceMethodId)!;
          const applicationKey =
            interaction.applicationId === null
              ? null
              : (semanticKeyById.get(interaction.applicationId) ?? null);
          return {
            interactionId: interaction.id,
            key: createSemanticKey('interaction', [
              'comparison_identity',
              sourceMethodKey.encoded,
              interaction.kind,
              interactionTargetKey(interaction.target),
              applicationKey?.encoded ?? null,
            ]),
            kind: interaction.kind,
            sourceMethodKey,
            targetKey: interactionTargetKey(interaction.target),
            applicationKey,
            activation: interaction.activation,
            boundary: interaction.boundary,
            dispatchTiming: interaction.dispatchTiming,
            ruleId: interaction.ruleId,
            evidenceIds: sortedUnique(interaction.evidenceIds),
          };
        })
        .sort((left, right) => compareSemanticKeys(left.key, right.key))
    : [];
  const interactionHandlers: InteractionHandlerSnapshot[] = analysisHasInteractionFacts(analysis)
    ? analysis.interactionHandlers
        .map((handler) => {
          const methodKey = semanticKeyById.get(handler.methodId)!;
          const applicationKey =
            handler.applicationId === null
              ? null
              : (semanticKeyById.get(handler.applicationId) ?? null);
          return {
            handlerId: handler.id,
            key: createSemanticKey('interaction_handler', [
              'comparison_identity',
              methodKey.encoded,
              handler.kind,
              interactionTargetKey(handler.target),
              applicationKey?.encoded ?? null,
            ]),
            kind: handler.kind,
            methodKey,
            targetKey: interactionTargetKey(handler.target),
            applicationKey,
            registrationState: handler.registrationState,
            ruleId: handler.ruleId,
            evidenceIds: sortedUnique([
              handler.handlerEvidenceId,
              ...(handler.kind === 'in_process_event'
                ? (handler.configurationEvidenceIds ?? [])
                : []),
            ]),
          };
        })
        .sort((left, right) => compareSemanticKeys(left.key, right.key))
    : [];

  const jobQueueDispatches: JobQueueDispatchSnapshot[] = [];
  const jobQueueBranches: JobQueueBranchSnapshot[] = [];
  const jobQueueBranchEffects: JobQueueBranchEffectSnapshot[] = [];
  if (analysisHasJobQueueBranchFacts(analysis)) {
    for (const dispatch of analysis.interactionHandlerDispatches) {
      const handlerKey = semanticKeyById.get(dispatch.handlerId)!;
      const key = createSemanticKey('interaction_handler_dispatch', [
        handlerKey.encoded,
        dispatch.ruleId,
      ]);
      register(dispatch.id, 'interaction_handler_dispatch', key);
      jobQueueDispatches.push({
        dispatchId: dispatch.id,
        key,
        handlerKey,
        state: dispatch.state,
        ruleId: dispatch.ruleId,
        evidenceIds: sortedUnique(dispatch.evidenceIds),
      });
    }
    for (const branch of analysis.interactionHandlerBranches) {
      const dispatchKey = semanticKeyById.get(branch.dispatchId)!;
      const selector = canonicalizeJobQueueBranchSelector(branch.selector);
      const key = createSemanticKey('interaction_handler_branch', [
        dispatchKey.encoded,
        jobQueueBranchSelectorKey(selector),
        branch.controlFlow,
      ]);
      register(branch.id, 'interaction_handler_branch', key);
      jobQueueBranches.push({
        branchId: branch.id,
        key,
        dispatchKey,
        selector,
        controlFlow: branch.controlFlow,
        ruleId: branch.ruleId,
        evidenceIds: sortedUnique(branch.evidenceIds),
      });
    }
    for (const effect of analysis.interactionHandlerBranchEffects) {
      const branchKey = semanticKeyById.get(effect.branchId)!;
      const targetKey = semanticKeyById.get(effect.targetId)!;
      const sourceAssertionKey = semanticKeyById.get(effect.sourceAssertionId)!;
      const key = createSemanticKey('interaction_handler_branch_effect', [
        branchKey.encoded,
        effect.kind,
        targetKey.encoded,
        sourceAssertionKey.encoded,
      ]);
      register(effect.id, 'interaction_handler_branch_effect', key);
      jobQueueBranchEffects.push({
        effectId: effect.id,
        key,
        branchKey,
        kind: effect.kind,
        targetKey,
        sourceAssertionKey,
        status: effect.status,
        ruleId: effect.ruleId,
        evidenceIds: sortedUnique(effect.evidenceIds),
      });
    }
    jobQueueDispatches.sort((left, right) => compareSemanticKeys(left.key, right.key));
    jobQueueBranches.sort((left, right) => compareSemanticKeys(left.key, right.key));
    jobQueueBranchEffects.sort((left, right) => compareSemanticKeys(left.key, right.key));
  }

  return {
    input: normalized.input,
    semanticKeyById,
    endpoints: endpoints.sort((left, right) =>
      `${left.routeSlotKey.encoded}:${left.exactKey?.encoded ?? ''}:${left.endpointId}`.localeCompare(
        `${right.routeSlotKey.encoded}:${right.exactKey?.encoded ?? ''}:${right.endpointId}`,
      ),
    ),
    assertions,
    diagnostics,
    interactions,
    interactionHandlers,
    jobQueueDispatches,
    jobQueueBranches,
    jobQueueBranchEffects,
    collisions: groupCollisions(keyedRecords),
  };
}
