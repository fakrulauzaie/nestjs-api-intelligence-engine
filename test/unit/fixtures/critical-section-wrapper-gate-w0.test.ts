import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import {
  CRITICAL_SECTION_WRAPPER_MUST_NOT_INFER,
  parseCriticalSectionWrapperGateManifest,
  serializeCriticalSectionWrapperGateManifest,
} from '../../helpers/critical-section-wrapper-gate-manifest.js';
import {
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeRedlock,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

const fixtureRoot = resolve('test/fixtures/resources/critical-section-wrappers');
const manifestPath = join(fixtureRoot, 'gate.expected.json');

async function loadManifest() {
  const text = await readFile(manifestPath, 'utf8');
  return {
    text,
    manifest: parseCriticalSectionWrapperGateManifest(JSON.parse(text) as unknown),
  };
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

describe('Verified critical-section wrapper Gate CSW0', () => {
  it('freezes canonical positive, negative, evidence, compatibility, and honesty contracts', async () => {
    const { manifest, text } = await loadManifest();
    expect(JSON.parse(text) as unknown).toEqual(manifest);
    const canonical = serializeCriticalSectionWrapperGateManifest(manifest);
    expect(
      serializeCriticalSectionWrapperGateManifest(
        parseCriticalSectionWrapperGateManifest(JSON.parse(canonical) as unknown),
      ),
    ).toBe(canonical);

    expect(manifest.schemaDecision).toEqual({
      currentAnalysisVersion: '7.0.0',
      targetAnalysisVersion: '8.0.0',
      v7Frozen: true,
      phaseW0PublishesWrapperFacts: false,
    });
    expect(manifest.bounds).toEqual({
      maxForwardingHops: 3,
      unchangedPositionalParametersOnly: true,
      inlineCallSiteCallbacksOnly: true,
    });
    expect(new Set(manifest.requiredEvidenceRoles)).toEqual(
      new Set([
        'call_site',
        'callback_argument',
        'callback_parameter',
        'parameter_forwarding',
        'callback_invocation',
        'redlock_terminal',
      ]),
    );
    expect(new Set(manifest.globalMustNotInfer)).toEqual(
      new Set(CRITICAL_SECTION_WRAPPER_MUST_NOT_INFER),
    );
    expect(new Set(manifest.cases.map(({ caseId }) => caseId)).size).toBe(manifest.cases.length);
    expect(new Set(manifest.cases.map(({ classification }) => classification))).toEqual(
      new Set(['eligible', 'unsupported']),
    );

    const cases = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
    for (const entry of manifest.cases) {
      for (const counterpartCaseId of entry.counterpartCaseIds) {
        expect(cases.has(counterpartCaseId), `${entry.caseId} -> ${counterpartCaseId}`).toBe(true);
      }
      if (entry.classification === 'eligible') {
        expect(
          entry.counterpartCaseIds.some(
            (counterpartCaseId) => cases.get(counterpartCaseId)?.classification === 'unsupported',
          ),
          `${entry.caseId} requires an unsupported counterpart`,
        ).toBe(true);
        expect(entry.expectedFlow.at(-1)?.relation).toBe('invoked_in_proven_section');
      }
    }

    expect(manifest.realWorldBasis).toEqual({
      repository: 'ticket-service-example',
      callerSourceFile: 'src/modules/ntt/ntt.service.ts',
      wrapperSourceFile: 'src/modules/redis/redis-lock.service.ts',
      entryMethod: 'NttService.resolveTicket',
      wrapperChain: [
        'RedisLockService.executeWithNttLock',
        'RedisLockService.executeWithLock',
        'Redlock.using',
      ],
      callbackArgumentIndex: 1,
    });
    expect(manifest.review).toMatchObject({
      semanticStatus: 'approved',
      extractorImplementationPresent: false,
      nextPhase: 'W1',
    });
  });

  it('type-checks every frozen source fixture without importing or executing it', async () => {
    const { manifest } = await loadManifest();
    const fixtureNames = [...new Set(manifest.cases.map(({ fixture }) => fixture))].sort();
    const actualFixtureNames = (await readdir(fixtureRoot))
      .filter((name) => name.endsWith('.ts.txt'))
      .sort();
    expect(fixtureNames).toEqual(actualFixtureNames);

    for (const fixtureName of fixtureNames) {
      const project = await createTestTypeScriptProject();
      try {
        await Promise.all([
          writeFakeNestCommon(project),
          writeFakeNestTypeOrm(project),
          writeFakeTypeOrm(project),
          writeFakeRedlock(project),
        ]);
        const source = await readFile(join(fixtureRoot, fixtureName), 'utf8');
        expect(source).toMatch(/CSW0 .* wrapper fixture must never execute/u);
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
        expect(loaded.diagnostics, fixtureName).toEqual([]);

        for (const entry of manifest.cases.filter(({ fixture }) => fixture === fixtureName)) {
          for (const marker of entry.sourceMarkers) {
            expect(countOccurrences(source, marker), `${fixtureName}: ${marker}`).toBe(1);
          }
        }
      } finally {
        await project.cleanup();
      }
    }
  }, 30_000);

  it('keeps the frozen corpus outside executable source imports', async () => {
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
