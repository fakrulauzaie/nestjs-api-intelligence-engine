#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkCommand } from './commands/check.js';
import { controlsCommand } from './commands/controls.js';
import { diffCommand } from './commands/diff.js';
import { endpointsCommand } from './commands/endpoints.js';
import { impactCommand } from './commands/impact.js';
import { graphCommand } from './commands/graph.js';
import { openApiCommand } from './commands/openapi.js';
import { reportCommand } from './commands/report.js';
import { scanCommand } from './commands/scan.js';
import { traceCommand } from './commands/trace.js';
import { stitchCommand } from './commands/stitch.js';
import { EXIT_CODE, reportMissingArgument } from './errors.js';
import { processIo } from './output.js';
import type { CliCommand, CliIo } from './types.js';
import { TOOL_NAME, TOOL_VERSION } from '../version.js';

const commands: readonly CliCommand[] = [
  scanCommand,
  diffCommand,
  impactCommand,
  checkCommand,
  openApiCommand,
  controlsCommand,
  graphCommand,
  stitchCommand,
  endpointsCommand,
  traceCommand,
  reportCommand,
];
const commandByName = new Map(commands.map((command) => [command.name, command]));

function renderHelp(): string {
  const commandLines = commands
    .map((command) => `  ${command.name.padEnd(12)}${command.summary}`)
    .join('\n');

  return `${TOOL_NAME} ${TOOL_VERSION}

Evidence-backed static endpoint tracing for NestJS and TypeORM repositories.

Usage:
  api-intel <command> [options]
  api-intel --help
  api-intel --version

Commands:
${commandLines}

Run "api-intel <command> --help" for command usage.`;
}

function renderCommandHelp(command: CliCommand): string {
  return `${command.name} - ${command.summary}\n\nUsage:\n  ${command.usage}`;
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url;
}

function parseGlobalOption(firstArgument: string, io: CliIo): number | undefined {
  try {
    const parsed = parseArgs({
      args: [firstArgument],
      allowPositionals: false,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });

    if (parsed.values.help === true) {
      io.writeOut(renderHelp());
      return EXIT_CODE.success;
    }

    if (parsed.values.version === true) {
      io.writeOut(TOOL_VERSION);
      return EXIT_CODE.success;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid command-line option.';
    io.writeError(message);
    io.writeError(`Run "${TOOL_NAME} --help" for usage.`);
    return EXIT_CODE.usageError;
  }

  return undefined;
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  io: CliIo = processIo,
): Promise<number> {
  const firstArgument = args[0];

  if (firstArgument === undefined || firstArgument === 'help') {
    io.writeOut(renderHelp());
    return EXIT_CODE.success;
  }

  if (firstArgument.startsWith('-')) {
    return parseGlobalOption(firstArgument, io) ?? EXIT_CODE.usageError;
  }

  const command = commandByName.get(firstArgument);
  if (command === undefined) {
    io.writeError(`Unknown command: ${firstArgument}`);
    io.writeError(`Run "${TOOL_NAME} --help" for usage.`);
    return EXIT_CODE.usageError;
  }

  const commandArguments = args.slice(1);
  if (commandArguments.includes('--help') || commandArguments.includes('-h')) {
    io.writeOut(renderCommandHelp(command));
    return EXIT_CODE.success;
  }

  if (commandArguments[0] === undefined || commandArguments[0].startsWith('-')) {
    return reportMissingArgument(command.name, command.requiredArgument, command.usage, io);
  }

  return command.execute(commandArguments, io);
}

if (isDirectExecution()) {
  const controller = new AbortController();
  const cancel = (): void => controller.abort(new Error('Canceled by user.'));
  process.once('SIGINT', cancel);
  runCli(process.argv.slice(2), { ...processIo, signal: controller.signal })
    .then(
      (exitCode) => {
        process.exitCode = exitCode;
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unexpected internal error.';
        processIo.writeError(message);
        process.exitCode = EXIT_CODE.internalError;
      },
    )
    .finally(() => process.removeListener('SIGINT', cancel));
}
