import { describe, expect, it } from 'vitest';
import type { AssertionRecord } from '../../../src/model/assertions.js';
import { createStableId, makeAssertionId } from '../../../src/model/ids.js';
import { traceDirectMethodCalls } from '../../../src/tracing/preliminary-call-trace.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

const ruleId = 'nest.call.injected-member.v1';

function methodId(name: string): string {
  return createStableId('method', [name]);
}

function call(from: string, to: string): AssertionRecord {
  return {
    id: makeAssertionId({
      subjectId: from,
      predicate: 'METHOD_CALLS_METHOD',
      objectId: to,
      ruleId,
    }),
    subjectId: from,
    predicate: 'METHOD_CALLS_METHOD',
    objectId: to,
    status: 'resolved',
    ruleId,
    evidenceIds: [createStableId('evidence', [from, to])],
  };
}

describe('preliminary direct-call tracing', () => {
  it('caps traversal at depth three and reports a supported continuation', () => {
    const ids = ['start', 'one', 'two', 'three', 'four'].map(methodId);
    const edges = [
      call(ids[0]!, ids[1]!),
      call(ids[1]!, ids[2]!),
      call(ids[2]!, ids[3]!),
      call(ids[3]!, ids[4]!),
    ];
    const analysis = { ...createMinimalAnalysisDocument(), assertions: edges };

    const trace = traceDirectMethodCalls(analysis, ids[0]!, 3);

    expect(trace.steps.map((step) => step.id).sort()).toEqual(
      edges
        .slice(0, 3)
        .map((edge) => edge.id)
        .sort(),
    );
    expect(trace.methodIds).toEqual(ids.slice(0, 4).sort());
    expect(trace.diagnostics).toHaveLength(1);
    expect(trace.diagnostics[0]).toMatchObject({
      code: 'CALL_DEPTH_LIMIT',
      severity: 'info',
      subjectId: ids[3],
    });
    expect(trace.diagnostics[0]?.evidenceIds).toEqual(edges[3]?.evidenceIds);
  });

  it('retains the discovered cycle edge and terminates', () => {
    const start = methodId('cycle-start');
    const target = methodId('cycle-target');
    const edges = [call(start, target), call(target, start)];
    const analysis = { ...createMinimalAnalysisDocument(), assertions: edges };

    const trace = traceDirectMethodCalls(analysis, start, 3);

    expect(trace.steps.map((step) => step.id).sort()).toEqual(edges.map((edge) => edge.id).sort());
    expect(trace.methodIds).toEqual([start, target].sort());
    expect(trace.diagnostics).toEqual([]);
  });

  it('explores a shared target at its shortest discovered depth', () => {
    const start = methodId('shared-start');
    const one = methodId('shared-one');
    const two = methodId('shared-two');
    const shared = methodId('shared-target');
    const terminal = methodId('shared-terminal');
    const edges = [
      call(start, one),
      call(one, two),
      call(two, shared),
      call(start, shared),
      call(shared, terminal),
    ];
    const analysis = { ...createMinimalAnalysisDocument(), assertions: edges };

    const trace = traceDirectMethodCalls(analysis, start, 3);

    expect(trace.steps.map((step) => step.id).sort()).toEqual(edges.map((edge) => edge.id).sort());
    expect(trace.methodIds).toEqual([start, one, two, shared, terminal].sort());
    expect(trace.diagnostics).toEqual([]);
  });

  it('rejects depth values outside the supported range', () => {
    const analysis = createMinimalAnalysisDocument();
    expect(() => traceDirectMethodCalls(analysis, analysis.methods[0]!.id, 0)).toThrow(RangeError);
    expect(() => traceDirectMethodCalls(analysis, analysis.methods[0]!.id, 4)).toThrow(RangeError);
  });
});
