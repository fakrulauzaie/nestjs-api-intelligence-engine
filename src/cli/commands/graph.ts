import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ComparisonInputStateError } from '../../comparison/normalize.js';
import { GraphReportRenderError } from '../../graph-report/html.js';
import {
  buildGraphReportDocument,
  GraphReportInputStateError,
} from '../../graph-report/project.js';
import { GraphReportIntegrityError } from '../../graph-report/validate.js';
import { analyzePotentialImpact } from '../../impact/analyze.js';
import { writeOfflineGraphReportArtifact } from '../../output/graph-report-artifact.js';
import {
  loadImpactResults,
  loadPolicyResults,
  StructuredExportInputError,
} from '../../structured-exports/inputs.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';
import { graphEdgeLimitFromOption, graphNodeLimitFromOption } from '../options.js';
import { previewPublishedArtifact } from '../preview-published-artifact.js';

export const graphCommand: CliCommand = {
  name: 'graph',
  summary: 'Generate a self-contained offline interactive evidence graph.',
  usage:
    'api-intel graph <analysis.json> [--baseline <before-analysis.json> | --impact-results <impact.json>] [--policy-results <policy-results.json>] [--max-nodes <10-500>] [--max-edges <10-1000>] [--output <directory>] [--open]',
  requiredArgument: '<analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          baseline: { type: 'string', short: 'b' },
          'policy-results': { type: 'string', short: 'p' },
          'impact-results': { type: 'string', short: 'i' },
          'max-nodes': { type: 'string' },
          'max-edges': { type: 'string' },
          output: { type: 'string', short: 'o' },
          open: { type: 'boolean', short: 'O' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid graph report options.');
      io.writeError(`Usage: ${graphCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    const analysisArgument = parsed.positionals[0];
    if (analysisArgument === undefined || parsed.positionals.length !== 1) {
      io.writeError('The graph command requires exactly one analysis file.');
      io.writeError(`Usage: ${graphCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    if (parsed.values.baseline !== undefined && parsed.values['impact-results'] !== undefined) {
      io.writeError('--baseline and --impact-results cannot be used together.');
      io.writeError(`Usage: ${graphCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const analysisPath = resolve(analysisArgument);
      const [analysis, baseline, policyResults, suppliedImpact] = await Promise.all([
        loadCanonicalAnalysis(analysisPath, io.signal),
        parsed.values.baseline === undefined
          ? undefined
          : loadCanonicalAnalysis(parsed.values.baseline, io.signal),
        parsed.values['policy-results'] === undefined
          ? undefined
          : loadPolicyResults(parsed.values['policy-results'], io.signal),
        parsed.values['impact-results'] === undefined
          ? undefined
          : loadImpactResults(parsed.values['impact-results'], io.signal),
      ]);
      io.signal?.throwIfAborted();
      const impact =
        baseline === undefined ? suppliedImpact : analyzePotentialImpact(baseline, analysis);
      io.signal?.throwIfAborted();
      const document = buildGraphReportDocument({
        analysis,
        ...(policyResults === undefined ? {} : { policyResults }),
        ...(impact === undefined ? {} : { impact }),
        options: {
          maxNodesPerEndpoint: graphNodeLimitFromOption(parsed.values['max-nodes']),
          maxEdgesPerEndpoint: graphEdgeLimitFromOption(parsed.values['max-edges']),
        },
      });
      const artifact = await writeOfflineGraphReportArtifact({
        outputDirectory:
          parsed.values.output === undefined ? dirname(analysisPath) : parsed.values.output,
        document,
        analysis,
        ...(policyResults === undefined ? {} : { policyResults }),
        ...(impact === undefined ? {} : { impact }),
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(
        `Offline graph: ${document.summary.endpoints} endpoint(s), ${artifact.bytes} bytes.`,
      );
      io.writeOut(`Graph report: ${artifact.path}`);
      if (parsed.values.open === true) {
        await previewPublishedArtifact(artifact.path, 'graph report', io);
      }
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not generate graph report.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : error instanceof GraphReportInputStateError || error instanceof ComparisonInputStateError
          ? EXIT_CODE.analysisFailure
          : error instanceof StructuredExportInputError
            ? EXIT_CODE.invalidStructuredInput
            : error instanceof RangeError
              ? EXIT_CODE.usageError
              : error instanceof GraphReportIntegrityError ||
                  error instanceof GraphReportRenderError
                ? EXIT_CODE.internalError
                : EXIT_CODE.internalError;
    }
  },
};
