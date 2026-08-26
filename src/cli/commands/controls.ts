import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeControlEvidenceArtifacts } from '../../output/structured-export-artifacts.js';
import {
  buildControlEvidenceDocument,
  StructuredExportInputStateError,
} from '../../structured-exports/control-evidence.js';
import { loadPolicyResults, StructuredExportInputError } from '../../structured-exports/inputs.js';
import { StructuredExportIntegrityError } from '../../structured-exports/validate.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

export const controlsCommand: CliCommand = {
  name: 'controls',
  summary: 'Export deterministic control-evidence JSON and safe CSV.',
  usage:
    'api-intel controls <analysis.json> [--policy-results <policy-results.json>] [--output <directory>]',
  requiredArgument: '<analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          'policy-results': { type: 'string', short: 'p' },
          output: { type: 'string', short: 'o' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid control export options.');
      io.writeError(`Usage: ${controlsCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    const analysisArgument = parsed.positionals[0];
    if (analysisArgument === undefined || parsed.positionals.length !== 1) {
      io.writeError('The controls command requires exactly one analysis file.');
      io.writeError(`Usage: ${controlsCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const analysisPath = resolve(analysisArgument);
      const analysis = await loadCanonicalAnalysis(analysisPath, io.signal);
      const policyResults =
        parsed.values['policy-results'] === undefined
          ? undefined
          : await loadPolicyResults(parsed.values['policy-results'], io.signal);
      const document = buildControlEvidenceDocument({
        analysis,
        ...(policyResults === undefined ? {} : { policyResults }),
      });
      const artifacts = await writeControlEvidenceArtifacts({
        outputDirectory:
          parsed.values.output === undefined ? dirname(analysisPath) : parsed.values.output,
        document,
        analysis,
        ...(policyResults === undefined ? {} : { policyResults }),
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(`Control-evidence rows: ${document.rows.length}.`);
      io.writeOut(`Control-evidence JSON: ${artifacts.jsonPath}`);
      io.writeOut(`Control-evidence CSV: ${artifacts.csvPath}`);
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not export control evidence.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : error instanceof StructuredExportInputStateError
          ? EXIT_CODE.analysisFailure
          : error instanceof StructuredExportInputError ||
              error instanceof StructuredExportIntegrityError
            ? EXIT_CODE.invalidStructuredInput
            : error instanceof RangeError
              ? EXIT_CODE.usageError
              : EXIT_CODE.internalError;
    }
  },
};
