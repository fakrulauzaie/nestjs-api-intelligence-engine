import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ComparisonInputStateError } from '../../comparison/normalize.js';
import {
  POLICY_OUTPUT_FORMATS,
  writePolicyArtifact,
  type PolicyOutputFormat,
} from '../../output/policy-artifact.js';
import { loadPolicyConfiguration, PolicyConfigurationInputError } from '../../policy/config.js';
import { evaluatePolicies, PolicyInputStateError } from '../../policy/evaluate.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

function outputFormat(value: string | undefined): PolicyOutputFormat {
  const format = value ?? 'json';
  if ((POLICY_OUTPUT_FORMATS as readonly string[]).includes(format)) {
    return format as PolicyOutputFormat;
  }
  throw new RangeError(`Policy format must be one of: ${POLICY_OUTPUT_FORMATS.join(', ')}.`);
}

export const checkCommand: CliCommand = {
  name: 'check',
  summary: 'Evaluate typed architecture policies against a canonical analysis.',
  usage:
    'api-intel check <analysis.json> --config <api-intel.config.json> [--baseline <analysis.json>] [--format json|markdown] [--output <directory>]',
  requiredArgument: '<analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          config: { type: 'string', short: 'c' },
          baseline: { type: 'string', short: 'b' },
          format: { type: 'string', short: 'f' },
          output: { type: 'string', short: 'o' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid policy options.');
      io.writeError(`Usage: ${checkCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    const analysisArgument = parsed.positionals[0];
    if (analysisArgument === undefined || parsed.positionals.length !== 1) {
      io.writeError('The check command requires exactly one analysis file.');
      io.writeError(`Usage: ${checkCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    if (parsed.values.config === undefined) {
      io.writeError('The check command requires --config <api-intel.config.json>.');
      io.writeError(`Usage: ${checkCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const format = outputFormat(parsed.values.format);
      // Config is intentionally loaded and validated before any analysis evaluation.
      const configuration = await loadPolicyConfiguration(parsed.values.config, io.signal);
      const analysisPath = resolve(analysisArgument);
      const analysis = await loadCanonicalAnalysis(analysisPath, io.signal);
      const baseline =
        parsed.values.baseline === undefined
          ? undefined
          : await loadCanonicalAnalysis(resolve(parsed.values.baseline), io.signal);
      const results = evaluatePolicies({
        analysis,
        configuration,
        ...(baseline === undefined ? {} : { baseline }),
      });
      const artifactPath = await writePolicyArtifact({
        outputDirectory:
          parsed.values.output === undefined ? dirname(analysisPath) : parsed.values.output,
        format,
        results,
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(
        `Policy results: ${results.summary.passed} passed, ${results.summary.failed} failed, ${results.summary.unknown} unknown, ${results.summary.notApplicable} not applicable.`,
      );
      io.writeOut(`Blocking findings: ${results.summary.blocking}.`);
      io.writeOut(`Policy: ${artifactPath}`);
      return results.summary.blocking > 0 ? EXIT_CODE.policyViolation : EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not evaluate policies.');
      return error instanceof PolicyConfigurationInputError
        ? EXIT_CODE.invalidConfiguration
        : error instanceof CanonicalAnalysisInputError
          ? EXIT_CODE.invalidAnalysis
          : error instanceof ComparisonInputStateError || error instanceof PolicyInputStateError
            ? EXIT_CODE.analysisFailure
            : error instanceof RangeError
              ? EXIT_CODE.usageError
              : EXIT_CODE.internalError;
    }
  },
};
