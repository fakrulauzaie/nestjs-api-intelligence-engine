import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import type {
  DISTRIBUTED_GATE_MUST_NOT_INFER,
  DistributedGateManifest,
} from '../../helpers/distributed-gate-manifest.js';
import {
  parseDistributedGateManifest,
  serializeDistributedGateManifest,
} from '../../helpers/distributed-gate-manifest.js';
import {
  DISTRIBUTED_STUB_VERSIONS,
  writeFakeBullMq,
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestMicroservices,
  writeFakeNestTypeOrm,
  writeFakeRxjs,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  type TestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

const fixtureRoot = resolve('test/fixtures/distributed');
const manifestPaths = [
  join(fixtureRoot, 'bullmq', 'gate.expected.json'),
  join(fixtureRoot, 'nest-microservices', 'gate.expected.json'),
] as const;

const fixtureMatrix = [
  ['bullmq', 'branch-filtering.ts.txt'],
  ['bullmq', 'colocated.ts.txt'],
  ['bullmq', 'consumer-only.ts.txt'],
  ['bullmq', 'negatives.ts.txt'],
  ['bullmq', 'producer-only.ts.txt'],
  ['nest_microservices', 'activation.ts.txt'],
  ['nest_microservices', 'colocated.ts.txt'],
  ['nest_microservices', 'consumer-only.ts.txt'],
  ['nest_microservices', 'negatives.ts.txt'],
  ['nest_microservices', 'patterns.ts.txt'],
  ['nest_microservices', 'producer-only.ts.txt'],
  ['nest_microservices', 'transports.ts.txt'],
] as const;

async function readManifest(path: string): Promise<{
  readonly manifest: DistributedGateManifest;
  readonly text: string;
}> {
  const text = await readFile(path, 'utf8');
  return { manifest: parseDistributedGateManifest(JSON.parse(text) as unknown), text };
}

async function writeDistributedStubs(
  project: TestTypeScriptProject,
  technology: (typeof fixtureMatrix)[number][0],
): Promise<void> {
  const base = [
    writeFakeNestCommon(project, DISTRIBUTED_STUB_VERSIONS.nest),
    writeFakeNestCore(project, DISTRIBUTED_STUB_VERSIONS.nest),
    writeFakeNestTypeOrm(project),
    writeFakeTypeOrm(project),
  ];
  if (technology === 'bullmq') {
    await Promise.all([...base, writeFakeBullMq(project)]);
    return;
  }
  await Promise.all([
    ...base,
    writeFakeRxjs(project, DISTRIBUTED_STUB_VERSIONS.rxjs),
    writeFakeNestMicroservices(project),
  ]);
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

async function sourceFilesBelow(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFilesBelow(path)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('Distributed Gate D0 frozen corpus', () => {
  it('validates canonical manifests, topology coverage, close negatives, and review gates', async () => {
    const loaded = await Promise.all(manifestPaths.map(readManifest));
    for (const { manifest, text } of loaded) {
      expect(text).toBe(serializeDistributedGateManifest(manifest));
      expect(new Set(manifest.cases.map(({ caseId }) => caseId)).size).toBe(manifest.cases.length);
      expect(new Set(manifest.requiredTopologies)).toEqual(
        new Set(['colocated', 'producer_only', 'consumer_only']),
      );
      expect(manifest.review).toMatchObject({
        semanticStatus: 'approved',
        valueStatus: 'approved',
        extractorImplementationPresent: false,
        phaseRecommendation: 'eligible_after_d0',
      });
      expect(manifest.review.estimatedPhaseHours.maximum).toBeGreaterThanOrEqual(
        manifest.review.estimatedPhaseHours.minimum,
      );

      const cases = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
      for (const entry of manifest.cases) {
        for (const counterpartId of entry.counterpartCaseIds) {
          expect(cases.has(counterpartId), `${entry.caseId} -> ${counterpartId}`).toBe(true);
        }
        if (entry.classification === 'positive') {
          expect(
            entry.counterpartCaseIds.some(
              (counterpartId) => cases.get(counterpartId)?.classification !== 'positive',
            ),
            `${entry.caseId} requires a close negative or unsupported counterpart`,
          ).toBe(true);
        }
      }
    }

    const allNonInferenceRules = new Set(
      loaded.flatMap(({ manifest }) => manifest.globalMustNotInfer),
    );
    for (const required of [
      'broker_delivery_guaranteed',
      'missing_consumer_as_failure',
      'branch_write_overattribution',
      'transport_equivalence',
    ] as const satisfies readonly (typeof DISTRIBUTED_GATE_MUST_NOT_INFER)[number][]) {
      expect(allNonInferenceRules.has(required), required).toBe(true);
    }

    expect(
      loaded
        .flatMap(({ manifest }) => manifest.cases)
        .some(({ expectation }) => expectation.activation === 'constructed_cold'),
    ).toBe(true);
    expect(
      loaded
        .flatMap(({ manifest }) => manifest.cases)
        .some(({ expectation }) => expectation.activation === 'proven_activated'),
    ).toBe(true);
  });

  it.each(fixtureMatrix)(
    'type-checks the isolated %s fixture %s without importing or executing it',
    async (technology, fixtureName) => {
      const project = await createTestTypeScriptProject();
      try {
        await writeDistributedStubs(project, technology);
        const directoryName = technology === 'bullmq' ? 'bullmq' : 'nest-microservices';
        const source = await readFile(join(fixtureRoot, directoryName, fixtureName), 'utf8');
        expect(source).toMatch(/D0 .* fixture must never execute/u);
        const { manifest } = await readManifest(manifestPaths[technology === 'bullmq' ? 0 : 1]);
        for (const packageContract of manifest.compatibilityTarget.packages) {
          const packageJson = JSON.parse(
            await readFile(
              join(project.path, 'node_modules', packageContract.name, 'package.json'),
              'utf8',
            ),
          ) as { readonly name?: string; readonly version?: string };
          expect(packageJson).toMatchObject({
            name: packageContract.name,
            version: packageContract.version,
          });
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
    30_000,
  );

  it('accounts for every fixture and prohibits executable imports of frozen source text', async () => {
    const loaded = await Promise.all(manifestPaths.map(readManifest));
    for (const { manifest } of loaded) {
      const directoryName = manifest.technology === 'bullmq' ? 'bullmq' : 'nest-microservices';
      const actualFixtures = (await readdir(join(fixtureRoot, directoryName)))
        .filter((name) => name.endsWith('.ts.txt'))
        .sort();
      const declaredFixtures = [...new Set(manifest.cases.map(({ fixture }) => fixture))].sort();
      expect(declaredFixtures).toEqual(actualFixtures);
    }

    const importPattern = /(?:from\s+|import\s*\(|require\s*\()[^;\n]*\.ts\.txt/gu;
    for (const path of [
      ...(await sourceFilesBelow(resolve('src'))),
      ...(await sourceFilesBelow(resolve('test'))),
    ]) {
      expect(await readFile(path, 'utf8'), path).not.toMatch(importPattern);
    }
  });
});
