import { describe, expect, it } from 'vitest';
import { buildModuleVisibility } from '../../../src/modules/visibility.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

describe('module visibility compatibility', () => {
  it('keeps module facts unavailable for a valid v1 analysis', () => {
    expect(buildModuleVisibility(createMinimalAnalysisDocument())).toEqual({
      availability: 'unavailable',
      modules: [],
    });
  });
});
