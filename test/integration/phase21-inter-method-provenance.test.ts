import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../src/evidence/validate.js';
import { renderEndpointContractsMarkdown } from '../../src/reporting/endpoint-contracts.js';

describe('Phase 21 integrated inter-method provenance', () => {
  it('proves POST /notes title influence through NotesService without treating formatter reachability as value flow', async () => {
    const { analysis } = await scanRepository({ repositoryRoot: resolve('example-nestjs-app') });
    if (analysis.schemaVersion !== '7.0.0') throw new Error('Expected analysis v7.');
    expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });

    const methods = new Map(analysis.methods.map((method) => [method.id, method]));
    const origins = new Map(analysis.requestFieldOrigins.map((origin) => [origin.id, origin]));
    const parameters = new Map(
      analysis.requestParameters.map((parameter) => [parameter.id, parameter]),
    );
    const columns = new Map(analysis.entityColumns.map((column) => [column.id, column]));
    const titleInfluence = analysis.columnInfluences.find((influence) => {
      const origin = origins.get(influence.originId);
      const parameter =
        origin === undefined ? undefined : parameters.get(origin.requestParameterId);
      return (
        parameter !== undefined &&
        methods.get(parameter.methodId)?.qualifiedName === 'NotesController.create' &&
        methods.get(influence.methodId)?.qualifiedName === 'NotesService.create' &&
        origin?.propertyPath.join('.') === 'title' &&
        columns.get(influence.columnId)?.propertyName === 'title'
      );
    });
    expect(titleInfluence).toMatchObject({
      state: 'direct',
      sinkKind: 'repository_insert',
      sinkPropertyName: 'title',
    });
    expect(titleInfluence?.callPath).toHaveLength(1);
    expect(columns.get(titleInfluence!.columnId)?.databaseName).toBe('title');

    const discontinuous = {
      ...structuredClone(analysis),
      columnInfluences: analysis.columnInfluences.map((influence) =>
        influence.id === titleInfluence?.id
          ? {
              ...influence,
              callPath: influence.callPath.map((step, index) =>
                index === 0 ? { ...step, calleeMethodId: step.callerMethodId } : step,
              ),
            }
          : influence,
      ),
    };
    const invalidPath = validateAnalysisDocument(discontinuous);
    expect(invalidPath.success).toBe(false);
    if (!invalidPath.success) {
      expect(invalidPath.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'COLUMN_INFLUENCE_ASSERTION_MISMATCH' }),
        ]),
      );
    }

    const endpoint = analysis.endpoints.find(
      ({ httpMethod, path }) => httpMethod === 'POST' && path === '/notes',
    )!;
    const report = renderEndpointContractsMarkdown(analysis, new Set([endpoint.id]));
    expect(report).toContain('NotesController.create -> NotesService.create');
    expect(report).toContain('`direct`');
    expect(report).not.toContain('NotesFormatterService.normalize -> NotesService.create');
  }, 30_000);
});
