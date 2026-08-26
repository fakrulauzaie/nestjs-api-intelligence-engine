import { describe, expect, it } from 'vitest';
import { deriveAnalysisResultState } from '../../../src/analysis/result-state.js';
import { createDiagnostic } from '../../../src/diagnostics/catalogue.js';

describe('analysis result-state policy', () => {
  it.each([
    ['clean facts', 1, [], {}, 'completed'],
    ['empty clean analysis', 0, [], {}, 'completed'],
    [
      'supported facts with a warning gap',
      1,
      [createDiagnostic({ code: 'NEST_GUARD_UNRESOLVED' })],
      {},
      'completed_with_gaps',
    ],
    [
      'supported facts with an error gap',
      1,
      [createDiagnostic({ code: 'TS_PARSE_ERROR' })],
      {},
      'completed_with_gaps',
    ],
    [
      'no trusted facts after an error',
      0,
      [createDiagnostic({ code: 'TS_PARSE_ERROR' })],
      {},
      'failed',
    ],
    ['integrity failure', 3, [], { fatal: true }, 'failed'],
    ['cancellation', 3, [], { canceled: true }, 'canceled'],
  ] as const)('maps %s distinctly', (_name, trustedFactCount, diagnostics, flags, expected) => {
    expect(deriveAnalysisResultState({ trustedFactCount, diagnostics, ...flags })).toBe(expected);
  });
});
