import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { endpointTraceViewSchema } from '../../src/model/schemas.js';
import { createMinimalAnalysisDocument } from '../helpers/minimal-analysis.js';
import { createTestTypeScriptProject } from '../helpers/typescript-project.js';

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

describe('Phase 7 trace CLI', () => {
  it('loads canonical JSON only and distinguishes success, misses, and failed analyses', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const minimal = createMinimalAnalysisDocument();
      const analysisPath = await files.write(
        'analysis files/analysis.json',
        serializeCanonicalAnalysis(minimal),
      );
      const success = captureIo();
      expect(
        await runCli(['trace', analysisPath, '--method', 'get', '--path', '//health/'], success.io),
      ).toBe(EXIT_CODE.success);
      expect(success.stderr).toEqual([]);
      expect(endpointTraceViewSchema.safeParse(JSON.parse(success.stdout.join('\n'))).success).toBe(
        true,
      );

      const missing = captureIo();
      expect(
        await runCli(['trace', analysisPath, '--method', 'GET', '--path', '/missing'], missing.io),
      ).toBe(EXIT_CODE.endpointNotFound);
      expect(missing.stdout).toEqual([]);
      expect(missing.stderr.join('\n')).toContain('Endpoint not found: GET /missing');

      const failedPath = await files.write(
        'analysis files/failed.json',
        serializeCanonicalAnalysis({ ...minimal, resultState: 'failed' }),
      );
      const failed = captureIo();
      expect(
        await runCli(['trace', failedPath, '--method', 'GET', '--path', '/health'], failed.io),
      ).toBe(EXIT_CODE.analysisFailure);
      expect(failed.stdout).toEqual([]);
      expect(failed.stderr.join('\n')).toContain('state failed');
    } finally {
      await files.cleanup();
    }
  });
});
