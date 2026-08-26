import type { DiagnosticCode, DiagnosticRecord, DiagnosticSeverity } from '../model/diagnostics.js';
import { makeDiagnosticId } from '../model/ids.js';

export interface DiagnosticDefinition {
  readonly defaultSeverity: DiagnosticSeverity;
  readonly summary: string;
}

export const DIAGNOSTIC_CATALOGUE: Readonly<Record<DiagnosticCode, DiagnosticDefinition>> = {
  TS_PARSE_ERROR: {
    defaultSeverity: 'error',
    summary: 'A source file could not be parsed.',
  },
  TS_IMPORT_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'A local import or symbol could not be resolved.',
  },
  NEST_ROUTE_DYNAMIC: {
    defaultSeverity: 'warning',
    summary: 'A route path is computed beyond the supported constant rules.',
  },
  NEST_CUSTOM_ROUTE_DECORATOR: {
    defaultSeverity: 'warning',
    summary: 'A route decorator is not a supported standard NestJS decorator.',
  },
  NEST_GUARD_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'A direct NestJS guard declaration could not be resolved to a repository class.',
  },
  NEST_MODULE_METADATA_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'NestJS module metadata is dynamic or outside the supported static boundary.',
  },
  NEST_GLOBAL_GUARD_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'An APP_GUARD provider could not be resolved within the supported boundary.',
  },
  NEST_BOOTSTRAP_GUARD_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'Bootstrap global-guard registration could not be proven complete.',
  },
  DI_TOKEN_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'Injection uses a string, symbol, factory, or other unsupported token form.',
  },
  CALL_TARGET_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'A direct method target could not be resolved.',
  },
  CALL_DEPTH_LIMIT: {
    defaultSeverity: 'info',
    summary: 'A trace stopped at the configured maximum depth.',
  },
  AUTH_GLOBAL_POLICY_UNKNOWN: {
    defaultSeverity: 'info',
    summary: 'Static global guard analysis is incomplete.',
  },
  TYPEORM_ENTITY_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'A repository entity type could not be resolved.',
  },
  TYPEORM_OPERATION_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'A persistence call is outside the supported repository-method set.',
  },
  TYPEORM_SAVE_COLUMNS_UNKNOWN: {
    defaultSeverity: 'info',
    summary: 'A table write is known but exact columns are not.',
  },
  TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS: {
    defaultSeverity: 'warning',
    summary: 'A TypeORM QueryBuilder receiver or local builder state is ambiguous.',
  },
  TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'A TypeORM QueryBuilder flow crosses an unsupported static-analysis boundary.',
  },
  TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED: {
    defaultSeverity: 'warning',
    summary: 'A TypeORM QueryBuilder table target cannot be resolved statically.',
  },
  TYPEORM_QUERY_BUILDER_TERMINAL_MISSING: {
    defaultSeverity: 'info',
    summary: 'A proven TypeORM QueryBuilder has no supported execution terminal.',
  },
  TYPEORM_RAW_SQL_DIALECT_UNSELECTED: {
    defaultSeverity: 'warning',
    summary: 'A proven TypeORM raw-SQL call has no explicitly selected SQL dialect.',
  },
  TYPEORM_RAW_SQL_RECEIVER_AMBIGUOUS: {
    defaultSeverity: 'warning',
    summary: 'A raw-SQL receiver mixes TypeORM and unsupported receiver possibilities.',
  },
  TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'A TypeORM raw-SQL source is dynamic or outside the static-source boundary.',
  },
  TYPEORM_RAW_SQL_LIMIT_EXCEEDED: {
    defaultSeverity: 'warning',
    summary: 'A TypeORM raw-SQL input or parser result exceeded a configured safety limit.',
  },
  TYPEORM_RAW_SQL_PARSE_FAILED: {
    defaultSeverity: 'warning',
    summary: 'A static SQL source failed parsing in the explicitly selected dialect.',
  },
  TYPEORM_RAW_SQL_STATEMENT_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'A parsed SQL statement or AST shape is outside the supported visitor boundary.',
  },
  REQUEST_PROVENANCE_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'Request-to-column provenance crosses an unsupported intraprocedural boundary.',
  },
  REQUEST_PROVENANCE_LIMIT_EXCEEDED: {
    defaultSeverity: 'warning',
    summary: 'Request-to-column provenance exceeded a configured safety bound.',
  },
  REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'Inter-method request provenance crosses an unsupported call boundary.',
  },
  REQUEST_PROVENANCE_CALL_DEPTH_LIMIT: {
    defaultSeverity: 'warning',
    summary: 'Inter-method request provenance reached its configured call-depth limit.',
  },
  OUTBOUND_HTTP_TARGET_DYNAMIC: {
    defaultSeverity: 'warning',
    summary: 'A proven outbound HTTP call has a target outside the bounded static rules.',
  },
  OUTBOUND_HTTP_METHOD_DYNAMIC: {
    defaultSeverity: 'warning',
    summary: 'A proven outbound HTTP call has a dynamic or unsupported request method.',
  },
  OUTBOUND_HTTP_CONFIG_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'An outbound HTTP configuration crosses an unsupported object-flow boundary.',
  },
  OUTBOUND_HTTP_RECEIVER_UNSUPPORTED: {
    defaultSeverity: 'warning',
    summary: 'An Axios receiver is package-proven but was not created by a supported binding.',
  },
  OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED: {
    defaultSeverity: 'warning',
    summary: 'An outbound HTTP target exceeded a bounded template or URL limit.',
  },
  OUTBOUND_HTTP_ACTIVATION_UNKNOWN: {
    defaultSeverity: 'warning',
    summary: 'A cold outbound HTTP producer crosses an unsupported activation boundary.',
  },
  INTERACTION_RECEIVER_AMBIGUOUS: {
    defaultSeverity: 'warning',
    summary: 'An interaction receiver is package-proven but its injected binding is ambiguous.',
  },
  INTERACTION_TARGET_DYNAMIC: {
    defaultSeverity: 'warning',
    summary: 'An interaction target is outside the bounded static identity rules.',
  },
  INTERACTION_TRACE_LIMIT_REACHED: {
    defaultSeverity: 'warning',
    summary: 'Local interaction traversal reached a configured state, hop, or fan-out limit.',
  },
  INTERACTION_CYCLE_TRUNCATED: {
    defaultSeverity: 'info',
    summary: 'A cyclic local interaction path was terminated deterministically.',
  },
  EVENT_EMITTER_CONFIGURATION_UNKNOWN: {
    defaultSeverity: 'warning',
    summary: 'EventEmitter module configuration is dynamic or outside the exact-event boundary.',
  },
  EVENT_HANDLER_REGISTRATION_UNKNOWN: {
    defaultSeverity: 'warning',
    summary: 'An event handler declaration cannot be proven reachable from an application root.',
  },
  JOB_QUEUE_HANDLER_REGISTRATION_UNKNOWN: {
    defaultSeverity: 'warning',
    summary: 'A BullMQ processor is declared but its Nest module registration is not proven.',
  },
  JOB_QUEUE_FILTER_UNPROVEN: {
    defaultSeverity: 'info',
    summary:
      'A BullMQ worker inspects the job name, but bounded branch slicing is not enabled; effects remain queue-wide and conditional.',
  },
};

export function createDiagnostic(input: {
  code: DiagnosticCode;
  message?: string;
  severity?: DiagnosticSeverity;
  subjectId?: string;
  evidenceIds?: readonly string[];
}): DiagnosticRecord {
  const definition = DIAGNOSTIC_CATALOGUE[input.code];
  const evidenceIds = [...(input.evidenceIds ?? [])].sort();
  const base = {
    id: makeDiagnosticId({
      code: input.code,
      ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
      evidenceIds,
    }),
    code: input.code,
    severity: input.severity ?? definition.defaultSeverity,
    message: input.message ?? definition.summary,
    evidenceIds,
  } as const;

  return input.subjectId === undefined ? base : { ...base, subjectId: input.subjectId };
}
