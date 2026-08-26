import { describe, expect, it } from 'vitest';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { isImportedDecorator } from '../../../src/ts-index/decorators.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import { buildSourceIndex } from '../../../src/ts-index/source-index.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('decorator identity', () => {
  it('resolves named aliases and namespace imports without trusting a local same-name function', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write(
        'src/decorators.ts',
        'export function Controller(): ClassDecorator { return () => undefined; }\n',
      );
      await project.write(
        'src/classes.ts',
        [
          "import { Controller as ImportedController } from './decorators.js';",
          "import * as LocalDecorators from './decorators.js';",
          'function Controller(): ClassDecorator { return () => undefined; }',
          '@ImportedController() export class NamedImported {}',
          '@LocalDecorators.Controller() export class NamespaceImported {}',
          '@Controller() export class SameNameLocal {}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);
      const inventory = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: null,
      });
      const loaded = await loadTypeScriptProject({
        repositoryRoot: project.path,
        inventory,
      });
      const index = buildSourceIndex(inventory, loaded.program, loaded.checker);
      const decoratorFor = (className: string) => {
        const indexedClass = index.classes.find((candidate) => candidate.name === className);
        expect(indexedClass).toBeDefined();
        expect(indexedClass?.decorators).toHaveLength(1);
        return indexedClass!.decorators[0]!;
      };

      const named = decoratorFor('NamedImported');
      expect(named).toMatchObject({
        localName: 'ImportedController',
        exportedName: 'Controller',
        moduleSpecifier: './decorators.js',
        importKind: 'named',
      });
      expect(isImportedDecorator(named, './decorators.js', 'Controller')).toBe(true);

      const namespace = decoratorFor('NamespaceImported');
      expect(namespace).toMatchObject({
        localName: 'Controller',
        exportedName: 'Controller',
        moduleSpecifier: './decorators.js',
        importKind: 'namespace',
      });
      expect(isImportedDecorator(namespace, './decorators.js', 'Controller')).toBe(true);

      const sameNameLocal = decoratorFor('SameNameLocal');
      expect(sameNameLocal).toMatchObject({
        localName: 'Controller',
        moduleSpecifier: null,
        importKind: null,
      });
      expect(isImportedDecorator(sameNameLocal, './decorators.js', 'Controller')).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
