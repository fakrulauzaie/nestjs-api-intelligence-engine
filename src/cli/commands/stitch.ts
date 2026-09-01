import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeSystemAnalysisArtifacts } from '../../output/system-analysis-artifacts.js';
import { writeSystemReportArtifacts } from '../../output/system-report-artifacts.js';
import {
  DEFAULT_SYSTEM_REPORT_EDGE_LIMIT,
  DEFAULT_SYSTEM_REPORT_NODE_LIMIT,
  buildSystemReportDocument,
  SystemReportInputError,
} from '../../system-report/index.js';
import {
  stitchSystemAnalyses,
  SystemStitchInputError,
  type SystemAnalysisDocument,
} from '../../system-analysis/index.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import {
  CanonicalAnalysisInputError,
  loadNamedAnalysisArtifact,
  loadSystemTopologyManifest,
  parseNamedAnalysisArgument,
  SystemArtifactInputError,
} from '../system-input.js';
import type { CliCommand } from '../types.js';
import { graphEdgeLimitFromOption, graphNodeLimitFromOption } from '../options.js';
import { previewPublishedArtifact } from '../preview-published-artifact.js';

function countState(document: SystemAnalysisDocument, state: string): number {
  return document.correlations.filter((correlation) => correlation.state === state).length;
}

export const stitchCommand: CliCommand = {
  name: 'stitch',
  summary: 'Correlate named completed analysis artifacts across service boundaries.',
  usage:
    'api-intel stitch <service=analysis.json-or-.api-intel> [...] [--topology <system-topology.json>] [--name <system-name>] [--output <directory>] [--with-graph] [--max-nodes <10-500>] [--max-edges <10-1000>] [--open]',
  requiredArgument: '<service=analysis.json-or-.api-intel> [...]',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          topology: { type: 'string', short: 't' },
          name: { type: 'string', short: 'n' },
          output: { type: 'string', short: 'o' },
          'with-graph': { type: 'boolean' },
          'max-nodes': { type: 'string' },
          'max-edges': { type: 'string' },
          open: { type: 'boolean', short: 'O' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid stitch options.');
      io.writeError(`Usage: ${stitchCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    if (parsed.positionals.length === 0) {
      io.writeError('The stitch command requires at least one named analysis artifact.');
      io.writeError(`Usage: ${stitchCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const reportRequested = parsed.values['with-graph'] === true;
      if (
        !reportRequested &&
        (parsed.values.open === true ||
          parsed.values['max-nodes'] !== undefined ||
          parsed.values['max-edges'] !== undefined)
      ) {
        throw new RangeError('--open, --max-nodes, and --max-edges require --with-graph.');
      }
      const maxNodes =
        graphNodeLimitFromOption(parsed.values['max-nodes']) ?? DEFAULT_SYSTEM_REPORT_NODE_LIMIT;
      const maxEdges =
        graphEdgeLimitFromOption(parsed.values['max-edges']) ?? DEFAULT_SYSTEM_REPORT_EDGE_LIMIT;
      const argumentsByService = parsed.positionals.map(parseNamedAnalysisArgument);
      const topology =
        parsed.values.topology === undefined
          ? undefined
          : await loadSystemTopologyManifest(parsed.values.topology, io.signal);
      const services = await Promise.all(
        argumentsByService.map((argument) => loadNamedAnalysisArtifact(argument, io.signal)),
      );
      io.signal?.throwIfAborted();
      const systemName = parsed.values.name ?? topology?.systemName ?? 'api-intel-system';
      const document = stitchSystemAnalyses({
        systemName,
        services,
        ...(topology === undefined ? {} : { topology }),
      });
      const artifacts = await writeSystemAnalysisArtifacts({
        outputDirectory: parsed.values.output ?? resolve('.api-intel-system'),
        document,
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(
        `Services: ${document.services.length}; distributed endpoints: ${document.interactionEndpoints.length}.`,
      );
      io.writeOut(
        `Correlations: ${countState(document, 'declared_realm_candidate')} declared-realm candidate(s), ${countState(document, 'target_only_candidate')} target-only, ${countState(document, 'ambiguous')} ambiguous, ${countState(document, 'unmatched')} unmatched.`,
      );
      io.writeOut(`System analysis: ${artifacts.jsonPath}`);
      io.writeOut(`System summary: ${artifacts.markdownPath}`);
      if (reportRequested) {
        const report = buildSystemReportDocument({
          system: document,
          services,
          maxNodes,
          maxEdges,
        });
        const reportArtifacts = await writeSystemReportArtifacts({
          outputDirectory: parsed.values.output ?? resolve('.api-intel-system'),
          document: report,
          ...(io.signal === undefined ? {} : { signal: io.signal }),
        });
        io.writeOut(
          `Conditional paths: ${report.summary.conditionalPaths}; worker effects: ${report.summary.workerEffects}; policy failures: ${report.summary.policyFailures}.`,
        );
        io.writeOut(`System report: ${reportArtifacts.jsonPath}`);
        io.writeOut(
          `System graph: ${reportArtifacts.htmlPath} (${reportArtifacts.htmlBytes} bytes)`,
        );
        if (parsed.values.open === true) {
          await previewPublishedArtifact(reportArtifacts.htmlPath, 'system graph report', io);
        }
      }
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not stitch analyses.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : error instanceof RangeError
          ? EXIT_CODE.usageError
          : error instanceof SystemArtifactInputError ||
              error instanceof SystemStitchInputError ||
              error instanceof SystemReportInputError
            ? EXIT_CODE.invalidStructuredInput
            : EXIT_CODE.internalError;
    }
  },
};
