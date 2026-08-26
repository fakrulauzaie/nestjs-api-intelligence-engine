import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { createDiagnostic } from '../../src/diagnostics/catalogue.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { createMinimalAnalysisDocument } from '../helpers/minimal-analysis.js';
import { createTestTypeScriptProject } from '../helpers/typescript-project.js';

function captureIo(signal?: AbortSignal): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      ...(signal === undefined ? {} : { signal }),
      writeOut(message) {
        stdout.push(message);
      },
      writeError(message) {
        stderr.push(message);
      },
    },
  };
}

describe('Phase 9 report workflow', () => {
  it('regenerates byte-identical Markdown from partial canonical JSON only', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const minimal = createMinimalAnalysisDocument();
      const limitation = createDiagnostic({
        code: 'AUTH_GLOBAL_POLICY_UNKNOWN',
        message: 'Global authentication policy is unknown.',
      });
      const analysis = {
        ...minimal,
        resultState: 'completed_with_gaps' as const,
        diagnostics: [limitation],
      };
      const analysisPath = await files.write(
        'canonical files/analysis.json',
        serializeCanonicalAnalysis(analysis),
      );
      const originalAnalysis = await readFile(analysisPath, 'utf8');
      const outputDirectory = join(files.path, 'generated reports with spaces');
      const first = captureIo();

      expect(await runCli(['report', analysisPath, '--output', outputDirectory], first.io)).toBe(
        EXIT_CODE.success,
      );
      expect(first.stderr).toEqual([]);
      expect(first.stdout.join('\n')).toContain('Result: completed_with_gaps');
      const endpointsPath = join(outputDirectory, 'endpoints.md');
      const traceDirectory = join(outputDirectory, 'traces');
      const traceFiles = await readdir(traceDirectory);
      expect(traceFiles).toHaveLength(1);
      expect(traceFiles[0]).toMatch(/^get-health-[a-f0-9]{10}\.md$/u);
      const firstEndpoints = await readFile(endpointsPath, 'utf8');
      const firstTrace = await readFile(join(traceDirectory, traceFiles[0]!), 'utf8');
      expect(firstEndpoints).toContain('completed_with_gaps');
      expect(firstTrace).toContain('`AUTH_GLOBAL_POLICY_UNKNOWN`');
      expect(firstTrace).toContain('decorator src/health.controller.ts:3:3');
      expect(await readFile(analysisPath, 'utf8')).toBe(originalAnalysis);

      await rm(endpointsPath);
      await rm(join(traceDirectory, traceFiles[0]!));
      const second = captureIo();
      expect(await runCli(['report', analysisPath, '--output', outputDirectory], second.io)).toBe(
        EXIT_CODE.success,
      );
      expect(await readFile(endpointsPath, 'utf8')).toBe(firstEndpoints);
      expect(await readFile(join(traceDirectory, traceFiles[0]!), 'utf8')).toBe(firstTrace);
      expect(await readFile(analysisPath, 'utf8')).toBe(originalAnalysis);

      const filtered = captureIo();
      expect(await runCli(['endpoints', analysisPath, '--route', '/missing/'], filtered.io)).toBe(
        EXIT_CODE.success,
      );
      expect(filtered.stdout.join('\n')).toContain('Endpoints: 0 of 1');
      expect(filtered.stdout.join('\n')).toContain('route=`/missing`');
    } finally {
      await files.cleanup();
    }
  });

  it('reports corrupt, failed, missing, and canceled inputs distinctly', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const corruptPath = await files.write('bad files/corrupt.json', '{not-json');
      const corrupt = captureIo();
      expect(await runCli(['report', corruptPath], corrupt.io)).toBe(EXIT_CODE.invalidAnalysis);
      expect(corrupt.stderr.join('\n')).toContain('Invalid JSON in analysis file');

      const invalidPath = await files.write('bad files/invalid.json', '{}');
      const invalid = captureIo();
      expect(await runCli(['endpoints', invalidPath], invalid.io)).toBe(EXIT_CODE.invalidAnalysis);
      expect(invalid.stderr.join('\n')).toContain('Invalid canonical analysis');

      const failedPath = await files.write(
        'bad files/failed.json',
        serializeCanonicalAnalysis({
          ...createMinimalAnalysisDocument(),
          resultState: 'failed',
        }),
      );
      const failed = captureIo();
      expect(await runCli(['report', failedPath], failed.io)).toBe(EXIT_CODE.analysisFailure);
      expect(failed.stderr.join('\n')).toContain('state failed');

      const controller = new AbortController();
      controller.abort();
      const canceled = captureIo(controller.signal);
      expect(await runCli(['report', failedPath], canceled.io)).toBe(EXIT_CODE.canceled);
      expect(canceled.stderr.join('\n')).toContain('Operation canceled');
    } finally {
      await files.cleanup();
    }
  });
});
