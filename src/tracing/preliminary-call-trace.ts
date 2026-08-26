import { createDiagnostic } from '../diagnostics/catalogue.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';

export interface PreliminaryCallTrace {
  readonly startMethodId: string;
  readonly methodIds: readonly string[];
  readonly steps: readonly AssertionRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

export function traceDirectMethodCalls(
  analysis: AnalysisDocument,
  startMethodId: string,
  maximumDepth: number = analysis.analysisRun.configuration.maxCallDepth,
): PreliminaryCallTrace {
  if (!Number.isInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 3) {
    throw new RangeError('Maximum direct-call trace depth must be an integer from 1 to 3.');
  }

  const outgoing = new Map<string, AssertionRecord[]>();
  for (const assertion of analysis.assertions) {
    if (
      assertion.predicate !== 'METHOD_CALLS_METHOD' ||
      assertion.objectId === null ||
      (assertion.status !== 'resolved' && assertion.status !== 'ambiguous')
    ) {
      continue;
    }
    const current = outgoing.get(assertion.subjectId) ?? [];
    current.push(assertion);
    outgoing.set(assertion.subjectId, current);
  }
  for (const edges of outgoing.values())
    edges.sort((left, right) => left.id.localeCompare(right.id));

  const minimumDepthByMethod = new Map([[startMethodId, 0]]);
  const stepById = new Map<string, AssertionRecord>();
  const depthLimitedMethods = new Set<string>();
  const queue: { methodId: string; depth: number }[] = [{ methodId: startMethodId, depth: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { methodId, depth } = queue[cursor]!;
    const edges = outgoing.get(methodId) ?? [];
    if (depth >= maximumDepth) {
      if (edges.length > 0) depthLimitedMethods.add(methodId);
      continue;
    }

    for (const edge of edges) {
      stepById.set(edge.id, edge);
      const targetId = edge.objectId;
      if (targetId === null || minimumDepthByMethod.has(targetId)) continue;
      const targetDepth = depth + 1;
      minimumDepthByMethod.set(targetId, targetDepth);
      queue.push({ methodId: targetId, depth: targetDepth });
    }
  }

  const diagnostics: DiagnosticRecord[] = [];
  for (const methodId of depthLimitedMethods) {
    const edges = outgoing.get(methodId) ?? [];
    const undiscoveredEdges = edges.filter(
      (edge) => edge.objectId === null || !minimumDepthByMethod.has(edge.objectId),
    );
    if (undiscoveredEdges.length === 0) continue;
    diagnostics.push(
      createDiagnostic({
        code: 'CALL_DEPTH_LIMIT',
        subjectId: methodId,
        message: `Direct-call traversal stopped at configured depth ${maximumDepth}.`,
        evidenceIds: [...new Set(undiscoveredEdges.flatMap((edge) => edge.evidenceIds))],
      }),
    );
  }

  return {
    startMethodId,
    methodIds: [...minimumDepthByMethod.keys()].sort(),
    steps: [...stepById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics: diagnostics.sort((left, right) => left.id.localeCompare(right.id)),
  };
}
