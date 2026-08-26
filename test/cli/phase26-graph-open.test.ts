import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { serializeCanonicalAnalysis } from '../../src/model/ordering.js';
import { createMinimalAnalysisDocument } from '../helpers/minimal-analysis.js';
import { createTestTypeScriptProject } from '../helpers/typescript-project.js';

function captureIo(
  input: {
    readonly signal?: AbortSignal | undefined;
    readonly openLocalArtifact?: CliIo['openLocalArtifact'] | undefined;
  } = {},
): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.openLocalArtifact === undefined
        ? {}
        : { openLocalArtifact: input.openLocalArtifact }),
      writeOut(message) {
        stdout.push(message);
      },
      writeError(message) {
        stderr.push(message);
      },
    },
  };
}

describe('Phase 26 graph local preview', () => {
  it('opens the exact committed artifact for both --open and -O', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createMinimalAnalysisDocument()),
      );
      const opened: string[] = [];
      const io = captureIo({
        openLocalArtifact: async (path) => {
          expect(isAbsolute(path)).toBe(true);
          expect(await readFile(path, 'utf8')).toContain('API Intel offline graph report');
          opened.push(path);
        },
      });

      for (const [flag, directory] of [
        ['--open', 'long option'],
        ['-O', 'short option'],
      ] as const) {
        expect(
          await runCli(
            ['graph', analysisPath, flag, '--output', join(files.path, directory)],
            io.io,
          ),
        ).toBe(EXIT_CODE.success);
      }

      expect(opened).toEqual([
        join(files.path, 'long option', 'api-intel-graph.html'),
        join(files.path, 'short option', 'api-intel-graph.html'),
      ]);
      expect(io.stdout.filter((line) => line.includes('Opened graph report'))).toHaveLength(2);
      expect(io.stderr).toEqual([]);
    } finally {
      await files.cleanup();
    }
  });

  it('keeps launcher absence and failure non-fatal after publication', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createMinimalAnalysisDocument()),
      );

      for (const [directory, io] of [
        ['missing-capability', captureIo()],
        [
          'missing-launcher',
          captureIo({
            openLocalArtifact: async () => {
              throw Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' });
            },
          }),
        ],
      ] as const) {
        const output = join(files.path, directory);
        const path = join(output, 'api-intel-graph.html');
        expect(await runCli(['graph', analysisPath, '--open', '--output', output], io.io)).toBe(
          EXIT_CODE.success,
        );
        expect(await readFile(path, 'utf8')).toContain('API Intel offline graph report');
        expect(io.stderr.join('\n')).toContain(`graph report was published at ${path}`);
      }
    } finally {
      await files.cleanup();
    }
  });

  it('never launches before publication and preserves a published graph on preview cancellation', async () => {
    const files = await createTestTypeScriptProject();
    try {
      const analysisPath = await files.write(
        'analysis.json',
        serializeCanonicalAnalysis(createMinimalAnalysisDocument()),
      );
      const blockedOutput = await files.write('blocked-output', 'not a directory');
      const launchBeforePublication = vi.fn(async () => undefined);
      expect(
        await runCli(
          ['graph', analysisPath, '--open', '--output', blockedOutput],
          captureIo({ openLocalArtifact: launchBeforePublication }).io,
        ),
      ).toBe(EXIT_CODE.internalError);
      expect(launchBeforePublication).not.toHaveBeenCalled();
      expect(await readFile(blockedOutput, 'utf8')).toBe('not a directory');

      const controller = new AbortController();
      const canceled = captureIo({
        signal: controller.signal,
        openLocalArtifact: async (_path, signal) => {
          controller.abort(new Error('Preview canceled by test.'));
          signal?.throwIfAborted();
        },
      });
      const output = join(files.path, 'canceled preview');
      const path = join(output, 'api-intel-graph.html');
      expect(await runCli(['graph', analysisPath, '-O', '--output', output], canceled.io)).toBe(
        EXIT_CODE.success,
      );
      expect(await readFile(path, 'utf8')).toContain('API Intel offline graph report');
      expect(canceled.stderr.join('\n')).toContain('Preview canceled by test.');
    } finally {
      await files.cleanup();
    }
  });
});
