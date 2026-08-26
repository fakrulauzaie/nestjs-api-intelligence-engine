import { parseArgs } from 'node:util';
import { HTTP_METHODS, type HttpMethod } from '../../model/entities.js';
import { serializeCanonicalEndpointTrace } from '../../model/ordering.js';
import { buildEndpointTrace } from '../../tracing/endpoint-trace.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

export const traceCommand: CliCommand = {
  name: 'trace',
  summary: 'Trace one endpoint from an existing canonical analysis file.',
  usage: 'api-intel trace <analysis.json> --method <method> --path <path>',
  requiredArgument: '<analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          method: { type: 'string' },
          path: { type: 'string' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid trace options.');
      io.writeError(`Usage: ${traceCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    const analysisArgument = parsed.positionals[0];
    const method = parsed.values.method?.toUpperCase();
    const path = parsed.values.path;
    if (
      analysisArgument === undefined ||
      parsed.positionals.length !== 1 ||
      method === undefined ||
      !isHttpMethod(method) ||
      path === undefined
    ) {
      io.writeError('The trace command requires one analysis file, --method, and --path.');
      io.writeError(`Usage: ${traceCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const analysis = await loadCanonicalAnalysis(analysisArgument, io.signal);
      const result = buildEndpointTrace(analysis, { httpMethod: method, path });
      switch (result.status) {
        case 'resolved':
          io.writeOut(serializeCanonicalEndpointTrace(result.trace).trimEnd());
          return EXIT_CODE.success;
        case 'not_found':
          io.writeError(
            `Endpoint not found: ${result.selector.httpMethod} ${result.selector.path}`,
          );
          return EXIT_CODE.endpointNotFound;
        case 'ambiguous':
          io.writeError(
            `Endpoint selection is ambiguous: ${result.selector.httpMethod} ${result.selector.path} matched ${result.candidates.length} declarations.`,
          );
          return EXIT_CODE.endpointAmbiguous;
        case 'analysis_failure':
          io.writeError(`Cannot trace an analysis in state ${result.resultState}.`);
          return EXIT_CODE.analysisFailure;
      }
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not build endpoint trace.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : EXIT_CODE.internalError;
    }
  },
};
