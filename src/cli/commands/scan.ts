import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { scanRepository } from '../../analysis/scan-repository.js';
import {
  loadProjectConfigurationForScan,
  ProjectConfigurationInputError,
} from '../../config/project-config.js';
import { DEFAULT_GRAPH_EDGE_LIMIT, DEFAULT_GRAPH_NODE_LIMIT } from '../../graph-report/model.js';
import { buildGraphReportDocument } from '../../graph-report/project.js';
import { hashContent } from '../../model/hashing.js';
import { canonicalStringify } from '../../model/ordering.js';
import { prepareAnalysisArtifacts } from '../../output/analysis-artifacts.js';
import {
  prepareArtifactPublication,
  writePreparedArtifactPublication,
  type BundleReporter,
  type PreparedTextArtifact,
} from '../../output/artifact-plan.js';
import { prepareOfflineGraphReportArtifact } from '../../output/graph-report-artifact.js';
import { preparePolicyArtifact } from '../../output/policy-artifact.js';
import { cleanupStaleTraceArtifacts } from '../../output/report-manifest.js';
import {
  prepareControlEvidenceArtifacts,
  prepareOpenApiEnrichmentArtifacts,
} from '../../output/structured-export-artifacts.js';
import { evaluatePolicies, PolicyInputStateError } from '../../policy/evaluate.js';
import { POLICY_CONFIGURATION_VERSION } from '../../policy/model.js';
import { RepositoryInputError } from '../../scanner/errors.js';
import {
  buildControlEvidenceDocument,
  StructuredExportInputStateError,
} from '../../structured-exports/control-evidence.js';
import { loadJsonDocument, StructuredExportInputError } from '../../structured-exports/inputs.js';
import { enrichOpenApiDocument, OpenApiInputError } from '../../structured-exports/openapi.js';
import { StructuredExportIntegrityError } from '../../structured-exports/validate.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import {
  endpointFilterFromOptions,
  graphEdgeLimitFromOption,
  graphNodeLimitFromOption,
  maximumCallDepthFromOption,
  rawSqlConfigurationFromOption,
} from '../options.js';
import { previewPublishedArtifact } from '../preview-published-artifact.js';
import type { CliCommand } from '../types.js';

export const scanCommand: CliCommand = {
  name: 'scan',
  summary: 'Analyze one local NestJS repository and write canonical output.',
  usage:
    'api-intel scan <repository> [--config <path> | --no-config] [--tsconfig <path>] [--output <directory>] [--max-call-depth <1-3>] [--raw-sql-dialect <postgresql-18>] [--controller <name>] [--route <path>] [--with-graph] [--with-controls] [--with-openapi <openapi.json>] [--max-nodes <10-500>] [--max-edges <10-1000>] [--open]',
  requiredArgument: '<repository>',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          tsconfig: { type: 'string' },
          config: { type: 'string', short: 'c' },
          'no-config': { type: 'boolean' },
          output: { type: 'string', short: 'o' },
          'max-call-depth': { type: 'string' },
          'raw-sql-dialect': { type: 'string' },
          controller: { type: 'string' },
          route: { type: 'string' },
          'with-graph': { type: 'boolean' },
          'with-controls': { type: 'boolean' },
          'with-openapi': { type: 'string' },
          'max-nodes': { type: 'string' },
          'max-edges': { type: 'string' },
          open: { type: 'boolean', short: 'O' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid scan options.');
      io.writeError(`Usage: ${scanCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    const repositoryArgument = parsed.positionals[0];
    if (repositoryArgument === undefined || parsed.positionals.length > 1) {
      io.writeError('The scan command requires exactly one repository path.');
      io.writeError(`Usage: ${scanCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    const repositoryRoot = resolve(repositoryArgument);

    try {
      const projectConfiguration = await loadProjectConfigurationForScan({
        repositoryRoot,
        ...(parsed.values.config === undefined ? {} : { explicitPath: parsed.values.config }),
        ...(parsed.values['no-config'] === undefined
          ? {}
          : { disabled: parsed.values['no-config'] }),
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      const maximumCallDepth =
        maximumCallDepthFromOption(parsed.values['max-call-depth']) ??
        projectConfiguration?.analysis.maxCallDepth;
      const rawSqlDialect =
        parsed.values['raw-sql-dialect'] ?? projectConfiguration?.analysis.rawSqlDialect;
      const rawSql = rawSqlConfigurationFromOption(rawSqlDialect);
      const graphRequested =
        parsed.values['with-graph'] === true || projectConfiguration?.graph?.enabled === true;
      const policyRequested = projectConfiguration?.policy?.enabled === true;
      const controlsRequested =
        parsed.values['with-controls'] === true || projectConfiguration?.controls?.enabled === true;
      const configuredOpenApi =
        projectConfiguration?.openapi?.enabled === true ? projectConfiguration.openapi : undefined;
      const openApiDocumentPath =
        parsed.values['with-openapi'] === undefined
          ? configuredOpenApi?.documentPath
          : resolve(parsed.values['with-openapi']);
      const openApiRequested = openApiDocumentPath !== undefined;
      if (policyRequested && (projectConfiguration?.rules.length ?? 0) === 0) {
        throw new RangeError('An enabled policy report requires at least one configured rule.');
      }
      const cliMaxNodes = graphNodeLimitFromOption(parsed.values['max-nodes']);
      const cliMaxEdges = graphEdgeLimitFromOption(parsed.values['max-edges']);
      if (
        !graphRequested &&
        (parsed.values.open === true || cliMaxNodes !== undefined || cliMaxEdges !== undefined)
      ) {
        throw new RangeError('--open, --max-nodes, and --max-edges require a graph report.');
      }
      const maxNodesPerEndpoint =
        cliMaxNodes ?? projectConfiguration?.graph?.maxNodesPerEndpoint ?? DEFAULT_GRAPH_NODE_LIMIT;
      const maxEdgesPerEndpoint =
        cliMaxEdges ?? projectConfiguration?.graph?.maxEdgesPerEndpoint ?? DEFAULT_GRAPH_EDGE_LIMIT;
      const outputDirectory =
        parsed.values.output === undefined
          ? (projectConfiguration?.outputDirectory ?? join(repositoryRoot, '.api-intel'))
          : resolve(parsed.values.output);
      const openApiInput =
        openApiDocumentPath === undefined
          ? undefined
          : await loadJsonDocument(openApiDocumentPath, io.signal);
      const filter = endpointFilterFromOptions(parsed.values);
      const configuration = {
        ...(maximumCallDepth === undefined ? {} : { maxCallDepth: maximumCallDepth }),
        ...(rawSql === undefined ? {} : { rawSql }),
        ...(projectConfiguration?.analysis.interactions === undefined
          ? {}
          : { interactions: projectConfiguration.analysis.interactions }),
        ...(projectConfiguration?.analysis.authorization === undefined
          ? {}
          : { authorization: projectConfiguration.analysis.authorization }),
      };
      const result = await scanRepository({
        repositoryRoot,
        ...(parsed.values.tsconfig === undefined ? {} : { tsconfigPath: parsed.values.tsconfig }),
        ...(Object.keys(configuration).length === 0 ? {} : { configuration }),
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      if (result.analysis.resultState === 'failed') {
        io.writeError('Repository analysis failed; canonical artifacts were not published.');
        return EXIT_CODE.analysisFailure;
      }
      if (result.analysis.resultState === 'canceled') return reportCancellation(io);
      const run = {
        ...result.run,
        projectConfiguration: {
          source:
            projectConfiguration === undefined
              ? { kind: 'none' as const, path: null, fileVersion: null }
              : {
                  kind: projectConfiguration.sourceKind,
                  path: projectConfiguration.path,
                  fileVersion: projectConfiguration.fileVersion,
                },
          analysis: {
            maxCallDepth: result.analysis.analysisRun.configuration.maxCallDepth,
            rawSqlDialect: result.analysis.analysisRun.configuration.rawSql?.dialect ?? null,
            interactions: result.analysis.analysisRun.configuration.interactions!,
            authorization: result.analysis.analysisRun.configuration.authorization!,
          },
          output: { directory: outputDirectory },
          rules: projectConfiguration?.rules ?? [],
          reports: {
            policy: { enabled: policyRequested },
            graph: { enabled: graphRequested, maxNodesPerEndpoint, maxEdgesPerEndpoint },
            controls: { enabled: controlsRequested },
            openapi: {
              enabled: openApiRequested,
              documentPath: openApiDocumentPath ?? null,
              pathPrefix: configuredOpenApi?.pathPrefix ?? '/',
              includeEvidence: configuredOpenApi?.includeEvidence ?? false,
            },
          },
        },
      };
      io.signal?.throwIfAborted();
      const paths = await prepareAnalysisArtifacts(outputDirectory, result.analysis, run, {
        filter,
      });
      const artifacts: PreparedTextArtifact[] = [...paths.artifacts];
      const requestedReporters: BundleReporter[] = ['analysis', 'markdown'];
      const policyResults = policyRequested
        ? evaluatePolicies({
            analysis: result.analysis,
            configuration: {
              version: POLICY_CONFIGURATION_VERSION,
              rules: projectConfiguration?.rules ?? [],
            },
          })
        : undefined;
      let policyPath: string | undefined;
      if (policyResults !== undefined) {
        const prepared = preparePolicyArtifact({
          outputDirectory,
          format: 'json',
          results: policyResults,
        });
        policyPath = prepared.path;
        artifacts.push(prepared.artifact);
        requestedReporters.push('policy');
      }
      let graphArtifact:
        | { readonly path: string; readonly bytes: number; readonly endpointCount: number }
        | undefined;
      if (graphRequested) {
        const graphDocument = buildGraphReportDocument({
          analysis: result.analysis,
          ...(policyResults === undefined ? {} : { policyResults }),
          options: { maxNodesPerEndpoint, maxEdgesPerEndpoint },
        });
        const prepared = await prepareOfflineGraphReportArtifact({
          outputDirectory,
          document: graphDocument,
          analysis: result.analysis,
          ...(policyResults === undefined ? {} : { policyResults }),
          ...(io.signal === undefined ? {} : { signal: io.signal }),
        });
        graphArtifact = {
          path: prepared.path,
          bytes: prepared.bytes,
          endpointCount: graphDocument.summary.endpoints,
        };
        artifacts.push(prepared.artifact);
        requestedReporters.push('graph');
      }
      let controlsArtifact:
        | { readonly jsonPath: string; readonly csvPath: string; readonly rowCount: number }
        | undefined;
      if (controlsRequested) {
        const document = buildControlEvidenceDocument({
          analysis: result.analysis,
          ...(policyResults === undefined ? {} : { policyResults }),
        });
        const prepared = prepareControlEvidenceArtifacts({
          outputDirectory,
          document,
          analysis: result.analysis,
          ...(policyResults === undefined ? {} : { policyResults }),
        });
        controlsArtifact = {
          jsonPath: prepared.jsonPath,
          csvPath: prepared.csvPath,
          rowCount: document.rows.length,
        };
        artifacts.push(...prepared.artifacts);
        requestedReporters.push('controls');
      }
      let openApiArtifact:
        | {
            readonly enrichedPath: string;
            readonly sidecarPath: string;
            readonly summary: {
              readonly resolved: number;
              readonly ambiguous: number;
              readonly unresolved: number;
              readonly unmatched: number;
            };
            readonly version: string;
          }
        | undefined;
      if (openApiDocumentPath !== undefined && openApiInput !== undefined) {
        const enrichment = enrichOpenApiDocument({
          analysis: result.analysis,
          openApi: openApiInput,
          ...(configuredOpenApi?.pathPrefix === undefined
            ? {}
            : { pathPrefix: configuredOpenApi.pathPrefix }),
          includeEvidence: configuredOpenApi?.includeEvidence === true,
        });
        const prepared = prepareOpenApiEnrichmentArtifacts({
          sourceOpenApiPath: openApiDocumentPath,
          outputDirectory,
          enrichedDocument: enrichment.enrichedDocument,
          result: enrichment.result,
        });
        openApiArtifact = {
          enrichedPath: prepared.enrichedPath,
          sidecarPath: prepared.sidecarPath,
          summary: enrichment.result.summary,
          version: enrichment.result.openApiVersion,
        };
        artifacts.push(...prepared.artifacts);
        requestedReporters.push('openapi');
      }
      const publication = prepareArtifactPublication({
        outputDirectory,
        analysis: {
          id: result.analysis.analysisRun.id,
          schemaVersion: result.analysis.schemaVersion,
          resultState: result.analysis.resultState,
        },
        requestedReporters,
        inputSnapshots: [
          {
            kind: 'analysis',
            id: result.analysis.analysisRun.id,
            schemaVersion: result.analysis.schemaVersion,
          },
          ...(openApiInput === undefined || openApiArtifact === undefined
            ? []
            : [
                {
                  kind: 'openapi' as const,
                  id: hashContent(canonicalStringify(openApiInput)),
                  schemaVersion: openApiArtifact.version,
                },
              ]),
        ],
        artifacts,
        ...(openApiDocumentPath === undefined
          ? {}
          : { protectedInputPaths: [openApiDocumentPath] }),
      });
      await writePreparedArtifactPublication(publication, io.signal);
      await cleanupStaleTraceArtifacts(paths.staleTracePaths);
      io.writeOut(
        `Analyzed ${result.analysis.endpoints.length} endpoint(s) with ${result.analysis.diagnostics.length} diagnostic(s).`,
      );
      io.writeOut(`Result: ${result.analysis.resultState}`);
      io.writeOut(`Analysis: ${paths.analysisPath}`);
      io.writeOut(`Catalogue: ${paths.endpointsMarkdownPath}`);
      io.writeOut(`Contracts: ${paths.contractsMarkdownPath}`);
      io.writeOut(`Traces: ${paths.tracePaths.length} file(s) in ${paths.traceDirectory}`);
      if (paths.skippedAmbiguousEndpointCount > 0) {
        io.writeOut(
          `Skipped ${paths.skippedAmbiguousEndpointCount} ambiguous endpoint declaration(s).`,
        );
      }
      if (policyResults !== undefined && policyPath !== undefined) {
        io.writeOut(
          `Policy results: ${policyResults.summary.passed} passed, ${policyResults.summary.failed} failed, ${policyResults.summary.unknown} unknown, ${policyResults.summary.notApplicable} not applicable.`,
        );
        io.writeOut(`Blocking findings: ${policyResults.summary.blocking}.`);
        io.writeOut(`Policy: ${policyPath}`);
      }
      if (graphArtifact !== undefined) {
        io.writeOut(
          `Offline graph: ${graphArtifact.endpointCount} endpoint(s), ${graphArtifact.bytes} bytes.`,
        );
        io.writeOut(`Graph report: ${graphArtifact.path}`);
        if (parsed.values.open === true) {
          await previewPublishedArtifact(graphArtifact.path, 'graph report', io);
        }
      }
      if (controlsArtifact !== undefined) {
        io.writeOut(`Control-evidence rows: ${controlsArtifact.rowCount}.`);
        io.writeOut(`Control-evidence JSON: ${controlsArtifact.jsonPath}`);
        io.writeOut(`Control-evidence CSV: ${controlsArtifact.csvPath}`);
      }
      if (openApiArtifact !== undefined) {
        io.writeOut(
          `OpenAPI operations: ${openApiArtifact.summary.resolved} resolved, ${openApiArtifact.summary.ambiguous} ambiguous, ${openApiArtifact.summary.unresolved} unresolved, ${openApiArtifact.summary.unmatched} unmatched.`,
        );
        io.writeOut(`Enriched OpenAPI: ${openApiArtifact.enrichedPath}`);
        io.writeOut(`OpenAPI sidecar: ${openApiArtifact.sidecarPath}`);
      }
      io.writeOut(`Bundle: ${publication.bundlePath}`);
      return (policyResults?.summary.blocking ?? 0) > 0
        ? EXIT_CODE.policyViolation
        : EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      if (error instanceof RangeError) {
        io.writeError(error.message);
        io.writeError(`Usage: ${scanCommand.usage}`);
        return EXIT_CODE.usageError;
      }
      io.writeError(error instanceof Error ? error.message : 'Repository analysis failed.');
      return error instanceof ProjectConfigurationInputError
        ? EXIT_CODE.invalidConfiguration
        : error instanceof StructuredExportInputError ||
            error instanceof OpenApiInputError ||
            error instanceof StructuredExportIntegrityError
          ? EXIT_CODE.invalidStructuredInput
          : error instanceof StructuredExportInputStateError ||
              error instanceof PolicyInputStateError
            ? EXIT_CODE.analysisFailure
            : error instanceof RepositoryInputError
              ? EXIT_CODE.usageError
              : EXIT_CODE.internalError;
    }
  },
};
