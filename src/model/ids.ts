import { createHash } from 'node:crypto';
import type { AssertionPredicate } from './assertions.js';
import type { AnalysisConfiguration } from './entities.js';
import type { EvidenceRole, SourceRange } from './evidence.js';

export const STABLE_ID_KINDS = [
  'analysis',
  'source',
  'class',
  'method',
  'endpoint',
  'guard',
  'repository_binding',
  'entity',
  'table',
  'assertion',
  'evidence',
  'diagnostic',
  'module',
  'global_guard_registration',
  'contract_type',
  'contract_field',
  'request_parameter',
  'response_contract',
  'entity_column',
  'request_field_origin',
  'column_influence',
  'application',
  'interaction',
  'interaction_handler',
] as const;
export type StableIdKind = (typeof STABLE_ID_KINDS)[number];

type StableIdentityValue = string | number | boolean | null;

function encodeIdentity(identity: readonly StableIdentityValue[]): string {
  return JSON.stringify(
    identity.map((value) => (typeof value === 'string' ? value.normalize('NFC') : value)),
  );
}

export function createStableId(
  kind: StableIdKind,
  identity: readonly StableIdentityValue[],
): string {
  const digest = createHash('sha256').update(encodeIdentity(identity)).digest('hex').slice(0, 32);
  return `${kind}:${digest}`;
}

export function makeAnalysisRunId(input: {
  repositoryRevision: string | null;
  tsconfigPath: string;
  toolVersion: string;
  typescriptVersion: string;
  configuration: AnalysisConfiguration;
}): string {
  const rawSqlIdentity: readonly StableIdentityValue[] =
    input.configuration.rawSql === undefined
      ? []
      : [
          input.configuration.rawSql.dialect,
          input.configuration.rawSql.parserName,
          input.configuration.rawSql.parserVersion,
          input.configuration.rawSql.maxSqlBytes,
          input.configuration.rawSql.maxStatements,
          input.configuration.rawSql.maxParseTimeMs,
          input.configuration.rawSql.maxAstNodes,
        ];
  const interactionIdentity: readonly StableIdentityValue[] =
    input.configuration.interactions === undefined
      ? []
      : [
          input.configuration.interactions.maxInteractionHops,
          input.configuration.interactions.maxFanOutPerInteraction,
          input.configuration.interactions.maxInteractionTraceStates,
        ];
  return createStableId('analysis', [
    input.repositoryRevision,
    input.tsconfigPath,
    input.toolVersion,
    input.typescriptVersion,
    input.configuration.maxCallDepth,
    input.configuration.maxSourceFileBytes,
    input.configuration.evidenceSnippetLimit,
    ...rawSqlIdentity,
    ...interactionIdentity,
  ]);
}

export function makeSourceFileId(path: string, repositoryRevision: string | null): string {
  return createStableId('source', [repositoryRevision, path]);
}

export function makeClassId(input: {
  path: string;
  qualifiedName: string;
  repositoryRevision: string | null;
}): string {
  return createStableId('class', [input.repositoryRevision, input.path, input.qualifiedName]);
}

export function makeMethodId(input: {
  path: string;
  qualifiedClassName: string;
  methodName: string;
  signature: string;
  repositoryRevision: string | null;
}): string {
  return createStableId('method', [
    input.repositoryRevision,
    input.path,
    input.qualifiedClassName,
    input.methodName,
    input.signature,
  ]);
}

export function makeEndpointId(input: {
  httpMethod: string;
  path: string;
  handlerMethodId: string;
  repositoryRevision: string | null;
}): string {
  return createStableId('endpoint', [
    input.repositoryRevision,
    input.httpMethod.toUpperCase(),
    input.path,
    input.handlerMethodId,
  ]);
}

export function makeGuardId(classId: string): string {
  return createStableId('guard', [classId]);
}

export function makeRepositoryBindingId(ownerClassId: string, memberName: string): string {
  return createStableId('repository_binding', [ownerClassId, memberName]);
}

export function makeEntityId(classId: string): string {
  return createStableId('entity', [classId]);
}

export function makeTableId(tableName: string, provenance?: string): string {
  return createStableId('table', provenance === undefined ? [tableName] : [tableName, provenance]);
}

export function makeModuleId(classId: string): string {
  return createStableId('module', [classId]);
}

export function makeGlobalGuardRegistrationId(input: {
  moduleId: string;
  guardId: string;
  kind: string;
  registrationEvidenceId: string;
}): string {
  return createStableId('global_guard_registration', [
    input.moduleId,
    input.guardId,
    input.kind,
    input.registrationEvidenceId,
  ]);
}

export function makeContractTypeId(input: {
  path: string;
  qualifiedName: string;
  repositoryRevision: string | null;
}): string {
  return createStableId('contract_type', [
    input.repositoryRevision,
    input.path,
    input.qualifiedName,
  ]);
}

export function makeContractFieldId(contractTypeId: string, propertyName: string): string {
  return createStableId('contract_field', [contractTypeId, propertyName]);
}

export function makeRequestParameterId(input: {
  methodId: string;
  parameterIndex: number;
  sourceKind: string;
}): string {
  return createStableId('request_parameter', [
    input.methodId,
    input.parameterIndex,
    input.sourceKind,
  ]);
}

export function makeResponseContractId(methodId: string): string {
  return createStableId('response_contract', [methodId]);
}

export function makeEntityColumnId(input: {
  entityId: string;
  declaringClassId: string;
  propertyName: string;
}): string {
  return createStableId('entity_column', [
    input.entityId,
    input.declaringClassId,
    input.propertyName,
  ]);
}

export function makeRequestFieldOriginId(input: {
  requestParameterId: string;
  propertyPath: readonly string[];
}): string {
  return createStableId('request_field_origin', [input.requestParameterId, ...input.propertyPath]);
}

export function makeColumnInfluenceId(input: {
  methodId: string;
  originId: string;
  columnId: string;
  sinkKind: string;
  sinkPropertyName: string;
  operationEvidenceId: string;
  callEvidenceIds?: readonly string[];
}): string {
  return createStableId('column_influence', [
    input.methodId,
    input.originId,
    input.columnId,
    input.sinkKind,
    input.sinkPropertyName,
    input.operationEvidenceId,
    ...(input.callEvidenceIds ?? []),
  ]);
}

export function makeApplicationId(input: {
  kind: string;
  rootModuleId: string | null;
  bootstrapEvidenceId: string;
}): string {
  return createStableId('application', [input.kind, input.rootModuleId, input.bootstrapEvidenceId]);
}

export function makeInteractionId(input: {
  kind: string;
  sourceMethodId: string;
  targetKey: string;
  applicationId: string | null;
  initiationEvidenceId: string;
}): string {
  return createStableId('interaction', [
    input.kind,
    input.sourceMethodId,
    input.targetKey,
    input.applicationId,
    input.initiationEvidenceId,
  ]);
}

export function makeInteractionHandlerId(input: {
  kind: string;
  methodId: string;
  targetKey: string;
  applicationId: string | null;
  handlerEvidenceId: string;
}): string {
  return createStableId('interaction_handler', [
    input.kind,
    input.methodId,
    input.targetKey,
    input.applicationId,
    input.handlerEvidenceId,
  ]);
}

export function makeAssertionId(input: {
  subjectId: string;
  predicate: AssertionPredicate;
  objectId: string | null;
  ruleId: string;
}): string {
  return createStableId('assertion', [
    input.subjectId,
    input.predicate,
    input.objectId,
    input.ruleId,
  ]);
}

export function makeEvidenceId(input: {
  fileId: string;
  range: SourceRange;
  role: EvidenceRole;
  contentHash: string;
}): string {
  return createStableId('evidence', [
    input.fileId,
    input.range.startLine,
    input.range.startColumn,
    input.range.endLine,
    input.range.endColumn,
    input.role,
    input.contentHash,
  ]);
}

export function makeDiagnosticId(input: {
  code: string;
  subjectId?: string;
  evidenceIds: readonly string[];
}): string {
  return createStableId('diagnostic', [
    input.code,
    input.subjectId ?? null,
    ...[...input.evidenceIds].sort(),
  ]);
}
