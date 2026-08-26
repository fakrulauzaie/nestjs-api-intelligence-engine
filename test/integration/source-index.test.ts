import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sourceRangeForNode } from '../../src/evidence/locations.js';
import { inventoryRepository } from '../../src/scanner/inventory.js';
import { resolveSimpleString } from '../../src/ts-index/constants.js';
import { isImportedDecorator } from '../../src/ts-index/decorators.js';
import { loadTypeScriptProject } from '../../src/ts-index/program.js';
import { buildSourceIndex } from '../../src/ts-index/source-index.js';

describe('sample NestJS source index', () => {
  it('indexes imports, classes, constructors, parameters, methods, and decorator symbols', async () => {
    const repositoryRoot = resolve('example-nestjs-app');
    const inventory = await inventoryRepository({ repositoryRoot, repositoryRevision: null });
    const loaded = await loadTypeScriptProject({ repositoryRoot, inventory });
    const index = buildSourceIndex(inventory, loaded.program, loaded.checker);

    expect(
      inventory.sourceFiles.every((source) => !source.record.path.includes('node_modules')),
    ).toBe(true);
    expect(index.sourceFiles).toHaveLength(inventory.sourceFiles.length);

    const notesController = index.classes.find(
      (indexedClass) => indexedClass.name === 'NotesController',
    );
    expect(notesController).toBeDefined();
    expect(notesController?.checkerQualifiedName).toContain('NotesController');
    expect(notesController?.constructors).toHaveLength(1);
    expect(notesController?.constructors[0]?.parameters.map((parameter) => parameter.name)).toEqual(
      ['notesService', 'notesRepository'],
    );
    expect(notesController?.methods.map((method) => method.name)).toEqual([
      'create',
      'findAll',
      'findArchived',
      'remove',
      'updateLegacy',
      'computedStatus',
    ]);
    expect(notesController?.methods.every((method) => method.signature.length > 0)).toBe(true);

    const controllerDecorator = notesController?.decorators[0];
    expect(controllerDecorator).toBeDefined();
    expect(isImportedDecorator(controllerDecorator!, '@nestjs/common', 'Controller')).toBe(true);
    expect(
      sourceRangeForNode(notesController!.node.getSourceFile(), controllerDecorator!.node),
    ).toEqual({
      startLine: 12,
      startColumn: 1,
      endLine: 12,
      endColumn: 21,
    });
    const repositoryDecorator = notesController?.constructors[0]?.parameters[1]?.decorators[0];
    expect(repositoryDecorator).toBeDefined();
    expect(isImportedDecorator(repositoryDecorator!, '@nestjs/typeorm', 'InjectRepository')).toBe(
      true,
    );

    const notesSource = index.sourceByPath.get('src/notes/notes.controller.ts');
    const controllerImport = notesSource?.imports
      .flatMap((imported) => imported.bindings)
      .find((binding) => binding.localName === 'Controller');
    expect(controllerImport).toMatchObject({
      exportedName: 'Controller',
      moduleSpecifier: '@nestjs/common',
      kind: 'named',
    });
    expect(controllerImport?.symbol).not.toBeNull();

    const methodByName = new Map(notesController?.methods.map((method) => [method.name, method]));
    const routeArgument = (methodName: string): ts.Expression => {
      const decorator = methodByName
        .get(methodName)
        ?.decorators.find((candidate) => candidate.exportedName === 'Get');
      expect(decorator).toBeDefined();
      expect(ts.isCallExpression(decorator!.node.expression)).toBe(true);
      return (decorator!.node.expression as ts.CallExpression).arguments[0]!;
    };

    expect(resolveSimpleString(routeArgument('findArchived'), loaded.checker)).toMatchObject({
      status: 'resolved',
      value: 'archived',
    });
    expect(resolveSimpleString(routeArgument('computedStatus'), loaded.checker)).toMatchObject({
      status: 'unsupported',
      reason: 'dynamic_expression',
    });
  }, 30_000);
});
