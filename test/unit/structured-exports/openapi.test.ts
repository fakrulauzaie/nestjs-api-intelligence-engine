import { describe, expect, it } from 'vitest';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';
import { createMinimalAnalysisDocument } from '../../helpers/minimal-analysis.js';
import {
  enrichOpenApiDocument,
  nestPathToOpenApiPath,
  OpenApiInputError,
} from '../../../src/structured-exports/openapi.js';
import { assertValidOpenApiEnrichmentResult } from '../../../src/structured-exports/validate.js';

describe('Phase 22 OpenAPI enrichment', () => {
  it.each(['3.0.3', '3.1.1'])(
    'matches OpenAPI %s exactly with prefix/trailing normalization',
    (version) => {
      const openApi = {
        openapi: version,
        info: { title: 'Unicode Notes — 測試', version: '1' },
        'x-existing': { retained: true },
        paths: {
          '/api/health/': {
            get: {
              summary: 'Health',
              'x-custom-operation': 'keep',
            },
          },
        },
      };
      const before = structuredClone(openApi);
      const enrichment = enrichOpenApiDocument({
        analysis: createMinimalAnalysisDocument(),
        openApi,
        pathPrefix: '/api/',
      });

      expect(openApi).toEqual(before);
      expect(enrichment.enrichedDocument).toMatchObject({
        info: before.info,
        'x-existing': { retained: true },
        paths: {
          '/api/health/': {
            get: {
              summary: 'Health',
              'x-custom-operation': 'keep',
              'x-api-intel': {
                schemaVersion: '1.0.0',
                resolution: 'resolved',
                dbReads: [],
                dbWrites: [],
                evidenceIds: [],
              },
            },
          },
        },
      });
      expect(assertValidOpenApiEnrichmentResult(enrichment.result).summary).toMatchObject({
        operations: 1,
        resolved: 1,
        unmatchedAnalysisEndpoints: 0,
      });
      expect(enrichment.result.operations[0]?.evidenceIds.length).toBeGreaterThan(0);
      expect(enrichment.result.extensionEvidence).toBe('sidecar_only');
    },
  );

  it('reports duplicates, unmatched operations, path parameters, and unmatched analysis endpoints', () => {
    const analysis = createComparisonAnalysisSnapshot('before');
    const exact = enrichOpenApiDocument({
      analysis,
      openApi: {
        openapi: '3.1.0',
        info: { title: 'Notes', version: '1' },
        paths: {
          '/notes/{id}': { delete: { responses: {} } },
          '/missing': { get: { responses: {} } },
        },
      },
      includeEvidence: true,
    });
    expect(exact.result.operations.map(({ resolution }) => resolution).sort()).toEqual([
      'resolved',
      'unmatched',
    ]);
    const resolvedOperation = (
      exact.enrichedDocument.paths as Record<string, Record<string, Record<string, unknown>>>
    )['/notes/{id}']!.delete!['x-api-intel'] as { evidenceIds: string[] };
    expect(resolvedOperation.evidenceIds.length).toBeGreaterThan(0);
    expect(exact.result.unmatchedAnalysisEndpoints.length).toBeGreaterThan(0);
    expect(nestPathToOpenApiPath('/notes/:id')).toBe('/notes/{id}');

    const duplicate = enrichOpenApiDocument({
      analysis: createMinimalAnalysisDocument(),
      openApi: {
        openapi: '3.0.3',
        info: { title: 'Duplicate', version: '1' },
        paths: {
          '/health': { get: {} },
          '/health/': { get: {} },
        },
      },
    });
    expect(duplicate.result.operations.map(({ resolution }) => resolution)).toEqual([
      'ambiguous',
      'ambiguous',
    ]);
    expect(duplicate.result.unmatchedAnalysisEndpoints).toEqual([]);
  });

  it('rejects Swagger/OpenAPI 2 and malformed operation objects', () => {
    expect(() =>
      enrichOpenApiDocument({
        analysis: createMinimalAnalysisDocument(),
        openApi: { swagger: '2.0', paths: {} },
      }),
    ).toThrow(OpenApiInputError);
    expect(() =>
      enrichOpenApiDocument({
        analysis: createMinimalAnalysisDocument(),
        openApi: { openapi: '3.0.3', paths: { '/health': { get: 'invalid' } } },
      }),
    ).toThrow(OpenApiInputError);
  });

  it('rejects sidecar evidence that is not in the canonical analysis', () => {
    const analysis = createMinimalAnalysisDocument();
    const enrichment = enrichOpenApiDocument({
      analysis,
      openApi: { openapi: '3.0.3', paths: { '/health': { get: {} } } },
    });
    const corrupted = {
      ...enrichment.result,
      operations: enrichment.result.operations.map((operation) => ({
        ...operation,
        evidenceIds: ['evidence:00000000000000000000000000000000'],
      })),
    };
    expect(() => assertValidOpenApiEnrichmentResult(corrupted, analysis)).toThrow(
      'Structured export integrity validation failed',
    );
  });
});
