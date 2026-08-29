import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { resolveSimpleString } from '../../../src/ts-index/constants.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

async function loadInitializers(files: Readonly<Record<string, string>>) {
  const project = await createTestTypeScriptProject();
  for (const [path, text] of Object.entries(files)) await project.write(path, text);
  await writeBasicTsconfig(project);
  const inventory = await inventoryRepository({
    repositoryRoot: project.path,
    repositoryRevision: null,
  });
  const loaded = await loadTypeScriptProject({ repositoryRoot: project.path, inventory });
  const declarations = new Map<string, ts.VariableDeclaration>();
  for (const source of loaded.program.getSourceFiles()) {
    if (!source.fileName.includes('/src/') && !source.fileName.includes('\\src\\')) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        declarations.set(node.name.text, node);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }
  const resolveInitializer = (name: string) => {
    const initializer = declarations.get(name)?.initializer;
    expect(initializer).toBeDefined();
    return resolveSimpleString(initializer!, loaded.checker);
  };
  return { project, resolveInitializer };
}

describe('simple string resolution', () => {
  it('resolves immutable chains, imported enums, const enums, and nested as-const properties', async () => {
    const { project, resolveInitializer } = await loadInitializers({
      'src/shared.ts': [
        "export enum Jobs { Regular = 'regular-job' }",
        "export const enum FastJobs { Immediate = 'immediate-job' }",
        'export const QUEUES = {',
        "  verification: { name: 'verification-queue', job: Jobs.Regular },",
        '} as const;',
      ].join('\n'),
      'src/values.ts': [
        "import { Jobs as ImportedJobs, FastJobs, QUEUES as SharedQueues } from './shared.js';",
        "const ROUTE = 'archived' as const;",
        'const oneHop = ROUTE;',
        'const chained = oneHop;',
        'const enumValue = ImportedJobs.Regular;',
        'const constEnumValue = FastJobs.Immediate;',
        'const objectValue = SharedQueues.verification.name;',
        "const elementValue = SharedQueues['verification']['job'];",
      ].join('\n'),
    });
    try {
      expect(resolveInitializer('chained')).toMatchObject({
        status: 'resolved',
        value: 'archived',
      });
      const enumValue = resolveInitializer('enumValue');
      expect(enumValue).toMatchObject({ status: 'resolved', value: 'regular-job' });
      expect(enumValue.evidenceNodes.some(ts.isEnumMember)).toBe(true);
      expect(resolveInitializer('constEnumValue')).toMatchObject({
        status: 'resolved',
        value: 'immediate-job',
      });
      const objectValue = resolveInitializer('objectValue');
      expect(objectValue).toMatchObject({
        status: 'resolved',
        value: 'verification-queue',
      });
      expect(
        objectValue.evidenceNodes.filter(ts.isPropertyAssignment).length,
      ).toBeGreaterThanOrEqual(2);
      expect(resolveInitializer('elementValue')).toMatchObject({
        status: 'resolved',
        value: 'regular-job',
      });
    } finally {
      await project.cleanup();
    }
  });

  it('fails closed for mutable, unasserted, spread, computed-key, and computed values', async () => {
    const { project, resolveInitializer } = await loadInitializers({
      'src/values.ts': [
        "let MUTABLE = 'mutable';",
        'const mutableUse = MUTABLE;',
        "const UNASSERTED = { key: 'value' };",
        'const unassertedUse = UNASSERTED.key;',
        "const BASE = { key: 'value' } as const;",
        "const WITH_SPREAD = { ...BASE, other: 'other' } as const;",
        'const spreadUse = WITH_SPREAD.key;',
        "const DYNAMIC_KEY = 'key';",
        'const dynamicKeyUse = BASE[DYNAMIC_KEY];',
        "const computed = ['computed', 'route'].join('/');",
      ].join('\n'),
    });
    try {
      expect(resolveInitializer('mutableUse')).toMatchObject({
        status: 'unsupported',
        reason: 'mutable_binding',
      });
      expect(resolveInitializer('unassertedUse')).toMatchObject({
        status: 'unsupported',
        reason: 'non_constant_property',
      });
      expect(resolveInitializer('spreadUse')).toMatchObject({
        status: 'unsupported',
        reason: 'non_constant_property',
      });
      expect(resolveInitializer('dynamicKeyUse')).toMatchObject({
        status: 'unsupported',
        reason: 'dynamic_expression',
      });
      expect(resolveInitializer('computed')).toMatchObject({
        status: 'unsupported',
        reason: 'dynamic_expression',
      });
    } finally {
      await project.cleanup();
    }
  });

  it('bounds recursive resolution and detects cycles', async () => {
    const chain = ["const VALUE_0 = 'resolved';"];
    for (let index = 1; index <= 10; index += 1) {
      chain.push(`const VALUE_${index} = VALUE_${index - 1};`);
    }
    chain.push('const withinLimit = VALUE_3;');
    chain.push('const beyondLimit = VALUE_10;');
    chain.push('const CYCLE_A: string = CYCLE_B;');
    chain.push('const CYCLE_B: string = CYCLE_A;');
    chain.push('const cyclic = CYCLE_A;');
    const { project, resolveInitializer } = await loadInitializers({
      'src/values.ts': chain.join('\n'),
    });
    try {
      expect(resolveInitializer('withinLimit')).toMatchObject({
        status: 'resolved',
        value: 'resolved',
      });
      expect(resolveInitializer('beyondLimit')).toMatchObject({
        status: 'unsupported',
        reason: 'resolution_depth_exceeded',
      });
      expect(resolveInitializer('cyclic')).toMatchObject({
        status: 'unsupported',
        reason: 'cyclic_reference',
      });
    } finally {
      await project.cleanup();
    }
  });
});
