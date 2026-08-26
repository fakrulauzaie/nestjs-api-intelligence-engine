import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { assertValidDiffDocument } from '../../src/comparison/validate.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { createComparisonAnalysisSnapshot } from '../helpers/comparison-analysis.js';
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

describe('Phase 13 diff CLI', () => {
  it('publishes deterministic JSON or Markdown from two explicit analysis files', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const beforeContents = serializeCanonicalAnalysis(createComparisonAnalysisSnapshot('before'));
      const afterContents = serializeCanonicalAnalysis(createComparisonAnalysisSnapshot('after'));
      const beforePath = await files.write('snapshots/before analysis.json', beforeContents);
      const afterPath = await files.write('snapshots/after analysis.json', afterContents);
      const jsonOutput = join(files.path, 'json output');
      const first = captureIo();

      expect(
        await runCli(
          ['diff', beforePath, afterPath, '--output', jsonOutput, '--format', 'json'],
          first.io,
        ),
      ).toBe(EXIT_CODE.success);
      expect(first.stderr).toEqual([]);
      expect(first.stdout.join('\n')).toContain('Endpoints: 2 added, 2 removed, 2 modified.');
      expect(first.stdout.join('\n')).toContain('Ambiguities: 0.');
      const firstJson = await readFile(join(jsonOutput, 'diff.json'), 'utf8');
      expect(assertValidDiffDocument(JSON.parse(firstJson) as unknown).summary).toMatchObject({
        endpointsAdded: 2,
        endpointsRemoved: 2,
        endpointsModified: 2,
      });

      const second = captureIo();
      expect(await runCli(['diff', beforePath, afterPath], second.io)).toBe(EXIT_CODE.success);
      expect(await readFile(join(files.path, 'snapshots', 'diff.json'), 'utf8')).toBe(firstJson);

      const markdownOutput = join(files.path, 'markdown output');
      const markdown = captureIo();
      expect(
        await runCli(
          ['diff', beforePath, afterPath, '--format', 'markdown', '-o', markdownOutput],
          markdown.io,
        ),
      ).toBe(EXIT_CODE.success);
      const markdownContents = await readFile(join(markdownOutput, 'diff.md'), 'utf8');
      expect(markdownContents).toContain('# API Intelligence Diff');
      expect(markdownContents).toContain('NotesController.list');
      expect(markdownContents).toContain('NotesController.findAll');
      expect(markdownContents).toContain('WRITE note (ambiguous)');
      expect(markdownContents).toContain('WRITE note (resolved)');
      expect(await readFile(beforePath, 'utf8')).toBe(beforeContents);
      expect(await readFile(afterPath, 'utf8')).toBe(afterContents);
    } finally {
      await files.cleanup();
    }
  });

  it('separates usage, invalid input, failed analysis, changes, and cancellation', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const beforePath = await files.write(
        'before.json',
        serializeCanonicalAnalysis(createComparisonAnalysisSnapshot('before')),
      );
      const afterPath = await files.write(
        'after.json',
        serializeCanonicalAnalysis(createComparisonAnalysisSnapshot('after')),
      );

      const missing = captureIo();
      expect(await runCli(['diff', beforePath], missing.io)).toBe(EXIT_CODE.usageError);
      expect(missing.stderr.join('\n')).toContain('requires exactly two analysis files');

      const badFormat = captureIo();
      expect(await runCli(['diff', beforePath, afterPath, '--format', 'html'], badFormat.io)).toBe(
        EXIT_CODE.usageError,
      );
      expect(badFormat.stderr.join('\n')).toContain('Diff format must be one of');

      const corruptPath = await files.write('corrupt.json', '{bad-json');
      const corrupt = captureIo();
      expect(await runCli(['diff', corruptPath, afterPath], corrupt.io)).toBe(
        EXIT_CODE.invalidAnalysis,
      );

      const failedPath = await files.write(
        'failed.json',
        serializeCanonicalAnalysis({
          ...createComparisonAnalysisSnapshot('before'),
          resultState: 'failed',
        }),
      );
      const failed = captureIo();
      expect(await runCli(['diff', failedPath, afterPath], failed.io)).toBe(
        EXIT_CODE.analysisFailure,
      );
      expect(failed.stderr.join('\n')).toContain('state failed');

      const controller = new AbortController();
      controller.abort();
      const canceled = captureIo(controller.signal);
      expect(await runCli(['diff', beforePath, afterPath], canceled.io)).toBe(EXIT_CODE.canceled);
      expect(canceled.stderr.join('\n')).toContain('Operation canceled');
    } finally {
      await files.cleanup();
    }
  });
});
