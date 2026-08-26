import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { assertValidImpactDocument } from '../../src/impact/validate.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { createImpactAnalysisSnapshot } from '../helpers/impact-analysis.js';
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

describe('Phase 14 impact CLI', () => {
  it('publishes deterministic JSON and endpoint-grouped Markdown', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const beforePath = await files.write(
        'snapshots/before.json',
        serializeCanonicalAnalysis(createImpactAnalysisSnapshot('before')),
      );
      const afterPath = await files.write(
        'snapshots/after.json',
        serializeCanonicalAnalysis(createImpactAnalysisSnapshot('after')),
      );
      const jsonOutput = join(files.path, 'json');
      const jsonIo = captureIo();

      expect(
        await runCli(['impact', beforePath, afterPath, '--output', jsonOutput], jsonIo.io),
      ).toBe(EXIT_CODE.success);
      expect(jsonIo.stderr).toEqual([]);
      expect(jsonIo.stdout.join('\n')).toContain('0 direct, 2 transitive');
      const json = await readFile(join(jsonOutput, 'impact.json'), 'utf8');
      const impact = assertValidImpactDocument(JSON.parse(json) as unknown);
      expect(impact.summary.impactedEndpointSlots).toBe(2);
      expect(impact.summary.unreachableSourceChanges).toBe(1);

      const markdownOutput = join(files.path, 'markdown');
      const markdownIo = captureIo();
      expect(
        await runCli(
          ['impact', beforePath, afterPath, '--format', 'markdown', '-o', markdownOutput],
          markdownIo.io,
        ),
      ).toBe(EXIT_CODE.success);
      const markdown = await readFile(join(markdownOutput, 'impact.md'), 'utf8');
      expect(markdown).toContain('# API Intelligence Potential Impact');
      expect(markdown).toContain('### GET /first');
      expect(markdown).toContain('reachable_method_file_change');
      expect(markdown).toContain('src/unused.service.ts');
    } finally {
      await files.cleanup();
    }
  });

  it('uses established usage and input error classes', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const beforePath = await files.write(
        'before.json',
        serializeCanonicalAnalysis(createImpactAnalysisSnapshot('before')),
      );
      const afterPath = await files.write(
        'after.json',
        serializeCanonicalAnalysis(createImpactAnalysisSnapshot('after')),
      );
      const missing = captureIo();
      expect(await runCli(['impact', beforePath], missing.io)).toBe(EXIT_CODE.usageError);
      expect(missing.stderr.join('\n')).toContain('requires exactly two analysis files');

      const format = captureIo();
      expect(await runCli(['impact', beforePath, afterPath, '--format', 'html'], format.io)).toBe(
        EXIT_CODE.usageError,
      );
      expect(format.stderr.join('\n')).toContain('Impact format must be one of');

      const corruptPath = await files.write('corrupt.json', '{no');
      const corrupt = captureIo();
      expect(await runCli(['impact', corruptPath, afterPath], corrupt.io)).toBe(
        EXIT_CODE.invalidAnalysis,
      );
    } finally {
      await files.cleanup();
    }
  });
});
