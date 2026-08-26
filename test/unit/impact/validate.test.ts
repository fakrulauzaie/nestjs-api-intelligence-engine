import { describe, expect, it } from 'vitest';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { validateImpactDocument } from '../../../src/impact/validate.js';
import { createImpactAnalysisSnapshot } from '../../helpers/impact-analysis.js';

describe('ImpactDocument validation', () => {
  it('accepts a generated document and rejects summary drift', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after'),
    );
    expect(validateImpactDocument(impact).success).toBe(true);

    const invalid = {
      ...impact,
      summary: { ...impact.summary, impactedEndpointSlots: 999 },
    };
    const result = validateImpactDocument(invalid);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.issues.some(({ code }) => code === 'SUMMARY_MISMATCH')).toBe(true);
  });

  it('rejects a discontinuous evidence path', () => {
    const impact = analyzePotentialImpact(
      createImpactAnalysisSnapshot('before'),
      createImpactAnalysisSnapshot('after'),
    );
    const endpoint = impact.impactedEndpoints[0]!;
    const reason = endpoint.reasons.find(({ paths }) =>
      paths.some(({ steps }) => steps.length > 1),
    )!;
    const targetPath = reason.paths.find(({ steps }) => steps.length > 1)!;
    const changedPath = {
      ...targetPath,
      steps: [
        targetPath.steps[0]!,
        { ...targetPath.steps[1]!, fromId: endpoint.beforeEndpointIds[0]! },
      ],
    };
    const invalid = {
      ...impact,
      impactedEndpoints: impact.impactedEndpoints.map((candidate) =>
        candidate !== endpoint
          ? candidate
          : {
              ...candidate,
              reasons: candidate.reasons.map((candidateReason) =>
                candidateReason !== reason
                  ? candidateReason
                  : {
                      ...candidateReason,
                      paths: candidateReason.paths.map((path) =>
                        path === targetPath ? changedPath : path,
                      ),
                    },
              ),
            },
      ),
    };

    const result = validateImpactDocument(invalid);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.issues.some(({ code }) => code === 'PATH_INVALID')).toBe(true);
  });
});
