import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeOpenApiEnrichmentArtifacts } from '../../output/structured-export-artifacts.js';
import { loadJsonDocument, StructuredExportInputError } from '../../structured-exports/inputs.js';
import { enrichOpenApiDocument, OpenApiInputError } from '../../structured-exports/openapi.js';
import { StructuredExportIntegrityError } from '../../structured-exports/validate.js';
import { CanonicalAnalysisInputError, loadCanonicalAnalysis } from '../analysis-input.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

export const openApiCommand: CliCommand = {
  name: 'openapi',
  summary: 'Enrich an OpenAPI 3.x JSON copy from canonical evidence.',
  usage:
    'api-intel openapi <analysis.json> --document <openapi.json> [--path-prefix <prefix>] [--include-evidence] [--output <directory>]',
  requiredArgument: '<analysis.json>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          document: { type: 'string', short: 'd' },
          'path-prefix': { type: 'string' },
          'include-evidence': { type: 'boolean' },
          output: { type: 'string', short: 'o' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid OpenAPI export options.');
      io.writeError(`Usage: ${openApiCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    const analysisArgument = parsed.positionals[0];
    if (analysisArgument === undefined || parsed.positionals.length !== 1) {
      io.writeError('The openapi command requires exactly one analysis file.');
      io.writeError(`Usage: ${openApiCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    if (parsed.values.document === undefined) {
      io.writeError('The openapi command requires --document <openapi.json>.');
      io.writeError(`Usage: ${openApiCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const analysisPath = resolve(analysisArgument);
      const documentPath = resolve(parsed.values.document);
      const [analysis, openApi] = await Promise.all([
        loadCanonicalAnalysis(analysisPath, io.signal),
        loadJsonDocument(documentPath, io.signal),
      ]);
      const enrichment = enrichOpenApiDocument({
        analysis,
        openApi,
        ...(parsed.values['path-prefix'] === undefined
          ? {}
          : { pathPrefix: parsed.values['path-prefix'] }),
        includeEvidence: parsed.values['include-evidence'] === true,
      });
      const artifacts = await writeOpenApiEnrichmentArtifacts({
        sourceOpenApiPath: documentPath,
        outputDirectory:
          parsed.values.output === undefined ? dirname(analysisPath) : parsed.values.output,
        enrichedDocument: enrichment.enrichedDocument,
        result: enrichment.result,
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(
        `OpenAPI operations: ${enrichment.result.summary.resolved} resolved, ${enrichment.result.summary.ambiguous} ambiguous, ${enrichment.result.summary.unresolved} unresolved, ${enrichment.result.summary.unmatched} unmatched.`,
      );
      io.writeOut(`Enriched OpenAPI: ${artifacts.enrichedPath}`);
      io.writeOut(`OpenAPI sidecar: ${artifacts.sidecarPath}`);
      return EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError(error instanceof Error ? error.message : 'Could not enrich OpenAPI input.');
      return error instanceof CanonicalAnalysisInputError
        ? EXIT_CODE.invalidAnalysis
        : error instanceof StructuredExportInputError ||
            error instanceof OpenApiInputError ||
            error instanceof StructuredExportIntegrityError
          ? EXIT_CODE.invalidStructuredInput
          : error instanceof RangeError
            ? EXIT_CODE.usageError
            : EXIT_CODE.internalError;
    }
  },
};
