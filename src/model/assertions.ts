import type { RecordId } from './entities.js';

export const ASSERTION_STATUSES = ['resolved', 'ambiguous', 'unresolved', 'unsupported'] as const;
export type AssertionStatus = (typeof ASSERTION_STATUSES)[number];

export const ASSERTION_PREDICATES_V1 = [
  'ENDPOINT_IMPLEMENTED_BY',
  'METHOD_CALLS_METHOD',
  'CLASS_INJECTS_CLASS',
  'CLASS_INJECTS_REPOSITORY',
  'REPOSITORY_FOR_ENTITY',
  'ENTITY_MAPS_TO_TABLE',
  'METHOD_READS_TABLE',
  'METHOD_WRITES_TABLE',
  'ENDPOINT_USES_GUARD',
] as const;
export const ASSERTION_PREDICATES_V2 = [
  ...ASSERTION_PREDICATES_V1,
  'MODULE_IMPORTS_MODULE',
  'MODULE_PROVIDES_CLASS',
  'MODULE_EXPORTS_CLASS',
  'MODULE_EXPORTS_MODULE',
  'MODULE_DECLARES_CONTROLLER',
  'MODULE_REGISTERS_GLOBAL_GUARD',
  'APPLICATION_REGISTERS_GLOBAL_GUARD',
  'METHOD_DECLARES_REQUEST_PARAMETER',
  'METHOD_DECLARES_RESPONSE',
  'CONTRACT_TYPE_DECLARES_FIELD',
  'ENTITY_DECLARES_COLUMN',
  'REQUEST_PARAMETER_HAS_FIELD_ORIGIN',
  'REQUEST_FIELD_MAY_FLOW_TO_COLUMN',
] as const;
export const ASSERTION_PREDICATES_V3 = [
  ...ASSERTION_PREDICATES_V2,
  'APPLICATION_USES_ROOT_MODULE',
  'METHOD_INITIATES_INTERACTION',
  'INTERACTION_MATCHES_LOCAL_HANDLER',
  'HANDLER_IMPLEMENTED_BY',
] as const;
export const ASSERTION_PREDICATES = ASSERTION_PREDICATES_V3;
export type AssertionPredicate = (typeof ASSERTION_PREDICATES)[number];

export interface AssertionRecord {
  readonly id: RecordId;
  readonly subjectId: RecordId;
  readonly predicate: AssertionPredicate;
  readonly objectId: RecordId | null;
  readonly status: AssertionStatus;
  readonly ruleId: string;
  readonly evidenceIds: readonly RecordId[];
}
