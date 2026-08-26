import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ComparisonInputStateError } from '../../comparison/normalize.js';
import { analyzePotentialImpact } from '../../impact/analyze.js';
import {
  IMPACT_OUTPUT_FORMATS,
  writeImpactArtifact,
  type ImpactOutputFormat,
} from '../../output/impact-artifact.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

function outputFormat(value: string | undefined): ImpactOutputFormat {
  const format = value ?? 'json';
  if ((IMPACT_OUTPUT_FORMATS as readonly string[]).includes(format)) {
    return format as ImpactOutputFormat;
  }
  throw new RangeError(`Impact format must be one of: ${IMPACT_OUTPUT_FORMATS.join(', ')}.`);
}

export const impactCommand: CliCommand = {
  name: 'impact',
  summary: 'Find evidence-backed potential endpoint impact between two analyses.',
  usage:
    'api-intel impact <before-analysis.json> <after-analysis.json> [--format json|markdown] [--output <directory>]',
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
      io.writeError(error instanceof Error ? error.message : 'Invalid impact options.');
      io.writeError(`Usage: ${impactCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    const beforeArgument = parsed.positionals[0];
    const afterArgument = parsed.positionals[1];
    if (
      beforeArgument === undefined ||
      afterArgument === undefined ||
      parsed.positionals.length !== 2
    ) {
      io.writeError('The impact command requires exactly two analysis files.');
      io.writeError(`Usage: ${impactCommand.usage}`);
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
      const impact = analyzePotentialImpact(before, after);
      const artifactPath = await writeImpactArtifact({
        outputDirectory:
          parsed.values.output === undefined ? dirname(afterPath) : parsed.values.output,
        format,
        impact,
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(
        `Potentially impacted endpoint slots: ${impact.summary.impactedEndpointSlots} (${impact.summary.directlyChangedEndpointSlots} direct, ${impact.summary.transitivelyImpactedEndpointSlots} transitive).`,
      );
      io.writeOut(
        `Changed but unreachable source files: ${impact.summary.unreachableSourceChanges}.`,
      );
      io.writeOut(`Impact: ${artifactPath}`);
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not analyze potential impact.');
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
