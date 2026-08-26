import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { analyzePotentialImpact } from '../../src/impact/analyze.js';
import { serializeImpactDocument } from '../../src/impact/ordering.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { normalizePolicyConfiguration } from '../../src/policy/config.js';
import { evaluatePolicies } from '../../src/policy/evaluate.js';
import { serializePolicyResults } from '../../src/policy/ordering.js';
import { createImpactAnalysisSnapshot } from '../helpers/impact-analysis.js';
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

describe('Phase 25 graph baseline shortcut', () => {
  it('renders byte-identical policy and impact output without publishing impact.json', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const before = createImpactAnalysisSnapshot('before');
      const after = createImpactAnalysisSnapshot('after');
      const impact = analyzePotentialImpact(before, after);
      const policy = evaluatePolicies({
        analysis: after,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: { 'no-repository-access-in-controller': 'warn' },
        }),
      });
      const beforePath = await files.write(
        'before/analysis.json',
        serializeCanonicalAnalysis(before),
      );
      const afterPath = await files.write('after/analysis.json', serializeCanonicalAnalysis(after));
      const impactPath = await files.write('impact/impact.json', serializeImpactDocument(impact));
      const policyPath = await files.write(
        'policy/policy-results.json',
        serializePolicyResults(policy),
      );
      const baselineOutput = join(files.path, 'baseline-graph');
      const impactOutput = join(files.path, 'impact-graph');
      const shortOutput = join(files.path, 'short-baseline-graph');

      expect(
        await runCli(
          [
            'graph',
            afterPath,
            '--baseline',
            beforePath,
            '--policy-results',
            policyPath,
            '--output',
            baselineOutput,
          ],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(
        await runCli(
          [
            'graph',
            afterPath,
            '--impact-results',
            impactPath,
            '--policy-results',
            policyPath,
            '--output',
            impactOutput,
          ],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(
        await runCli(
          ['graph', afterPath, '-b', beforePath, '-p', policyPath, '-o', shortOutput],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.success);

      const baselineHtml = await readFile(join(baselineOutput, 'api-intel-graph.html'), 'utf8');
      expect(await readFile(join(impactOutput, 'api-intel-graph.html'), 'utf8')).toBe(baselineHtml);
      expect(await readFile(join(shortOutput, 'api-intel-graph.html'), 'utf8')).toBe(baselineHtml);
      expect(baselineHtml).toContain('"side": "after"');
      expect(baselineHtml).toContain('"state": "supplied"');
      await expect(access(join(baselineOutput, 'impact.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await files.cleanup();
    }
  });

  it('rejects conflicting and invalid baseline inputs with stable exit categories', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const afterPath = await files.write(
        'after.json',
        serializeCanonicalAnalysis(createImpactAnalysisSnapshot('after')),
      );
      const conflict = captureIo();
      expect(
        await runCli(
          [
            'graph',
            'missing-current.json',
            '--baseline',
            'missing-before.json',
            '--impact-results',
            'missing-impact.json',
          ],
          conflict.io,
        ),
      ).toBe(EXIT_CODE.usageError);
      expect(conflict.stderr.join('\n')).toContain(
        '--baseline and --impact-results cannot be used together.',
      );

      const invalidBaseline = await files.write('invalid-before.json', '{"bad":true}');
      expect(
        await runCli(['graph', afterPath, '--baseline', invalidBaseline], captureIo().io),
      ).toBe(EXIT_CODE.invalidAnalysis);

      for (const resultState of ['failed', 'canceled'] as const) {
        const unusableBaseline = await files.write(
          `${resultState}-before.json`,
          serializeCanonicalAnalysis({
            ...createImpactAnalysisSnapshot('before'),
            resultState,
          }),
        );
        const captured = captureIo();
        expect(
          await runCli(['graph', afterPath, '--baseline', unusableBaseline], captured.io),
        ).toBe(EXIT_CODE.analysisFailure);
        expect(captured.stderr.join('\n')).toContain(
          `Cannot compare an analysis in state ${resultState}.`,
        );
      }
    } finally {
      await files.cleanup();
    }
  });

  it('preserves an existing graph when baseline processing is canceled or cannot derive impact', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const before = createImpactAnalysisSnapshot('before');
      const afterPath = await files.write(
        'after.json',
        serializeCanonicalAnalysis(createImpactAnalysisSnapshot('after')),
      );
      const beforePath = await files.write('before.json', serializeCanonicalAnalysis(before));
      const failedPath = await files.write(
        'failed.json',
        serializeCanonicalAnalysis({ ...before, resultState: 'failed' }),
      );
      const output = join(files.path, 'existing');
      const existing = await files.write('existing/api-intel-graph.html', 'previous graph report');
      const controller = new AbortController();
      controller.abort(new Error('Canceled by test.'));

      expect(
        await runCli(
          ['graph', afterPath, '--baseline', beforePath, '--output', output],
          captureIo(controller.signal).io,
        ),
      ).toBe(EXIT_CODE.canceled);
      expect(await readFile(existing, 'utf8')).toBe('previous graph report');

      expect(
        await runCli(
          ['graph', afterPath, '--baseline', failedPath, '--output', output],
          captureIo().io,
        ),
      ).toBe(EXIT_CODE.analysisFailure);
      expect(await readFile(existing, 'utf8')).toBe('previous graph report');
    } finally {
      await files.cleanup();
    }
  });
});
