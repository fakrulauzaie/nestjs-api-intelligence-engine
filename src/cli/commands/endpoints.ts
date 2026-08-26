import { parseArgs } from 'node:util';
import {
  buildEndpointCatalogue,
  renderEndpointCatalogueMarkdown,
} from '../../reporting/endpoint-catalogue.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import { endpointFilterFromOptions } from '../options.js';
import type { CliCommand } from '../types.js';

export const endpointsCommand: CliCommand = {
  name: 'endpoints',
  summary: 'Print endpoints from an existing canonical analysis file.',
  usage: 'api-intel endpoints <analysis.json> [--controller <name>] [--route <path>]',
  requiredArgument: '<analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          controller: { type: 'string' },
          route: { type: 'string' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid endpoints options.');
      io.writeError(`Usage: ${endpointsCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    const analysisArgument = parsed.positionals[0];
    if (analysisArgument === undefined || parsed.positionals.length > 1) {
      io.writeError('The endpoints command requires exactly one analysis file.');
      io.writeError(`Usage: ${endpointsCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const filter = endpointFilterFromOptions(parsed.values);
      const analysis = await loadCanonicalAnalysis(analysisArgument, io.signal);
      if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
        io.writeError(`Cannot list endpoints from an analysis in state ${analysis.resultState}.`);
        return EXIT_CODE.analysisFailure;
      }
      io.writeOut(
        renderEndpointCatalogueMarkdown(buildEndpointCatalogue(analysis, filter)).trimEnd(),
      );
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not read canonical analysis.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : error instanceof RangeError
          ? EXIT_CODE.usageError
          : EXIT_CODE.internalError;
    }
  },
};
