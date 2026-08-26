import { describe, expect, it } from 'vitest';
import { ANALYSIS_SCHEMA_VERSION, type RunDocument } from '../../../src/model/analysis.js';
import {
  canonicalStringify,
  canonicalizeAnalysisDocument,
  normalizeRunForComparison,
  serializeCanonicalAnalysis,
} from '../../../src/model/ordering.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';

describe('canonical ordering', () => {
  it('serializes identically when record and reference discovery order changes', () => {
    const original = createMinimalAnalysisDocument();
    const shuffled = {
      ...original,
      sourceFiles: original.sourceFiles.toReversed(),
      classes: original.classes.toReversed(),
      methods: original.methods.toReversed(),
      endpoints: original.endpoints.toReversed(),
      assertions: original.assertions
        .toReversed()
        .map((assertion) => ({ ...assertion, evidenceIds: assertion.evidenceIds.toReversed() })),
      evidence: original.evidence.toReversed(),
    };

    expect(serializeCanonicalAnalysis(shuffled)).toBe(serializeCanonicalAnalysis(original));
  });

  it('does not mutate extractor-owned arrays while canonicalizing', () => {
    const analysis = createMinimalAnalysisDocument();
    const evidenceOrder = analysis.evidence.map((record) => record.id);

    const canonical = canonicalizeAnalysisDocument(analysis);

    expect(analysis.evidence.map((record) => record.id)).toEqual(evidenceOrder);
    expect(canonical).not.toBe(analysis);
  });

  it('sorts object keys for stable JSON text', () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    );
  });

  it('removes volatile and machine-specific run fields for comparisons', () => {
    const analysis = createMinimalAnalysisDocument();
    const base: RunDocument = {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      analysisId: analysis.analysisRun.id,
      repositoryPath: 'C:\\first\\checkout',
      repositoryRevision: 'fixture-revision',
      startedAt: '2026-08-16T00:00:00Z',
      endedAt: '2026-08-16T00:00:01Z',
      durationMs: 1_000,
      resultState: 'completed',
      tool: analysis.analysisRun.tool,
      configuration: analysis.analysisRun.configuration,
      diagnostics: [],
    };
    const other: RunDocument = {
      ...base,
      repositoryPath: 'D:\\other\\checkout',
      startedAt: '2026-08-17T00:00:00Z',
      endedAt: '2026-08-17T00:00:09Z',
      durationMs: 9_000,
    };

    expect(canonicalStringify(normalizeRunForComparison(base))).toBe(
      canonicalStringify(normalizeRunForComparison(other)),
    );
  });
});
