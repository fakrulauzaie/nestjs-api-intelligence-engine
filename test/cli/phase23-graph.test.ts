import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { normalizePolicyConfiguration } from '../../src/policy/config.js';
import { evaluatePolicies } from '../../src/policy/evaluate.js';
import { serializePolicyResults } from '../../src/policy/ordering.js';
import { createComparisonAnalysisSnapshot } from '../helpers/comparison-analysis.js';
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

describe('Phase 23 graph CLI', () => {
  it('publishes a deterministic self-contained report and validates display limits', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createMinimalAnalysisDocument()),
      );
      const output = join(files.path, 'offline');
      const io = captureIo();
      expect(
        await runCli(
          ['graph', analysisPath, '--max-nodes', '20', '--max-edges', '30', '--output', output],
          io.io,
        ),
      ).toBe(EXIT_CODE.success);
      const path = join(output, 'api-intel-graph.html');
      const first = await readFile(path, 'utf8');
      expect(first).toContain('API Intel offline graph report');
      expect(
        await runCli(
          ['graph', analysisPath, '--max-nodes', '20', '--max-edges', '30', '-o', output],
          io.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(await readFile(path, 'utf8')).toBe(first);
      expect(await runCli(['graph', analysisPath, '--max-nodes', '9'], io.io)).toBe(
        EXIT_CODE.usageError,
      );
    } finally {
      await files.cleanup();
    }
  });

  it('separates invalid and mismatched optional inputs and preserves prior output on cancellation', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createMinimalAnalysisDocument()),
      );
      const invalidPolicy = await files.write('invalid-policy.json', '{"bad":true}');
      expect(
        await runCli(['graph', analysisPath, '--policy-results', invalidPolicy], captureIo().io),
      ).toBe(EXIT_CODE.invalidStructuredInput);

      const otherAnalysis = createComparisonAnalysisSnapshot('before');
      const otherPolicy = evaluatePolicies({
        analysis: otherAnalysis,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: { 'no-repository-access-in-controller': 'warn' },
        }),
      });
      const mismatchPath = await files.write(
        'mismatch-policy.json',
        serializePolicyResults(otherPolicy),
      );
      expect(await runCli(['graph', analysisPath, '-p', mismatchPath], captureIo().io)).toBe(
        EXIT_CODE.analysisFailure,
      );

      const output = join(files.path, 'canceled');
      const existing = await files.write('canceled/api-intel-graph.html', 'previous report');
      const controller = new AbortController();
      controller.abort(new Error('Canceled by test.'));
      expect(
        await runCli(['graph', analysisPath, '--output', output], captureIo(controller.signal).io),
      ).toBe(EXIT_CODE.canceled);
      expect(await readFile(existing, 'utf8')).toBe('previous report');
    } finally {
      await files.cleanup();
    }
  });
});
