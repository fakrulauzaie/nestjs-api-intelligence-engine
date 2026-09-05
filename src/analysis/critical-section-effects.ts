import type { AssertionRecord } from '../model/assertions.js';
import type { CriticalSectionRecord } from '../model/critical-sections.js';
import type { EvidenceRecord } from '../model/evidence.js';

const SCOPED_EFFECT_PREDICATES = new Set<AssertionRecord['predicate']>([
  'METHOD_CALLS_METHOD',
  'METHOD_READS_TABLE',
  'METHOD_WRITES_TABLE',
  'METHOD_ACCESSES_RESOURCE',
  'METHOD_INITIATES_INTERACTION',
]);

function position(line: number, column: number): readonly [number, number] {
  return [line, column];
}

function compare(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

function contained(inner: EvidenceRecord, outer: EvidenceRecord): boolean {
  return (
    inner.fileId === outer.fileId &&
    compare(
      position(inner.startLine, inner.startColumn),
      position(outer.startLine, outer.startColumn),
    ) >= 0 &&
    compare(position(inner.endLine, inner.endColumn), position(outer.endLine, outer.endColumn)) <= 0
  );
}

/** Projects exact callback-contained assertions without changing their canonical identity. */
export function projectCriticalSectionEffects(input: {
  readonly criticalSections: readonly CriticalSectionRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
}): readonly CriticalSectionRecord[] {
  const evidenceById = new Map(input.evidence.map((record) => [record.id, record]));
  return input.criticalSections.map((section) => {
    const callback = evidenceById.get(section.callbackEvidenceId);
    if (callback === undefined) return section;
    const effectAssertionIds = input.assertions
      .filter(
        (assertion) =>
          assertion.subjectId === section.sourceMethodId &&
          SCOPED_EFFECT_PREDICATES.has(assertion.predicate) &&
          assertion.evidenceIds.some((evidenceId) => {
            const candidate = evidenceById.get(evidenceId);
            return candidate?.role === 'call_site' && contained(candidate, callback);
          }),
      )
      .map(({ id }) => id)
      .sort();
    return { ...section, effectAssertionIds };
  });
}
