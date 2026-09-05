import {
  analysisHasAuthorizationFacts,
  analysisHasCriticalSectionFacts,
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  analysisHasResourceAccessFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import type { AssertionPredicate } from '../model/assertions.js';
import type { ClassRole } from '../model/entities.js';
import {
  inProcessEventTargetsMatch,
  INTERACTION_KINDS,
  interactionTargetKey,
  jobQueueTargetsMatch,
  microserviceMessageTargetsMatch,
} from '../model/interactions.js';
import { canonicalStringify } from '../model/ordering.js';
import { analysisDocumentSchema, jobQueueBranchContractSchema } from '../model/schemas.js';

export const INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'DUPLICATE_RECORD_ID',
  'STABLE_ID_COLLISION',
  'RECORD_ID_KIND_MISMATCH',
  'MISSING_REFERENCE',
  'REFERENCE_KIND_MISMATCH',
  'MISSING_ASSERTION_TARGET',
  'RESOLVED_ASSERTION_WITHOUT_EVIDENCE',
  'EVIDENCE_HASH_MISMATCH',
  'INVALID_EVIDENCE_RANGE',
  'DUPLICATE_REFERENCE',
  'CLASS_ROLE_MISMATCH',
  'EVIDENCE_ROLE_MISMATCH',
  'GLOBAL_GUARD_STATE_MISMATCH',
  'GLOBAL_GUARD_REGISTRATION_MISMATCH',
  'COLUMN_INFLUENCE_ASSERTION_MISMATCH',
  'APPLICATION_STATE_MISMATCH',
  'INTERACTION_ASSERTION_MISMATCH',
  'INTERACTION_CAPABILITY_MISMATCH',
  'AUTHORIZATION_RELATIONSHIP_MISMATCH',
  'RESOURCE_ACCESS_RELATIONSHIP_MISMATCH',
  'CRITICAL_SECTION_RELATIONSHIP_MISMATCH',
] as const;
export type IntegrityIssueCode = (typeof INTEGRITY_ISSUE_CODES)[number];

export interface IntegrityIssue {
  readonly code: IntegrityIssueCode;
  readonly message: string;
  readonly recordId?: string;
  readonly path?: string;
}

export type AnalysisValidationResult =
  | { readonly success: true; readonly data: AnalysisDocument }
  | { readonly success: false; readonly issues: readonly IntegrityIssue[] };

type CanonicalRecordKind =
  | 'analysis'
  | 'source'
  | 'class'
  | 'method'
  | 'endpoint'
  | 'guard'
  | 'repository_binding'
  | 'entity'
  | 'table'
  | 'assertion'
  | 'evidence'
  | 'diagnostic'
  | 'module'
  | 'global_guard_registration'
  | 'contract_type'
  | 'contract_field'
  | 'request_parameter'
  | 'response_contract'
  | 'entity_column'
  | 'request_field_origin'
  | 'column_influence'
  | 'application'
  | 'interaction'
  | 'interaction_handler'
  | 'interaction_handler_dispatch'
  | 'interaction_handler_branch'
  | 'interaction_handler_branch_effect'
  | 'authorization_metadata'
  | 'authorization_enforcement'
  | 'resource_access'
  | 'critical_section';

interface RecordEnvelope {
  readonly id: string;
  readonly kind: CanonicalRecordKind;
  readonly record: { readonly id: string };
}

const ASSERTION_KINDS: Readonly<
  Record<AssertionPredicate, { subject: CanonicalRecordKind; object: CanonicalRecordKind }>
> = {
  ENDPOINT_IMPLEMENTED_BY: { subject: 'endpoint', object: 'method' },
  METHOD_CALLS_METHOD: { subject: 'method', object: 'method' },
  CLASS_INJECTS_CLASS: { subject: 'class', object: 'class' },
  CLASS_INJECTS_REPOSITORY: { subject: 'class', object: 'repository_binding' },
  REPOSITORY_FOR_ENTITY: { subject: 'repository_binding', object: 'entity' },
  ENTITY_MAPS_TO_TABLE: { subject: 'entity', object: 'table' },
  METHOD_READS_TABLE: { subject: 'method', object: 'table' },
  METHOD_WRITES_TABLE: { subject: 'method', object: 'table' },
  ENDPOINT_USES_GUARD: { subject: 'endpoint', object: 'guard' },
  MODULE_IMPORTS_MODULE: { subject: 'module', object: 'module' },
  MODULE_PROVIDES_CLASS: { subject: 'module', object: 'class' },
  MODULE_EXPORTS_CLASS: { subject: 'module', object: 'class' },
  MODULE_EXPORTS_MODULE: { subject: 'module', object: 'module' },
  MODULE_DECLARES_CONTROLLER: { subject: 'module', object: 'class' },
  MODULE_REGISTERS_GLOBAL_GUARD: { subject: 'module', object: 'guard' },
  APPLICATION_REGISTERS_GLOBAL_GUARD: { subject: 'module', object: 'guard' },
  METHOD_DECLARES_REQUEST_PARAMETER: { subject: 'method', object: 'request_parameter' },
  METHOD_DECLARES_RESPONSE: { subject: 'method', object: 'response_contract' },
  CONTRACT_TYPE_DECLARES_FIELD: { subject: 'contract_type', object: 'contract_field' },
  ENTITY_DECLARES_COLUMN: { subject: 'entity', object: 'entity_column' },
  REQUEST_PARAMETER_HAS_FIELD_ORIGIN: {
    subject: 'request_parameter',
    object: 'request_field_origin',
  },
  REQUEST_FIELD_MAY_FLOW_TO_COLUMN: {
    subject: 'request_field_origin',
    object: 'entity_column',
  },
  APPLICATION_USES_ROOT_MODULE: { subject: 'application', object: 'module' },
  METHOD_INITIATES_INTERACTION: { subject: 'method', object: 'interaction' },
  INTERACTION_MATCHES_LOCAL_HANDLER: {
    subject: 'interaction',
    object: 'interaction_handler',
  },
  HANDLER_IMPLEMENTED_BY: { subject: 'interaction_handler', object: 'method' },
  METHOD_ACCESSES_RESOURCE: { subject: 'method', object: 'resource_access' },
};

function allRecords(analysis: AnalysisDocument): RecordEnvelope[] {
  const envelope = <T extends { readonly id: string }>(
    kind: CanonicalRecordKind,
    records: readonly T[],
  ): RecordEnvelope[] => records.map((record) => ({ id: record.id, kind, record }));

  return [
    { id: analysis.analysisRun.id, kind: 'analysis', record: analysis.analysisRun },
    ...envelope('source', analysis.sourceFiles),
    ...envelope('class', analysis.classes),
    ...envelope('method', analysis.methods),
    ...envelope('endpoint', analysis.endpoints),
    ...envelope('guard', analysis.guards),
    ...envelope('repository_binding', analysis.repositoryBindings),
    ...envelope('entity', analysis.entities),
    ...envelope('table', analysis.tables),
    ...envelope('assertion', analysis.assertions),
    ...envelope('evidence', analysis.evidence),
    ...envelope('diagnostic', analysis.diagnostics),
    ...(analysis.schemaVersion !== '1.0.0'
      ? [
          ...envelope('module', analysis.modules),
          ...envelope('global_guard_registration', analysis.globalGuardRegistrations),
          ...envelope('contract_type', analysis.contractTypes),
          ...envelope('contract_field', analysis.contractFields),
          ...envelope('request_parameter', analysis.requestParameters),
          ...envelope('response_contract', analysis.responseContracts),
          ...envelope('entity_column', analysis.entityColumns),
          ...envelope('request_field_origin', analysis.requestFieldOrigins),
          ...envelope('column_influence', analysis.columnInfluences),
        ]
      : []),
    ...(analysisHasInteractionFacts(analysis)
      ? [
          ...envelope('application', analysis.applications),
          ...envelope('interaction', analysis.interactions),
          ...envelope('interaction_handler', analysis.interactionHandlers),
        ]
      : []),
    ...(analysisHasJobQueueBranchFacts(analysis)
      ? [
          ...envelope('interaction_handler_dispatch', analysis.interactionHandlerDispatches),
          ...envelope('interaction_handler_branch', analysis.interactionHandlerBranches),
          ...envelope(
            'interaction_handler_branch_effect',
            analysis.interactionHandlerBranchEffects,
          ),
        ]
      : []),
    ...(analysisHasAuthorizationFacts(analysis)
      ? [
          ...envelope('authorization_metadata', analysis.authorizationMetadata),
          ...envelope('authorization_enforcement', analysis.authorizationEnforcements),
        ]
      : []),
    ...(analysisHasResourceAccessFacts(analysis)
      ? [...envelope('resource_access', analysis.resourceAccesses)]
      : []),
    ...(analysisHasCriticalSectionFacts(analysis)
      ? [...envelope('critical_section', analysis.criticalSections)]
      : []),
  ];
}

function rangeIsOrdered(input: {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}): boolean {
  return (
    input.startLine < input.endLine ||
    (input.startLine === input.endLine && input.startColumn <= input.endColumn)
  );
}

function addDuplicateReferenceIssues(
  ownerId: string,
  field: string,
  references: readonly string[],
  issues: IntegrityIssue[],
): void {
  const seen = new Set<string>();
  for (const reference of references) {
    if (seen.has(reference)) {
      issues.push({
        code: 'DUPLICATE_REFERENCE',
        recordId: ownerId,
        path: field,
        message: `Record ${ownerId} repeats reference ${reference} in ${field}.`,
      });
    }
    seen.add(reference);
  }
}

export function validateAnalysisDocument(input: unknown): AnalysisValidationResult {
  const schemaResult = analysisDocumentSchema.safeParse(input);
  if (!schemaResult.success) {
    return {
      success: false,
      issues: schemaResult.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const analysis = schemaResult.data;
  const issues: IntegrityIssue[] = [];
  const recordById = new Map<string, RecordEnvelope>();

  for (const current of allRecords(analysis)) {
    const expectedPrefix = `${current.kind}:`;
    if (!current.id.startsWith(expectedPrefix)) {
      issues.push({
        code: 'RECORD_ID_KIND_MISMATCH',
        recordId: current.id,
        message: `Record ${current.id} is in the ${current.kind} collection but has a different ID prefix.`,
      });
    }

    const existing = recordById.get(current.id);
    if (existing !== undefined) {
      const equalContent =
        canonicalStringify(existing.record) === canonicalStringify(current.record);
      issues.push({
        code: equalContent ? 'DUPLICATE_RECORD_ID' : 'STABLE_ID_COLLISION',
        recordId: current.id,
        message: equalContent
          ? `Record ID ${current.id} occurs more than once.`
          : `Record ID ${current.id} maps to unequal record content.`,
      });
      continue;
    }

    recordById.set(current.id, current);
  }

  const requireReference = (
    ownerId: string,
    field: string,
    referenceId: string,
    expectedKind?: CanonicalRecordKind,
  ): RecordEnvelope | undefined => {
    const target = recordById.get(referenceId);
    if (target === undefined) {
      issues.push({
        code: 'MISSING_REFERENCE',
        recordId: ownerId,
        path: field,
        message: `Record ${ownerId} references missing ID ${referenceId} from ${field}.`,
      });
      return undefined;
    }

    if (expectedKind !== undefined && target.kind !== expectedKind) {
      issues.push({
        code: 'REFERENCE_KIND_MISMATCH',
        recordId: ownerId,
        path: field,
        message: `Record ${ownerId} expected ${field} to reference ${expectedKind}, but ${referenceId} is ${target.kind}.`,
      });
      return undefined;
    }

    return target;
  };

  const requireDeclarationEvidence = (ownerId: string, evidenceId: string): void => {
    const target = requireReference(ownerId, 'declarationEvidenceId', evidenceId, 'evidence');
    if (target !== undefined && 'role' in target.record && target.record.role !== 'declaration') {
      issues.push({
        code: 'EVIDENCE_ROLE_MISMATCH',
        recordId: ownerId,
        path: 'declarationEvidenceId',
        message: `Record ${ownerId} declaration evidence ${evidenceId} is not declaration evidence.`,
      });
    }
  };

  for (const sourceClass of analysis.classes) {
    requireReference(sourceClass.id, 'sourceFileId', sourceClass.sourceFileId, 'source');
    requireDeclarationEvidence(sourceClass.id, sourceClass.declarationEvidenceId);
    addDuplicateReferenceIssues(sourceClass.id, 'roles', sourceClass.roles, issues);
  }

  for (const method of analysis.methods) {
    requireReference(method.id, 'classId', method.classId, 'class');
    requireDeclarationEvidence(method.id, method.declarationEvidenceId);
  }

  for (const guard of analysis.guards) {
    const target = requireReference(guard.id, 'classId', guard.classId, 'class');
    if (
      target !== undefined &&
      'roles' in target.record &&
      !(target.record.roles as readonly ClassRole[]).includes('guard')
    ) {
      issues.push({
        code: 'CLASS_ROLE_MISMATCH',
        recordId: guard.id,
        path: 'classId',
        message: `Guard ${guard.id} references class ${guard.classId} without the guard role.`,
      });
    }
  }

  for (const binding of analysis.repositoryBindings) {
    requireReference(binding.id, 'ownerClassId', binding.ownerClassId, 'class');
    requireDeclarationEvidence(binding.id, binding.declarationEvidenceId);
  }

  for (const entity of analysis.entities) {
    const target = requireReference(entity.id, 'classId', entity.classId, 'class');
    if (
      target !== undefined &&
      'roles' in target.record &&
      !(target.record.roles as readonly ClassRole[]).includes('entity')
    ) {
      issues.push({
        code: 'CLASS_ROLE_MISMATCH',
        recordId: entity.id,
        path: 'classId',
        message: `Entity ${entity.id} references class ${entity.classId} without the entity role.`,
      });
    }
  }

  if (analysis.schemaVersion !== '1.0.0') {
    const requireDeclaredTypeReferences = (
      ownerId: string,
      contractTypeIds: readonly string[],
    ): void => {
      addDuplicateReferenceIssues(ownerId, 'declaredType.contractTypeIds', contractTypeIds, issues);
      for (const contractTypeId of contractTypeIds) {
        requireReference(ownerId, 'declaredType.contractTypeIds', contractTypeId, 'contract_type');
      }
    };
    for (const contractType of analysis.contractTypes) {
      requireReference(contractType.id, 'sourceFileId', contractType.sourceFileId, 'source');
      requireDeclarationEvidence(contractType.id, contractType.declarationEvidenceId);
    }
    for (const field of analysis.contractFields) {
      requireReference(field.id, 'contractTypeId', field.contractTypeId, 'contract_type');
      if (field.declaringContractTypeId !== null) {
        requireReference(
          field.id,
          'declaringContractTypeId',
          field.declaringContractTypeId,
          'contract_type',
        );
      }
      if (field.declarationEvidenceId !== null) {
        requireDeclarationEvidence(field.id, field.declarationEvidenceId);
      }
      for (const constraint of field.declaredConstraints) {
        requireReference(
          field.id,
          'declaredConstraints.decoratorEvidenceId',
          constraint.decoratorEvidenceId,
          'evidence',
        );
      }
    }
    for (const parameter of analysis.requestParameters) {
      requireReference(parameter.id, 'methodId', parameter.methodId, 'method');
      requireDeclarationEvidence(parameter.id, parameter.declarationEvidenceId);
      requireReference(
        parameter.id,
        'decoratorEvidenceId',
        parameter.decoratorEvidenceId,
        'evidence',
      );
      requireDeclaredTypeReferences(parameter.id, parameter.declaredType.contractTypeIds);
    }
    for (const response of analysis.responseContracts) {
      requireReference(response.id, 'methodId', response.methodId, 'method');
      requireDeclarationEvidence(response.id, response.declarationEvidenceId);
      if (response.manualResponseEvidenceId !== null) {
        requireReference(
          response.id,
          'manualResponseEvidenceId',
          response.manualResponseEvidenceId,
          'evidence',
        );
      }
      requireDeclaredTypeReferences(response.id, response.declaredType.contractTypeIds);
    }
    for (const column of analysis.entityColumns) {
      requireReference(column.id, 'entityId', column.entityId, 'entity');
      requireReference(column.id, 'declaringClassId', column.declaringClassId, 'class');
      requireDeclarationEvidence(column.id, column.declarationEvidenceId);
      requireReference(column.id, 'decoratorEvidenceId', column.decoratorEvidenceId, 'evidence');
    }
    for (const origin of analysis.requestFieldOrigins) {
      requireReference(
        origin.id,
        'requestParameterId',
        origin.requestParameterId,
        'request_parameter',
      );
      requireReference(origin.id, 'originEvidenceId', origin.originEvidenceId, 'evidence');
      addDuplicateReferenceIssues(origin.id, 'contractFieldIds', origin.contractFieldIds, issues);
      for (const fieldId of origin.contractFieldIds) {
        requireReference(origin.id, 'contractFieldIds', fieldId, 'contract_field');
      }
    }
    for (const influence of analysis.columnInfluences) {
      const originRecord = analysis.requestFieldOrigins.find(({ id }) => id === influence.originId);
      const originParameter = analysis.requestParameters.find(
        ({ id }) => id === originRecord?.requestParameterId,
      );
      const originMethodId = originParameter?.methodId;
      requireReference(influence.id, 'methodId', influence.methodId, 'method');
      requireReference(influence.id, 'originId', influence.originId, 'request_field_origin');
      requireReference(influence.id, 'columnId', influence.columnId, 'entity_column');
      requireReference(influence.id, 'assertionId', influence.assertionId, 'assertion');
      requireReference(influence.id, 'sinkEvidenceId', influence.sinkEvidenceId, 'evidence');
      requireReference(
        influence.id,
        'operationEvidenceId',
        influence.operationEvidenceId,
        'evidence',
      );
      addDuplicateReferenceIssues(
        influence.id,
        'propagationEvidenceIds',
        influence.propagationEvidenceIds,
        issues,
      );
      for (const evidenceId of influence.propagationEvidenceIds) {
        requireReference(influence.id, 'propagationEvidenceIds', evidenceId, 'evidence');
      }
      if (influence.callPath.length === 0 && originMethodId !== influence.methodId) {
        issues.push({
          code: 'COLUMN_INFLUENCE_ASSERTION_MISMATCH',
          recordId: influence.id,
          path: 'callPath',
          message: `Column influence ${influence.id} omits the path between its request origin and sink method.`,
        });
      }
      for (const [index, step] of influence.callPath.entries()) {
        requireReference(
          influence.id,
          `callPath.${index}.callerMethodId`,
          step.callerMethodId,
          'method',
        );
        requireReference(
          influence.id,
          `callPath.${index}.calleeMethodId`,
          step.calleeMethodId,
          'method',
        );
        const callEvidence = requireReference(
          influence.id,
          `callPath.${index}.callEvidenceId`,
          step.callEvidenceId,
          'evidence',
        );
        if (
          callEvidence !== undefined &&
          'role' in callEvidence.record &&
          callEvidence.record.role !== 'call_site'
        ) {
          issues.push({
            code: 'EVIDENCE_ROLE_MISMATCH',
            recordId: influence.id,
            path: `callPath.${index}.callEvidenceId`,
            message: `Column influence ${influence.id} call path must cite call-site evidence.`,
          });
        }
        if (
          (index === 0 && step.callerMethodId !== originMethodId) ||
          (index > 0 && influence.callPath[index - 1]!.calleeMethodId !== step.callerMethodId) ||
          (index === influence.callPath.length - 1 && step.calleeMethodId !== influence.methodId)
        ) {
          issues.push({
            code: 'COLUMN_INFLUENCE_ASSERTION_MISMATCH',
            recordId: influence.id,
            path: `callPath.${index}`,
            message: `Column influence ${influence.id} has a discontinuous call path.`,
          });
        }
      }
      const assertion = analysis.assertions.find(({ id }) => id === influence.assertionId);
      if (
        assertion !== undefined &&
        (assertion.subjectId !== influence.originId ||
          assertion.objectId !== influence.columnId ||
          assertion.predicate !== 'REQUEST_FIELD_MAY_FLOW_TO_COLUMN' ||
          !assertion.evidenceIds.includes(influence.sinkEvidenceId) ||
          !assertion.evidenceIds.includes(influence.operationEvidenceId) ||
          influence.callPath.some(
            ({ callEvidenceId }) => !assertion.evidenceIds.includes(callEvidenceId),
          ))
      ) {
        issues.push({
          code: 'COLUMN_INFLUENCE_ASSERTION_MISMATCH',
          recordId: influence.id,
          path: 'assertionId',
          message: `Column influence ${influence.id} does not match its supporting assertion and sink evidence.`,
        });
      }
    }
    for (const moduleRecord of analysis.modules) {
      const target = requireReference(moduleRecord.id, 'classId', moduleRecord.classId, 'class');
      if (
        target !== undefined &&
        'roles' in target.record &&
        !(target.record.roles as readonly ClassRole[]).includes('module')
      ) {
        issues.push({
          code: 'CLASS_ROLE_MISMATCH',
          recordId: moduleRecord.id,
          path: 'classId',
          message: `Module ${moduleRecord.id} references class ${moduleRecord.classId} without the module role.`,
        });
      }
      requireDeclarationEvidence(moduleRecord.id, moduleRecord.declarationEvidenceId);
    }

    const assertionById = new Map(
      analysis.assertions.map((assertion) => [assertion.id, assertion]),
    );
    const registrationOrders = new Set<number>();
    for (const registration of analysis.globalGuardRegistrations) {
      requireReference(registration.id, 'guardId', registration.guardId, 'guard');
      requireReference(registration.id, 'moduleId', registration.moduleId, 'module');
      requireReference(registration.id, 'assertionId', registration.assertionId, 'assertion');
      requireReference(
        registration.id,
        'registrationEvidenceId',
        registration.registrationEvidenceId,
        'evidence',
      );
      const assertion = assertionById.get(registration.assertionId);
      const expectedPredicate =
        registration.kind === 'bootstrap_use_global_guards'
          ? 'APPLICATION_REGISTERS_GLOBAL_GUARD'
          : 'MODULE_REGISTERS_GLOBAL_GUARD';
      if (
        assertion !== undefined &&
        (assertion.subjectId !== registration.moduleId ||
          assertion.objectId !== registration.guardId ||
          assertion.predicate !== expectedPredicate ||
          assertion.status !== 'resolved' ||
          !assertion.evidenceIds.includes(registration.registrationEvidenceId))
      ) {
        issues.push({
          code: 'GLOBAL_GUARD_REGISTRATION_MISMATCH',
          recordId: registration.id,
          path: 'assertionId',
          message: `Global guard registration ${registration.id} does not match its supporting assertion and evidence.`,
        });
      }
      if (registrationOrders.has(registration.order)) {
        issues.push({
          code: 'DUPLICATE_REFERENCE',
          recordId: registration.id,
          path: 'order',
          message: `Global guard registration order ${registration.order} occurs more than once.`,
        });
      }
      registrationOrders.add(registration.order);
    }
    const orderedRegistrations = [...analysis.globalGuardRegistrations].sort(
      (left, right) => left.order - right.order,
    );
    for (const [expectedOrder, registration] of orderedRegistrations.entries()) {
      if (registration.order === expectedOrder) continue;
      issues.push({
        code: 'GLOBAL_GUARD_REGISTRATION_MISMATCH',
        recordId: registration.id,
        path: 'order',
        message: `Global guard registration order must be contiguous from zero; expected ${expectedOrder}, received ${registration.order}.`,
      });
    }

    const incompletenessEvidence =
      analysis.modules.some(({ metadataCompleteness }) => metadataCompleteness === 'incomplete') ||
      analysis.diagnostics.some(({ code }) =>
        [
          'NEST_MODULE_METADATA_UNRESOLVED',
          'NEST_GLOBAL_GUARD_UNRESOLVED',
          'NEST_BOOTSTRAP_GUARD_UNRESOLVED',
        ].includes(code),
      );
    if (incompletenessEvidence && analysis.globalGuardAnalysis.completeness !== 'incomplete') {
      issues.push({
        code: 'GLOBAL_GUARD_STATE_MISMATCH',
        path: 'globalGuardAnalysis.completeness',
        message:
          'Global guard completeness is complete despite explicit unresolved module or bootstrap evidence.',
      });
    }

    const expectedGlobalState =
      analysis.globalGuardRegistrations.length > 0
        ? 'declared'
        : analysis.globalGuardAnalysis.completeness === 'complete'
          ? 'none_proven'
          : 'unknown';
    if (analysis.globalGuardAnalysis.state !== expectedGlobalState) {
      issues.push({
        code: 'GLOBAL_GUARD_STATE_MISMATCH',
        path: 'globalGuardAnalysis.state',
        message: `Global guard state ${analysis.globalGuardAnalysis.state} does not match ${expectedGlobalState}.`,
      });
    }
  }

  if (analysisHasInteractionFacts(analysis)) {
    const interactionAnalysis = analysis.interactionAnalysis;
    addDuplicateReferenceIssues(
      analysis.analysisRun.id,
      'interactionAnalysis.schemaKinds',
      interactionAnalysis.schemaKinds,
      issues,
    );
    addDuplicateReferenceIssues(
      analysis.analysisRun.id,
      'interactionAnalysis.supportedKinds',
      interactionAnalysis.supportedKinds,
      issues,
    );
    addDuplicateReferenceIssues(
      analysis.analysisRun.id,
      'interactionAnalysis.enabledKinds',
      interactionAnalysis.enabledKinds,
      issues,
    );
    const expectedSchemaKinds = [...INTERACTION_KINDS].sort();
    const actualSchemaKinds = [...interactionAnalysis.schemaKinds].sort();
    const supported = new Set(interactionAnalysis.supportedKinds);
    if (
      expectedSchemaKinds.length !== actualSchemaKinds.length ||
      expectedSchemaKinds.some((kind, index) => kind !== actualSchemaKinds[index])
    ) {
      issues.push({
        code: 'INTERACTION_CAPABILITY_MISMATCH',
        path: 'interactionAnalysis.schemaKinds',
        message:
          'Interaction schema kinds do not match the kinds representable by this analysis version.',
      });
    }
    for (const kind of interactionAnalysis.supportedKinds) {
      if (INTERACTION_KINDS.includes(kind)) continue;
      issues.push({
        code: 'INTERACTION_CAPABILITY_MISMATCH',
        path: 'interactionAnalysis.supportedKinds',
        message: `Unsupported interaction capability ${kind}.`,
      });
    }
    for (const kind of interactionAnalysis.enabledKinds) {
      if (supported.has(kind)) continue;
      issues.push({
        code: 'INTERACTION_CAPABILITY_MISMATCH',
        path: 'interactionAnalysis.enabledKinds',
        message: `Enabled interaction kind ${kind} is not supported by this analyzer.`,
      });
    }
    if (interactionAnalysis.state === 'not_run' && interactionAnalysis.enabledKinds.length > 0) {
      issues.push({
        code: 'INTERACTION_CAPABILITY_MISMATCH',
        path: 'interactionAnalysis.state',
        message: 'Interaction analysis cannot be not_run when an extractor kind is enabled.',
      });
    }

    const applicationById = new Map(
      analysis.applications.map((application) => [application.id, application]),
    );
    const interactionById = new Map(
      analysis.interactions.map((interaction) => [interaction.id, interaction]),
    );
    const handlerById = new Map(
      analysis.interactionHandlers.map((handler) => [handler.id, handler]),
    );

    for (const application of analysis.applications) {
      requireReference(
        application.id,
        'bootstrapEvidenceId',
        application.bootstrapEvidenceId,
        'evidence',
      );
      if (application.rootModuleId !== null) {
        requireReference(application.id, 'rootModuleId', application.rootModuleId, 'module');
      }
      if ((application.rootResolution === 'resolved') !== (application.rootModuleId !== null)) {
        issues.push({
          code: 'APPLICATION_STATE_MISMATCH',
          recordId: application.id,
          path: 'rootResolution',
          message: `Application ${application.id} root resolution does not match its root-module reference.`,
        });
      }
      const transportIsValid =
        application.kind === 'http'
          ? application.transportState === 'not_applicable' && application.transport === null
          : application.transportState === 'resolved'
            ? application.transport !== null
            : application.transportState === 'unknown' && application.transport === null;
      if (!transportIsValid) {
        issues.push({
          code: 'APPLICATION_STATE_MISMATCH',
          recordId: application.id,
          path: 'transportState',
          message: `Application ${application.id} transport state does not match its kind and transport value.`,
        });
      }
    }

    for (const interaction of analysis.interactions) {
      requireReference(interaction.id, 'sourceMethodId', interaction.sourceMethodId, 'method');
      if (interaction.applicationId !== null) {
        requireReference(interaction.id, 'applicationId', interaction.applicationId, 'application');
      }
      addDuplicateReferenceIssues(interaction.id, 'evidenceIds', interaction.evidenceIds, issues);
      for (const evidenceId of interaction.evidenceIds) {
        requireReference(interaction.id, 'evidenceIds', evidenceId, 'evidence');
      }
      if (interaction.kind === 'in_process_event' && interaction.target.pattern !== undefined) {
        issues.push({
          code: 'INTERACTION_ASSERTION_MISMATCH',
          recordId: interaction.id,
          path: 'target.pattern',
          message: `Emitted interaction ${interaction.id} cannot carry a listener wildcard pattern.`,
        });
      }
    }

    for (const handler of analysis.interactionHandlers) {
      requireReference(handler.id, 'methodId', handler.methodId, 'method');
      if (handler.applicationId !== null) {
        requireReference(handler.id, 'applicationId', handler.applicationId, 'application');
      }
      requireReference(handler.id, 'handlerEvidenceId', handler.handlerEvidenceId, 'evidence');
      if (handler.kind === 'in_process_event') {
        addDuplicateReferenceIssues(
          handler.id,
          'configurationEvidenceIds',
          handler.configurationEvidenceIds ?? [],
          issues,
        );
        for (const evidenceId of handler.configurationEvidenceIds ?? []) {
          requireReference(handler.id, 'configurationEvidenceIds', evidenceId, 'evidence');
        }
        if (
          (handler.target.pattern === undefined) !==
          (handler.configurationEvidenceIds === undefined)
        ) {
          issues.push({
            code: 'INTERACTION_ASSERTION_MISMATCH',
            recordId: handler.id,
            path: 'configurationEvidenceIds',
            message: `Wildcard handler ${handler.id} must carry its configuration evidence, and exact handlers must not.`,
          });
        }
      }
    }

    const rootAssertionApplications = new Set<string>();
    const initiatedInteractions = new Set<string>();
    const implementedHandlers = new Set<string>();
    for (const assertion of analysis.assertions) {
      switch (assertion.predicate) {
        case 'APPLICATION_USES_ROOT_MODULE': {
          const application = applicationById.get(assertion.subjectId);
          if (assertion.status === 'resolved') {
            rootAssertionApplications.add(assertion.subjectId);
          }
          if (
            application !== undefined &&
            (assertion.status !== 'resolved' ||
              application.rootResolution !== 'resolved' ||
              application.rootModuleId !== assertion.objectId ||
              !assertion.evidenceIds.includes(application.bootstrapEvidenceId))
          ) {
            issues.push({
              code: 'INTERACTION_ASSERTION_MISMATCH',
              recordId: assertion.id,
              message: `Application root assertion ${assertion.id} does not match its application record.`,
            });
          }
          break;
        }
        case 'METHOD_INITIATES_INTERACTION': {
          if (assertion.objectId === null) break;
          const interaction = interactionById.get(assertion.objectId);
          if (assertion.status === 'resolved') {
            initiatedInteractions.add(assertion.objectId);
          }
          if (
            interaction !== undefined &&
            (assertion.status !== 'resolved' ||
              interaction.sourceMethodId !== assertion.subjectId ||
              !interaction.evidenceIds.some((id) => assertion.evidenceIds.includes(id)))
          ) {
            issues.push({
              code: 'INTERACTION_ASSERTION_MISMATCH',
              recordId: assertion.id,
              message: `Interaction initiation assertion ${assertion.id} does not match its interaction record.`,
            });
          }
          break;
        }
        case 'HANDLER_IMPLEMENTED_BY': {
          const handler = handlerById.get(assertion.subjectId);
          if (assertion.status === 'resolved') {
            implementedHandlers.add(assertion.subjectId);
          }
          if (
            handler !== undefined &&
            (assertion.status !== 'resolved' ||
              handler.methodId !== assertion.objectId ||
              !assertion.evidenceIds.includes(handler.handlerEvidenceId))
          ) {
            issues.push({
              code: 'INTERACTION_ASSERTION_MISMATCH',
              recordId: assertion.id,
              message: `Handler implementation assertion ${assertion.id} does not match its handler record.`,
            });
          }
          break;
        }
        case 'INTERACTION_MATCHES_LOCAL_HANDLER': {
          if (assertion.objectId === null) break;
          const interaction = interactionById.get(assertion.subjectId);
          const handler = handlerById.get(assertion.objectId);
          if (interaction !== undefined && handler !== undefined) {
            const targetMismatch =
              interaction.kind === 'in_process_event' && handler.kind === 'in_process_event'
                ? !inProcessEventTargetsMatch(interaction.target, handler.target)
                : interaction.kind === 'job_queue' && handler.kind === 'job_queue'
                  ? !jobQueueTargetsMatch(interaction.target, handler.target)
                  : interaction.kind === 'microservice_message' &&
                      handler.kind === 'microservice_message'
                    ? !microserviceMessageTargetsMatch(interaction.target, handler.target)
                    : interactionTargetKey(interaction.target) !==
                      interactionTargetKey(handler.target);
            const applicationMismatch =
              interaction.kind === 'microservice_message'
                ? interaction.applicationId === null ||
                  handler.applicationId === null ||
                  interaction.applicationId !== handler.applicationId
                : interaction.applicationId !== null &&
                  handler.applicationId !== null &&
                  interaction.applicationId !== handler.applicationId;
            const statusMismatch =
              assertion.status !== 'resolved' &&
              !(
                assertion.status === 'ambiguous' &&
                interaction.kind === 'microservice_message' &&
                interaction.target.mode === 'request_response'
              );
            if (
              statusMismatch ||
              interaction.kind !== handler.kind ||
              targetMismatch ||
              applicationMismatch ||
              (handler.kind === 'in_process_event' &&
                (handler.configurationEvidenceIds ?? []).some(
                  (evidenceId) => !assertion.evidenceIds.includes(evidenceId),
                )) ||
              (handler.kind === 'in_process_event' &&
                handler.target.pattern !== undefined &&
                assertion.ruleId !== 'event.in-process.wildcard-match.v1') ||
              (interaction.kind === 'in_process_event' &&
                interaction.target.identityKind === 'dynamic')
            ) {
              issues.push({
                code: 'INTERACTION_ASSERTION_MISMATCH',
                recordId: assertion.id,
                message: `Interaction/handler assertion ${assertion.id} does not preserve kind, configured target matching, application scope, evidence, and resolution semantics (${interactionTargetKey(interaction.target)} versus ${interactionTargetKey(handler.target)}).`,
              });
            }
          }
          break;
        }
        default:
          break;
      }
    }

    for (const application of analysis.applications) {
      if (
        application.rootResolution !== 'resolved' ||
        rootAssertionApplications.has(application.id)
      ) {
        continue;
      }
      issues.push({
        code: 'INTERACTION_ASSERTION_MISMATCH',
        recordId: application.id,
        path: 'rootModuleId',
        message: `Resolved application ${application.id} has no root-module assertion.`,
      });
    }
    for (const interaction of analysis.interactions) {
      if (initiatedInteractions.has(interaction.id)) continue;
      issues.push({
        code: 'INTERACTION_ASSERTION_MISMATCH',
        recordId: interaction.id,
        message: `Interaction ${interaction.id} has no method-initiation assertion.`,
      });
    }
    for (const handler of analysis.interactionHandlers) {
      if (implementedHandlers.has(handler.id)) continue;
      issues.push({
        code: 'INTERACTION_ASSERTION_MISMATCH',
        recordId: handler.id,
        message: `Interaction handler ${handler.id} has no implementation assertion.`,
      });
    }

    if (analysisHasJobQueueBranchFacts(analysis)) {
      const contractResult = jobQueueBranchContractSchema.safeParse({
        dispatches: analysis.interactionHandlerDispatches,
        branches: analysis.interactionHandlerBranches,
        effects: analysis.interactionHandlerBranchEffects,
      });
      if (!contractResult.success) {
        for (const issue of contractResult.error.issues) {
          issues.push({
            code: 'SCHEMA_INVALID',
            path: issue.path.join('.'),
            message: issue.message,
          });
        }
      }
      for (const dispatch of analysis.interactionHandlerDispatches) {
        requireReference(dispatch.id, 'handlerId', dispatch.handlerId, 'interaction_handler');
        addDuplicateReferenceIssues(dispatch.id, 'branchIds', dispatch.branchIds, issues);
        addDuplicateReferenceIssues(dispatch.id, 'evidenceIds', dispatch.evidenceIds, issues);
        for (const branchId of dispatch.branchIds) {
          requireReference(dispatch.id, 'branchIds', branchId, 'interaction_handler_branch');
        }
        for (const evidenceId of dispatch.evidenceIds) {
          requireReference(dispatch.id, 'evidenceIds', evidenceId, 'evidence');
        }
        const handler = handlerById.get(dispatch.handlerId);
        if (handler !== undefined && handler.kind !== 'job_queue') {
          issues.push({
            code: 'INTERACTION_ASSERTION_MISMATCH',
            recordId: dispatch.id,
            path: 'handlerId',
            message: `Job-queue dispatch ${dispatch.id} references a non-job-queue handler.`,
          });
        }
      }
      for (const branch of analysis.interactionHandlerBranches) {
        requireReference(
          branch.id,
          'dispatchId',
          branch.dispatchId,
          'interaction_handler_dispatch',
        );
        addDuplicateReferenceIssues(branch.id, 'evidenceIds', branch.evidenceIds, issues);
        for (const evidenceId of branch.evidenceIds) {
          requireReference(branch.id, 'evidenceIds', evidenceId, 'evidence');
        }
      }
      for (const effect of analysis.interactionHandlerBranchEffects) {
        requireReference(effect.id, 'branchId', effect.branchId, 'interaction_handler_branch');
        requireReference(effect.id, 'sourceAssertionId', effect.sourceAssertionId, 'assertion');
        const targetKind =
          effect.kind === 'calls_method'
            ? 'method'
            : effect.kind === 'initiates_interaction'
              ? 'interaction'
              : effect.kind === 'accesses_resource'
                ? 'resource_access'
                : 'table';
        requireReference(effect.id, 'targetId', effect.targetId, targetKind);
        addDuplicateReferenceIssues(effect.id, 'evidenceIds', effect.evidenceIds, issues);
        for (const evidenceId of effect.evidenceIds) {
          requireReference(effect.id, 'evidenceIds', evidenceId, 'evidence');
        }
        const sourceAssertion = analysis.assertions.find(
          ({ id }) => id === effect.sourceAssertionId,
        );
        if (
          sourceAssertion !== undefined &&
          (sourceAssertion.objectId !== effect.targetId ||
            sourceAssertion.status !== effect.status ||
            (effect.kind === 'calls_method' &&
              sourceAssertion.predicate !== 'METHOD_CALLS_METHOD') ||
            (effect.kind === 'reads_table' && sourceAssertion.predicate !== 'METHOD_READS_TABLE') ||
            (effect.kind === 'writes_table' &&
              sourceAssertion.predicate !== 'METHOD_WRITES_TABLE') ||
            (effect.kind === 'initiates_interaction' &&
              sourceAssertion.predicate !== 'METHOD_INITIATES_INTERACTION') ||
            (effect.kind === 'accesses_resource' &&
              sourceAssertion.predicate !== 'METHOD_ACCESSES_RESOURCE'))
        ) {
          issues.push({
            code: 'INTERACTION_ASSERTION_MISMATCH',
            recordId: effect.id,
            path: 'sourceAssertionId',
            message: `Branch effect ${effect.id} does not preserve its source assertion semantics.`,
          });
        }
      }
    }
  }

  if (analysisHasAuthorizationFacts(analysis)) {
    const metadataById = new Map(
      analysis.authorizationMetadata.map((record) => [record.id, record]),
    );
    const enforcementCounts = new Map<string, number>();
    for (const metadata of analysis.authorizationMetadata) {
      requireReference(metadata.id, 'endpointId', metadata.endpointId, 'endpoint');
      if (metadata.decorator.sourceFileId !== null) {
        requireReference(
          metadata.id,
          'decorator.sourceFileId',
          metadata.decorator.sourceFileId,
          'source',
        );
      }
      addDuplicateReferenceIssues(metadata.id, 'evidenceIds', metadata.evidenceIds, issues);
      for (const evidenceId of metadata.evidenceIds) {
        requireReference(metadata.id, 'evidenceIds', evidenceId, 'evidence');
      }
    }
    for (const enforcement of analysis.authorizationEnforcements) {
      enforcementCounts.set(
        enforcement.metadataId,
        (enforcementCounts.get(enforcement.metadataId) ?? 0) + 1,
      );
      requireReference(
        enforcement.id,
        'metadataId',
        enforcement.metadataId,
        'authorization_metadata',
      );
      requireReference(enforcement.id, 'endpointId', enforcement.endpointId, 'endpoint');
      addDuplicateReferenceIssues(enforcement.id, 'evidenceIds', enforcement.evidenceIds, issues);
      for (const evidenceId of enforcement.evidenceIds) {
        requireReference(enforcement.id, 'evidenceIds', evidenceId, 'evidence');
      }
      const metadata = metadataById.get(enforcement.metadataId);
      if (metadata !== undefined && metadata.endpointId !== enforcement.endpointId) {
        issues.push({
          code: 'AUTHORIZATION_RELATIONSHIP_MISMATCH',
          recordId: enforcement.id,
          path: 'endpointId',
          message: `Authorization enforcement ${enforcement.id} does not share its metadata endpoint.`,
        });
      }
      if (enforcement.guardId === null || enforcement.guardAssertionId === null) continue;
      requireReference(enforcement.id, 'guardId', enforcement.guardId, 'guard');
      requireReference(
        enforcement.id,
        'guardAssertionId',
        enforcement.guardAssertionId,
        'assertion',
      );
      const assertion = analysis.assertions.find(({ id }) => id === enforcement.guardAssertionId);
      const isEndpointGuardAssertion =
        assertion?.predicate === 'ENDPOINT_USES_GUARD' &&
        assertion.subjectId === enforcement.endpointId;
      const isGlobalGuardAssertion = analysis.globalGuardRegistrations.some(
        ({ assertionId }) => assertionId === assertion?.id,
      );
      if (
        assertion !== undefined &&
        ((!isEndpointGuardAssertion && !isGlobalGuardAssertion) ||
          assertion.objectId !== enforcement.guardId ||
          assertion.status !== 'resolved')
      ) {
        issues.push({
          code: 'AUTHORIZATION_RELATIONSHIP_MISMATCH',
          recordId: enforcement.id,
          path: 'guardAssertionId',
          message: `Authorization enforcement ${enforcement.id} does not match a resolved direct/composite/global guard assertion.`,
        });
      }
    }
    for (const metadata of analysis.authorizationMetadata) {
      if ((enforcementCounts.get(metadata.id) ?? 0) > 0) continue;
      issues.push({
        code: 'AUTHORIZATION_RELATIONSHIP_MISMATCH',
        recordId: metadata.id,
        message: `Authorization metadata ${metadata.id} has no explicit enforcement relationship.`,
      });
    }
  }

  if (analysisHasResourceAccessFacts(analysis)) {
    const supported = [...analysis.resourceAccessAnalysis.supportedTechnologies].sort();
    const enabled = [...analysis.resourceAccessAnalysis.enabledTechnologies].sort();
    const expectedTechnologies = analysisHasCriticalSectionFacts(analysis)
      ? ['cache_manager', 'ioredis', 'redlock'].sort()
      : ['cache_manager', 'ioredis'];
    if (
      supported.join('|') !== expectedTechnologies.join('|') ||
      enabled.join('|') !== supported.join('|')
    ) {
      issues.push({
        code: 'RESOURCE_ACCESS_RELATIONSHIP_MISMATCH',
        path: 'resourceAccessAnalysis',
        message:
          'Resource-access analysis must advertise the complete supported and enabled technology set.',
      });
    }
    const accessById = new Map(analysis.resourceAccesses.map((record) => [record.id, record]));
    const linkedAccessIds = new Set<string>();
    for (const access of analysis.resourceAccesses) {
      requireReference(access.id, 'sourceMethodId', access.sourceMethodId, 'method');
      addDuplicateReferenceIssues(access.id, 'evidenceIds', access.evidenceIds, issues);
      for (const evidenceId of access.evidenceIds) {
        requireReference(access.id, 'evidenceIds', evidenceId, 'evidence');
      }
    }
    for (const assertion of analysis.assertions) {
      if (assertion.predicate !== 'METHOD_ACCESSES_RESOURCE' || assertion.objectId === null) {
        continue;
      }
      linkedAccessIds.add(assertion.objectId);
      const access = accessById.get(assertion.objectId);
      if (
        access !== undefined &&
        (assertion.status !== 'resolved' ||
          assertion.subjectId !== access.sourceMethodId ||
          assertion.ruleId !== access.ruleId ||
          !access.evidenceIds.some((id) => assertion.evidenceIds.includes(id)))
      ) {
        issues.push({
          code: 'RESOURCE_ACCESS_RELATIONSHIP_MISMATCH',
          recordId: assertion.id,
          message: `Resource assertion ${assertion.id} does not match its access record.`,
        });
      }
    }
    for (const access of analysis.resourceAccesses) {
      if (!linkedAccessIds.has(access.id)) {
        issues.push({
          code: 'RESOURCE_ACCESS_RELATIONSHIP_MISMATCH',
          recordId: access.id,
          message: `Resource access ${access.id} has no method-access assertion.`,
        });
      }
    }
  }

  if (analysisHasCriticalSectionFacts(analysis)) {
    const accessById = new Map(analysis.resourceAccesses.map((record) => [record.id, record]));
    const assertionById = new Map(analysis.assertions.map((record) => [record.id, record]));
    for (const section of analysis.criticalSections) {
      requireReference(section.id, 'sourceMethodId', section.sourceMethodId, 'method');
      requireReference(section.id, 'callbackEvidenceId', section.callbackEvidenceId, 'evidence');
      addDuplicateReferenceIssues(
        section.id,
        'lockResourceAccessIds',
        section.lockResourceAccessIds,
        issues,
      );
      addDuplicateReferenceIssues(
        section.id,
        'effectAssertionIds',
        section.effectAssertionIds,
        issues,
      );
      for (const evidenceId of section.evidenceIds) {
        requireReference(section.id, 'evidenceIds', evidenceId, 'evidence');
      }
      for (const accessId of section.lockResourceAccessIds) {
        requireReference(section.id, 'lockResourceAccessIds', accessId, 'resource_access');
        const access = accessById.get(accessId);
        if (
          access !== undefined &&
          (access.sourceMethodId !== section.sourceMethodId ||
            access.technology !== 'redlock' ||
            access.resourceKind !== 'distributed_lock' ||
            access.operation !== 'critical_section')
        ) {
          issues.push({
            code: 'CRITICAL_SECTION_RELATIONSHIP_MISMATCH',
            recordId: section.id,
            path: 'lockResourceAccessIds',
            message: `Critical section ${section.id} references a non-Redlock critical-section resource.`,
          });
        }
      }
      for (const assertionId of section.effectAssertionIds) {
        requireReference(section.id, 'effectAssertionIds', assertionId, 'assertion');
        const assertion = assertionById.get(assertionId);
        if (
          assertion !== undefined &&
          (assertion.subjectId !== section.sourceMethodId ||
            ![
              'METHOD_CALLS_METHOD',
              'METHOD_READS_TABLE',
              'METHOD_WRITES_TABLE',
              'METHOD_ACCESSES_RESOURCE',
              'METHOD_INITIATES_INTERACTION',
            ].includes(assertion.predicate))
        ) {
          issues.push({
            code: 'CRITICAL_SECTION_RELATIONSHIP_MISMATCH',
            recordId: section.id,
            path: 'effectAssertionIds',
            message: `Critical section ${section.id} references an assertion outside its supported effect family.`,
          });
        }
      }
    }
  }

  const sourceById = new Map(analysis.sourceFiles.map((source) => [source.id, source]));
  for (const evidence of analysis.evidence) {
    requireReference(evidence.id, 'fileId', evidence.fileId, 'source');
    const source = sourceById.get(evidence.fileId);
    if (source !== undefined && source.contentHash !== evidence.contentHash) {
      issues.push({
        code: 'EVIDENCE_HASH_MISMATCH',
        recordId: evidence.id,
        path: 'contentHash',
        message: `Evidence ${evidence.id} hash does not match source file ${source.id}.`,
      });
    }

    if (!rangeIsOrdered(evidence)) {
      issues.push({
        code: 'INVALID_EVIDENCE_RANGE',
        recordId: evidence.id,
        message: `Evidence ${evidence.id} starts after it ends.`,
      });
    }
  }

  for (const assertion of analysis.assertions) {
    const expectedKinds = ASSERTION_KINDS[assertion.predicate];
    requireReference(assertion.id, 'subjectId', assertion.subjectId, expectedKinds.subject);

    if (assertion.objectId === null) {
      if (assertion.status === 'resolved' || assertion.status === 'ambiguous') {
        issues.push({
          code: 'MISSING_ASSERTION_TARGET',
          recordId: assertion.id,
          path: 'objectId',
          message: `${assertion.status} assertion ${assertion.id} must have a target.`,
        });
      }
    } else {
      requireReference(assertion.id, 'objectId', assertion.objectId, expectedKinds.object);
    }

    if (assertion.status === 'resolved' && assertion.evidenceIds.length === 0) {
      issues.push({
        code: 'RESOLVED_ASSERTION_WITHOUT_EVIDENCE',
        recordId: assertion.id,
        path: 'evidenceIds',
        message: `Resolved assertion ${assertion.id} has no evidence.`,
      });
    }

    addDuplicateReferenceIssues(assertion.id, 'evidenceIds', assertion.evidenceIds, issues);
    for (const evidenceId of assertion.evidenceIds) {
      requireReference(assertion.id, 'evidenceIds', evidenceId, 'evidence');
    }
  }

  for (const diagnostic of analysis.diagnostics) {
    if (diagnostic.subjectId !== undefined) {
      requireReference(diagnostic.id, 'subjectId', diagnostic.subjectId);
    }
    addDuplicateReferenceIssues(diagnostic.id, 'evidenceIds', diagnostic.evidenceIds, issues);
    for (const evidenceId of diagnostic.evidenceIds) {
      requireReference(diagnostic.id, 'evidenceIds', evidenceId, 'evidence');
    }
  }

  if (issues.length > 0) {
    return {
      success: false,
      issues: issues.sort((left, right) =>
        `${left.code}:${left.recordId ?? ''}:${left.path ?? ''}`.localeCompare(
          `${right.code}:${right.recordId ?? ''}:${right.path ?? ''}`,
        ),
      ),
    };
  }

  return { success: true, data: analysis };
}

export class AnalysisIntegrityError extends Error {
  readonly issues: readonly IntegrityIssue[];

  constructor(issues: readonly IntegrityIssue[]) {
    super(
      `Analysis integrity validation failed with ${issues.length} issue(s): ${issues
        .map(
          (issue) =>
            `${issue.code}${issue.path === undefined ? '' : ` at ${issue.path}`}: ${issue.message}`,
        )
        .join(' | ')}`,
    );
    this.name = 'AnalysisIntegrityError';
    this.issues = issues;
  }
}

export function assertValidAnalysisDocument(input: unknown): AnalysisDocument {
  const result = validateAnalysisDocument(input);
  if (!result.success) {
    throw new AnalysisIntegrityError(result.issues);
  }
  return result.data;
}
