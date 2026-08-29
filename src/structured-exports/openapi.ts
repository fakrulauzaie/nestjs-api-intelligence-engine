import { normalizeRoutePath } from '../extractors/route-paths.js';
import {
  analysisHasAuthorizationFacts,
  analysisHasInteractionFacts,
  analysisHasJobQueueBranchFacts,
  type AnalysisDocument,
} from '../model/analysis.js';
import { canonicalStringify } from '../model/ordering.js';
import type {
  OpenApiEnrichmentResultDocument,
  OpenApiIntelExtension,
  OpenApiMatchResolution,
} from './model.js';
import {
  OPENAPI_ENRICHMENT_SCHEMA_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V4_VERSION,
  OPENAPI_ENRICHMENT_SCHEMA_V5_VERSION,
} from './model.js';
import { canonicalizeOpenApiEnrichmentResult } from './ordering.js';
import { buildEndpointExportFacts } from './endpoint-facts.js';
import {
  assertValidOpenApiEnrichmentResult,
  assertValidOpenApiIntelExtension,
} from './validate.js';

const OPENAPI_OPERATION_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

type JsonObject = Record<string, unknown>;

interface OpenApiOperationSlot {
  readonly openApiPath: string;
  readonly normalizedPath: string;
  readonly httpMethod: string;
  readonly operation: JsonObject;
}

export class OpenApiInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenApiInputError';
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeOpenApiPath(path: string): string {
  return normalizeRoutePath(path);
}

export function nestPathToOpenApiPath(path: string, pathPrefix = '/'): string {
  const converted = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/gu, '{$1}');
  return normalizeRoutePath(pathPrefix, converted);
}

function parseDocument(input: unknown): {
  readonly document: JsonObject;
  readonly version: string;
  readonly slots: readonly OpenApiOperationSlot[];
} {
  if (!isObject(input)) throw new OpenApiInputError('OpenAPI input must be a JSON object.');
  const version = input.openapi;
  if (typeof version !== 'string' || (!version.startsWith('3.0.') && !version.startsWith('3.1.'))) {
    throw new OpenApiInputError('Only OpenAPI 3.0.x and 3.1.x JSON documents are supported.');
  }
  if (!isObject(input.paths)) throw new OpenApiInputError('OpenAPI input must contain paths.');
  const slots: OpenApiOperationSlot[] = [];
  for (const [openApiPath, pathItem] of Object.entries(input.paths)) {
    if (!openApiPath.startsWith('/') || !isObject(pathItem)) {
      throw new OpenApiInputError(`Invalid OpenAPI path item ${openApiPath}.`);
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      const normalizedMethod = method.toLowerCase();
      if (!OPENAPI_OPERATION_METHODS.has(normalizedMethod)) continue;
      if (!isObject(operation)) {
        throw new OpenApiInputError(
          `OpenAPI operation ${method.toUpperCase()} ${openApiPath} must be an object.`,
        );
      }
      slots.push({
        openApiPath,
        normalizedPath: normalizeOpenApiPath(openApiPath),
        httpMethod: normalizedMethod.toUpperCase(),
        operation,
      });
    }
  }
  return { document: input, version, slots };
}

export interface OpenApiEnrichment {
  readonly enrichedDocument: JsonObject;
  readonly result: OpenApiEnrichmentResultDocument;
}

export function enrichOpenApiDocument(input: {
  readonly analysis: AnalysisDocument;
  readonly openApi: unknown;
  readonly pathPrefix?: string | undefined;
  readonly includeEvidence?: boolean | undefined;
}): OpenApiEnrichment {
  if (input.analysis.resultState === 'failed' || input.analysis.resultState === 'canceled') {
    throw new OpenApiInputError(`Analysis state ${input.analysis.resultState} is not exportable.`);
  }
  const parsed = parseDocument(structuredClone(input.openApi));
  const pathPrefix = normalizeRoutePath(input.pathPrefix ?? '/');
  const includeEvidence = input.includeEvidence === true;
  const hasDistributedInteractionRecords =
    analysisHasInteractionFacts(input.analysis) &&
    (input.analysis.interactions.some(({ kind }) => kind === 'job_queue') ||
      input.analysis.interactions.some(({ kind }) => kind === 'microservice_message') ||
      input.analysis.interactionHandlers.some(
        ({ kind }) => kind === 'job_queue' || kind === 'microservice_message',
      ));
  const schemaVersion = analysisHasAuthorizationFacts(input.analysis)
    ? OPENAPI_ENRICHMENT_SCHEMA_V5_VERSION
    : analysisHasJobQueueBranchFacts(input.analysis)
      ? OPENAPI_ENRICHMENT_SCHEMA_V4_VERSION
      : hasDistributedInteractionRecords
        ? OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION
        : analysisHasInteractionFacts(input.analysis)
          ? OPENAPI_ENRICHMENT_SCHEMA_V2_VERSION
          : OPENAPI_ENRICHMENT_SCHEMA_VERSION;
  const factsByEndpoint = buildEndpointExportFacts({ analysis: input.analysis });
  const endpointsBySlot = new Map<string, string[]>();
  for (const endpoint of input.analysis.endpoints) {
    const key = `${endpoint.httpMethod}:${nestPathToOpenApiPath(endpoint.path, pathPrefix)}`;
    endpointsBySlot.set(key, [...(endpointsBySlot.get(key) ?? []), endpoint.id]);
  }
  const duplicateOpenApiSlots = new Map<string, number>();
  for (const slot of parsed.slots) {
    const key = `${slot.httpMethod}:${slot.normalizedPath}`;
    duplicateOpenApiSlots.set(key, (duplicateOpenApiSlots.get(key) ?? 0) + 1);
  }

  const seenAnalysisEndpointIds = new Set<string>();
  const operations = parsed.slots.map((slot) => {
    const key = `${slot.httpMethod}:${slot.normalizedPath}`;
    const candidates = [...(endpointsBySlot.get(key) ?? [])].sort();
    candidates.forEach((id) => seenAnalysisEndpointIds.add(id));
    const duplicateOpenApi = (duplicateOpenApiSlots.get(key) ?? 0) > 1;
    let resolution: OpenApiMatchResolution;
    if (duplicateOpenApi || candidates.length > 1) resolution = 'ambiguous';
    else if (candidates.length === 0) resolution = 'unmatched';
    else {
      const facts = factsByEndpoint.get(candidates[0]!);
      resolution = facts?.endpoint.selectionStatus === 'resolved' ? 'resolved' : 'unresolved';
    }

    let extension: OpenApiIntelExtension;
    let evidenceIds: readonly string[] = [];
    if (resolution === 'resolved') {
      const endpointId = candidates[0]!;
      const facts = factsByEndpoint.get(endpointId)!;
      evidenceIds = facts.evidenceIds;
      extension = {
        schemaVersion,
        resolution: 'resolved',
        analysisId: input.analysis.analysisRun.id,
        endpointId,
        guards: {
          direct: facts.endpoint.directGuards.map(({ name }) => name),
          global: facts.endpoint.globalGuards.map(({ name }) => name),
          directState: facts.endpoint.directGuardState,
          globalState: facts.endpoint.globalGuardState,
          effectiveState: facts.endpoint.effectiveGuardState,
        },
        dbReads: facts.dbReads,
        dbWrites: facts.dbWrites,
        diagnosticCodes: facts.diagnostics.map(({ code }) => code),
        evidenceIds: includeEvidence ? facts.evidenceIds : [],
        ...(analysisHasInteractionFacts(input.analysis)
          ? {
              outboundInteractions: facts.outboundInteractions,
              localInteractions: facts.localInteractions,
              localCausalEffects: facts.localCausalEffects,
              ...(schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_V3_VERSION ||
              schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_V4_VERSION ||
              schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_V5_VERSION
                ? {
                    distributedInteractions: facts.distributedInteractions,
                    distributedConditionalEffects: facts.distributedConditionalEffects,
                  }
                : {}),
              ...(schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_V4_VERSION ||
              schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_V5_VERSION
                ? { jobQueueBranchIds: facts.jobQueueBranchIds }
                : {}),
            }
          : {}),
        ...(schemaVersion === OPENAPI_ENRICHMENT_SCHEMA_V5_VERSION
          ? { authorizationRequirements: facts.authorizationRequirements }
          : {}),
      };
    } else {
      extension = {
        schemaVersion,
        resolution,
        analysisId: input.analysis.analysisRun.id,
        candidateEndpointIds: candidates,
        diagnosticCodes: [],
        evidenceIds: [],
      };
    }
    slot.operation['x-api-intel'] = assertValidOpenApiIntelExtension(extension);
    return {
      openApiPath: slot.openApiPath,
      normalizedPath: slot.normalizedPath,
      httpMethod: slot.httpMethod,
      resolution,
      analysisEndpointIds: candidates,
      evidenceIds,
    };
  });

  const unmatchedAnalysisEndpoints = input.analysis.endpoints
    .filter(({ id }) => !seenAnalysisEndpointIds.has(id))
    .map((endpoint) => ({
      endpointId: endpoint.id,
      httpMethod: endpoint.httpMethod,
      path: endpoint.path,
      mappedOpenApiPath: nestPathToOpenApiPath(endpoint.path, pathPrefix),
    }));
  const result = canonicalizeOpenApiEnrichmentResult({
    schemaVersion,
    analysisId: input.analysis.analysisRun.id,
    analysisSchemaVersion: input.analysis.schemaVersion,
    openApiVersion: parsed.version,
    pathPrefix,
    extensionEvidence: includeEvidence ? 'included' : 'sidecar_only',
    summary: {
      operations: operations.length,
      resolved: operations.filter(({ resolution }) => resolution === 'resolved').length,
      ambiguous: operations.filter(({ resolution }) => resolution === 'ambiguous').length,
      unresolved: operations.filter(({ resolution }) => resolution === 'unresolved').length,
      unmatched: operations.filter(({ resolution }) => resolution === 'unmatched').length,
      unmatchedAnalysisEndpoints: unmatchedAnalysisEndpoints.length,
    },
    operations,
    unmatchedAnalysisEndpoints,
  });
  return {
    enrichedDocument: parsed.document,
    result: assertValidOpenApiEnrichmentResult(result, input.analysis),
  };
}

export function serializeEnrichedOpenApi(document: JsonObject): string {
  return canonicalStringify(document);
}
