import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compareAnalysisDocuments } from '../../comparison/compare.js';
import { ComparisonInputStateError } from '../../comparison/normalize.js';
import {
  DIFF_OUTPUT_FORMATS,
  writeDiffArtifact,
  type DiffOutputFormat,
} from '../../output/diff-artifact.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

function outputFormat(value: string | undefined): DiffOutputFormat {
  const format = value ?? 'json';
  if ((DIFF_OUTPUT_FORMATS as readonly string[]).includes(format)) {
    return format as DiffOutputFormat;
  }
  throw new RangeError(`Diff format must be one of: ${DIFF_OUTPUT_FORMATS.join(', ')}.`);
}

export const diffCommand: CliCommand = {
  name: 'diff',
  summary: 'Compare two explicit canonical analysis snapshots.',
  usage:
    'api-intel diff <before-analysis.json> <after-analysis.json> [--format json|markdown] [--output <directory>]',
  requiredArgument: '<before-analysis.json> <after-analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          format: { type: 'string', short: 'f' },
          output: { type: 'string', short: 'o' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid diff options.');
      io.writeError(`Usage: ${diffCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    const beforeArgument = parsed.positionals[0];
    const afterArgument = parsed.positionals[1];
    if (
      beforeArgument === undefined ||
      afterArgument === undefined ||
      parsed.positionals.length !== 2
    ) {
      io.writeError('The diff command requires exactly two analysis files.');
      io.writeError(`Usage: ${diffCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const format = outputFormat(parsed.values.format);
      const beforePath = resolve(beforeArgument);
      const afterPath = resolve(afterArgument);
      const [before, after] = await Promise.all([
        loadCanonicalAnalysis(beforePath, io.signal),
        loadCanonicalAnalysis(afterPath, io.signal),
      ]);
      const diff = compareAnalysisDocuments(before, after);
      const artifactPath = await writeDiffArtifact({
        outputDirectory:
          parsed.values.output === undefined ? dirname(afterPath) : parsed.values.output,
        format,
        diff,
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(
        `Endpoints: ${diff.summary.endpointsAdded} added, ${diff.summary.endpointsRemoved} removed, ${diff.summary.endpointsModified} modified.`,
      );
      io.writeOut(
        `Diagnostics: ${diff.summary.diagnosticsNew} new, ${diff.summary.diagnosticsResolved} resolved, ${diff.summary.diagnosticsChanged} changed.`,
      );
      io.writeOut(`Ambiguities: ${diff.summary.ambiguities}.`);
      io.writeOut(`Diff: ${artifactPath}`);
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not compare analyses.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : error instanceof ComparisonInputStateError
          ? EXIT_CODE.analysisFailure
          : error instanceof RangeError
            ? EXIT_CODE.usageError
            : EXIT_CODE.internalError;
    }
  },
};
