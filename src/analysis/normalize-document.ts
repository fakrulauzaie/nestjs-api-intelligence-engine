import { assertValidAnalysisDocument } from '../evidence/validate.js';
import type {
  AnalysisDocument,
  AnalysisDocumentV2,
  AnalysisDocumentV3,
  AnalysisDocumentV4,
  AnalysisDocumentV5,
  AnalysisDocumentV6,
  AnalysisDocumentV7,
  InteractionAnalysisDocument,
} from '../model/analysis.js';
import { analysisHasInteractionFacts } from '../model/analysis.js';

export type CanonicalFactAvailability = 'available' | 'unavailable';

export interface NormalizedAnalysisDocument {
  readonly analysis: AnalysisDocument;
  readonly facts: {
    readonly v2Families: CanonicalFactAvailability;
    readonly interactionFamilies: CanonicalFactAvailability;
    readonly jobQueueBranchFamilies: CanonicalFactAvailability;
    readonly authorizationFamilies: CanonicalFactAvailability;
    readonly resourceAccessFamilies: CanonicalFactAvailability;
    readonly criticalSectionFamilies: CanonicalFactAvailability;
  };
  readonly v2:
    | AnalysisDocumentV2
    | AnalysisDocumentV3
    | AnalysisDocumentV4
    | AnalysisDocumentV5
    | AnalysisDocumentV6
    | AnalysisDocumentV7
    | null;
  readonly v3: AnalysisDocumentV3 | null;
  readonly v4: AnalysisDocumentV4 | null;
  readonly v5: AnalysisDocumentV5 | null;
  readonly v6: AnalysisDocumentV6 | null;
  readonly v7: AnalysisDocumentV7 | null;
  readonly interactions: InteractionAnalysisDocument | null;
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
      interactionFamilies: analysisHasInteractionFacts(analysis) ? 'available' : 'unavailable',
      jobQueueBranchFamilies:
        analysis.schemaVersion === '4.0.0' ||
        analysis.schemaVersion === '5.0.0' ||
        analysis.schemaVersion === '6.0.0' ||
        analysis.schemaVersion === '7.0.0'
          ? 'available'
          : 'unavailable',
      authorizationFamilies:
        analysis.schemaVersion === '5.0.0' ||
        analysis.schemaVersion === '6.0.0' ||
        analysis.schemaVersion === '7.0.0'
          ? 'available'
          : 'unavailable',
      resourceAccessFamilies:
        analysis.schemaVersion === '6.0.0' || analysis.schemaVersion === '7.0.0'
          ? 'available'
          : 'unavailable',
      criticalSectionFamilies: analysis.schemaVersion === '7.0.0' ? 'available' : 'unavailable',
    },
    v2: analysis.schemaVersion === '1.0.0' ? null : analysis,
    v3: analysis.schemaVersion === '3.0.0' ? analysis : null,
    v4: analysis.schemaVersion === '4.0.0' ? analysis : null,
    v5: analysis.schemaVersion === '5.0.0' ? analysis : null,
    v6: analysis.schemaVersion === '6.0.0' ? analysis : null,
    v7: analysis.schemaVersion === '7.0.0' ? analysis : null,
    interactions: analysisHasInteractionFacts(analysis) ? analysis : null,
  };
}
