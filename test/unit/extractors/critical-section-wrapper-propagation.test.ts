import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { propagateCriticalSectionCallbackParameters } from '../../../src/extractors/critical-section-wrapper-flow.js';
import { extractRedlockCriticalSections } from '../../../src/extractors/redlock-critical-sections.js';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import { buildSourceIndex } from '../../../src/ts-index/source-index.js';
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

async function loadExtraction(project: TestTypeScriptProject, source: string) {
  await Promise.all([
    writeFakeNestCommon(project),
    writeFakeNestTypeOrm(project),
    writeFakeTypeOrm(project),
    writeFakeRedlock(project),
  ]);
  await project.write('src/wrappers.ts', source);
  await writeBasicTsconfig(project);
  const inventory = await inventoryRepository({
    repositoryRoot: project.path,
    repositoryRevision: null,
  });
  const loaded = await loadTypeScriptProject({ repositoryRoot: project.path, inventory });
  expect(loaded.diagnostics).toEqual([]);
  const sourceIndex = buildSourceIndex(inventory, loaded.program, loaded.checker);
  return {
    sourceIndex,
    checker: loaded.checker,
    extraction: extractRedlockCriticalSections({
      sourceIndex,
      checker: loaded.checker,
      repositoryRevision: null,
      evidenceSnippetLimit: 240,
    }),
  };
}

function projectedFlows(extraction: ReturnType<typeof extractRedlockCriticalSections>) {
  return extraction.callbackParameterFlowSummaries.map((summary) => ({
    method: summary.method.qualifiedName,
    parameter: summary.parameter.name,
    parameterIndex: summary.callbackParameterIndex,
    hops: summary.forwardingHopCount,
    flow: summary.flow.map((step) => ({
      method: step.method.qualifiedName,
      parameterIndex: step.callbackParameterIndex,
      relation: step.relation,
    })),
    evidenceRoles: summary.evidenceNodes.map(({ role }) => role),
  }));
}

describe('bounded critical-section wrapper propagation', () => {
  it('proves the real two-level shape while rejecting every close W0 forwarding negative', async () => {
    const verifiedProject = await createTestTypeScriptProject();
    const unsupportedProject = await createTestTypeScriptProject();
    try {
      const [verifiedSource, unsupportedSource] = await Promise.all([
        readFile(
          resolve('test/fixtures/resources/critical-section-wrappers/verified.ts.txt'),
          'utf8',
        ),
        readFile(
          resolve('test/fixtures/resources/critical-section-wrappers/unsupported.ts.txt'),
          'utf8',
        ),
      ]);
      const [verified, unsupported] = await Promise.all([
        loadExtraction(verifiedProject, verifiedSource),
        loadExtraction(unsupportedProject, unsupportedSource),
      ]);

      expect(projectedFlows(verified.extraction)).toEqual([
        {
          method: 'RedisLockService.executeWithLock',
          parameter: 'task',
          parameterIndex: 1,
          hops: 0,
          flow: [
            {
              method: 'RedisLockService.executeWithLock',
              parameterIndex: 1,
              relation: 'invoked_in_proven_section',
            },
          ],
          evidenceRoles: [
            'redlock_terminal',
            'callback_argument',
            'callback_parameter',
            'callback_invocation',
          ],
        },
        {
          method: 'RedisLockService.executeWithNttLock',
          parameter: 'task',
          parameterIndex: 1,
          hops: 1,
          flow: [
            {
              method: 'RedisLockService.executeWithNttLock',
              parameterIndex: 1,
              relation: 'forwarded_unchanged',
            },
            {
              method: 'RedisLockService.executeWithLock',
              parameterIndex: 1,
              relation: 'invoked_in_proven_section',
            },
          ],
          evidenceRoles: [
            'callback_parameter',
            'parameter_forwarding',
            'redlock_terminal',
            'callback_argument',
            'callback_parameter',
            'callback_invocation',
          ],
        },
      ]);
      expect(verified.extraction.wrapperFlowIssues).toEqual([]);
      expect(
        verified.extraction.wrapperCallSiteProjections.map((projection) => ({
          source: projection.sourceMethod.qualifiedName,
          target: projection.targetMethod.qualifiedName,
          callbackArgumentIndex: projection.callbackArgumentIndex,
          terminals: projection.flowSummaries.map(({ terminalCall }) =>
            terminalCall
              .getSourceFile()
              .text.slice(terminalCall.expression.getStart(), terminalCall.expression.getEnd()),
          ),
        })),
      ).toEqual([
        {
          source: 'TicketService.forceResolveTicket',
          target: 'RedisLockService.executeWithLock',
          callbackArgumentIndex: 1,
          terminals: ['this.redlock.using'],
        },
        {
          source: 'TicketService.resolveTicket',
          target: 'RedisLockService.executeWithNttLock',
          callbackArgumentIndex: 1,
          terminals: ['this.redlock.using'],
        },
      ]);

      expect(projectedFlows(unsupported.extraction)).toEqual([
        {
          method: 'UnsupportedLockWrappers.executeWithLock',
          parameter: 'task',
          parameterIndex: 1,
          hops: 0,
          flow: [
            {
              method: 'UnsupportedLockWrappers.executeWithLock',
              parameterIndex: 1,
              relation: 'invoked_in_proven_section',
            },
          ],
          evidenceRoles: [
            'redlock_terminal',
            'callback_argument',
            'callback_parameter',
            'callback_invocation',
          ],
        },
      ]);
      expect(
        unsupported.extraction.callbackParameterFlowSummaries.some(({ method }) =>
          [
            'UnsupportedLockWrappers.transformsCallback',
            'UnsupportedLockWrappers.spreadsArguments',
            'UnsupportedLockWrappers.cycleOne',
            'UnsupportedLockWrappers.cycleTwo',
          ].includes(method.qualifiedName),
        ),
      ).toBe(false);
      expect(
        unsupported.extraction.wrapperCallSiteProjections.map((projection) => ({
          source: projection.sourceMethod.qualifiedName,
          target: projection.targetMethod.qualifiedName,
        })),
      ).toEqual([
        {
          source: 'UnsupportedLockWrappers.transformsCallback',
          target: 'UnsupportedLockWrappers.executeWithLock',
        },
      ]);
      expect(
        unsupported.extraction.wrapperCallSiteProjections.some(({ sourceMethod }) =>
          sourceMethod.qualifiedName.startsWith('UnsupportedCaller.'),
        ),
      ).toBe(false);
    } finally {
      await Promise.all([verifiedProject.cleanup(), unsupportedProject.cleanup()]);
    }
  }, 30_000);

  it('uses a deterministic fixed point and stops at hop, cycle, and state limits', async () => {
    const project = await createTestTypeScriptProject();
    try {
      const source = [
        "import { Injectable } from '@nestjs/common';",
        "import Redlock from 'redlock';",
        '@Injectable()',
        'class BoundedWrappers {',
        '  constructor(private readonly redlock: Redlock) {}',
        '  terminal<T>(key: string, task: () => Promise<T>): Promise<T> {',
        '    return this.redlock.using([key], 100, async () => task());',
        '  }',
        '  one<T>(key: string, task: () => Promise<T>): Promise<T> {',
        '    return this.terminal(key, task);',
        '  }',
        '  two<T>(key: string, task: () => Promise<T>): Promise<T> {',
        '    return this.one(key, task);',
        '  }',
        '  three<T>(key: string, task: () => Promise<T>): Promise<T> {',
        '    return this.two(key, task);',
        '  }',
        '  four<T>(key: string, task: () => Promise<T>): Promise<T> {',
        '    return this.three(key, task);',
        '  }',
        '  cycleA<T>(key: string, task: () => Promise<T>): Promise<T> {',
        '    return this.cycleB(key, task);',
        '  }',
        '  cycleB<T>(key: string, task: () => Promise<T>): Promise<T> {',
        '    if (key.length > 0) return this.cycleA(key, task);',
        '    return this.terminal(key, task);',
        '  }',
        '}',
      ].join('\n');
      const loaded = await loadExtraction(project, source);
      const direct = loaded.extraction.directCallbackParameterSummaries;
      expect([...new Set(loaded.extraction.diagnostics.map(({ code }) => code))]).toEqual(
        expect.arrayContaining([
          'CRITICAL_SECTION_WRAPPER_CYCLE_TRUNCATED',
          'CRITICAL_SECTION_WRAPPER_LIMIT_REACHED',
        ]),
      );

      const bounded = propagateCriticalSectionCallbackParameters({
        sourceIndex: loaded.sourceIndex,
        checker: loaded.checker,
        directSummaries: direct,
        maxForwardingHops: 2,
      });
      expect(
        bounded.summaries.map(({ method, forwardingHopCount }) => [
          method.qualifiedName,
          forwardingHopCount,
        ]),
      ).toEqual([
        ['BoundedWrappers.terminal', 0],
        ['BoundedWrappers.one', 1],
        ['BoundedWrappers.two', 2],
        ['BoundedWrappers.cycleA', 2],
        ['BoundedWrappers.cycleB', 1],
      ]);
      expect(bounded.summaries.some(({ method }) => method.qualifiedName.endsWith('.three'))).toBe(
        false,
      );
      expect(new Set(bounded.issues.map(({ kind }) => kind))).toEqual(
        new Set(['cycle', 'hop_limit']),
      );
      expect(bounded.state).toBe('bounded');

      const repeated = propagateCriticalSectionCallbackParameters({
        sourceIndex: loaded.sourceIndex,
        checker: loaded.checker,
        directSummaries: direct,
        maxForwardingHops: 2,
      });
      expect(projectedFlowIdentity(repeated)).toEqual(projectedFlowIdentity(bounded));

      const stateLimited = propagateCriticalSectionCallbackParameters({
        sourceIndex: loaded.sourceIndex,
        checker: loaded.checker,
        directSummaries: direct,
        maxFlowStates: 1,
      });
      expect(stateLimited.summaries).toHaveLength(1);
      expect(stateLimited.issues.map(({ kind }) => kind)).toContain('state_limit');
      expect(stateLimited.state).toBe('bounded');
    } finally {
      await project.cleanup();
    }
  }, 20_000);
});

function projectedFlowIdentity(input: {
  readonly summaries: ReturnType<
    typeof extractRedlockCriticalSections
  >['callbackParameterFlowSummaries'];
  readonly issues: ReturnType<typeof extractRedlockCriticalSections>['wrapperFlowIssues'];
}) {
  return {
    summaries: input.summaries.map((summary) => ({
      method: summary.method.qualifiedName,
      parameterIndex: summary.callbackParameterIndex,
      hops: summary.forwardingHopCount,
      flow: summary.flow.map((step) => `${step.method.qualifiedName}:${step.relation}`),
    })),
    issues: input.issues.map((issue) => ({
      kind: issue.kind,
      method: issue.method.qualifiedName,
      parameterIndex: issue.callbackParameterIndex,
      callStart: issue.call.getStart(),
    })),
  };
}
