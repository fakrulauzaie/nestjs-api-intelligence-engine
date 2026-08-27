import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { writeFakeNestCommon } from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

function captureIo(openLocalArtifact?: CliIo['openLocalArtifact']): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      ...(openLocalArtifact === undefined ? {} : { openLocalArtifact }),
      writeOut(message) {
        stdout.push(message);
      },
      writeError(message) {
        stderr.push(message);
      },
    },
  };
}

async function prepareRepository(): Promise<
  Awaited<ReturnType<typeof createTestTypeScriptProject>>
> {
  const project = await createTestTypeScriptProject();
  await writeFakeNestCommon(project);
  await project.write(
    'src/status.controller.ts',
    [
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller('status')",
      'export class StatusController {',
      "  @Get() check() { return 'ok'; }",
      '}',
    ].join('\n'),
  );
  await writeBasicTsconfig(project);
  return project;
}

describe('Phase 27 scan project configuration', () => {
  it('records v3 interaction traversal limits with the current extractor capabilities', async () => {
    const project = await prepareRepository();
    try {
      await project.writeJson('api-intel.config.json', {
        version: 3,
        analysis: {
          interactions: {
            maxInteractionHops: 4,
            maxFanOutPerInteraction: 75,
            maxInteractionTraceStates: 2_500,
          },
        },
        output: { directory: 'v3 output' },
      });
      expect(await runCli(['scan', project.path], captureIo().io)).toBe(EXIT_CODE.success);
      const output = join(project.path, 'v3 output');
      const analysis = JSON.parse(await readFile(join(output, 'analysis.json'), 'utf8')) as {
        schemaVersion: string;
        analysisRun: { configuration: { interactions: Record<string, number> } };
        interactionAnalysis: {
          supportedKinds: string[];
          enabledKinds: string[];
          state: string;
        };
      };
      expect(analysis).toMatchObject({
        schemaVersion: '3.0.0',
        analysisRun: {
          configuration: {
            interactions: {
              maxInteractionHops: 4,
              maxFanOutPerInteraction: 75,
              maxInteractionTraceStates: 2_500,
            },
          },
        },
        interactionAnalysis: {
          supportedKinds: [
            'in_process_event',
            'job_queue',
            'microservice_message',
            'outbound_http',
          ],
          enabledKinds: ['in_process_event', 'job_queue', 'microservice_message', 'outbound_http'],
          state: 'complete',
        },
      });
      const run = JSON.parse(await readFile(join(output, 'run.json'), 'utf8')) as {
        projectConfiguration: Record<string, unknown>;
      };
      expect(run.projectConfiguration).toMatchObject({
        source: { fileVersion: 3 },
        analysis: {
          interactions: {
            maxInteractionHops: 4,
            maxFanOutPerInteraction: 75,
            maxInteractionTraceStates: 2_500,
          },
        },
      });
    } finally {
      await project.cleanup();
    }
  }, 20_000);

  it('discovers v2 defaults, records them, previews after publication, and matches standalone graph', async () => {
    const project = await prepareRepository();
    try {
      const configPath = await project.writeJson('api-intel.config.json', {
        $schema: 'https://example.invalid/not-fetched.json',
        version: 2,
        analysis: { maxCallDepth: 2, rawSqlDialect: 'postgresql-18' },
        output: { directory: 'configured output' },
        rules: { 'no-repository-access-in-controller': 'warn' },
        reports: {
          graph: { enabled: true, maxNodesPerEndpoint: 20, maxEdgesPerEndpoint: 30 },
        },
      });
      const output = join(project.path, 'configured output');
      const opened: string[] = [];
      const scanned = captureIo(async (path) => {
        expect(await readFile(path, 'utf8')).toContain('API Intel offline graph report');
        opened.push(path);
      });
      expect(await runCli(['scan', project.path, '--open'], scanned.io)).toBe(EXIT_CODE.success);

      const analysisPath = join(output, 'analysis.json');
      const analysisText = await readFile(analysisPath, 'utf8');
      const analysis = JSON.parse(analysisText) as {
        analysisRun: { configuration: { maxCallDepth: number; rawSql: { dialect: string } } };
      };
      expect(analysis.analysisRun.configuration).toMatchObject({
        maxCallDepth: 2,
        rawSql: { dialect: 'postgresql-18' },
      });
      const run = JSON.parse(await readFile(join(output, 'run.json'), 'utf8')) as {
        projectConfiguration: Record<string, unknown>;
      };
      expect(run.projectConfiguration).toMatchObject({
        source: { kind: 'discovered', path: configPath, fileVersion: 2 },
        analysis: { maxCallDepth: 2, rawSqlDialect: 'postgresql-18' },
        output: { directory: output },
        rules: [{ ruleId: 'no-repository-access-in-controller', severity: 'warn' }],
        reports: {
          graph: { enabled: true, maxNodesPerEndpoint: 20, maxEdgesPerEndpoint: 30 },
        },
      });
      const configuredGraph = join(output, 'api-intel-graph.html');
      expect(opened).toEqual([configuredGraph]);

      const standaloneOutput = join(project.path, 'standalone graph');
      expect(
        await runCli(
          [
            'graph',
            analysisPath,
            '--max-nodes',
            '20',
            '--max-edges',
            '30',
            '--output',
            standaloneOutput,
          ],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(await readFile(join(standaloneOutput, 'api-intel-graph.html'), 'utf8')).toBe(
        await readFile(configuredGraph, 'utf8'),
      );

      expect(
        await runCli(
          ['check', analysisPath, '--config', configPath, '--output', join(project.path, 'policy')],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('applies CLI precedence while presentation-only configuration leaves analysis unchanged', async () => {
    const project = await prepareRepository();
    const outputs = await createTestTypeScriptProject();
    try {
      await project.writeJson('api-intel.config.json', {
        version: 2,
        analysis: { maxCallDepth: 1 },
        output: { directory: 'configured-but-overridden' },
        rules: { 'require-complete-write-trace': 'warn' },
        reports: {
          graph: { enabled: true, maxNodesPerEndpoint: 20, maxEdgesPerEndpoint: 30 },
        },
      });
      const firstOutput = join(outputs.path, 'first outside output');
      const explicitFlags = [
        '--max-call-depth',
        '3',
        '--raw-sql-dialect',
        'postgresql-18',
        '--max-nodes',
        '25',
        '--max-edges',
        '35',
      ] as const;
      expect(
        await runCli(
          ['scan', project.path, ...explicitFlags, '--output', firstOutput],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
      const firstAnalysis = await readFile(join(firstOutput, 'analysis.json'), 'utf8');
      const firstRun = JSON.parse(await readFile(join(firstOutput, 'run.json'), 'utf8')) as {
        projectConfiguration: {
          analysis: { maxCallDepth: number; rawSqlDialect: string };
          output: { directory: string };
          reports: { graph: { maxNodesPerEndpoint: number; maxEdgesPerEndpoint: number } };
        };
      };
      expect(firstRun.projectConfiguration).toMatchObject({
        analysis: { maxCallDepth: 3, rawSqlDialect: 'postgresql-18' },
        output: { directory: firstOutput },
        reports: { graph: { maxNodesPerEndpoint: 25, maxEdgesPerEndpoint: 35 } },
      });

      await project.writeJson('api-intel.config.json', {
        version: 2,
        analysis: { maxCallDepth: 1 },
        output: { directory: 'different-presentation-output' },
        rules: { 'require-guard-on-write-endpoint': 'error' },
        reports: {
          graph: { enabled: true, maxNodesPerEndpoint: 45, maxEdgesPerEndpoint: 55 },
        },
      });
      const secondOutput = join(outputs.path, 'second outside output');
      expect(
        await runCli(
          ['scan', project.path, ...explicitFlags, '--output', secondOutput],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(await readFile(join(secondOutput, 'analysis.json'), 'utf8')).toBe(firstAnalysis);

      const explicitConfigPath = await outputs.writeJson(
        'explicit configuration/api-intel.config.json',
        {
          version: 2,
          analysis: { maxCallDepth: 2 },
          output: { directory: 'relative output' },
        },
      );
      const explicitOutput = join(outputs.path, 'explicit configuration', 'relative output');
      expect(
        await runCli(['scan', project.path, '--config', explicitConfigPath], captureIo().io),
      ).toBe(EXIT_CODE.success);
      const explicitRun = JSON.parse(await readFile(join(explicitOutput, 'run.json'), 'utf8')) as {
        projectConfiguration: {
          source: { kind: string; path: string; fileVersion: number };
          analysis: { maxCallDepth: number };
          output: { directory: string };
        };
      };
      expect(explicitRun.projectConfiguration).toMatchObject({
        source: { kind: 'explicit', path: explicitConfigPath, fileVersion: 2 },
        analysis: { maxCallDepth: 2 },
        output: { directory: explicitOutput },
      });

      const noConfigOutput = join(outputs.path, 'no config output');
      expect(
        await runCli(
          ['scan', project.path, '--no-config', '--with-graph', '--output', noConfigOutput],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
      const noConfigRun = JSON.parse(await readFile(join(noConfigOutput, 'run.json'), 'utf8')) as {
        projectConfiguration: {
          source: { kind: string };
          reports: { graph: { enabled: boolean } };
        };
      };
      expect(noConfigRun.projectConfiguration).toMatchObject({
        source: { kind: 'none' },
        reports: { graph: { enabled: true } },
      });
      await expect(access(join(noConfigOutput, 'api-intel-graph.html'))).resolves.toBeUndefined();

      const openWithoutGraph = captureIo();
      expect(
        await runCli(
          [
            'scan',
            project.path,
            '--no-config',
            '--open',
            '--output',
            join(outputs.path, 'must not scan'),
          ],
          openWithoutGraph.io,
        ),
      ).toBe(EXIT_CODE.usageError);
      expect(openWithoutGraph.stderr.join('\n')).toContain('require a graph report');

      const conflict = captureIo();
      expect(
        await runCli(
          ['scan', project.path, '--config', 'anything.json', '--no-config'],
          conflict.io,
        ),
      ).toBe(EXIT_CODE.usageError);
      expect(conflict.stderr.join('\n')).toContain('--config and --no-config');

      const invalidDialect = captureIo();
      expect(
        await runCli(['scan', project.path, '--raw-sql-dialect', 'mysql'], invalidDialect.io),
      ).toBe(EXIT_CODE.usageError);
      expect(invalidDialect.stderr.join('\n')).toContain('supports only postgresql-18');
    } finally {
      await project.cleanup();
      await outputs.cleanup();
    }
  }, 45_000);
});
