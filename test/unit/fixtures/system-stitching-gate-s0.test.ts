import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventoryRepository } from '../../../src/scanner/inventory.js';
import { loadTypeScriptProject } from '../../../src/ts-index/program.js';
import {
  SYSTEM_CORRELATION_STATES,
  type SystemCorrelationState,
} from '../../../src/system-analysis/model.js';
import {
  parseSystemStitchingGateManifest,
  serializeSystemStitchingGateManifest,
  SYSTEM_STITCHING_GATE_TECHNOLOGIES,
  SYSTEM_STITCHING_GATE_TOPOLOGIES,
} from '../../helpers/system-stitching-gate-manifest.js';
import {
  writeFakeBullMq,
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestMicroservices,
  writeFakeRxjs,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

const fixtureRoot = resolve('test/fixtures/system-stitching');
const manifestPath = join(fixtureRoot, 'gate.expected.json');

async function loadManifest() {
  const text = await readFile(manifestPath, 'utf8');
  return { text, manifest: parseSystemStitchingGateManifest(JSON.parse(text) as unknown) };
}

describe('Phase 45 System Stitching Gate S0', () => {
  it('freezes both technologies, every topology, every state, and the real RMQ pair', async () => {
    const { manifest, text } = await loadManifest();
    expect(JSON.parse(text)).toEqual(manifest);
    const canonical = serializeSystemStitchingGateManifest(manifest);
    expect(
      serializeSystemStitchingGateManifest(
        parseSystemStitchingGateManifest(JSON.parse(canonical) as unknown),
      ),
    ).toBe(canonical);
    expect(new Set(manifest.cases.map(({ caseId }) => caseId)).size).toBe(manifest.cases.length);
    expect(new Set(manifest.requiredTechnologies)).toEqual(
      new Set(SYSTEM_STITCHING_GATE_TECHNOLOGIES),
    );
    expect(new Set(manifest.requiredTopologies)).toEqual(new Set(SYSTEM_STITCHING_GATE_TOPOLOGIES));
    expect(new Set(manifest.cases.map(({ expected }) => expected.state))).toEqual(
      new Set<SystemCorrelationState>(SYSTEM_CORRELATION_STATES),
    );

    for (const technology of SYSTEM_STITCHING_GATE_TECHNOLOGIES) {
      const cases = manifest.cases.filter((entry) => entry.technology === technology);
      expect(new Set(cases.map(({ topology }) => topology))).toEqual(
        new Set(SYSTEM_STITCHING_GATE_TOPOLOGIES),
      );
    }

    expect(manifest.realWorldBasis).toEqual({
      producerService: 'ticket-service-example',
      consumerService: 'ctt-queue-service-example',
      transport: 'rmq',
      queue: 'intt_ctt_queue',
      pattern: 'tmf-update-ctt-list',
      producerToken: 'MESSAGE_QUEUE_SERVICE',
      producerApis: ['ClientProxy.emit', 'ClientProxy.send'],
      producerSourceFiles: [
        'src/modules/ctt/ctt.service.ts',
        'src/modules/ntt/ntt.service.ts',
        'src/modules/ntt/ntt.module.ts',
      ],
      consumerDecorator: 'MessagePattern',
      consumerSourceFiles: ['src/main.ts', 'src/modules/ctt/ctt.controller.ts'],
    });
  });

  it('enforces Gate S0 for collision and missing-topology cases', async () => {
    const { manifest } = await loadManifest();
    for (const entry of manifest.cases.filter(({ topology }) =>
      ['collision', 'missing_topology'].includes(topology),
    )) {
      expect(entry.expected.state).not.toBe('declared_realm_candidate');
      expect(entry.expected.provenCrossServiceEdge).toBe(false);
      expect(entry.mustNotInfer).toContain('pattern_equality_proves_realm');
    }
    expect(manifest.globalMustNotInfer).toContain('target_only_candidate_as_edge');
    expect(manifest.globalMustNotInfer).toContain('cross_service_causal_path');
  });

  it('type-checks every frozen source slice without importing or executing it', async () => {
    const { manifest } = await loadManifest();
    const fixtures = [
      ...new Set(manifest.cases.flatMap(({ sources }) => sources.map(({ fixture }) => fixture))),
    ].sort();
    const actual = (
      await Promise.all(
        ['bullmq', 'microservices'].map(async (directory) =>
          (await readdir(join(fixtureRoot, directory)))
            .filter((name) => name.endsWith('.ts.txt'))
            .map((name) => `${directory}/${name}`),
        ),
      )
    )
      .flat()
      .sort();
    expect(fixtures).toEqual(actual);

    for (const fixture of fixtures) {
      const project = await createTestTypeScriptProject();
      try {
        await writeFakeNestCommon(project);
        if (fixture.startsWith('bullmq/')) {
          await writeFakeBullMq(project);
        } else {
          await Promise.all([
            writeFakeNestCore(project),
            writeFakeRxjs(project),
            writeFakeNestMicroservices(project),
          ]);
        }
        const source = await readFile(join(fixtureRoot, fixture), 'utf8');
        expect(source).toMatch(/S0 .* fixture must never execute/u);
        expect(source.match(/S0_SOURCE:/gu)).toHaveLength(1);
        await project.write('src/fixture.ts', source);
        await writeBasicTsconfig(project);
        const inventory = await inventoryRepository({
          repositoryRoot: project.path,
          repositoryRevision: null,
        });
        const loaded = await loadTypeScriptProject({ repositoryRoot: project.path, inventory });
        expect(loaded.diagnostics, fixture).toEqual([]);
      } finally {
        await project.cleanup();
      }
    }
  }, 30_000);

  it('keeps frozen source text non-executable from implementation and tests', async () => {
    const importPattern = /(?:from\s+|import\s*\(|require\s*\()[^;\n]*\.ts\.txt/gu;
    const sourceFiles = [
      ...(await readdir(resolve('src'), { recursive: true, withFileTypes: true })),
      ...(await readdir(resolve('test'), { recursive: true, withFileTypes: true })),
    ];
    for (const entry of sourceFiles) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const path = resolve(entry.parentPath, entry.name);
      expect(await readFile(path, 'utf8'), path).not.toMatch(importPattern);
    }
  });
});
