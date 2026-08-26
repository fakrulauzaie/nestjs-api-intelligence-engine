import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { writeFakeNestCommon } from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

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

describe('Phase 4 CLI workflow', () => {
  it('scans to a separate output directory and renders endpoints from canonical JSON only', async () => {
    const project = await createTestTypeScriptProject();
    const output = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await project.write(
        'src/health.controller.ts',
        [
          "import { Controller, Get } from '@nestjs/common';",
          "@Controller('health')",
          'export class HealthController {',
          '  @Get() check(): string { return "ok"; }',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);
      const outputDirectory = join(output.path, 'generated output');
      const firstIo = captureIo();

      expect(
        await runCli(
          [
            'scan',
            project.path,
            '--tsconfig',
            'tsconfig.json',
            '--output',
            outputDirectory,
            '--max-call-depth',
            '2',
          ],
          firstIo.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(firstIo.stderr).toEqual([]);
      expect(firstIo.stdout.join('\n')).toContain('Analyzed 1 endpoint(s)');
      const analysisPath = join(outputDirectory, 'analysis.json');
      const firstAnalysis = await readFile(analysisPath, 'utf8');
      const parsedAnalysis = JSON.parse(firstAnalysis) as {
        endpoints: unknown[];
        analysisRun: { configuration: { maxCallDepth: number } };
      };
      expect(parsedAnalysis.endpoints).toHaveLength(1);
      expect(parsedAnalysis.analysisRun.configuration.maxCallDepth).toBe(2);
      const run = JSON.parse(await readFile(join(outputDirectory, 'run.json'), 'utf8')) as {
        repositoryPath: string;
        resultState: string;
        startedAt: string;
        endedAt: string;
        durationMs: number;
        configuration: { maxCallDepth: number };
        tool: { name: string; version: string; typescriptVersion: string };
        diagnostics: { code: string }[];
      };
      expect(run).toMatchObject({
        repositoryPath: project.path,
        resultState: 'completed_with_gaps',
        configuration: { maxCallDepth: 2 },
        tool: { name: 'api-intel' },
      });
      expect(Date.parse(run.startedAt)).not.toBeNaN();
      expect(Date.parse(run.endedAt)).not.toBeNaN();
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
      expect(run.tool.version.length).toBeGreaterThan(0);
      expect(run.tool.typescriptVersion.length).toBeGreaterThan(0);
      expect(run.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'AUTH_GLOBAL_POLICY_UNKNOWN',
      );
      const generatedMarkdown = await readFile(join(outputDirectory, 'endpoints.md'), 'utf8');
      expect(generatedMarkdown).toContain('HealthController.check');
      const traceFiles = await readdir(join(outputDirectory, 'traces'));
      expect(traceFiles).toHaveLength(1);
      await output.write('generated output/unrelated-user-file.txt', 'preserve me');

      const secondIo = captureIo();
      expect(
        await runCli(
          [
            'scan',
            project.path,
            '--output',
            outputDirectory,
            '--max-call-depth',
            '2',
            '--route',
            '/missing/',
          ],
          secondIo.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(await readFile(analysisPath, 'utf8')).toBe(firstAnalysis);
      expect(await readFile(join(outputDirectory, 'endpoints.md'), 'utf8')).toContain(
        'Endpoints: 0 of 1',
      );
      expect(await readdir(join(outputDirectory, 'traces'))).toEqual([]);
      await expect(
        readFile(join(outputDirectory, 'unrelated-user-file.txt'), 'utf8'),
      ).resolves.toBe('preserve me');

      await project.cleanup();
      const reportIo = captureIo();
      expect(await runCli(['report', analysisPath], reportIo.io)).toBe(EXIT_CODE.success);
      expect(await readFile(join(outputDirectory, 'endpoints.md'), 'utf8')).toBe(generatedMarkdown);
      const endpointsIo = captureIo();
      expect(await runCli(['endpoints', analysisPath], endpointsIo.io)).toBe(EXIT_CODE.success);
      expect(endpointsIo.stderr).toEqual([]);
      expect(endpointsIo.stdout.join('\n')).toContain(
        '| GET | `/health` | HealthController.check |',
      );
      expect(`${endpointsIo.stdout.join('\n')}\n`).toBe(generatedMarkdown);
    } finally {
      await project.cleanup();
      await output.cleanup();
    }
  }, 20_000);
});
