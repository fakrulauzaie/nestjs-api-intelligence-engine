import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { resolveSimpleString } from '../../../src/ts-index/constants.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('simple string resolution', () => {
  it('supports literals and one const hop while rejecting mutable, chained, and computed values', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write(
        'src/values.ts',
        [
          "const ROUTE = 'archived' as const;",
          'const direct = `direct`;',
          'const oneHop = ROUTE;',
          "let MUTABLE = 'mutable';",
          'const mutableUse = MUTABLE;',
          "const BASE = 'base';",
          'const CHAIN = BASE;',
          'const chained = CHAIN;',
          "const computed = ['computed', 'route'].join('/');",
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
      const source = loaded.program
        .getSourceFiles()
        .find((file) => file.fileName.endsWith('values.ts'));
      expect(source).toBeDefined();
      const declarations = new Map<string, ts.VariableDeclaration>();
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          declarations.set(node.name.text, node);
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(source!, visit);
      const resolveInitializer = (name: string) => {
        const initializer = declarations.get(name)?.initializer;
        expect(initializer).toBeDefined();
        return resolveSimpleString(initializer!, loaded.checker);
      };

      expect(resolveInitializer('direct')).toMatchObject({ status: 'resolved', value: 'direct' });
      expect(resolveInitializer('oneHop')).toMatchObject({
        status: 'resolved',
        value: 'archived',
      });
      expect(resolveInitializer('mutableUse')).toMatchObject({
        status: 'unsupported',
        reason: 'mutable_binding',
      });
      expect(resolveInitializer('chained')).toMatchObject({
        status: 'unsupported',
        reason: 'identifier_chain',
      });
      expect(resolveInitializer('computed')).toMatchObject({
        status: 'unsupported',
        reason: 'dynamic_expression',
      });
    } finally {
      await project.cleanup();
    }
  });
});
