import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { writeFakeNestCommon } from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

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

describe('Phase 9 scan options', () => {
  it('uses the default output, validates depth, filters only reports, and cancels safely', async () => {
    const project = await createTestTypeScriptProject();
    const canceledOutput = await createTestTypeScriptProject();
    try {
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

      const invalidDepth = captureIo();
      expect(await runCli(['scan', project.path, '--max-call-depth', '4'], invalidDepth.io)).toBe(
        EXIT_CODE.usageError,
      );
      expect(invalidDepth.stderr.join('\n')).toContain('integer from 1 to 3');

      const scanned = captureIo();
      expect(
        await runCli(
          ['scan', project.path, '--controller', 'StatusController', '--route', '//status/'],
          scanned.io,
        ),
      ).toBe(EXIT_CODE.success);
      const defaultOutput = join(project.path, '.api-intel');
      const analysis = JSON.parse(await readFile(join(defaultOutput, 'analysis.json'), 'utf8')) as {
        endpoints: unknown[];
      };
      expect(analysis.endpoints).toHaveLength(1);
      expect(await readFile(join(defaultOutput, 'endpoints.md'), 'utf8')).toContain(
        'Endpoints: 1 of 1',
      );
      expect(scanned.stdout.join('\n')).toContain('Result: completed_with_gaps');

      const controller = new AbortController();
      controller.abort();
      const canceled = captureIo(controller.signal);
      const canceledDirectory = join(canceledOutput.path, 'must-not-be-published');
      expect(await runCli(['scan', project.path, '--output', canceledDirectory], canceled.io)).toBe(
        EXIT_CODE.canceled,
      );
      expect(canceled.stderr.join('\n')).toContain('No partial canonical analysis');
      await expect(access(join(canceledDirectory, 'analysis.json'))).rejects.toThrow();
    } finally {
      await project.cleanup();
      await canceledOutput.cleanup();
    }
  }, 20_000);
});
