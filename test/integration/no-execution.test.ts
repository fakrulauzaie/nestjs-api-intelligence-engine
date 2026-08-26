import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { inventoryRepository } from '../../src/scanner/inventory.js';
import { loadTypeScriptProject } from '../../src/ts-index/program.js';
import { buildSourceIndex } from '../../src/ts-index/source-index.js';
import { writeFakeAxios } from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

describe('static-analysis safety', () => {
  it('does not execute target top-level code during inventory, indexing, or a complete scan', async () => {
    const project = await createTestTypeScriptProject();
    const sentinel = join(project.path, 'TARGET_CODE_EXECUTED');
    const originalFetch = globalThis.fetch;
    let attemptedNetworkRequest = false;
    try {
      globalThis.fetch = (() => {
        attemptedNetworkRequest = true;
        throw new Error('The static analyzer attempted a network request.');
      }) as typeof fetch;
      await writeFakeAxios(project);
      await project.write(
        'src/side-effect.ts',
        [
          "import axios from 'axios';",
          'declare const require: (moduleName: string) => { writeFileSync(path: string, value: string): void };',
          `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed');`,
          'export class SafeToIndex {',
          '  run(): string {',
          "    axios.get('https://must-not-run.example/axios');",
          "    fetch('https://must-not-run.example/fetch');",
          '    return "indexed";',
          '  }',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);
      await expect(access(sentinel)).rejects.toThrow();

      const inventory = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: null,
      });
      const loaded = await loadTypeScriptProject({
        repositoryRoot: project.path,
        inventory,
      });
      const index = buildSourceIndex(inventory, loaded.program, loaded.checker);

      expect(index.classes.map((indexedClass) => indexedClass.name)).toContain('SafeToIndex');
      const scanned = await scanRepository({ repositoryRoot: project.path });
      expect(scanned.analysis.sourceFiles.map((source) => source.path)).toEqual([
        'src/side-effect.ts',
      ]);
      expect(
        scanned.analysis.schemaVersion === '3.0.0' ? scanned.analysis.interactions : [],
      ).toHaveLength(2);
      expect(attemptedNetworkRequest).toBe(false);
      await expect(access(sentinel)).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
      await project.cleanup();
    }
  });

  it('scans an unfamiliar non-Nest repository without converting local lookalikes into facts', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write(
        'src/unfamiliar.ts',
        [
          'function Controller(_path: string): ClassDecorator { return () => undefined; }',
          'function Get(_path?: string): MethodDecorator { return () => undefined; }',
          'function Entity(): ClassDecorator { return () => undefined; }',
          'class Repository<T> {',
          '  find(): T[] { return []; }',
          '  delete(_id: number): void {}',
          '}',
          "@Controller('lookalike')",
          '@Entity()',
          'export class OrdinaryClass {',
          '  private readonly repository = new Repository<OrdinaryClass>();',
          "  @Get('items') list(): OrdinaryClass[] { return this.repository.find(); }",
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const scanned = await scanRepository({ repositoryRoot: project.path });

      expect(scanned.analysis.resultState).toBe('completed');
      expect(scanned.analysis.sourceFiles.map((source) => source.path)).toEqual([
        'src/unfamiliar.ts',
      ]);
      expect(scanned.analysis.endpoints).toEqual([]);
      expect(scanned.analysis.entities).toEqual([]);
      expect(scanned.analysis.repositoryBindings).toEqual([]);
      expect(scanned.analysis.assertions).toEqual([]);
      expect(scanned.analysis.diagnostics).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });
});
