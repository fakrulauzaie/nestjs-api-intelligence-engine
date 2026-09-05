import { resolve } from 'node:path';
import ts from 'typescript';
import { DEFAULT_ANALYSIS_CONFIGURATION } from '../config/analysis-config.js';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForOffsets } from '../evidence/locations.js';
import { assertValidAnalysisDocument } from '../evidence/validate.js';
import { extractNestRoutes } from '../extractors/nest-routes.js';
import { extractNestGuards } from '../extractors/nest-guards.js';
import { extractNestAuthorization } from '../extractors/nest-authorization.js';
import { extractNestContracts } from '../extractors/nest-contracts.js';
import { extractInterMethodRequestProvenance } from '../extractors/inter-method-provenance.js';
import { extractRequestProvenance } from '../extractors/request-provenance.js';
import { extractNestModules } from '../extractors/nest-modules.js';
import { extractClassRelationships } from '../extractors/class-relationships.js';
import { extractNestHttpService } from '../extractors/nest-http-service.js';
import { extractNestEventEmitter } from '../extractors/nest-event-emitter.js';
import { extractNestBullMq } from '../extractors/nest-bullmq.js';
import { extractNestMicroservices } from '../extractors/nest-microservices.js';
import { extractOutboundHttp } from '../extractors/outbound-http.js';
import { extractResourceAccesses } from '../extractors/resource-access.js';
import { extractRedlockCriticalSections } from '../extractors/redlock-critical-sections.js';
import { extractTypeOrmPersistence } from '../extractors/typeorm-persistence.js';
import { extractTypeOrmRawSql } from '../extractors/typeorm-raw-sql.js';
import {
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  type AnalysisDocument,
  type RunDocument,
} from '../model/analysis.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type { AnalysisConfiguration, ToolMetadata } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { INTERACTION_KINDS, type InteractionKind } from '../model/interactions.js';
import { makeAnalysisRunId } from '../model/ids.js';
import { RESOURCE_TECHNOLOGIES } from '../model/resource-access.js';
import { canonicalizeAnalysisDocument, canonicalizeRunDocument } from '../model/ordering.js';
import { normalizeRepositoryRelativePath } from '../model/paths.js';
import { analysisConfigurationSchema, runDocumentSchema } from '../model/schemas.js';
import { readLocalGitRevision } from '../scanner/git-metadata.js';
import { inventoryRepository, type RepositoryInventory } from '../scanner/inventory.js';
import {
  loadTypeScriptProject,
  type TypeScriptProject,
  type TypeScriptProjectDiagnostic,
} from '../ts-index/program.js';
import { buildSourceIndex, type SourceIndex } from '../ts-index/source-index.js';
import { TOOL_NAME, TOOL_VERSION } from '../version.js';
import {
  mergeAssertionRecords,
  mergeApplicationRecords,
  mergeClassRecords,
  mergeEvidenceRecords,
  mergeGuardRecords,
  mergeInteractionHandlerRecords,
  mergeInteractionRecords,
  mergeMethodRecords,
} from './merge-records.js';
import { deriveAnalysisResultState } from './result-state.js';
import { projectJobQueueBranchEffects } from './job-queue-branch-effects.js';
import { projectCriticalSectionEffects } from './critical-section-effects.js';

export interface ScanRepositoryOptions {
  readonly repositoryRoot: string;
  readonly tsconfigPath?: string;
  readonly configuration?: Partial<AnalysisConfiguration>;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
}

/** Extractor capabilities shipped by the current scanner, independent of schema reservations. */
export const SUPPORTED_INTERACTION_KINDS = [
  'outbound_http',
  'in_process_event',
  'job_queue',
  'microservice_message',
] as const satisfies readonly InteractionKind[];

export interface ScanRepositoryResult {
  readonly analysis: AnalysisDocument;
  readonly run: RunDocument;
  readonly inventory: RepositoryInventory;
  readonly project: TypeScriptProject;
  readonly sourceIndex: SourceIndex;
}

function toolMetadata(): ToolMetadata {
  return { name: TOOL_NAME, version: TOOL_VERSION, typescriptVersion: ts.version };
}

function compilerDiagnosticEvidence(
  diagnostic: TypeScriptProjectDiagnostic,
  sourceIndex: SourceIndex,
  snippetLimit: number,
): EvidenceRecord | null {
  if (
    diagnostic.filePath === null ||
    diagnostic.startLine === null ||
    diagnostic.startColumn === null
  ) {
    return null;
  }
  const source = sourceIndex.sourceByPath.get(diagnostic.filePath);
  if (source === undefined) return null;

  try {
    const startOffset = source.sourceFile.getPositionOfLineAndCharacter(
      diagnostic.startLine - 1,
      diagnostic.startColumn - 1,
    );
    const endOffset =
      diagnostic.endLine === null || diagnostic.endColumn === null
        ? startOffset
        : source.sourceFile.getPositionOfLineAndCharacter(
            diagnostic.endLine - 1,
            diagnostic.endColumn - 1,
          );
    return createEvidenceForOffsets({
      sourceFile: source.sourceFile,
      sourceFileRecord: source.inventorySource.record,
      startOffset,
      endOffset,
      role: 'resolution_basis',
      snippetLimit,
    });
  } catch {
    return null;
  }
}

function canonicalCompilerDiagnostics(
  project: TypeScriptProject,
  sourceIndex: SourceIndex,
  snippetLimit: number,
): { diagnostics: readonly DiagnosticRecord[]; evidence: readonly EvidenceRecord[] } {
  const evidenceById = new Map<string, EvidenceRecord>();
  const grouped = new Map<
    string,
    {
      code: 'TS_PARSE_ERROR' | 'TS_IMPORT_UNRESOLVED';
      evidenceIds: string[];
      messages: Set<string>;
    }
  >();

  for (const diagnostic of project.diagnostics) {
    if (
      diagnostic.canonicalCode !== 'TS_PARSE_ERROR' &&
      diagnostic.canonicalCode !== 'TS_IMPORT_UNRESOLVED'
    ) {
      continue;
    }
    const evidence = compilerDiagnosticEvidence(diagnostic, sourceIndex, snippetLimit);
    if (evidence !== null) evidenceById.set(evidence.id, evidence);
    const evidenceIds = evidence === null ? [] : [evidence.id];
    const key = `${diagnostic.canonicalCode}:${evidenceIds.join(':')}`;
    const existing = grouped.get(key);
    const message = `TS${diagnostic.typescriptCode}: ${diagnostic.message}`;
    if (existing === undefined) {
      grouped.set(key, {
        code: diagnostic.canonicalCode,
        evidenceIds,
        messages: new Set([message]),
      });
    } else {
      existing.messages.add(message);
    }
  }

  return {
    diagnostics: [...grouped.values()].map((group) =>
      createDiagnostic({
        code: group.code,
        message: [...group.messages].sort().join(' | '),
        evidenceIds: group.evidenceIds,
      }),
    ),
    evidence: [...evidenceById.values()],
  };
}

export async function scanRepository(
  options: ScanRepositoryOptions,
): Promise<ScanRepositoryResult> {
  const now = options.now ?? (() => new Date());
  options.signal?.throwIfAborted();
  const startedAt = now();
  const repositoryRoot = resolve(options.repositoryRoot);
  const parsedConfiguration = analysisConfigurationSchema.parse({
    ...DEFAULT_ANALYSIS_CONFIGURATION,
    ...options.configuration,
  });
  const uniqueAuthorizationEntries = <T>(values: readonly T[]): T[] =>
    [...new Map(values.map((value) => [JSON.stringify(value), value])).values()].sort(
      (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  const configuration = {
    ...parsedConfiguration,
    authorization: {
      metadataKeys: [...new Set(parsedConfiguration.authorization.metadataKeys)].sort(),
      decoratorSymbols: uniqueAuthorizationEntries(
        parsedConfiguration.authorization.decoratorSymbols,
      ),
      enforcementRelationships: uniqueAuthorizationEntries(
        parsedConfiguration.authorization.enforcementRelationships,
      ),
    },
  };
  const repositoryRevision = await readLocalGitRevision(repositoryRoot);
  options.signal?.throwIfAborted();
  const inventory = await inventoryRepository({
    repositoryRoot,
    repositoryRevision,
    maxSourceFileBytes: configuration.maxSourceFileBytes,
  });
  options.signal?.throwIfAborted();
  const project = await loadTypeScriptProject({
    repositoryRoot,
    inventory,
    ...(options.tsconfigPath === undefined ? {} : { tsconfigPath: options.tsconfigPath }),
  });
  options.signal?.throwIfAborted();
  const sourceIndex = buildSourceIndex(inventory, project.program, project.checker);
  const moduleExtraction = extractNestModules({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
  });
  options.signal?.throwIfAborted();
  const routeExtraction = extractNestRoutes({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
  });
  options.signal?.throwIfAborted();
  const guardExtraction = extractNestGuards({
    sourceIndex,
    checker: project.checker,
    endpointDeclarations: routeExtraction.endpointDeclarations,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
  });
  options.signal?.throwIfAborted();
  const authorizationExtraction = extractNestAuthorization({
    sourceIndex,
    checker: project.checker,
    endpointDeclarations: routeExtraction.endpointDeclarations,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    configuration: configuration.authorization!,
    existingClasses: [...guardExtraction.classes, ...moduleExtraction.classes],
    existingGuards: [...guardExtraction.guards, ...moduleExtraction.guards],
    existingAssertions: [...guardExtraction.assertions, ...moduleExtraction.assertions],
    modules: moduleExtraction.modules,
    moduleAssertions: moduleExtraction.assertions,
    applicationRootModuleIds: moduleExtraction.applicationRootModuleIds,
    globalGuardRegistrations: moduleExtraction.globalGuardRegistrations,
  });
  options.signal?.throwIfAborted();
  const contractExtraction = extractNestContracts({
    sourceIndex,
    checker: project.checker,
    endpointDeclarations: routeExtraction.endpointDeclarations,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
  });
  options.signal?.throwIfAborted();
  const redlockCriticalSections = extractRedlockCriticalSections({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
  });
  options.signal?.throwIfAborted();
  const classRelationships = extractClassRelationships({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const outboundHttp = extractOutboundHttp({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const nestHttpService = extractNestHttpService({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const nestEventEmitter = extractNestEventEmitter({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    modules: moduleExtraction.modules,
    moduleAssertions: moduleExtraction.assertions,
    maxFanOutPerInteraction: configuration.interactions.maxFanOutPerInteraction,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const nestBullMq = extractNestBullMq({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    moduleAssertions: moduleExtraction.assertions,
    maxFanOutPerInteraction: configuration.interactions.maxFanOutPerInteraction,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const nestMicroservices = extractNestMicroservices({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    modules: moduleExtraction.modules,
    moduleAssertions: moduleExtraction.assertions,
    maxFanOutPerInteraction: configuration.interactions.maxFanOutPerInteraction,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const resourceAccesses = extractResourceAccesses({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const typeOrmPersistence = extractTypeOrmPersistence({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const requestProvenance = extractRequestProvenance({
    checker: project.checker,
    requestParameters: contractExtraction.requestParameters,
    contractFields: contractExtraction.contractFields,
    entityColumns: typeOrmPersistence.entityColumns,
    writeSinks: typeOrmPersistence.objectWriteSinks,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
  });
  options.signal?.throwIfAborted();
  const interMethodProvenance = extractInterMethodRequestProvenance({
    checker: project.checker,
    requestParameters: contractExtraction.requestParameters,
    contractFields: contractExtraction.contractFields,
    entityColumns: typeOrmPersistence.entityColumns,
    writeSinks: typeOrmPersistence.objectWriteSinks,
    directMethodCalls: classRelationships.directMethodCalls,
    maxCallDepth: configuration.maxCallDepth,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
  });
  options.signal?.throwIfAborted();
  const typeOrmRawSql = await extractTypeOrmRawSql({
    sourceIndex,
    checker: project.checker,
    repositoryRevision,
    evidenceSnippetLimit: configuration.evidenceSnippetLimit,
    configuration: configuration.rawSql,
    signal: options.signal,
    allowedNestedFunctions: redlockCriticalSections.allowedNestedFunctions,
  });
  options.signal?.throwIfAborted();
  const compiler = canonicalCompilerDiagnostics(
    project,
    sourceIndex,
    configuration.evidenceSnippetLimit,
  );
  const globalAuthenticationDiagnostics =
    routeExtraction.endpoints.length === 0 ||
    moduleExtraction.globalGuardAnalysis.state !== 'unknown'
      ? []
      : [
          createDiagnostic({
            code: 'AUTH_GLOBAL_POLICY_UNKNOWN',
            message:
              'Static module/bootstrap analysis is incomplete; additional global guard declarations may exist.',
          }),
        ];
  const diagnostics = [
    ...routeExtraction.diagnostics,
    ...guardExtraction.diagnostics,
    ...authorizationExtraction.diagnostics,
    ...classRelationships.diagnostics,
    ...outboundHttp.diagnostics,
    ...nestHttpService.diagnostics,
    ...nestEventEmitter.diagnostics,
    ...nestBullMq.diagnostics,
    ...nestMicroservices.diagnostics,
    ...resourceAccesses.diagnostics,
    ...redlockCriticalSections.diagnostics,
    ...typeOrmPersistence.diagnostics,
    ...requestProvenance.diagnostics,
    ...interMethodProvenance.diagnostics,
    ...typeOrmRawSql.diagnostics,
    ...moduleExtraction.diagnostics,
    ...compiler.diagnostics,
    ...globalAuthenticationDiagnostics,
  ];
  const trustedFactCount =
    routeExtraction.endpoints.length +
    routeExtraction.assertions.length +
    guardExtraction.assertions.length +
    authorizationExtraction.metadata.length +
    authorizationExtraction.enforcements.length +
    authorizationExtraction.assertions.length +
    classRelationships.assertions.length +
    typeOrmPersistence.assertions.length +
    typeOrmPersistence.entities.length +
    typeOrmPersistence.tables.length +
    typeOrmRawSql.assertions.length +
    typeOrmRawSql.tables.length +
    moduleExtraction.modules.length +
    moduleExtraction.globalGuardRegistrations.length +
    contractExtraction.requestParameters.length +
    contractExtraction.responseContracts.length +
    contractExtraction.contractFields.length +
    typeOrmPersistence.entityColumns.length +
    requestProvenance.columnInfluences.length +
    interMethodProvenance.columnInfluences.length +
    outboundHttp.interactions.length +
    outboundHttp.assertions.length +
    nestHttpService.interactions.length +
    nestHttpService.assertions.length +
    nestEventEmitter.applications.length +
    nestEventEmitter.interactions.length +
    nestEventEmitter.handlers.length +
    nestEventEmitter.assertions.length +
    nestBullMq.interactions.length +
    nestBullMq.handlers.length +
    nestBullMq.handlerDispatches.length +
    nestBullMq.handlerBranches.length +
    nestBullMq.assertions.length +
    nestMicroservices.applications.length +
    nestMicroservices.interactions.length +
    nestMicroservices.handlers.length +
    nestMicroservices.assertions.length +
    resourceAccesses.resourceAccesses.length +
    resourceAccesses.assertions.length +
    redlockCriticalSections.resourceAccesses.length +
    redlockCriticalSections.assertions.length +
    redlockCriticalSections.criticalSections.length;
  const resultState = deriveAnalysisResultState({ diagnostics, trustedFactCount });
  const tool = toolMetadata();
  const tsconfigPath = normalizeRepositoryRelativePath(repositoryRoot, project.tsconfigPath);
  const analysisId = makeAnalysisRunId({
    repositoryRevision,
    tsconfigPath,
    toolVersion: tool.version,
    typescriptVersion: tool.typescriptVersion,
    configuration,
  });
  const assertions = mergeAssertionRecords(
    routeExtraction.assertions,
    guardExtraction.assertions,
    authorizationExtraction.assertions,
    classRelationships.assertions,
    outboundHttp.assertions,
    nestHttpService.assertions,
    nestEventEmitter.assertions,
    nestBullMq.assertions,
    nestMicroservices.assertions,
    resourceAccesses.assertions,
    redlockCriticalSections.assertions,
    typeOrmPersistence.assertions,
    typeOrmRawSql.assertions,
    moduleExtraction.assertions,
    contractExtraction.assertions,
    requestProvenance.assertions,
    interMethodProvenance.assertions,
  );
  const evidence = mergeEvidenceRecords(
    routeExtraction.evidence,
    guardExtraction.evidence,
    authorizationExtraction.evidence,
    classRelationships.evidence,
    outboundHttp.evidence,
    nestHttpService.evidence,
    nestEventEmitter.evidence,
    nestBullMq.evidence,
    nestMicroservices.evidence,
    resourceAccesses.evidence,
    redlockCriticalSections.evidence,
    typeOrmPersistence.evidence,
    typeOrmRawSql.evidence,
    compiler.evidence,
    moduleExtraction.evidence,
    contractExtraction.evidence,
    requestProvenance.evidence,
    interMethodProvenance.evidence,
  );
  const interactionHandlers = mergeInteractionHandlerRecords(
    nestEventEmitter.handlers,
    nestBullMq.handlers,
    nestMicroservices.handlers,
  );
  const interactionHandlerBranchEffects = projectJobQueueBranchEffects({
    handlers: interactionHandlers,
    dispatches: nestBullMq.handlerDispatches,
    branches: nestBullMq.handlerBranches,
    assertions,
    evidence,
  });
  const criticalSections = projectCriticalSectionEffects({
    criticalSections: redlockCriticalSections.criticalSections,
    assertions,
    evidence,
  });
  const analysis = canonicalizeAnalysisDocument({
    schemaVersion: CURRENT_ANALYSIS_SCHEMA_VERSION,
    resultState,
    analysisRun: {
      id: analysisId,
      repositoryRevision,
      tsconfigPath,
      tool,
      configuration,
    },
    sourceFiles: inventory.sourceFiles.map((source) => source.record),
    classes: mergeClassRecords(
      routeExtraction.classes,
      guardExtraction.classes,
      authorizationExtraction.classes,
      classRelationships.classes,
      outboundHttp.classes,
      nestHttpService.classes,
      nestEventEmitter.classes,
      nestBullMq.classes,
      nestMicroservices.classes,
      resourceAccesses.classes,
      redlockCriticalSections.classes,
      typeOrmPersistence.classes,
      typeOrmRawSql.classes,
      moduleExtraction.classes,
    ),
    methods: mergeMethodRecords(
      routeExtraction.methods,
      classRelationships.methods,
      outboundHttp.methods,
      nestHttpService.methods,
      nestEventEmitter.methods,
      nestBullMq.methods,
      nestMicroservices.methods,
      resourceAccesses.methods,
      redlockCriticalSections.methods,
      typeOrmPersistence.methods,
      typeOrmRawSql.methods,
    ),
    endpoints: routeExtraction.endpoints,
    guards: mergeGuardRecords(
      guardExtraction.guards,
      authorizationExtraction.guards,
      moduleExtraction.guards,
    ),
    repositoryBindings: typeOrmPersistence.repositoryBindings,
    entities: typeOrmPersistence.entities,
    tables: [...typeOrmPersistence.tables, ...typeOrmRawSql.tables],
    assertions,
    evidence,
    diagnostics,
    modules: moduleExtraction.modules,
    globalGuardRegistrations: moduleExtraction.globalGuardRegistrations,
    globalGuardAnalysis: moduleExtraction.globalGuardAnalysis,
    contractTypes: contractExtraction.contractTypes,
    contractFields: contractExtraction.contractFields,
    requestParameters: contractExtraction.requestParameters,
    responseContracts: contractExtraction.responseContracts,
    entityColumns: typeOrmPersistence.entityColumns,
    requestFieldOrigins: [
      ...new Map(
        [
          ...requestProvenance.requestFieldOrigins,
          ...interMethodProvenance.requestFieldOrigins,
        ].map((record) => [record.id, record]),
      ).values(),
    ],
    columnInfluences: [
      ...requestProvenance.columnInfluences,
      ...interMethodProvenance.columnInfluences,
    ],
    applications: mergeApplicationRecords(
      nestEventEmitter.applications,
      nestMicroservices.applications,
    ),
    interactions: mergeInteractionRecords(
      outboundHttp.interactions,
      nestHttpService.interactions,
      nestEventEmitter.interactions,
      nestBullMq.interactions,
      nestMicroservices.interactions,
    ),
    interactionHandlers,
    interactionHandlerDispatches: nestBullMq.handlerDispatches,
    interactionHandlerBranches: nestBullMq.handlerBranches,
    interactionHandlerBranchEffects,
    authorizationMetadata: authorizationExtraction.metadata,
    authorizationEnforcements: authorizationExtraction.enforcements,
    resourceAccesses: [
      ...resourceAccesses.resourceAccesses,
      ...redlockCriticalSections.resourceAccesses,
    ],
    resourceAccessAnalysis: {
      supportedTechnologies: [...RESOURCE_TECHNOLOGIES],
      enabledTechnologies: [...RESOURCE_TECHNOLOGIES],
      state:
        resourceAccesses.state === 'incomplete' || redlockCriticalSections.state === 'incomplete'
          ? 'incomplete'
          : 'complete',
    },
    criticalSections,
    interactionAnalysis: {
      schemaKinds: [...INTERACTION_KINDS],
      supportedKinds: [...SUPPORTED_INTERACTION_KINDS],
      enabledKinds: [...SUPPORTED_INTERACTION_KINDS],
      state:
        outboundHttp.state === 'incomplete' ||
        nestHttpService.state === 'incomplete' ||
        nestEventEmitter.state === 'incomplete' ||
        nestBullMq.state === 'incomplete' ||
        nestMicroservices.state === 'incomplete'
          ? 'incomplete'
          : 'complete',
    },
  });
  const validatedAnalysis = assertValidAnalysisDocument(analysis);
  options.signal?.throwIfAborted();
  const endedAt = now();
  const run = canonicalizeRunDocument(
    runDocumentSchema.parse({
      schemaVersion: CURRENT_ANALYSIS_SCHEMA_VERSION,
      analysisId,
      repositoryPath: repositoryRoot,
      repositoryRevision,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
      resultState,
      tool,
      configuration,
      diagnostics,
    }),
  );

  return { analysis: validatedAnalysis, run, inventory, project, sourceIndex };
}
