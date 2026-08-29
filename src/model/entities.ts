import type { AuthorizationAnalysisConfiguration } from './authorization.js';

export type RecordId = string;

export const CLASS_ROLES_V1 = ['controller', 'provider', 'guard', 'entity'] as const;
export const CLASS_ROLES_V2 = [...CLASS_ROLES_V1, 'module'] as const;
export const CLASS_ROLES = CLASS_ROLES_V2;
export type ClassRole = (typeof CLASS_ROLES)[number];

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'ALL',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const TABLE_NAME_SOURCES_V1 = ['explicit', 'default_lowercase_class_name'] as const;
export const TABLE_NAME_SOURCES_V2 = [
  ...TABLE_NAME_SOURCES_V1,
  'query_builder_literal',
  'raw_sql_literal',
] as const;
export const TABLE_NAME_SOURCES = TABLE_NAME_SOURCES_V2;
export type TableNameSource = (typeof TABLE_NAME_SOURCES)[number];

export interface ToolMetadata {
  readonly name: string;
  readonly version: string;
  readonly typescriptVersion: string;
}

export const RAW_SQL_DIALECTS = ['postgresql-18'] as const;
export type RawSqlDialect = (typeof RAW_SQL_DIALECTS)[number];

export interface RawSqlAnalysisConfiguration {
  readonly dialect: RawSqlDialect;
  readonly parserName: 'libpg-query';
  readonly parserVersion: '18.1.2';
  readonly maxSqlBytes: number;
  readonly maxStatements: number;
  readonly maxParseTimeMs: number;
  readonly maxAstNodes: number;
}

export interface AnalysisConfiguration {
  readonly maxCallDepth: number;
  readonly maxSourceFileBytes: number;
  readonly evidenceSnippetLimit: number;
  readonly rawSql?: RawSqlAnalysisConfiguration | undefined;
  /** Required by analysis v3; absent from frozen v1/v2 documents. */
  readonly interactions?: InteractionTraversalConfiguration | undefined;
  /** Required by analysis v5; absent from frozen v1-v4 documents. */
  readonly authorization?: AuthorizationAnalysisConfiguration | undefined;
}

export interface InteractionTraversalConfiguration {
  readonly maxInteractionHops: number;
  readonly maxFanOutPerInteraction: number;
  readonly maxInteractionTraceStates: number;
}

export interface AnalysisRunRecord {
  readonly id: RecordId;
  readonly repositoryRevision: string | null;
  readonly tsconfigPath: string;
  readonly tool: ToolMetadata;
  readonly configuration: AnalysisConfiguration;
}

export interface SourceFileRecord {
  readonly id: RecordId;
  readonly path: string;
  readonly contentHash: string;
  readonly byteLength: number;
}

export interface ClassRecord {
  readonly id: RecordId;
  readonly sourceFileId: RecordId;
  readonly qualifiedName: string;
  readonly displayName: string;
  readonly roles: readonly ClassRole[];
  readonly declarationEvidenceId: RecordId;
}

export interface MethodRecord {
  readonly id: RecordId;
  readonly classId: RecordId;
  readonly qualifiedName: string;
  readonly displayName: string;
  readonly signature: string;
  readonly declarationEvidenceId: RecordId;
}

export interface EndpointRecord {
  readonly id: RecordId;
  readonly httpMethod: HttpMethod;
  readonly path: string;
}

export interface GuardRecord {
  readonly id: RecordId;
  readonly classId: RecordId;
  readonly displayName: string;
}

export interface RepositoryBindingRecord {
  readonly id: RecordId;
  readonly ownerClassId: RecordId;
  readonly memberName: string;
  readonly declarationEvidenceId: RecordId;
}

export interface TypeOrmEntityRecord {
  readonly id: RecordId;
  readonly classId: RecordId;
  readonly displayName: string;
}

export interface TableRecord {
  readonly id: RecordId;
  readonly name: string;
  readonly nameSource: TableNameSource;
}

export const MODULE_METADATA_COMPLETENESS_STATES = ['complete', 'incomplete'] as const;
export type ModuleMetadataCompleteness = (typeof MODULE_METADATA_COMPLETENESS_STATES)[number];

export interface ModuleRecord {
  readonly id: RecordId;
  readonly classId: RecordId;
  readonly isGlobal: boolean;
  readonly metadataCompleteness: ModuleMetadataCompleteness;
  readonly declarationEvidenceId: RecordId;
}

export const GLOBAL_GUARD_REGISTRATION_KINDS = [
  'app_guard_use_class',
  'app_guard_use_existing',
  'bootstrap_use_global_guards',
] as const;
export type GlobalGuardRegistrationKind = (typeof GLOBAL_GUARD_REGISTRATION_KINDS)[number];

export interface GlobalGuardRegistrationRecord {
  readonly id: RecordId;
  readonly guardId: RecordId;
  readonly moduleId: RecordId;
  readonly kind: GlobalGuardRegistrationKind;
  readonly order: number;
  readonly assertionId: RecordId;
  readonly registrationEvidenceId: RecordId;
}

export const CONTRACT_DECLARATION_KINDS = ['class', 'interface'] as const;
export type ContractDeclarationKind = (typeof CONTRACT_DECLARATION_KINDS)[number];
export const CONTRACT_SHAPE_SOURCES = ['declarations', 'checker_derived', 'unknown'] as const;
export type ContractShapeSource = (typeof CONTRACT_SHAPE_SOURCES)[number];

export interface ContractTypeRecord {
  readonly id: RecordId;
  readonly sourceFileId: RecordId;
  readonly qualifiedName: string;
  readonly displayName: string;
  readonly declarationKind: ContractDeclarationKind;
  readonly shapeSource: ContractShapeSource;
  readonly declarationEvidenceId: RecordId;
}

export interface DeclaredConstraint {
  readonly name: string;
  readonly argumentTexts: readonly string[];
  readonly decoratorEvidenceId: RecordId;
}

export interface ContractFieldRecord {
  readonly id: RecordId;
  /** The effective DTO/interface shape for which this field was inventoried. */
  readonly contractTypeId: RecordId;
  /** The in-repository declaration owner, when the checker can prove one. */
  readonly declaringContractTypeId: RecordId | null;
  readonly name: string;
  readonly typeText: string;
  readonly optional: boolean;
  readonly readonly: boolean;
  readonly inherited: boolean;
  readonly shapeSource: ContractShapeSource;
  readonly declarationEvidenceId: RecordId | null;
  readonly declaredConstraints: readonly DeclaredConstraint[];
}

export const DECLARED_TYPE_KINDS = [
  'primitive',
  'contract',
  'array',
  'union',
  'void',
  'any',
  'unknown',
  'complex_generic',
] as const;
export type DeclaredTypeKind = (typeof DECLARED_TYPE_KINDS)[number];
export const DECLARED_TYPE_SOURCES = ['declared', 'checker_derived'] as const;
export type DeclaredTypeSource = (typeof DECLARED_TYPE_SOURCES)[number];

export interface DeclaredTypeShape {
  readonly typeText: string;
  readonly kind: DeclaredTypeKind;
  readonly source: DeclaredTypeSource;
  /** All simple union/array alternatives retained without selecting one. */
  readonly alternatives: readonly string[];
  readonly contractTypeIds: readonly RecordId[];
}

export const REQUEST_SOURCE_KINDS = ['body', 'param', 'query'] as const;
export type RequestSourceKind = (typeof REQUEST_SOURCE_KINDS)[number];
export const REQUEST_SELECTOR_STATES = ['whole', 'literal', 'unknown'] as const;
export type RequestSelectorState = (typeof REQUEST_SELECTOR_STATES)[number];

export interface RequestParameterRecord {
  readonly id: RecordId;
  readonly methodId: RecordId;
  readonly parameterIndex: number;
  readonly parameterName: string;
  readonly sourceKind: RequestSourceKind;
  readonly selector: string | null;
  readonly selectorState: RequestSelectorState;
  readonly optional: boolean;
  readonly declaredType: DeclaredTypeShape;
  readonly declarationEvidenceId: RecordId;
  readonly decoratorEvidenceId: RecordId;
}

export const RESPONSE_HANDLING_KINDS = ['return_value', 'manual'] as const;
export type ResponseHandlingKind = (typeof RESPONSE_HANDLING_KINDS)[number];

export interface ResponseContractRecord {
  readonly id: RecordId;
  readonly methodId: RecordId;
  readonly handling: ResponseHandlingKind;
  /** Handler return annotation/checker text before bounded Promise unwrapping. */
  readonly outerTypeText: string;
  readonly promiseUnwrapped: boolean;
  readonly declaredType: DeclaredTypeShape;
  readonly declarationEvidenceId: RecordId;
  readonly manualResponseEvidenceId: RecordId | null;
}

export const ENTITY_COLUMN_KINDS = ['regular', 'primary', 'primary_generated'] as const;
export type EntityColumnKind = (typeof ENTITY_COLUMN_KINDS)[number];
export const DATABASE_COLUMN_NAME_SOURCES = [
  'explicit',
  'property_name_fallback',
  'unknown',
] as const;
export type DatabaseColumnNameSource = (typeof DATABASE_COLUMN_NAME_SOURCES)[number];
export const TRANSFORMER_PRESENCE_STATES = ['present', 'absent', 'unknown'] as const;
export type TransformerPresenceState = (typeof TRANSFORMER_PRESENCE_STATES)[number];

export interface EntityColumnRecord {
  readonly id: RecordId;
  /** Effective entity that receives this direct or inherited declaration. */
  readonly entityId: RecordId;
  readonly declaringClassId: RecordId;
  readonly propertyName: string;
  readonly databaseName: string | null;
  readonly databaseNameSource: DatabaseColumnNameSource;
  readonly columnKind: EntityColumnKind;
  readonly insert: boolean | null;
  readonly update: boolean | null;
  readonly transformer: TransformerPresenceState;
  readonly inherited: boolean;
  readonly declarationEvidenceId: RecordId;
  readonly decoratorEvidenceId: RecordId;
}

export const REQUEST_FIELD_ORIGIN_RESOLUTIONS = ['resolved', 'ambiguous', 'unknown'] as const;
export type RequestFieldOriginResolution = (typeof REQUEST_FIELD_ORIGIN_RESOLUTIONS)[number];

export interface RequestFieldOriginRecord {
  readonly id: RecordId;
  readonly requestParameterId: RecordId;
  /** A one-segment DTO field path in Phase 20. */
  readonly propertyPath: readonly string[];
  readonly contractFieldIds: readonly RecordId[];
  readonly resolution: RequestFieldOriginResolution;
  readonly originEvidenceId: RecordId;
}

export const COLUMN_INFLUENCE_STATES = ['direct', 'derived', 'unknown'] as const;
export type ColumnInfluenceState = (typeof COLUMN_INFLUENCE_STATES)[number];
export const COLUMN_INFLUENCE_SINK_KINDS = [
  'repository_insert',
  'repository_update',
  'query_builder_insert',
  'query_builder_update',
] as const;
export type ColumnInfluenceSinkKind = (typeof COLUMN_INFLUENCE_SINK_KINDS)[number];

export interface ProvenanceCallStep {
  readonly callerMethodId: RecordId;
  readonly calleeMethodId: RecordId;
  readonly callEvidenceId: RecordId;
}

export interface ColumnInfluenceRecord {
  readonly id: RecordId;
  readonly methodId: RecordId;
  readonly originId: RecordId;
  readonly columnId: RecordId;
  readonly state: ColumnInfluenceState;
  readonly sinkKind: ColumnInfluenceSinkKind;
  readonly sinkPropertyName: string;
  readonly assertionId: RecordId;
  readonly sinkEvidenceId: RecordId;
  readonly operationEvidenceId: RecordId;
  readonly propagationEvidenceIds: readonly RecordId[];
  /** Ordered, empty for same-method influence. */
  readonly callPath: readonly ProvenanceCallStep[];
}
