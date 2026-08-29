import type { ControlEvidenceDocument, ControlEvidenceRow } from './model.js';
import {
  CONTROL_EVIDENCE_SCHEMA_V2_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V3_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V4_VERSION,
  CONTROL_EVIDENCE_SCHEMA_V5_VERSION,
} from './model.js';

export const CONTROL_EVIDENCE_CSV_HEADERS = [
  'analysis_id',
  'analysis_schema_version',
  'tool_name',
  'tool_version',
  'endpoint_id',
  'http_method',
  'path',
  'handler',
  'selection_status',
  'direct_guard_state',
  'global_guard_state',
  'effective_guard_state',
  'direct_guards',
  'global_guards',
  'mutation_classification',
  'db_reads',
  'db_writes',
  'request_column_influences',
  'diagnostic_codes',
  'incompleteness_codes',
  'policy_outcomes',
  'evidence_ids',
  'source_locations',
] as const;

export const CONTROL_EVIDENCE_CSV_HEADERS_V2 = [
  ...CONTROL_EVIDENCE_CSV_HEADERS.slice(0, 17),
  'outbound_interactions',
  'local_interactions',
  'local_causal_effects',
  ...CONTROL_EVIDENCE_CSV_HEADERS.slice(17),
] as const;

export const CONTROL_EVIDENCE_CSV_HEADERS_V3 = [
  ...CONTROL_EVIDENCE_CSV_HEADERS_V2.slice(0, 20),
  'distributed_interactions',
  'distributed_conditional_effects',
  ...CONTROL_EVIDENCE_CSV_HEADERS_V2.slice(20),
] as const;

export const CONTROL_EVIDENCE_CSV_HEADERS_V4 = [
  ...CONTROL_EVIDENCE_CSV_HEADERS_V3.slice(0, 22),
  'job_queue_branch_ids',
  ...CONTROL_EVIDENCE_CSV_HEADERS_V3.slice(22),
] as const;

export const CONTROL_EVIDENCE_CSV_HEADERS_V5 = [
  ...CONTROL_EVIDENCE_CSV_HEADERS_V4.slice(0, 23),
  'authorization_requirements',
  ...CONTROL_EVIDENCE_CSV_HEADERS_V4.slice(23),
] as const;

/** Prefix spreadsheet formula markers. The apostrophe is export syntax, not source text. */
export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

export function encodeCsvCell(value: string): string {
  const neutralized = neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/u.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

function join(values: readonly string[]): string {
  return values.join('; ');
}

function rowCells(row: ControlEvidenceRow, version: 1 | 2 | 3 | 4 | 5): string[] {
  const base = [
    row.analysisId,
    row.analysisSchemaVersion,
    row.toolName,
    row.toolVersion,
    row.endpointId,
    row.httpMethod,
    row.path,
    row.handler ?? '',
    row.selectionStatus,
    row.directGuardState,
    row.globalGuardState,
    row.effectiveGuardState,
    join(row.directGuards.map(({ scope, name, status }) => `${scope}:${name}:${status}`)),
    join(row.globalGuards.map(({ name, status }) => `${name}:${status}`)),
    row.mutationClassification,
    join(row.dbReads),
    join(row.dbWrites),
  ];
  const interactions =
    version >= 2
      ? [
          join(
            (row.outboundInteractions ?? []).map(
              ({ kind, target, activation, boundary }) =>
                `${kind}:${target} (${activation}; ${boundary})`,
            ),
          ),
          join(
            (row.localInteractions ?? []).map(
              ({ kind, target, dispatchTiming, handlerStates }) =>
                `${kind}:${target} (${dispatchTiming}; ${handlerStates.join('+') || 'none_proven'})`,
            ),
          ),
          join(
            (row.localCausalEffects ?? []).map(
              ({ direction, table, causalClass }) => `${direction} ${table} (${causalClass})`,
            ),
          ),
        ]
      : [];
  const distributed =
    version >= 3
      ? [
          join(
            (row.distributedInteractions ?? []).map(
              ({ kind, target, activation, boundary, handlerStates }) =>
                `${kind}:${target} (${activation}; ${boundary}; ${handlerStates.join('+') || 'none_proven'})`,
            ),
          ),
          join(
            (row.distributedConditionalEffects ?? []).map(
              ({ direction, table, causalClass }) => `${direction} ${table} (${causalClass})`,
            ),
          ),
        ]
      : [];
  return [
    ...base,
    ...interactions,
    ...distributed,
    ...(version >= 4 ? [join(row.jobQueueBranchIds ?? [])] : []),
    ...(version >= 5
      ? [
          join(
            (row.authorizationRequirements ?? []).map(
              ({ metadataKey, scope, enforcementState, guardName }) =>
                `${scope}:${metadataKey} (${enforcementState}${guardName === null ? '' : `; ${guardName}`})`,
            ),
          ),
        ]
      : []),
    join(
      row.requestColumnInfluences.map(
        ({ origin, column, state, sinkMethod, callDepth }) =>
          `${origin} -> ${column} (${state}; ${sinkMethod}; ${callDepth} hops)`,
      ),
    ),
    join(row.diagnosticCodes),
    join(row.incompletenessCodes),
    join(
      row.policyOutcomes.map(
        ({ ruleId, outcome, severity, reasonCode }) =>
          `${ruleId}:${outcome}:${severity}:${reasonCode}`,
      ),
    ),
    join(row.evidenceIds),
    join(row.sourceLocations),
  ];
}

export function renderControlEvidenceCsv(document: ControlEvidenceDocument): string {
  const version =
    document.schemaVersion === CONTROL_EVIDENCE_SCHEMA_V5_VERSION
      ? 5
      : document.schemaVersion === CONTROL_EVIDENCE_SCHEMA_V4_VERSION
        ? 4
        : document.schemaVersion === CONTROL_EVIDENCE_SCHEMA_V3_VERSION
          ? 3
          : document.schemaVersion === CONTROL_EVIDENCE_SCHEMA_V2_VERSION
            ? 2
            : 1;
  const headers =
    version === 5
      ? CONTROL_EVIDENCE_CSV_HEADERS_V5
      : version === 4
        ? CONTROL_EVIDENCE_CSV_HEADERS_V4
        : version === 3
          ? CONTROL_EVIDENCE_CSV_HEADERS_V3
          : version === 2
            ? CONTROL_EVIDENCE_CSV_HEADERS_V2
            : CONTROL_EVIDENCE_CSV_HEADERS;
  const lines = [
    headers.map(encodeCsvCell).join(','),
    ...document.rows.map((row) => rowCells(row, version).map(encodeCsvCell).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
