import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { CliIo } from '../../src/cli/types.js';
import { TOOL_VERSION } from '../../src/version.js';

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

describe('api-intel CLI', () => {
  it('prints help for the supported help forms', async () => {
    const helpArguments: readonly (readonly string[])[] = [[], ['--help'], ['-h'], ['help']];

    for (const args of helpArguments) {
      const captured = captureIo();
      const exitCode = await runCli(args, captured.io);

      expect(exitCode).toBe(EXIT_CODE.success);
      expect(captured.stderr).toEqual([]);
      expect(captured.stdout.join('\n')).toContain('Usage:');
      expect(captured.stdout.join('\n')).toContain('scan');
      expect(captured.stdout.join('\n')).toContain('trace');
    }
  });

  it('prints the version for long and short options', async () => {
    const versionArguments: readonly (readonly string[])[] = [['--version'], ['-v']];

    for (const args of versionArguments) {
      const captured = captureIo();
      const exitCode = await runCli(args, captured.io);

      expect(exitCode).toBe(EXIT_CODE.success);
      expect(captured.stdout).toEqual([TOOL_VERSION]);
      expect(captured.stderr).toEqual([]);
    }
  });

  it('rejects an unknown command with a usage exit code', async () => {
    const captured = captureIo();

    const exitCode = await runCli(['unknown'], captured.io);

    expect(exitCode).toBe(EXIT_CODE.usageError);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr.join('\n')).toContain('Unknown command: unknown');
  });

  it('reports a missing command argument', async () => {
    const captured = captureIo();

    const exitCode = await runCli(['scan'], captured.io);

    expect(exitCode).toBe(EXIT_CODE.usageError);
    expect(captured.stderr.join('\n')).toContain('Missing required argument for scan');
    expect(captured.stderr.join('\n')).toContain('api-intel scan <repository>');
  });

  it('prints command-specific help without executing the command', async () => {
    const captured = captureIo();

    const exitCode = await runCli(['trace', '--help'], captured.io);

    expect(exitCode).toBe(EXIT_CODE.success);
    expect(captured.stderr).toEqual([]);
    expect(captured.stdout.join('\n')).toContain('api-intel trace <analysis.json>');
  });

  it('uses a distinct invalid-analysis result when report input cannot be read', async () => {
    const captured = captureIo();

    const exitCode = await runCli(['report', 'input'], captured.io);

    expect(exitCode).toBe(EXIT_CODE.invalidAnalysis);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr.join('\n')).toContain('Could not read analysis file');
  });
});
