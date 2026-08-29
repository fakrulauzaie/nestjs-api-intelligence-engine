import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisDocument,
  type AnalysisDocumentV2,
  type AnalysisDocumentV3,
  type AnalysisDocumentV4,
  type EvidenceRecord,
  type SourceRange,
} from '../../src/model/index.js';
import { hashContent } from '../../src/model/hashing.js';
import {
  makeAnalysisRunId,
  makeAssertionId,
  makeClassId,
  makeEndpointId,
  makeEvidenceId,
  makeMethodId,
  makeSourceFileId,
} from '../../src/model/ids.js';

export const MINIMAL_SOURCE_TEXT = `@Controller('health')
export class HealthController {
  @Get()
  check(): string {
    return 'ok';
  }
}
`;

const repositoryRevision = 'fixture-revision';
const sourcePath = 'src/health.controller.ts';
const contentHash = hashContent(MINIMAL_SOURCE_TEXT);
const sourceFileId = makeSourceFileId(sourcePath, repositoryRevision);
const classId = makeClassId({
  path: sourcePath,
  qualifiedName: 'HealthController',
  repositoryRevision,
});
const methodId = makeMethodId({
  path: sourcePath,
  qualifiedClassName: 'HealthController',
  methodName: 'check',
  signature: 'check(): string',
  repositoryRevision,
});
const endpointId = makeEndpointId({
  httpMethod: 'GET',
  path: '/health',
  handlerMethodId: methodId,
  repositoryRevision,
});

function evidence(
  role: EvidenceRecord['role'],
  range: SourceRange,
  snippet: string,
): EvidenceRecord {
  return {
    id: makeEvidenceId({ fileId: sourceFileId, range, role, contentHash }),
    fileId: sourceFileId,
    ...range,
    role,
    snippet,
    contentHash,
  };
}

const classEvidence = evidence(
  'declaration',
  { startLine: 2, startColumn: 1, endLine: 7, endColumn: 2 },
  'export class HealthController',
);
const methodEvidence = evidence(
  'declaration',
  { startLine: 4, startColumn: 3, endLine: 6, endColumn: 4 },
  "check(): string { return 'ok'; }",
);
const routeEvidence = evidence(
  'decorator',
  { startLine: 3, startColumn: 3, endLine: 3, endColumn: 9 },
  '@Get()',
);

const assertionId = makeAssertionId({
  subjectId: endpointId,
  predicate: 'ENDPOINT_IMPLEMENTED_BY',
  objectId: methodId,
  ruleId: 'nest.route.standard.v1',
});

export function createMinimalAnalysisDocument(): AnalysisDocument {
  const configuration = {
    maxCallDepth: 3,
    maxSourceFileBytes: 1_048_576,
    evidenceSnippetLimit: 240,
  } as const;

  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    resultState: 'completed',
    analysisRun: {
      id: makeAnalysisRunId({
        repositoryRevision,
        tsconfigPath: 'tsconfig.json',
        toolVersion: '0.1.0',
        typescriptVersion: '5.9.3',
        configuration,
      }),
      repositoryRevision,
      tsconfigPath: 'tsconfig.json',
      tool: {
        name: 'api-intel',
        version: '0.1.0',
        typescriptVersion: '5.9.3',
      },
      configuration,
    },
    sourceFiles: [
      {
        id: sourceFileId,
        path: sourcePath,
        contentHash,
        byteLength: Buffer.byteLength(MINIMAL_SOURCE_TEXT),
      },
    ],
    classes: [
      {
        id: classId,
        sourceFileId,
        qualifiedName: 'HealthController',
        displayName: 'HealthController',
        roles: ['controller'],
        declarationEvidenceId: classEvidence.id,
      },
    ],
    methods: [
      {
        id: methodId,
        classId,
        qualifiedName: 'HealthController.check',
        displayName: 'check',
        signature: 'check(): string',
        declarationEvidenceId: methodEvidence.id,
      },
    ],
    endpoints: [{ id: endpointId, httpMethod: 'GET', path: '/health' }],
    guards: [],
    repositoryBindings: [],
    entities: [],
    tables: [],
    assertions: [
      {
        id: assertionId,
        subjectId: endpointId,
        predicate: 'ENDPOINT_IMPLEMENTED_BY',
        objectId: methodId,
        status: 'resolved',
        ruleId: 'nest.route.standard.v1',
        evidenceIds: [routeEvidence.id, methodEvidence.id],
      },
    ],
    evidence: [classEvidence, methodEvidence, routeEvidence],
    diagnostics: [],
  };
}

export function createMinimalAnalysisDocumentV2(): AnalysisDocumentV2 {
  const v1 = createMinimalAnalysisDocument();
  return {
    ...v1,
    schemaVersion: '2.0.0',
    modules: [],
    globalGuardRegistrations: [],
    globalGuardAnalysis: { completeness: 'incomplete', state: 'unknown' },
    contractTypes: [],
    contractFields: [],
    requestParameters: [],
    responseContracts: [],
    entityColumns: [],
    requestFieldOrigins: [],
    columnInfluences: [],
  };
}

export function createMinimalAnalysisDocumentV3(): AnalysisDocumentV3 {
  const v2 = createMinimalAnalysisDocumentV2();
  const configuration = {
    ...v2.analysisRun.configuration,
    interactions: {
      maxInteractionHops: 2,
      maxFanOutPerInteraction: 50,
      maxInteractionTraceStates: 1_000,
    },
  } as const;
  return {
    ...v2,
    schemaVersion: '3.0.0',
    analysisRun: {
      ...v2.analysisRun,
      id: makeAnalysisRunId({
        repositoryRevision,
        tsconfigPath: 'tsconfig.json',
        toolVersion: '0.1.0',
        typescriptVersion: '5.9.3',
        configuration,
      }),
      configuration,
    },
    applications: [],
    interactions: [],
    interactionHandlers: [],
    interactionAnalysis: {
      schemaKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      supportedKinds: [],
      enabledKinds: [],
      state: 'not_run',
    },
  };
}

export function createMinimalAnalysisDocumentV4(): AnalysisDocumentV4 {
  return {
    ...createMinimalAnalysisDocumentV3(),
    schemaVersion: '4.0.0',
    interactionHandlerDispatches: [],
    interactionHandlerBranches: [],
    interactionHandlerBranchEffects: [],
  };
}
