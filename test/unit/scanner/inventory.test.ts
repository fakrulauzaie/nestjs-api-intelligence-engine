import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashContent } from '../../../src/model/hashing.js';
import { inventoryRepository, type InventorySkipReason } from '../../../src/scanner/inventory.js';
import { createTestTypeScriptProject } from '../../helpers/typescript-project.js';

describe('repository inventory', () => {
  it('reads eligible TypeScript once into deterministic records and skips unsafe inputs', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write('src/a.ts', 'export const a = 1;\n');
      await project.write('src/b.tsx', 'export const b = <span />;\n');
      await project.write('src/readme.md', 'not source');
      await project.write('node_modules/pkg/index.ts', 'excluded');
      await project.write('dist/generated.ts', 'excluded');
      await project.write('.git/hooks/side-effect.ts', 'excluded');
      await project.write('.api-intel/old.ts', 'excluded');
      await project.write('src/large.ts', 'x'.repeat(33));
      await project.write('src/binary.ts', new Uint8Array([65, 0, 66]));

      const first = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: 'abc',
        maxSourceFileBytes: 32,
      });
      const second = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: 'abc',
        maxSourceFileBytes: 32,
      });

      expect(first.sourceFiles.map((source) => source.record.path)).toEqual([
        'src/a.ts',
        'src/b.tsx',
      ]);
      expect(first.sourceFiles[0]?.record.contentHash).toBe(hashContent('export const a = 1;\n'));
      expect(first.sourceFiles[0]?.text).toBe('export const a = 1;\n');
      expect(first.sourceFiles.map((source) => source.record)).toEqual(
        second.sourceFiles.map((source) => source.record),
      );
      expect(first.skippedEntries).toEqual(second.skippedEntries);

      const reasons = new Map(first.skippedEntries.map((entry) => [entry.path, entry.reason]));
      expect(reasons.get('node_modules')).toBe('excluded_directory');
      expect(reasons.get('dist')).toBe('excluded_directory');
      expect(reasons.get('.git')).toBe('excluded_directory');
      expect(reasons.get('.api-intel')).toBe('excluded_directory');
      expect(reasons.get('src/large.ts')).toBe('oversized');
      expect(reasons.get('src/binary.ts')).toBe('binary');
      expect(reasons.get('src/readme.md')).toBe('unsupported_extension');
    } finally {
      await project.cleanup();
    }
  });

  it('skips symlinks and distinguishes targets outside the repository', async () => {
    const project = await createTestTypeScriptProject();
    const external = await createTestTypeScriptProject();
    try {
      const internalTarget = await project.write('src/target.ts', 'export const safe = true;');
      const externalTarget = await external.write('outside.ts', 'throw new Error("never read");');
      let linksSupported = true;
      try {
        await symlink(internalTarget, join(project.path, 'internal-link.ts'));
        await symlink(externalTarget, join(project.path, 'outside-link.ts'));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES') linksSupported = false;
        else throw error;
      }
      if (!linksSupported) return;

      const inventory = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: null,
      });
      const skipped = new Map<string, InventorySkipReason>(
        inventory.skippedEntries.map((entry) => [entry.path, entry.reason]),
      );

      expect(skipped.get('internal-link.ts')).toBe('symbolic_link');
      expect(skipped.get('outside-link.ts')).toBe('symlink_outside_repository');
      expect(inventory.sourceFiles.map((source) => source.record.path)).toEqual(['src/target.ts']);
    } finally {
      await project.cleanup();
      await external.cleanup();
    }
  });

  it('rejects missing repositories and invalid size limits', async () => {
    const project = await createTestTypeScriptProject();
    const missing = join(project.path, 'missing');
    try {
      await expect(
        inventoryRepository({ repositoryRoot: missing, repositoryRevision: null }),
      ).rejects.toMatchObject({ code: 'REPOSITORY_NOT_FOUND' });
      await expect(
        inventoryRepository({
          repositoryRoot: project.path,
          repositoryRevision: null,
          maxSourceFileBytes: 0,
        }),
      ).rejects.toThrow(RangeError);
    } finally {
      await project.cleanup();
    }
  });
});
