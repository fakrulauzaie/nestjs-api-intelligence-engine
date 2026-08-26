import { describe, expect, it } from 'vitest';
import { createDiagnostic } from '../../../src/diagnostics/catalogue.js';
import type { AnalysisDocument } from '../../../src/model/analysis.js';
import type { AssertionPredicate, AssertionRecord } from '../../../src/model/assertions.js';
import type { MethodRecord, TableRecord } from '../../../src/model/entities.js';
import { createStableId, makeAssertionId, makeTableId } from '../../../src/model/ids.js';
import { serializeCanonicalEndpointTrace } from '../../../src/model/ordering.js';
import { endpointTraceViewSchema } from '../../../src/model/schemas.js';
import { buildTraceAssertionIndexes } from '../../../src/tracing/assertion-indexes.js';
import { buildEndpointTrace, selectEndpoint } from '../../../src/tracing/endpoint-trace.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

function method(base: AnalysisDocument, name: string): MethodRecord {
  return {
    id: createStableId('method', [name]),
    classId: base.classes[0]!.id,
    qualifiedName: `Graph.${name}`,
    displayName: name,
    signature: `${name}(): void`,
    declarationEvidenceId: base.methods[0]!.declarationEvidenceId,
  };
}

function table(name: string): TableRecord {
  return { id: makeTableId(name), name, nameSource: 'explicit' };
}

function assertion(
  base: AnalysisDocument,
  subjectId: string,
  predicate: AssertionPredicate,
  objectId: string | null,
  ruleId: string,
  status: AssertionRecord['status'] = 'resolved',
): AssertionRecord {
  return {
    id: makeAssertionId({ subjectId, predicate, objectId, ruleId }),
    subjectId,
    predicate,
    objectId,
    status,
    ruleId,
    evidenceIds: [base.evidence[0]!.id],
  };
}

describe('canonical endpoint trace assembly', () => {
  it('indexes typed trace assertions and retains branches, cycles, statuses, and terminals', () => {
    const base = createMinimalAnalysisDocument();
    const handler = base.methods[0]!;
    const left = method(base, 'left');
    const right = method(base, 'right');
    const shared = method(base, 'shared');
    const alpha = table('alpha');
    const beta = table('beta');
    const graphAssertions = [
      ...base.assertions,
      assertion(base, handler.id, 'METHOD_CALLS_METHOD', left.id, 'call.left'),
      assertion(base, handler.id, 'METHOD_CALLS_METHOD', right.id, 'call.right', 'ambiguous'),
      assertion(base, left.id, 'METHOD_CALLS_METHOD', shared.id, 'call.left-shared'),
      assertion(base, right.id, 'METHOD_CALLS_METHOD', shared.id, 'call.right-shared'),
      assertion(base, shared.id, 'METHOD_CALLS_METHOD', handler.id, 'call.cycle'),
      assertion(base, left.id, 'METHOD_READS_TABLE', alpha.id, 'typeorm.repository.find.v1'),
      assertion(base, left.id, 'METHOD_READS_TABLE', alpha.id, 'typeorm.repository.count.v1'),
      assertion(base, right.id, 'METHOD_WRITES_TABLE', beta.id, 'typeorm.repository.update.v1'),
      assertion(base, shared.id, 'METHOD_READS_TABLE', beta.id, 'typeorm.repository.exists.v1'),
    ];
    const reachedDiagnostic = createDiagnostic({
      code: 'CALL_TARGET_UNRESOLVED',
      subjectId: left.id,
      evidenceIds: [base.evidence[0]!.id],
    });
    const unrelatedDiagnostic = createDiagnostic({
      code: 'TYPEORM_OPERATION_UNSUPPORTED',
      subjectId: createStableId('method', ['unreached']),
      evidenceIds: [base.evidence[0]!.id],
    });
    const analysis: AnalysisDocument = {
      ...base,
      methods: [...base.methods, left, right, shared],
      tables: [beta, alpha],
      assertions: graphAssertions,
      diagnostics: [unrelatedDiagnostic, reachedDiagnostic],
    };

    const indexes = buildTraceAssertionIndexes(graphAssertions);
    expect(indexes.implementationsByEndpoint.get(base.endpoints[0]!.id)).toHaveLength(1);
    expect(indexes.callsByMethod.get(handler.id)).toHaveLength(2);
    expect(indexes.tableAccessByMethod.get(left.id)).toHaveLength(2);

    const result = buildEndpointTrace(analysis, { httpMethod: 'GET', path: '//health/' });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;

    expect(endpointTraceViewSchema.safeParse(result.trace).success).toBe(true);
    expect(result.trace.steps).toHaveLength(graphAssertions.length);
    expect(result.trace.steps.find((step) => step.ruleId === 'call.right')).toMatchObject({
      status: 'ambiguous',
    });
    expect(
      result.trace.terminals
        .map((terminal) => ({
          method: terminal.methodId,
          direction: terminal.direction,
          table: terminal.tableName,
        }))
        .sort((a, b) => `${a.method}:${a.direction}`.localeCompare(`${b.method}:${b.direction}`)),
    ).toEqual(
      [
        { method: left.id, direction: 'READ', table: 'alpha' },
        { method: right.id, direction: 'WRITE', table: 'beta' },
        { method: shared.id, direction: 'READ', table: 'beta' },
      ].sort((a, b) => `${a.method}:${a.direction}`.localeCompare(`${b.method}:${b.direction}`)),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([reachedDiagnostic.id]);
    expect(result.trace.diagnosticIds).toEqual([reachedDiagnostic.id]);

    const reversed = buildEndpointTrace(
      {
        ...analysis,
        assertions: [...analysis.assertions].reverse(),
        tables: [...analysis.tables].reverse(),
        diagnostics: [...analysis.diagnostics].reverse(),
      },
      { httpMethod: 'GET', path: '/health' },
    );
    expect(reversed.status).toBe('resolved');
    if (reversed.status === 'resolved') {
      expect(serializeCanonicalEndpointTrace(reversed.trace)).toBe(
        serializeCanonicalEndpointTrace(result.trace),
      );
    }
  });

  it('includes table access at depth three and reports only the undiscovered continuation', () => {
    const base = createMinimalAnalysisDocument();
    const one = method(base, 'depth-one');
    const two = method(base, 'depth-two');
    const three = method(base, 'depth-three');
    const four = method(base, 'depth-four');
    const reachedTable = table('reached');
    const beyondTable = table('beyond');
    const calls = [
      assertion(base, base.methods[0]!.id, 'METHOD_CALLS_METHOD', one.id, 'call.depth-one'),
      assertion(base, one.id, 'METHOD_CALLS_METHOD', two.id, 'call.depth-two'),
      assertion(base, two.id, 'METHOD_CALLS_METHOD', three.id, 'call.depth-three'),
      assertion(base, three.id, 'METHOD_CALLS_METHOD', four.id, 'call.depth-four'),
    ];
    const accesses = [
      assertion(
        base,
        three.id,
        'METHOD_READS_TABLE',
        reachedTable.id,
        'typeorm.repository.find.v1',
      ),
      assertion(base, four.id, 'METHOD_READS_TABLE', beyondTable.id, 'typeorm.repository.find.v1'),
    ];
    const analysis: AnalysisDocument = {
      ...base,
      methods: [...base.methods, one, two, three, four],
      tables: [reachedTable, beyondTable],
      assertions: [...base.assertions, ...calls, ...accesses],
    };

    const result = buildEndpointTrace(analysis, { httpMethod: 'GET', path: '/health' });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;

    expect(result.trace.steps.some((step) => step.ruleId === 'call.depth-four')).toBe(false);
    expect(result.trace.terminals.map((terminal) => terminal.tableName)).toEqual(['reached']);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'CALL_DEPTH_LIMIT',
      subjectId: three.id,
      evidenceIds: calls[3]!.evidenceIds,
    });
  });

  it('distinguishes normalized selection misses, ambiguity, and failed analyses', () => {
    const base = createMinimalAnalysisDocument();
    expect(selectEndpoint(base, { httpMethod: 'GET', path: '//health/' })).toMatchObject({
      status: 'resolved',
      selector: { path: '/health' },
    });
    expect(buildEndpointTrace(base, { httpMethod: 'POST', path: '/missing' })).toEqual({
      status: 'not_found',
      selector: { httpMethod: 'POST', path: '/missing' },
    });

    const duplicateEndpoint = {
      ...base.endpoints[0]!,
      id: createStableId('endpoint', ['duplicate-health']),
    };
    const ambiguous = buildEndpointTrace(
      { ...base, endpoints: [...base.endpoints, duplicateEndpoint] },
      { httpMethod: 'GET', path: '/health' },
    );
    expect(ambiguous.status).toBe('ambiguous');
    if (ambiguous.status === 'ambiguous') expect(ambiguous.candidates).toHaveLength(2);

    expect(
      buildEndpointTrace(
        { ...base, resultState: 'failed' },
        { httpMethod: 'GET', path: '/health' },
      ),
    ).toEqual({ status: 'analysis_failure', resultState: 'failed' });
  });
});
