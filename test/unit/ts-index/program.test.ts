import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { loadTypeScriptProject, resolveTsconfigPath } from '../../../src/ts-index/program.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('TypeScript project loading', () => {
  it('loads default and explicit in-repository configurations from inventory-backed source', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write('src/main.ts', 'export const answer: number = 42;\n');
      await writeBasicTsconfig(project);
      await writeBasicTsconfig(project, 'config/tsconfig.app.json', ['../src/**/*.ts']);
      const inventory = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: null,
      });

      const defaultProject = await loadTypeScriptProject({
        repositoryRoot: project.path,
        inventory,
      });
      const explicitProject = await loadTypeScriptProject({
        repositoryRoot: project.path,
        inventory,
        tsconfigPath: 'config/tsconfig.app.json',
      });

      expect(defaultProject.program.getRootFileNames()).toHaveLength(1);
      expect(explicitProject.program.getRootFileNames()).toHaveLength(1);
      expect(defaultProject.targetSourceCacheHits).toBeGreaterThan(0);
      expect(defaultProject.diagnostics).toEqual([]);
      expect(explicitProject.diagnostics).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  it('rejects configurations outside the repository and sources excluded by inventory', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write('dist/hidden.ts', 'export const hidden = true;');
      await project.writeJson('tsconfig.json', {
        compilerOptions: { noEmit: true },
        files: ['dist/hidden.ts'],
      });
      const inventory = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: null,
      });

      await expect(
        resolveTsconfigPath(project.path, '../outside-tsconfig.json'),
      ).rejects.toMatchObject({
        code: 'TSCONFIG_OUTSIDE_REPOSITORY',
      });
      await expect(
        loadTypeScriptProject({ repositoryRoot: project.path, inventory }),
      ).rejects.toMatchObject({
        code: 'TSCONFIG_SOURCE_EXCLUDED',
      });
    } finally {
      await project.cleanup();
    }
  });

  it('reports malformed configuration, syntax failures, and unresolved imports', async () => {
    const malformed = await createTestTypeScriptProject();
    const broken = await createTestTypeScriptProject();
    try {
      await malformed.write('tsconfig.json', '{ invalid json');
      const malformedInventory = await inventoryRepository({
        repositoryRoot: malformed.path,
        repositoryRevision: null,
      });
      await expect(
        loadTypeScriptProject({ repositoryRoot: malformed.path, inventory: malformedInventory }),
      ).rejects.toMatchObject({ code: 'TSCONFIG_INVALID' });

      await broken.write(
        'src/broken.ts',
        "import { missing } from './does-not-exist.js';\nexport const value = ;\n",
      );
      await writeBasicTsconfig(broken);
      const brokenInventory = await inventoryRepository({
        repositoryRoot: broken.path,
        repositoryRevision: null,
      });
      const loaded = await loadTypeScriptProject({
        repositoryRoot: broken.path,
        inventory: brokenInventory,
      });

      expect(loaded.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ origin: 'syntactic', canonicalCode: 'TS_PARSE_ERROR' }),
          expect.objectContaining({
            origin: 'semantic',
            canonicalCode: 'TS_IMPORT_UNRESOLVED',
          }),
        ]),
      );
      expect(loaded.diagnostics.filter((diagnostic) => diagnostic.filePath !== null)).toEqual(
        expect.arrayContaining([expect.objectContaining({ filePath: 'src/broken.ts' })]),
      );
    } finally {
      await malformed.cleanup();
      await broken.cleanup();
    }
  });

  it('rejects project references for the single-application MVP', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write('src/main.ts', 'export {};');
      await project.writeJson('tsconfig.json', {
        files: ['src/main.ts'],
        references: [{ path: './child' }],
      });
      const inventory = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: null,
      });

      await expect(
        loadTypeScriptProject({ repositoryRoot: project.path, inventory }),
      ).rejects.toMatchObject({
        code: 'TSCONFIG_PROJECT_REFERENCES_UNSUPPORTED',
      });
    } finally {
      await project.cleanup();
    }
  });

  it('blocks imported repository sources excluded by inventory and sources outside the repository', async () => {
    const excluded = await createTestTypeScriptProject();
    const outside = await createTestTypeScriptProject();
    const externalTarget = await createTestTypeScriptProject();
    try {
      await excluded.write(
        'src/main.ts',
        "import { hidden } from '../dist/hidden.js';\nexport { hidden };\n",
      );
      await excluded.write('dist/hidden.ts', 'export const hidden = true;\n');
      await writeBasicTsconfig(excluded);
      const excludedInventory = await inventoryRepository({
        repositoryRoot: excluded.path,
        repositoryRevision: null,
      });
      await expect(
        loadTypeScriptProject({ repositoryRoot: excluded.path, inventory: excludedInventory }),
      ).rejects.toMatchObject({ code: 'TSCONFIG_SOURCE_EXCLUDED' });

      const externalFile = await externalTarget.write(
        'external.ts',
        'export const external = true;\n',
      );
      let modulePath = relative(join(outside.path, 'src'), externalFile).replaceAll('\\', '/');
      if (!modulePath.startsWith('.')) modulePath = `./${modulePath}`;
      modulePath = modulePath.replace(/\.ts$/, '.js');
      await outside.write(
        'src/main.ts',
        `import { external } from ${JSON.stringify(modulePath)};\nexport { external };\n`,
      );
      await writeBasicTsconfig(outside);
      const outsideInventory = await inventoryRepository({
        repositoryRoot: outside.path,
        repositoryRevision: null,
      });
      await expect(
        loadTypeScriptProject({ repositoryRoot: outside.path, inventory: outsideInventory }),
      ).rejects.toMatchObject({ code: 'TSCONFIG_SOURCE_OUTSIDE_REPOSITORY' });
    } finally {
      await excluded.cleanup();
      await outside.cleanup();
      await externalTarget.cleanup();
    }
  });
});
