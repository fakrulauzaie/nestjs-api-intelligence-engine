import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JobQueueBranchContract } from '../../../src/model/job-queue-branches.js';
import { jobQueueBranchSelectorKey } from '../../../src/model/job-queue-branches.js';
import {
  createStableId,
  makeJobQueueHandlerBranchEffectId,
  makeJobQueueHandlerBranchId,
  makeJobQueueHandlerDispatchId,
} from '../../../src/model/ids.js';
import { jobQueueBranchContractSchema } from '../../../src/model/schemas.js';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import type { BullMqBranchGateManifest } from '../../helpers/bullmq-branch-gate-manifest.js';
import {
  BULLMQ_BRANCH_GATE_MUST_NOT_INFER,
  parseBullMqBranchGateManifest,
  serializeBullMqBranchGateManifest,
} from '../../helpers/bullmq-branch-gate-manifest.js';
import {
  DISTRIBUTED_STUB_VERSIONS,
  writeFakeBullMq,
  writeFakeNestCommon,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

const fixtureRoot = resolve('test/fixtures/phase39/bullmq');
const manifestPath = join(fixtureRoot, 'gate.expected.json');
const fixtureNames = ['if-safe.ts.txt', 'switch-safe.ts.txt', 'unsupported.ts.txt'] as const;

async function readManifest(): Promise<{
  readonly manifest: BullMqBranchGateManifest;
  readonly text: string;
}> {
  const text = await readFile(manifestPath, 'utf8');
  return { manifest: parseBullMqBranchGateManifest(JSON.parse(text) as unknown), text };
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function representCaseAsContract(
  entry: BullMqBranchGateManifest['cases'][number],
): JobQueueBranchContract {
  const handlerId = createStableId('interaction_handler', [entry.caseId]);
  const dispatchEvidenceId = createStableId('evidence', [entry.caseId, 'dispatch']);
  const dispatchId = makeJobQueueHandlerDispatchId({
    handlerId,
    discriminantEvidenceId: dispatchEvidenceId,
    ruleId: 'queue.bullmq.dispatch.contract.v1',
  });
  const branches = entry.expectedBranches.map((expected, branchIndex) => {
    const evidenceId = createStableId('evidence', [entry.caseId, 'branch', branchIndex]);
    return {
      id: makeJobQueueHandlerBranchId({
        dispatchId,
        selectorKey: jobQueueBranchSelectorKey(expected.selector),
        controlFlow: expected.controlFlow,
        branchEvidenceId: evidenceId,
        ruleId: 'queue.bullmq.dispatch.branch-contract.v1',
      }),
      dispatchId,
      selector: expected.selector,
      controlFlow: expected.controlFlow,
      ruleId: 'queue.bullmq.dispatch.branch-contract.v1',
      evidenceIds: [evidenceId],
    } as const;
  });
  const effects = entry.expectedBranches.flatMap((expected, branchIndex) =>
    expected.effects.map((effect, effectIndex) => {
      const branch = branches[branchIndex]!;
      const targetId = createStableId(
        effect.kind === 'calls_method'
          ? 'method'
          : effect.kind === 'initiates_interaction'
            ? 'interaction'
            : 'table',
        [entry.caseId, effect.target],
      );
      const sourceAssertionId = createStableId('assertion', [
        entry.caseId,
        branchIndex,
        effectIndex,
      ]);
      const evidenceId = createStableId('evidence', [
        entry.caseId,
        'effect',
        branchIndex,
        effectIndex,
      ]);
      return {
        id: makeJobQueueHandlerBranchEffectId({
          branchId: branch.id,
          kind: effect.kind,
          targetId,
          sourceAssertionId,
          effectEvidenceId: evidenceId,
          ruleId: 'queue.bullmq.dispatch.branch-effect-contract.v1',
        }),
        branchId: branch.id,
        kind: effect.kind,
        targetId,
        sourceAssertionId,
        status: 'resolved' as const,
        ruleId: 'queue.bullmq.dispatch.branch-effect-contract.v1',
        evidenceIds: [evidenceId],
      };
    }),
  );
  return {
    dispatches: [
      {
        id: dispatchId,
        handlerId,
        state: entry.dispatchState,
        branchIds: branches.map(({ id }) => id),
        ruleId: 'queue.bullmq.dispatch.contract.v1',
        evidenceIds: [dispatchEvidenceId],
      },
    ],
    branches,
    effects,
  };
}

describe('Phase 39 BullMQ branch Gate B0', () => {
  it('freezes a canonical, review-approved corpus whose cases fit the branch contract', async () => {
    const { manifest, text } = await readManifest();
    expect(JSON.parse(text) as unknown).toEqual(manifest);
    expect(
      parseBullMqBranchGateManifest(
        JSON.parse(serializeBullMqBranchGateManifest(manifest)) as unknown,
      ),
    ).toEqual(manifest);
    expect(manifest.schemaDecision).toEqual({
      currentAnalysisVersion: '3.0.0',
      targetAnalysisVersion: '4.0.0',
      v3Frozen: true,
      phase39PublishesBranchFacts: false,
    });
    expect(manifest.review).toMatchObject({
      semanticStatus: 'approved',
      extractorImplementationPresent: false,
      phaseRecommendation: 'eligible_after_b0',
    });
    expect(new Set(manifest.cases.map(({ caseId }) => caseId)).size).toBe(manifest.cases.length);
    expect(new Set(manifest.cases.map(({ classification }) => classification))).toEqual(
      new Set(['positive', 'partial', 'unsupported']),
    );

    const cases = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
    for (const entry of manifest.cases) {
      expect(jobQueueBranchContractSchema.safeParse(representCaseAsContract(entry))).toMatchObject({
        success: true,
      });
      for (const counterpartCaseId of entry.counterpartCaseIds) {
        expect(cases.has(counterpartCaseId), `${entry.caseId} -> ${counterpartCaseId}`).toBe(true);
      }
      if (entry.classification === 'positive') {
        expect(
          entry.counterpartCaseIds.some(
            (counterpartCaseId) =>
              cases.get(counterpartCaseId)?.classification !== entry.classification,
          ),
          `${entry.caseId} requires a partial or unsupported counterpart`,
        ).toBe(true);
      }
      if (entry.dispatchState !== 'complete') {
        expect(
          entry.expectedBranches
            .filter(({ selector }) => selector.kind === 'unknown')
            .flatMap(({ effects }) => effects).length,
          `${entry.caseId} must retain effects in its unknown residual`,
        ).toBeGreaterThan(0);
      }
    }

    expect(new Set(manifest.globalMustNotInfer)).toEqual(
      new Set(BULLMQ_BRANCH_GATE_MUST_NOT_INFER),
    );
  });

  it.each(fixtureNames)(
    'type-checks frozen fixture %s without importing or executing it',
    async (fixtureName) => {
      const project = await createTestTypeScriptProject();
      try {
        await Promise.all([
          writeFakeNestCommon(project, DISTRIBUTED_STUB_VERSIONS.nest),
          writeFakeBullMq(project),
        ]);
        const source = await readFile(join(fixtureRoot, fixtureName), 'utf8');
        expect(source).toMatch(/B0 BullMQ fixture must never execute/u);
        const { manifest } = await readManifest();
        for (const packageContract of manifest.compatibilityTarget.packages) {
          const packageJson = JSON.parse(
            await readFile(
              join(project.path, 'node_modules', packageContract.name, 'package.json'),
              'utf8',
            ),
          ) as { readonly name?: string; readonly version?: string };
          expect(packageJson).toMatchObject(packageContract);
        }
        await project.write('src/fixture.ts', source);
        await writeBasicTsconfig(project);

        const inventory = await inventoryRepository({
          repositoryRoot: project.path,
          repositoryRevision: null,
        });
        const loaded = await loadTypeScriptProject({
          repositoryRoot: project.path,
          inventory,
        });
        expect(loaded.diagnostics).toEqual([]);

        const cases = manifest.cases.filter(({ fixture }) => fixture === fixtureName);
        expect(cases.length).toBeGreaterThan(0);
        for (const entry of cases) {
          for (const marker of entry.sourceMarkers) {
            expect(countOccurrences(source, marker), `${fixtureName}: ${marker}`).toBe(1);
          }
        }
      } finally {
        await project.cleanup();
      }
    },
  );

  it('accounts for every frozen source file and forbids executable imports', async () => {
    const { manifest } = await readManifest();
    const actualFixtures = (await readdir(fixtureRoot))
      .filter((name) => name.endsWith('.ts.txt'))
      .sort();
    expect([...new Set(manifest.cases.map(({ fixture }) => fixture))].sort()).toEqual(
      actualFixtures,
    );

    const importPattern = /(?:from\s+|import\s*\(|require\s*\()[^;\n]*\.ts\.txt/gu;
    for (const root of [resolve('src'), resolve('test')]) {
      const pending = [root];
      while (pending.length > 0) {
        const directory = pending.pop()!;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) pending.push(path);
          else if (entry.isFile() && entry.name.endsWith('.ts')) {
            expect(await readFile(path, 'utf8'), path).not.toMatch(importPattern);
          }
        }
      }
    }
  });
});
