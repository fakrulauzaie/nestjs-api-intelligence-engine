import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { renderDiffMarkdown } from '../../../src/comparison/markdown.js';
import { DIFF_SCHEMA_VERSION } from '../../../src/comparison/model.js';
import {
  DiffIntegrityError,
  assertValidDiffDocument,
  validateDiffDocument,
} from '../../../src/comparison/validate.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';

describe('DiffDocument validation', () => {
  const createDiff = () =>
    compareAnalysisDocuments(
      createComparisonAnalysisSnapshot('before'),
      createComparisonAnalysisSnapshot('after'),
    );

  it('uses an independent strict schema and renders only validated data', () => {
    const diff = createDiff();

    expect(diff.schemaVersion).toBe(DIFF_SCHEMA_VERSION);
    expect(assertValidDiffDocument(diff)).toEqual(diff);
    expect(renderDiffMarkdown(diff)).toContain('# API Intelligence Diff');
    expect(renderDiffMarkdown(diff)).toContain('Endpoints modified | 2');
    expect(validateDiffDocument({ ...diff, unknown: true }).success).toBe(false);
  });

  it('rejects noncanonical keys, inconsistent summaries, and invalid change shapes', () => {
    const diff = createDiff();
    const invalidKey = {
      ...diff,
      endpointChanges: [
        {
          ...diff.endpointChanges[0]!,
          routeSlotKey: { ...diff.endpointChanges[0]!.routeSlotKey, encoded: '["wrong"]' },
        },
        ...diff.endpointChanges.slice(1),
      ],
    };
    expect(validateDiffDocument(invalidKey)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA_INVALID' })]),
    });

    expect(
      validateDiffDocument({
        ...diff,
        summary: { ...diff.summary, endpointsAdded: diff.summary.endpointsAdded + 1 },
      }),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'SUMMARY_MISMATCH' })]),
    });

    const invalidShape = {
      ...diff,
      endpointChanges: [
        {
          ...diff.endpointChanges[0]!,
          change: 'added' as const,
          before: diff.endpointChanges[0]!.before,
          after: null,
        },
        ...diff.endpointChanges.slice(1),
      ],
    };
    expect(validateDiffDocument(invalidShape)).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'CHANGE_SHAPE_INVALID' })]),
    });
    expect(() => renderDiffMarkdown(invalidShape)).toThrow(DiffIntegrityError);
  });
});
