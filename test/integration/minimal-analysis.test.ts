import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateAnalysisDocument } from '../../src/evidence/validate.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { createMinimalAnalysisDocument } from '../helpers/minimal-analysis.js';

describe('minimal canonical analysis exit artifact', () => {
  it('is runtime-valid, integrity-valid, and byte-identical to canonical serialization', async () => {
    const artifactPath = resolve('test/fixtures/minimal-analysis.json');
    const artifactText = await readFile(artifactPath, 'utf8');
    const parsed: unknown = JSON.parse(artifactText);

    expect(validateAnalysisDocument(parsed).success).toBe(true);
    expect(artifactText).toBe(serializeCanonicalAnalysis(createMinimalAnalysisDocument()));
  });

  it('serializes identically after all populated arrays are reversed', () => {
    const analysis = createMinimalAnalysisDocument();
    const shuffled = {
      ...analysis,
      sourceFiles: analysis.sourceFiles.toReversed(),
      classes: analysis.classes.toReversed(),
      methods: analysis.methods.toReversed(),
      endpoints: analysis.endpoints.toReversed(),
      assertions: analysis.assertions
        .toReversed()
        .map((assertion) => ({ ...assertion, evidenceIds: assertion.evidenceIds.toReversed() })),
      evidence: analysis.evidence.toReversed(),
    };

    expect(serializeCanonicalAnalysis(shuffled)).toBe(serializeCanonicalAnalysis(analysis));
  });
});
