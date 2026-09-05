import { normalizeAnalysisDocument } from '../analysis/normalize-document.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { DiffInputSnapshot } from './model.js';

export const SUPPORTED_COMPARISON_ANALYSIS_SCHEMA_VERSIONS = [
  '1.0.0',
  '2.0.0',
  '3.0.0',
  '4.0.0',
  '5.0.0',
  '6.0.0',
  '7.0.0',
  '8.0.0',
] as const;

export interface NormalizedComparisonAnalysis {
  readonly analysis: AnalysisDocument;
  readonly input: DiffInputSnapshot;
}

/**
 * This is the only analysis-schema boundary used by comparison. Missing historical
 * fact families remain unavailable rather than becoming proven-empty collections.
 */
export function normalizeAnalysisForComparison(input: unknown): NormalizedComparisonAnalysis {
  const normalized = normalizeAnalysisDocument(input);
  const analysis = normalized.analysis;
  if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
    throw new ComparisonInputStateError(analysis.resultState);
  }

  return {
    analysis,
    input: {
      analysisId: analysis.analysisRun.id,
      analysisSchemaVersion: analysis.schemaVersion,
      resultState: analysis.resultState,
      configuration: {
        maxCallDepth: analysis.analysisRun.configuration.maxCallDepth,
        maxSourceFileBytes: analysis.analysisRun.configuration.maxSourceFileBytes,
        evidenceSnippetLimit: analysis.analysisRun.configuration.evidenceSnippetLimit,
      },
      facts: {
        directGuards: 'available',
        effectiveGuards: normalized.facts.v2Families,
        terminals: 'available',
        assertions: 'available',
        diagnostics: 'available',
        ...(normalized.facts.authorizationFamilies === 'available'
          ? { authorization: 'available' as const }
          : {}),
        ...(normalized.facts.resourceAccessFamilies === 'available'
          ? { resourceAccesses: 'available' as const }
          : {}),
      },
    },
  };
}

export class ComparisonInputStateError extends Error {
  constructor(state: AnalysisDocument['resultState']) {
    super(`Cannot compare an analysis in state ${state}.`);
    this.name = 'ComparisonInputStateError';
  }
}
