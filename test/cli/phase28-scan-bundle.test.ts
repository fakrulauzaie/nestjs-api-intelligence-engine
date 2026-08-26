import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EXIT_CODE } from '../../src/cli/errors.js';
import { runCli } from '../../src/cli/index.js';
import type { CliIo } from '../../src/cli/types.js';
import type { scanRepository as ScanRepository } from '../../src/analysis/scan-repository.js';
import { assertValidBundleManifest } from '../../src/output/artifact-plan.js';
import {
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

const scanCounter = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../src/analysis/scan-repository.js', async (importOriginal) => {
  const original = await importOriginal<{ scanRepository: typeof ScanRepository }>();
  return {
    ...original,
    async scanRepository(input: Parameters<typeof original.scanRepository>[0]) {
      scanCounter.calls += 1;
      return original.scanRepository(input);
    },
  };
});

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeOut(message) {
        stdout.push(message);
      },
      writeError(message) {
        stderr.push(message);
      },
    },
  };
}

async function prepareRepository(withDirectRepository = false) {
  const project = await createTestTypeScriptProject();
  await writeFakeNestCommon(project);
  if (withDirectRepository) {
    await writeFakeNestTypeOrm(project);
    await writeFakeTypeOrm(project);
  }
  await project.write(
    'src/status.controller.ts',
    withDirectRepository
      ? [
          "import { Controller, Get } from '@nestjs/common';",
          "import { InjectRepository } from '@nestjs/typeorm';",
          "import { Entity, PrimaryGeneratedColumn, Repository } from 'typeorm';",
          "@Entity('status')",
          'export class Status { @PrimaryGeneratedColumn() id!: number; }',
          "@Controller('status')",
          'export class StatusController {',
          '  constructor(@InjectRepository(Status) private readonly statuses: Repository<Status>) {}',
          '  @Get() list() { return this.statuses.find(); }',
          '}',
        ].join('\n')
      : [
          "import { Controller, Get } from '@nestjs/common';",
          "@Controller('status')",
          "export class StatusController { @Get() check() { return 'ok'; } }",
        ].join('\n'),
  );
  await writeBasicTsconfig(project);
  return project;
}

function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: { title: 'Status', version: '1' },
    paths: { '/status': { get: { summary: 'Status operation' } } },
  };
}

describe('Phase 28 selected scan bundles', () => {
  it('publishes CLI-selected reporters once with standalone-equivalent bytes and an immutable input', async () => {
    const project = await prepareRepository();
    const standalone = await createTestTypeScriptProject();
    try {
      const openApiText = `${JSON.stringify(openApiDocument(), null, 2)}\n`;
      const openApiPath = await project.write('openapi.json', openApiText);
      const output = join(project.path, 'bundle output');
      const io = captureIo();
      const callsBeforeScan = scanCounter.calls;
      expect(
        await runCli(
          [
            'scan',
            project.path,
            '--no-config',
            '--with-graph',
            '--with-controls',
            '--with-openapi',
            openApiPath,
            '--output',
            output,
          ],
          io.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(scanCounter.calls).toBe(callsBeforeScan + 1);
      expect(await readFile(openApiPath, 'utf8')).toBe(openApiText);

      const manifest = assertValidBundleManifest(
        JSON.parse(await readFile(join(output, 'bundle.json'), 'utf8')) as unknown,
      );
      expect(manifest.completionState).toBe('complete');
      expect(manifest.requestedReporters).toEqual([
        'analysis',
        'controls',
        'graph',
        'markdown',
        'openapi',
      ]);
      expect(manifest.inputSnapshots.map(({ kind }) => kind)).toEqual(['analysis', 'openapi']);
      expect(manifest.artifacts.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          'analysis.json',
          'run.json',
          'api-intel-graph.html',
          'control-evidence.json',
          'control-evidence.csv',
          'openapi.enriched.json',
          'openapi-enrichment.json',
        ]),
      );
      const analysisPath = join(output, 'analysis.json');
      expect(
        await runCli(['graph', analysisPath, '--output', standalone.path], captureIo().io),
      ).toBe(EXIT_CODE.success);
      expect(
        await runCli(['controls', analysisPath, '--output', standalone.path], captureIo().io),
      ).toBe(EXIT_CODE.success);
      expect(
        await runCli(
          ['openapi', analysisPath, '--document', openApiPath, '--output', standalone.path],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
      for (const fileName of [
        'api-intel-graph.html',
        'control-evidence.json',
        'control-evidence.csv',
        'openapi.enriched.json',
        'openapi-enrichment.json',
      ]) {
        expect(await readFile(join(output, fileName), 'utf8')).toBe(
          await readFile(join(standalone.path, fileName), 'utf8'),
        );
      }
      expect(io.stdout.join('\n')).toContain(`Bundle: ${join(output, 'bundle.json')}`);
    } finally {
      await project.cleanup();
      await standalone.cleanup();
    }
  }, 30_000);

  it('uses explicit config recipes, shares one policy result with overlays, and exits after publishing blocking findings', async () => {
    const project = await prepareRepository(true);
    try {
      const openApiPath = await project.writeJson('contract/openapi.json', openApiDocument());
      await project.writeJson('api-intel.config.json', {
        version: 2,
        rules: { 'no-repository-access-in-controller': 'error' },
        reports: {
          policy: { enabled: true },
          graph: { enabled: true, maxNodesPerEndpoint: 30, maxEdgesPerEndpoint: 40 },
          controls: { enabled: true },
          openapi: { enabled: true, document: 'contract/openapi.json', includeEvidence: true },
        },
      });
      const output = join(project.path, '.api-intel');
      const io = captureIo();
      expect(await runCli(['scan', project.path], io.io)).toBe(EXIT_CODE.policyViolation);
      expect(JSON.parse(await readFile(join(output, 'policy-results.json'), 'utf8'))).toMatchObject(
        {
          summary: { failed: 1, blocking: 1 },
        },
      );
      expect(
        JSON.parse(await readFile(join(output, 'control-evidence.json'), 'utf8')),
      ).toMatchObject({
        policy: { state: 'supplied' },
      });
      expect(await readFile(join(output, 'api-intel-graph.html'), 'utf8')).toContain(
        'no-repository-access-in-controller',
      );
      expect(
        assertValidBundleManifest(
          JSON.parse(await readFile(join(output, 'bundle.json'), 'utf8')) as unknown,
        ).requestedReporters,
      ).toEqual(['analysis', 'controls', 'graph', 'markdown', 'openapi', 'policy']);
      expect(await readFile(openApiPath, 'utf8')).not.toContain('x-api-intel');
      expect(io.stdout.join('\n')).toContain('Blocking findings: 1');

      await project.writeJson('api-intel.config.json', {
        version: 2,
        rules: { 'no-repository-access-in-controller': 'warn' },
        reports: {
          policy: { enabled: true },
          graph: { enabled: true },
          controls: { enabled: true },
        },
      });
      const warningOutput = join(project.path, 'warning bundle');
      expect(await runCli(['scan', project.path, '--output', warningOutput], captureIo().io)).toBe(
        EXIT_CODE.success,
      );
      expect(
        JSON.parse(await readFile(join(warningOutput, 'policy-results.json'), 'utf8')),
      ).toMatchObject({ summary: { failed: 1, warnings: 1, blocking: 0 } });
      await expect(access(join(warningOutput, 'bundle.json'))).resolves.toBeUndefined();
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('rejects ambiguous convenience switches and incomplete recipes before publication', async () => {
    const project = await prepareRepository();
    try {
      expect(await runCli(['scan', project.path, '--all'], captureIo().io)).toBe(
        EXIT_CODE.usageError,
      );
      await project.writeJson('api-intel.config.json', {
        version: 2,
        reports: { policy: { enabled: true } },
      });
      expect(await runCli(['scan', project.path], captureIo().io)).toBe(
        EXIT_CODE.invalidConfiguration,
      );
      await project.writeJson('api-intel.config.json', {
        version: 2,
        reports: { openapi: { enabled: true } },
      });
      expect(await runCli(['scan', project.path], captureIo().io)).toBe(
        EXIT_CODE.invalidConfiguration,
      );
      await expect(access(join(project.path, '.api-intel', 'bundle.json'))).rejects.toThrow();
    } finally {
      await project.cleanup();
    }
  });

  it('rejects a source/output collision without changing a prior complete bundle', async () => {
    const project = await prepareRepository();
    try {
      const output = join(project.path, 'collision');
      const sourcePath = await project.writeJson(
        'collision/openapi.enriched.json',
        openApiDocument(),
      );
      const previousAnalysis = await project.write(
        'collision/analysis.json',
        'previous analysis\n',
      );
      const previousBundle = await project.write('collision/bundle.json', 'previous bundle\n');
      const sourceText = await readFile(sourcePath, 'utf8');
      const io = captureIo();
      expect(
        await runCli(
          ['scan', project.path, '--no-config', '--with-openapi', sourcePath, '--output', output],
          io.io,
        ),
      ).toBe(EXIT_CODE.usageError);
      expect(io.stderr.join('\n')).toContain('collides');
      expect(await readFile(sourcePath, 'utf8')).toBe(sourceText);
      expect(await readFile(previousAnalysis, 'utf8')).toBe('previous analysis\n');
      expect(await readFile(previousBundle, 'utf8')).toBe('previous bundle\n');
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
