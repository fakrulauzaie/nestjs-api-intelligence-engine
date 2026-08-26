import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeMarkdownReportArtifacts } from '../../output/report-artifacts.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import { endpointFilterFromOptions } from '../options.js';
import type { CliCommand } from '../types.js';

export const reportCommand: CliCommand = {
  name: 'report',
  summary: 'Regenerate Markdown reports from canonical JSON.',
  usage:
    'api-intel report <analysis.json> [--output <directory>] [--controller <name>] [--route <path>]',
  requiredArgument: '<analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          output: { type: 'string', short: 'o' },
          controller: { type: 'string' },
          route: { type: 'string' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid report options.');
      io.writeError(`Usage: ${reportCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    const analysisArgument = parsed.positionals[0];
    if (analysisArgument === undefined || parsed.positionals.length !== 1) {
      io.writeError('The report command requires exactly one analysis file.');
      io.writeError(`Usage: ${reportCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const analysisPath = resolve(analysisArgument);
      const filter = endpointFilterFromOptions(parsed.values);
      const analysis = await loadCanonicalAnalysis(analysisPath, io.signal);
      if (analysis.resultState === 'failed' || analysis.resultState === 'canceled') {
        io.writeError(`Cannot build reports from an analysis in state ${analysis.resultState}.`);
        return EXIT_CODE.analysisFailure;
      }
      const artifacts = await writeMarkdownReportArtifacts({
        outputDirectory:
          parsed.values.output === undefined ? dirname(analysisPath) : parsed.values.output,
        analysis,
        filter,
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(`Result: ${analysis.resultState}`);
      io.writeOut(`Catalogue: ${artifacts.endpointsMarkdownPath}`);
      io.writeOut(`Contracts: ${artifacts.contractsMarkdownPath}`);
      io.writeOut(`Traces: ${artifacts.tracePaths.length} file(s) in ${artifacts.traceDirectory}`);
      if (artifacts.skippedAmbiguousEndpointCount > 0) {
        io.writeOut(
          `Skipped ${artifacts.skippedAmbiguousEndpointCount} ambiguous endpoint declaration(s).`,
        );
      }
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not regenerate reports.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : error instanceof RangeError
          ? EXIT_CODE.usageError
          : EXIT_CODE.internalError;
    }
  },
};
