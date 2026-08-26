import { describe, expect, it } from 'vitest';
import { createDiagnostic, DIAGNOSTIC_CATALOGUE } from '../../../src/diagnostics/catalogue.js';
import { DIAGNOSTIC_CODES } from '../../../src/model/diagnostics.js';

describe('diagnostic catalogue', () => {
  it('defines every initial project diagnostic exactly once', () => {
    expect(Object.keys(DIAGNOSTIC_CATALOGUE).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
  });

  it('provides a severity and human-readable summary for every code', () => {
    for (const definition of Object.values(DIAGNOSTIC_CATALOGUE)) {
      expect(['info', 'warning', 'error']).toContain(definition.defaultSeverity);
      expect(definition.summary.length).toBeGreaterThan(10);
    }
  });

  it('creates deterministic diagnostics with canonical evidence ordering', () => {
    const evidenceIds = [`evidence:${'2'.repeat(32)}`, `evidence:${'1'.repeat(32)}`];
    const first = createDiagnostic({
      code: 'CALL_TARGET_UNRESOLVED',
      subjectId: `method:${'a'.repeat(32)}`,
      evidenceIds,
    });
    const second = createDiagnostic({
      code: 'CALL_TARGET_UNRESOLVED',
      subjectId: `method:${'a'.repeat(32)}`,
      evidenceIds: evidenceIds.toReversed(),
    });

    expect(first).toEqual(second);
    expect(first.message).toBe(DIAGNOSTIC_CATALOGUE.CALL_TARGET_UNRESOLVED.summary);
  });
});
