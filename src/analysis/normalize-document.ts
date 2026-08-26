import { assertValidAnalysisDocument } from '../evidence/validate.js';
import type {
  AnalysisDocument,
  AnalysisDocumentV2,
  AnalysisDocumentV3,
} from '../model/analysis.js';

export type CanonicalFactAvailability = 'available' | 'unavailable';

export interface NormalizedAnalysisDocument {
  readonly analysis: AnalysisDocument;
  readonly facts: {
    readonly v2Families: CanonicalFactAvailability;
    readonly interactionFamilies: CanonicalFactAvailability;
  };
  readonly v2: AnalysisDocumentV2 | AnalysisDocumentV3 | null;
  readonly v3: AnalysisDocumentV3 | null;
}

/**
 * Pure version boundary for canonical consumers. Missing families remain explicitly
 * unavailable and are never normalized into a proven empty result.
 */
export function normalizeAnalysisDocument(input: unknown): NormalizedAnalysisDocument {
  const analysis = assertValidAnalysisDocument(input);
  return {
    analysis,
    facts: {
      v2Families: analysis.schemaVersion === '1.0.0' ? 'unavailable' : 'available',
      interactionFamilies: analysis.schemaVersion === '3.0.0' ? 'available' : 'unavailable',
    },
    v2: analysis.schemaVersion === '1.0.0' ? null : analysis,
    v3: analysis.schemaVersion === '3.0.0' ? analysis : null,
  };
}
