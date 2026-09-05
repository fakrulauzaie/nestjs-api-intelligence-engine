import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { createDiagnostic } from '../../../src/diagnostics/catalogue.js';
import { serializeGraphReportDocument } from '../../../src/graph-report/ordering.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { assertValidGraphReportDocument } from '../../../src/graph-report/validate.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { analysisDocumentSchema } from '../../../src/model/schemas.js';
import {
  createMinimalAnalysisDocumentV7,
  createMinimalAnalysisDocumentV8,
} from '../../helpers/minimal-analysis.js';

describe('analysis v8 compatibility boundary', () => {
  it('compares a frozen v7 document with its equivalent v8 projection', () => {
    const before = createMinimalAnalysisDocumentV7();
    const after = createMinimalAnalysisDocumentV8();

    expect(analysisDocumentSchema.safeParse(before).success).toBe(true);
    expect(analysisDocumentSchema.safeParse(after).success).toBe(true);

    const diff = compareAnalysisDocuments(before, after);
    expect(diff).toMatchObject({
      schemaVersion: '5.0.0',
      before: { analysisSchemaVersion: '7.0.0' },
      after: { analysisSchemaVersion: '8.0.0' },
    });
    expect(diff.endpointChanges).toEqual([]);
    expect(diff.assertionStatusChanges).toEqual([]);
    expect(diff.diagnosticChanges).toEqual([]);

    const impact = analyzePotentialImpact(before, after);
    expect(impact).toMatchObject({
      schemaVersion: '2.0.0',
      before: { analysisSchemaVersion: '7.0.0' },
      after: { analysisSchemaVersion: '8.0.0' },
    });
    expect(impact.impactedEndpoints).toEqual([]);

    const beforeGraph = buildGraphReportDocument({ analysis: before });
    const afterGraph = buildGraphReportDocument({ analysis: after });
    expect(beforeGraph.schemaVersion).toBe('9.0.0');
    expect(afterGraph.schemaVersion).toBe('9.0.0');
    expect(assertValidGraphReportDocument({ document: beforeGraph, analysis: before })).toEqual(
      beforeGraph,
    );
    expect(assertValidGraphReportDocument({ document: afterGraph, analysis: after })).toEqual(
      afterGraph,
    );
    expect(() =>
      serializeGraphReportDocument({ document: beforeGraph, analysis: before }),
    ).not.toThrow();
    expect(() =>
      serializeGraphReportDocument({ document: afterGraph, analysis: after }),
    ).not.toThrow();
  });

  it('exposes a v8-only wrapper diagnostic to comparison without mutating v7', () => {
    const before = createMinimalAnalysisDocumentV7();
    const wrapperDiagnostic = createDiagnostic({
      code: 'CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN',
    });
    const after = {
      ...createMinimalAnalysisDocumentV8(),
      diagnostics: [wrapperDiagnostic],
      resultState: 'completed_with_gaps' as const,
    };

    expect(analysisDocumentSchema.safeParse(after).success).toBe(true);
    const diff = compareAnalysisDocuments(before, after);
    expect(diff.diagnosticChanges).toEqual([
      expect.objectContaining({
        change: 'new',
        after: expect.objectContaining({
          code: 'CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN',
        }),
      }),
    ]);
  });
});
