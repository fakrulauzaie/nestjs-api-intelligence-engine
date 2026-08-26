import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { NEST_ROUTE_DECORATOR_METHODS } from '../../../src/extractors/nest-routes.js';
import { buildEndpointCatalogue } from '../../../src/reporting/endpoint-catalogue.js';
import { writeFakeNestCommon } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('NestJS route extraction', () => {
  it('extracts standard routes and declines dynamic, custom, and same-named local decorators', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/routes.controller.ts',
        [
          "import { Controller, Get as NestGet, Post, Put, Patch, Delete, Options, Head, All } from '@nestjs/common';",
          "const PREFIX = '/api/';",
          "const ITEM_PATH = 'items';",
          "const DYNAMIC_PATH = ['dynamic', 'path'].join('/');",
          'function CustomGet(path: string): MethodDecorator { return NestGet(path); }',
          'function Get(): MethodDecorator { return () => undefined; }',
          '@Controller(PREFIX)',
          'export class RoutesController {',
          '  @NestGet() root() {}',
          '  @Post(ITEM_PATH) create() {}',
          "  @Delete('/items/:itemId/') remove() {}",
          "  @Put('put') put() {}",
          "  @Patch('patch') patch() {}",
          "  @Options('options') options() {}",
          "  @Head('head') head() {}",
          "  @All('all') all() {}",
          '  @NestGet(DYNAMIC_PATH) dynamic() {}',
          "  @CustomGet('wrapped') wrapped() {}",
          '  @Get() localLookalike() {}',
          "  @NestGet('duplicate') firstDuplicate() {}",
          "  @NestGet('/duplicate/') secondDuplicate() {}",
          "  @NestGet('twice') @NestGet('twice') repeatedDecorator() {}",
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const result = await scanRepository({ repositoryRoot: project.path });
      const methodById = new Map(result.analysis.methods.map((method) => [method.id, method]));
      const handlerByEndpoint = new Map(
        result.analysis.assertions
          .filter((assertion) => assertion.predicate === 'ENDPOINT_IMPLEMENTED_BY')
          .map((assertion) => [
            assertion.subjectId,
            assertion.objectId === null
              ? null
              : (methodById.get(assertion.objectId)?.qualifiedName ?? null),
          ]),
      );
      const endpointFacts = result.analysis.endpoints
        .map((endpoint) => ({
          method: endpoint.httpMethod,
          path: endpoint.path,
          handler: handlerByEndpoint.get(endpoint.id),
        }))
        .sort((left, right) =>
          `${left.method}:${left.path}:${left.handler}`.localeCompare(
            `${right.method}:${right.path}:${right.handler}`,
          ),
        );

      expect(endpointFacts).toEqual(
        [
          ['ALL', '/api/all', 'RoutesController.all'],
          ['DELETE', '/api/items/:itemId', 'RoutesController.remove'],
          ['GET', '/api', 'RoutesController.root'],
          ['GET', '/api/duplicate', 'RoutesController.firstDuplicate'],
          ['GET', '/api/duplicate', 'RoutesController.secondDuplicate'],
          ['GET', '/api/twice', 'RoutesController.repeatedDecorator'],
          ['HEAD', '/api/head', 'RoutesController.head'],
          ['OPTIONS', '/api/options', 'RoutesController.options'],
          ['PATCH', '/api/patch', 'RoutesController.patch'],
          ['POST', '/api/items', 'RoutesController.create'],
          ['PUT', '/api/put', 'RoutesController.put'],
        ].map(([method, path, handler]) => ({ method, path, handler })),
      );
      expect(new Set(endpointFacts.map((endpoint) => endpoint.method))).toEqual(
        new Set(Object.values(NEST_ROUTE_DECORATOR_METHODS)),
      );
      expect(result.analysis.methods.map((method) => method.displayName)).not.toContain(
        'localLookalike',
      );
      expect(result.analysis.methods.map((method) => method.displayName)).toEqual(
        expect.arrayContaining(['dynamic', 'wrapped']),
      );
      expect(result.analysis.diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([
        'AUTH_GLOBAL_POLICY_UNKNOWN',
        'NEST_CUSTOM_ROUTE_DECORATOR',
        'NEST_ROUTE_DYNAMIC',
      ]);
      expect(result.analysis.resultState).toBe('completed_with_gaps');
      expect(validateAnalysisDocument(result.analysis)).toMatchObject({ success: true });
      expect(
        result.analysis.assertions
          .filter((assertion) => assertion.predicate === 'ENDPOINT_IMPLEMENTED_BY')
          .every(
            (assertion) => assertion.status === 'resolved' && assertion.evidenceIds.length >= 3,
          ),
      ).toBe(true);

      const catalogue = buildEndpointCatalogue(result.analysis);
      expect(
        catalogue.endpoints
          .filter((endpoint) => endpoint.path === '/api/duplicate')
          .map((endpoint) => endpoint.selectionStatus),
      ).toEqual(['ambiguous', 'ambiguous']);
      expect(
        catalogue.endpoints
          .filter((endpoint) => endpoint.path !== '/api/duplicate')
          .every((endpoint) => endpoint.selectionStatus === 'resolved'),
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
