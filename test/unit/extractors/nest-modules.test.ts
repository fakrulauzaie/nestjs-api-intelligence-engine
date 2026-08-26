import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { buildModuleVisibility } from '../../../src/modules/visibility.js';
import { writeFakeNestCommon, writeFakeNestCore } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('NestJS module and global guard extraction', () => {
  it('resolves bounded metadata, APP_GUARD, bootstrap order, and explicit unknowns', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestCore(project);
      await project.writeJson('package.json', { type: 'commonjs' });
      await project.write(
        'src/modules.ts',
        await readFile(resolve('test/fixtures/post-mvp/modules/modules.ts.txt'), 'utf8'),
      );
      await project.write(
        'src/bootstrap.ts',
        await readFile(resolve('test/fixtures/post-mvp/modules/bootstrap.ts.txt'), 'utf8'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      expect(analysis.schemaVersion).toBe('3.0.0');
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');

      const classById = new Map(analysis.classes.map((record) => [record.id, record]));
      const moduleById = new Map(analysis.modules.map((record) => [record.id, record]));
      const guardById = new Map(analysis.guards.map((record) => [record.id, record]));
      const moduleName = (moduleId: string): string | undefined => {
        const moduleRecord = moduleById.get(moduleId);
        return moduleRecord === undefined
          ? undefined
          : classById.get(moduleRecord.classId)?.displayName;
      };

      expect(analysis.modules).toHaveLength(8);
      expect(
        analysis.modules.filter(({ isGlobal }) => isGlobal).map(({ id }) => moduleName(id)),
      ).toEqual(['AuditModule']);
      const appModule = analysis.modules.find(({ id }) => moduleName(id) === 'AppModule')!;
      const importedNames = analysis.assertions
        .filter(
          ({ subjectId, predicate }) =>
            subjectId === appModule.id && predicate === 'MODULE_IMPORTS_MODULE',
        )
        .map(({ objectId }) => (objectId === null ? undefined : moduleName(objectId)))
        .sort();
      expect(importedNames).toEqual(['AuditModule', 'AuthModule', 'NotesModule']);
      expect(
        analysis.assertions.some(
          ({ subjectId, predicate, objectId }) =>
            moduleName(subjectId) === 'NotesModule' &&
            predicate === 'MODULE_IMPORTS_MODULE' &&
            objectId === appModule.id,
        ),
      ).toBe(true);

      expect(analysis.globalGuardAnalysis).toEqual({
        completeness: 'incomplete',
        state: 'declared',
      });
      expect(
        analysis.globalGuardRegistrations.map((registration) => ({
          kind: registration.kind,
          module: moduleName(registration.moduleId),
          guard: guardById.get(registration.guardId)?.displayName,
          order: registration.order,
        })),
      ).toEqual([
        {
          kind: 'bootstrap_use_global_guards',
          module: 'AppModule',
          guard: 'AuthGuard',
          order: 0,
        },
        {
          kind: 'bootstrap_use_global_guards',
          module: 'AppModule',
          guard: 'AuditGuard',
          order: 1,
        },
        {
          kind: 'app_guard_use_class',
          module: 'AuthModule',
          guard: 'AuthGuard',
          order: 2,
        },
        {
          kind: 'app_guard_use_existing',
          module: 'AuditModule',
          guard: 'AuditGuard',
          order: 3,
        },
      ]);

      const diagnosticCodes = analysis.diagnostics.map(({ code }) => code);
      expect(diagnosticCodes).toContain('NEST_MODULE_METADATA_UNRESOLVED');
      expect(diagnosticCodes).toContain('NEST_GLOBAL_GUARD_UNRESOLVED');
      expect(diagnosticCodes).toContain('NEST_BOOTSTRAP_GUARD_UNRESOLVED');
      expect(
        analysis.globalGuardRegistrations.some(
          ({ moduleId }) => moduleName(moduleId) === 'LookalikeTokenModule',
        ),
      ).toBe(false);
      expect(
        analysis.globalGuardRegistrations.some(
          ({ moduleId }) => moduleName(moduleId) === 'AmbiguousGuardModule',
        ),
      ).toBe(false);

      const visibility = buildModuleVisibility(analysis);
      const appVisibility = visibility.modules.find(({ moduleId }) => moduleId === appModule.id)!;
      const names = (ids: readonly string[]): string[] =>
        ids.map((id) => classById.get(id)?.displayName ?? id).sort();
      expect(names(appVisibility.importedProviderClassIds)).toEqual([
        'AuditGuard',
        'AuthGuard',
        'NotesService',
      ]);
      expect(names(appVisibility.globalProviderClassIds)).toEqual(['AuditGuard']);
      expect(appVisibility.complete).toBe(true);
    } finally {
      await project.cleanup();
    }
  }, 20_000);

  it('does not trust mutated const arrays, computed metadata, or indirect metadata objects', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/dynamic-modules.ts',
        [
          "import { Module } from '@nestjs/common';",
          'export class FirstProvider {}',
          'export class HiddenProvider {}',
          'const MUTATED_PROVIDERS = [FirstProvider];',
          'MUTATED_PROVIDERS.push(HiddenProvider);',
          '@Module({ providers: [...MUTATED_PROVIDERS] })',
          'export class MutatedArrayModule {}',
          "const FIELD = 'providers';",
          '@Module({ [FIELD]: [HiddenProvider] })',
          'export class ComputedMetadataModule {}',
          'const INDIRECT_METADATA = { providers: [HiddenProvider] };',
          '@Module(INDIRECT_METADATA)',
          'export class IndirectMetadataModule {}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      expect(analysis.schemaVersion).toBe('3.0.0');
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      expect(analysis.modules).toHaveLength(3);
      expect(
        analysis.modules.every(({ metadataCompleteness }) => metadataCompleteness === 'incomplete'),
      ).toBe(true);
      expect(
        analysis.assertions.some(({ predicate }) => predicate === 'MODULE_PROVIDES_CLASS'),
      ).toBe(false);
      expect(analysis.globalGuardAnalysis).toEqual({
        completeness: 'incomplete',
        state: 'unknown',
      });
    } finally {
      await project.cleanup();
    }
  }, 15_000);
});
