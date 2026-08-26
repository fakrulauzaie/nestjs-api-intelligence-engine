import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CODE } from '../../src/cli/errors.js';
import { runCli } from '../../src/cli/index.js';
import type { CliIo } from '../../src/cli/types.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { assertValidPolicyResultsDocument } from '../../src/policy/validate.js';
import { createComparisonAnalysisSnapshot } from '../helpers/comparison-analysis.js';
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

describe('Phase 16 check CLI', () => {
  it('publishes JSON/Markdown and reserves a policy-violation exit code', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const baselinePath = await files.write(
        'baseline.json',
        serializeCanonicalAnalysis(createComparisonAnalysisSnapshot('before')),
      );
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createComparisonAnalysisSnapshot('after')),
      );
      const configPath = await files.write(
        'api-intel.config.json',
        JSON.stringify({
          version: 1,
          rules: {
            'no-new-diagnostics': ['error', { minimumSeverity: 'warning' }],
          },
        }),
      );
      const jsonOutput = join(files.path, 'json');
      const jsonIo = captureIo();
      expect(
        await runCli(
          [
            'check',
            analysisPath,
            '--baseline',
            baselinePath,
            '--config',
            configPath,
            '--output',
            jsonOutput,
          ],
          jsonIo.io,
        ),
      ).toBe(EXIT_CODE.policyViolation);
      const json = await readFile(join(jsonOutput, 'policy-results.json'), 'utf8');
      const results = assertValidPolicyResultsDocument(JSON.parse(json) as unknown);
      expect(results.summary).toMatchObject({ failed: 1, blocking: 1 });
      expect(jsonIo.stdout.join('\n')).toContain('Blocking findings: 1');

      const warningConfig = await files.write(
        'warning.config.json',
        JSON.stringify({
          version: 1,
          rules: {
            'no-new-diagnostics': ['warn', { minimumSeverity: 'warning' }],
          },
        }),
      );
      const markdownOutput = join(files.path, 'markdown');
      const markdownIo = captureIo();
      expect(
        await runCli(
          [
            'check',
            analysisPath,
            '-b',
            baselinePath,
            '-c',
            warningConfig,
            '--format',
            'markdown',
            '-o',
            markdownOutput,
          ],
          markdownIo.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(await readFile(join(markdownOutput, 'policy-results.md'), 'utf8')).toContain(
        'new_diagnostics_found',
      );
    } finally {
      await files.cleanup();
    }
  });

  it('validates config before analysis and separates usage/input errors', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createMinimalAnalysisDocument()),
      );
      const corruptAnalysis = await files.write('corrupt-analysis.json', '{no');
      const invalidConfig = await files.write(
        'invalid-config.json',
        JSON.stringify({ version: 1, rules: { invented: 'error' } }),
      );
      const invalid = captureIo();
      expect(await runCli(['check', corruptAnalysis, '--config', invalidConfig], invalid.io)).toBe(
        EXIT_CODE.invalidConfiguration,
      );
      expect(invalid.stderr.join('\n')).toContain('Invalid policy configuration');

      const missing = captureIo();
      expect(await runCli(['check', analysisPath], missing.io)).toBe(EXIT_CODE.usageError);
      expect(missing.stderr.join('\n')).toContain('requires --config');

      const validConfig = await files.write(
        'valid-config.json',
        JSON.stringify({
          version: 1,
          rules: { 'no-repository-access-in-controller': 'error' },
        }),
      );
      const corrupt = captureIo();
      expect(await runCli(['check', corruptAnalysis, '--config', validConfig], corrupt.io)).toBe(
        EXIT_CODE.invalidAnalysis,
      );
    } finally {
      await files.cleanup();
    }
  });
});
