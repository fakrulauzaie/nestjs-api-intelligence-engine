import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractRedlockCriticalSections } from '../../../src/extractors/redlock-critical-sections.js';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { buildSourceIndex } from '../../../src/ts-index/source-index.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import {
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeRedlock,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
  type TestTypeScriptProject,
} from '../../helpers/typescript-project.js';

async function extractFromFixture(project: TestTypeScriptProject, fixturePath: string) {
  await Promise.all([
    writeFakeNestCommon(project),
    writeFakeNestTypeOrm(project),
    writeFakeTypeOrm(project),
    writeFakeRedlock(project),
  ]);
  await project.write('src/fixture.ts', await readFile(resolve(fixturePath), 'utf8'));
  await writeBasicTsconfig(project);
  const inventory = await inventoryRepository({
    repositoryRoot: project.path,
    repositoryRevision: null,
  });
  const loaded = await loadTypeScriptProject({ repositoryRoot: project.path, inventory });
  expect(loaded.diagnostics).toEqual([]);
  const sourceIndex = buildSourceIndex(inventory, loaded.program, loaded.checker);
  return extractRedlockCriticalSections({
    sourceIndex,
    checker: loaded.checker,
    repositoryRevision: null,
    evidenceSnippetLimit: 240,
  });
}

function projectedSummaries(extraction: ReturnType<typeof extractRedlockCriticalSections>) {
  return extraction.directCallbackParameterSummaries.map((summary) => ({
    method: summary.method.qualifiedName,
    parameter: summary.parameter.name,
    parameterIndex: summary.callbackParameterIndex,
    invocationCount: summary.callbackInvocations.length,
    roles: summary.evidenceNodes.map(({ role }) => role),
    sourceFile: summary.method.node.getSourceFile().fileName.replaceAll('\\', '/'),
  }));
}

describe('direct critical-section callback parameter summaries', () => {
  it('summarizes only parameters invoked directly inside package-proven Redlock callbacks', async () => {
    const verifiedProject = await createTestTypeScriptProject();
    const unsupportedProject = await createTestTypeScriptProject();
    try {
      const [verified, unsupported] = await Promise.all([
        extractFromFixture(
          verifiedProject,
          'test/fixtures/resources/critical-section-wrappers/verified.ts.txt',
        ),
        extractFromFixture(
          unsupportedProject,
          'test/fixtures/resources/critical-section-wrappers/unsupported.ts.txt',
        ),
      ]);

      expect(projectedSummaries(verified)).toEqual([
        {
          method: 'RedisLockService.executeWithLock',
          parameter: 'task',
          parameterIndex: 1,
          invocationCount: 1,
          roles: [
            'redlock_terminal',
            'callback_argument',
            'callback_parameter',
            'callback_invocation',
          ],
          sourceFile: expect.stringMatching(/\/src\/fixture\.ts$/u),
        },
      ]);
      expect(projectedSummaries(unsupported)).toEqual([
        {
          method: 'UnsupportedLockWrappers.executeWithLock',
          parameter: 'task',
          parameterIndex: 1,
          invocationCount: 1,
          roles: [
            'redlock_terminal',
            'callback_argument',
            'callback_parameter',
            'callback_invocation',
          ],
          sourceFile: expect.stringMatching(/\/src\/fixture\.ts$/u),
        },
      ]);

      expect(
        unsupported.directCallbackParameterSummaries.some(({ method }) =>
          [
            'UnsupportedLockWrappers.invokesOutsideSection',
            'UnsupportedLockWrappers.schedulesInsideSection',
            'LookalikeWrapper.execute',
          ].includes(method.qualifiedName),
        ),
      ).toBe(false);
    } finally {
      await Promise.all([verifiedProject.cleanup(), unsupportedProject.cleanup()]);
    }
  }, 30_000);

  it('uses symbols, skips nested boundaries and aliases, and retains every direct invocation', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([writeFakeNestCommon(project), writeFakeRedlock(project)]);
      await project.write(
        'src/summaries.ts',
        [
          "import { Injectable } from '@nestjs/common';",
          "import LockManager from 'redlock';",
          '@Injectable()',
          'class WrapperCases {',
          '  constructor(private readonly locks: LockManager) {}',
          '  async direct<T>(key: string, task: () => Promise<T>): Promise<T> {',
          '    return this.locks.using([key], 100, async () => {',
          '      await task();',
          '      return task();',
          '    });',
          '  }',
          '  async alias<T>(key: string, task: () => Promise<T>): Promise<T> {',
          '    return this.locks.using([key], 100, async () => {',
          '      const run = task;',
          '      return run();',
          '    });',
          '  }',
          '  async nested<T>(key: string, task: () => Promise<T>): Promise<() => Promise<T>> {',
          '    return this.locks.using([key], 100, async () => async () => task());',
          '  }',
          '  async indirect<T>(key: string, task: () => Promise<T>): Promise<T> {',
          '    return this.locks.using([key], 100, async () => task.call(undefined));',
          '  }',
          '  async defaulted<T>(key: string, task: () => Promise<T> = async () => undefined as T): Promise<T> {',
          '    return this.locks.using([key], 100, async () => task());',
          '  }',
          '}',
          'class Lookalike { using<T>(_keys: string[], _ttl: number, task: () => Promise<T>) { return task(); } }',
          '@Injectable()',
          'class LookalikeWrapper {',
          '  constructor(private readonly locks: Lookalike) {}',
          '  run(task: () => Promise<string>): Promise<string> {',
          "    return this.locks.using(['key'], 100, async () => task());",
          '  }',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);
      const inventory = await inventoryRepository({
        repositoryRoot: project.path,
        repositoryRevision: null,
      });
      const loaded = await loadTypeScriptProject({ repositoryRoot: project.path, inventory });
      expect(loaded.diagnostics).toEqual([]);
      const extraction = extractRedlockCriticalSections({
        sourceIndex: buildSourceIndex(inventory, loaded.program, loaded.checker),
        checker: loaded.checker,
        repositoryRevision: null,
        evidenceSnippetLimit: 240,
      });

      expect(projectedSummaries(extraction)).toEqual([
        {
          method: 'WrapperCases.direct',
          parameter: 'task',
          parameterIndex: 1,
          invocationCount: 2,
          roles: [
            'redlock_terminal',
            'callback_argument',
            'callback_parameter',
            'callback_invocation',
            'callback_invocation',
          ],
          sourceFile: expect.stringMatching(/\/src\/summaries\.ts$/u),
        },
      ]);
      expect(extraction.directCallbackParameterSummaries[0]?.callbackInvocations).toEqual(
        [...(extraction.directCallbackParameterSummaries[0]?.callbackInvocations ?? [])].sort(
          (left, right) => left.getStart() - right.getStart(),
        ),
      );
    } finally {
      await project.cleanup();
    }
  }, 20_000);
});
