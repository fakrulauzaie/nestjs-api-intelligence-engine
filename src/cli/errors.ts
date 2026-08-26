import type { CliIo } from './types.js';

export const EXIT_CODE = {
  success: 0,
  internalError: 1,
  usageError: 2,
  notImplemented: 3,
  endpointNotFound: 4,
  endpointAmbiguous: 5,
  analysisFailure: 6,
  invalidAnalysis: 7,
  policyViolation: 8,
  invalidConfiguration: 9,
  invalidStructuredInput: 10,
  canceled: 130,
} as const;

export function reportMissingArgument(
  commandName: string,
  requiredArgument: string,
  usage: string,
  io: CliIo,
): number {
  io.writeError(`Missing required argument for ${commandName}: ${requiredArgument}`);
  io.writeError(`Usage: ${usage}`);
  return EXIT_CODE.usageError;
}

export function reportNotImplemented(commandName: string, io: CliIo): number {
  io.writeError(
    `The ${commandName} command is not implemented yet. It is a Phase 1 command shell.`,
  );
  return EXIT_CODE.notImplemented;
}
