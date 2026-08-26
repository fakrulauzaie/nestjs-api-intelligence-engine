import { describe, expect, it } from 'vitest';
import { rawSqlConfigurationForDialect } from '../../../src/config/analysis-config.js';
import { createDiagnostic } from '../../../src/diagnostics/catalogue.js';
import {
  ANALYSIS_SCHEMA_VERSION,
  type EndpointTraceView,
  type RunDocument,
} from '../../../src/model/analysis.js';
import { createStableId } from '../../../src/model/ids.js';
import {
  analysisDocumentSchema,
  endpointTraceViewSchema,
  runDocumentSchema,
} from '../../../src/model/schemas.js';
import {
  createMinimalAnalysisDocument,
  createMinimalAnalysisDocumentV2,
  createMinimalAnalysisDocumentV3,
} from '../../helpers/minimal-analysis.js';

describe('canonical runtime schemas', () => {
  it('accepts a valid minimal analysis document', () => {
    expect(analysisDocumentSchema.safeParse(createMinimalAnalysisDocument()).success).toBe(true);
  });

  it('keeps v1/v2 strict while accepting the explicit v3 interaction envelope', () => {
    const v1 = createMinimalAnalysisDocument();
    const v2 = createMinimalAnalysisDocumentV2();
    const v3 = createMinimalAnalysisDocumentV3();

    expect(analysisDocumentSchema.safeParse(v2).success).toBe(true);
    expect(analysisDocumentSchema.safeParse(v3).success).toBe(true);
    expect(
      analysisDocumentSchema.safeParse({ ...v1, modules: [] }).success,
      'v1 must reject v2-only fields',
    ).toBe(false);
    expect(
      analysisDocumentSchema.safeParse({ ...v1, contractTypes: [] }).success,
      'v1 must reject Phase 19 contract fields',
    ).toBe(false);
    const missingPhase19Family: Record<string, unknown> = { ...v2 };
    delete missingPhase19Family.entityColumns;
    expect(
      analysisDocumentSchema.safeParse(missingPhase19Family).success,
      'v2 must carry every Phase 19 record family',
    ).toBe(false);
    const missingPhase20Family: Record<string, unknown> = { ...v2 };
    delete missingPhase20Family.columnInfluences;
    expect(
      analysisDocumentSchema.safeParse(missingPhase20Family).success,
      'v2 must carry every Phase 20 provenance family',
    ).toBe(false);
    expect(
      analysisDocumentSchema.safeParse({ ...v2, interactions: [] }).success,
      'v2 must reject v3-only fields',
    ).toBe(false);
    expect(
      analysisDocumentSchema.safeParse({
        ...v2,
        diagnostics: [createDiagnostic({ code: 'OUTBOUND_HTTP_TARGET_DYNAMIC' })],
      }).success,
      'v2 must reject v3-only diagnostic codes',
    ).toBe(false);
    const missingInteractionFamily: Record<string, unknown> = { ...v3 };
    delete missingInteractionFamily.interactionHandlers;
    expect(
      analysisDocumentSchema.safeParse(missingInteractionFamily).success,
      'v3 must carry every Phase 30 record family',
    ).toBe(false);
    expect(
      analysisDocumentSchema.safeParse({ ...v3, schemaVersion: '4.0.0' }).success,
      'unknown schema versions must fail closed',
    ).toBe(false);
  });

  it('keeps QueryBuilder literal table provenance v2-only', () => {
    const v1 = createMinimalAnalysisDocument();
    const literalTable = {
      id: createStableId('table', ['literal-provenance']),
      name: 'literal_table',
      nameSource: 'query_builder_literal' as const,
    };
    expect(analysisDocumentSchema.safeParse({ ...v1, tables: [literalTable] }).success).toBe(false);
    expect(
      analysisDocumentSchema.safeParse({
        ...v1,
        schemaVersion: '2.0.0',
        tables: [literalTable],
        modules: [],
        globalGuardRegistrations: [],
        contractTypes: [],
        contractFields: [],
        requestParameters: [],
        responseContracts: [],
        entityColumns: [],
        requestFieldOrigins: [],
        columnInfluences: [],
        globalGuardAnalysis: { completeness: 'complete', state: 'none_proven' },
      }).success,
    ).toBe(true);
  });

  it('keeps raw-SQL provenance and configuration v2-only', () => {
    const v1 = createMinimalAnalysisDocument();
    const rawSql = rawSqlConfigurationForDialect('postgresql-18');
    const rawTable = {
      id: createStableId('table', ['raw-sql-provenance']),
      name: 'public.note',
      nameSource: 'raw_sql_literal' as const,
    };
    expect(analysisDocumentSchema.safeParse({ ...v1, tables: [rawTable] }).success).toBe(false);
    expect(
      analysisDocumentSchema.safeParse({
        ...v1,
        analysisRun: {
          ...v1.analysisRun,
          configuration: { ...v1.analysisRun.configuration, rawSql },
        },
      }).success,
      'v1 configuration must reject the v2-only raw-SQL envelope',
    ).toBe(false);
    expect(
      analysisDocumentSchema.safeParse({
        ...v1,
        schemaVersion: '2.0.0',
        analysisRun: {
          ...v1.analysisRun,
          configuration: { ...v1.analysisRun.configuration, rawSql },
        },
        tables: [rawTable],
        modules: [],
        globalGuardRegistrations: [],
        contractTypes: [],
        contractFields: [],
        requestParameters: [],
        responseContracts: [],
        entityColumns: [],
        requestFieldOrigins: [],
        columnInfluences: [],
        globalGuardAnalysis: { completeness: 'complete', state: 'none_proven' },
      }).success,
    ).toBe(true);
  });

  it('rejects absolute canonical paths and volatile analysis fields', () => {
    const minimal = createMinimalAnalysisDocument();
    const absolutePath = {
      ...minimal,
      analysisRun: {
        ...minimal.analysisRun,
        tsconfigPath: 'C:/work/reference-app/tsconfig.json',
      },
    };

    expect(analysisDocumentSchema.safeParse(absolutePath).success).toBe(false);

    const volatile = { ...createMinimalAnalysisDocument(), startedAt: '2026-08-16T00:00:00Z' };
    expect(analysisDocumentSchema.safeParse(volatile).success).toBe(false);
  });

  it('accepts volatile and absolute metadata in run.json', () => {
    const minimal = createMinimalAnalysisDocument();
    const run: RunDocument = {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      analysisId: minimal.analysisRun.id,
      repositoryPath: 'C:\\work\\reference-app',
      repositoryRevision: 'fixture-revision',
      startedAt: '2026-08-16T01:00:00+08:00',
      endedAt: '2026-08-16T01:00:01+08:00',
      durationMs: 1_000,
      resultState: 'completed',
      tool: minimal.analysisRun.tool,
      configuration: minimal.analysisRun.configuration,
      diagnostics: [],
    };

    expect(runDocumentSchema.safeParse(run).success).toBe(true);
  });

  it('accepts the endpoint trace view contract', () => {
    const minimal = createMinimalAnalysisDocument();
    const endpoint = minimal.endpoints[0]!;
    const assertion = minimal.assertions[0]!;
    const trace: EndpointTraceView = {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      analysisId: minimal.analysisRun.id,
      endpoint,
      directGuardState: 'none_declared',
      globalGuardState: 'unknown',
      effectiveGuardState: 'unknown',
      guards: [],
      steps: [
        {
          fromId: assertion.subjectId,
          relation: assertion.predicate,
          toId: assertion.objectId,
          status: assertion.status,
          ruleId: assertion.ruleId,
          evidenceIds: assertion.evidenceIds,
        },
      ],
      terminals: [],
      diagnosticIds: [],
    };

    expect(endpointTraceViewSchema.safeParse(trace).success).toBe(true);

    const missingTarget = {
      ...trace,
      steps: [{ ...trace.steps[0], status: 'resolved', toId: null }],
      analysisId: createStableId('analysis', ['other']),
    };
    // Cross-record target requirements are integrity rules, not shape rules.
    expect(endpointTraceViewSchema.safeParse(missingTarget).success).toBe(true);
  });
});
