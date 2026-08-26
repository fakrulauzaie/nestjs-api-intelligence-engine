import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { serializeDiffDocument } from '../../../src/comparison/ordering.js';
import {
  assertValidAnalysisDocument,
  validateAnalysisDocument,
} from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { renderOfflineGraphReport } from '../../../src/graph-report/html.js';
import { serializeGraphReportDocument } from '../../../src/graph-report/ordering.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { serializeImpactDocument } from '../../../src/impact/ordering.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import {
  buildEndpointCatalogue,
  renderEndpointCatalogueMarkdown,
} from '../../../src/reporting/endpoint-catalogue.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildControlEvidenceDocument } from '../../../src/structured-exports/control-evidence.js';
import { renderControlEvidenceCsv } from '../../../src/structured-exports/csv.js';
import { enrichOpenApiDocument } from '../../../src/structured-exports/openapi.js';
import {
  serializeControlEvidenceDocument,
  serializeOpenApiEnrichmentResult,
} from '../../../src/structured-exports/ordering.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import {
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestEventEmitter,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

interface WildcardExpected {
  readonly applications: number;
  readonly interactions: number;
  readonly handlers: number;
  readonly matches: Readonly<Record<string, number>>;
  readonly diagnostics: readonly string[];
}

describe('configured EventEmitter2 wildcard extraction', () => {
  it('matches exact, *, **, and custom-delimiter listeners across bounded application roots', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeNestCore(project),
        writeFakeNestEventEmitter(project),
        writeFakeNestTypeOrm(project),
        writeFakeTypeOrm(project),
      ]);
      const [fixture, expectedText] = await Promise.all([
        readFile('test/fixtures/interactions/nest-event-emitter-wildcard.ts.txt', 'utf8'),
        readFile('test/fixtures/interactions/nest-event-emitter-wildcard.expected.json', 'utf8'),
      ]);
      const expected = JSON.parse(expectedText) as WildcardExpected;
      await project.write('src/wildcards.ts', fixture);
      await writeBasicTsconfig(project);

      const first = await scanRepository({ repositoryRoot: project.path });
      const second = await scanRepository({ repositoryRoot: project.path });
      const { analysis } = first;
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      const methodNames = new Map(
        analysis.methods.map(({ id, qualifiedName }) => [id, qualifiedName]),
      );
      const interactions = analysis.interactions.filter(({ kind }) => kind === 'in_process_event');
      const handlers = analysis.interactionHandlers.filter(
        (handler) => handler.kind === 'in_process_event',
      );
      const matchAssertions = analysis.assertions.filter(
        ({ predicate }) => predicate === 'INTERACTION_MATCHES_LOCAL_HANDLER',
      );

      expect(analysis.applications).toHaveLength(expected.applications);
      expect(interactions).toHaveLength(expected.interactions);
      expect(handlers).toHaveLength(expected.handlers);
      for (const [methodSuffix, count] of Object.entries(expected.matches)) {
        const interaction = interactions.find(({ sourceMethodId }) =>
          methodNames.get(sourceMethodId)?.endsWith(methodSuffix),
        );
        expect(interaction, methodSuffix).toBeDefined();
        expect(
          matchAssertions.filter(({ subjectId }) => subjectId === interaction?.id),
          methodSuffix,
        ).toHaveLength(count);
      }

      const wildcardHandlers = handlers.filter(({ target }) => target.pattern !== undefined);
      expect(wildcardHandlers).toHaveLength(6);
      expect(
        wildcardHandlers.every(({ configurationEvidenceIds }) => configurationEvidenceIds?.length),
      ).toBe(true);
      expect(
        matchAssertions.filter(({ ruleId }) => ruleId === 'event.in-process.wildcard-match.v1'),
      ).toHaveLength(8);
      expect(
        handlers.find(({ methodId }) =>
          methodNames.get(methodId)?.endsWith('DisabledHandler.literalOnly'),
        ),
      ).toMatchObject({
        registrationState: 'proven_registered',
        target: { identityKind: 'string', value: 'order.*' },
      });
      expect(
        handlers.find(({ methodId }) =>
          methodNames.get(methodId)?.endsWith('DynamicHandler.unknown'),
        ),
      ).toMatchObject({
        registrationState: 'registration_unknown',
        target: { identityKind: 'dynamic', value: null },
      });

      const createdTrace = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/wildcards/dot-created',
      });
      expect(createdTrace.status).toBe('resolved');
      if (createdTrace.status === 'resolved') {
        expect(createdTrace.trace.terminals).toHaveLength(5);
        expect(
          createdTrace.trace.terminals.every(
            ({ tableName, causalClass }) =>
              tableName === 'event_effect' && causalClass === 'local_interaction_synchronous',
          ),
        ).toBe(true);
        expect(createdTrace.trace.causalSummary).toMatchObject({
          synchronousEffects: [],
          outboundInteractionIds: [],
          completeness: { state: 'incomplete' },
        });
        expect(
          createdTrace.trace.causalSummary?.completeness.diagnosticCodes.length,
        ).toBeGreaterThan(0);
        expect(createdTrace.trace.causalSummary?.localInteractionEffects).toHaveLength(5);
        const traceMarkdown = renderEndpointTraceMarkdown({
          analysis,
          trace: createdTrace.trace,
          diagnostics: createdTrace.diagnostics,
        });
        expect(traceMarkdown).toContain('## Causal summary');
        expect(traceMarkdown).toContain('Local interaction effects: 5');
        expect(
          renderEndpointTraceMarkdown({
            analysis,
            trace: createdTrace.trace,
            diagnostics: createdTrace.diagnostics,
          }),
        ).toBe(traceMarkdown);
      }

      const catalogue = buildEndpointCatalogue(analysis);
      const catalogueMarkdown = renderEndpointCatalogueMarkdown(catalogue);
      expect(catalogueMarkdown).toContain('## In-process event interactions');
      expect(catalogueMarkdown).toContain('order.** [wildcard; delimiter .]');
      expect(renderEndpointCatalogueMarkdown(catalogue)).toBe(catalogueMarkdown);

      const createdInteraction = interactions.find(({ sourceMethodId }) =>
        methodNames.get(sourceMethodId)?.endsWith('DotController.dotCreated'),
      )!;
      const createdHandlerId = matchAssertions.find(
        ({ subjectId }) => subjectId === createdInteraction.id,
      )!.objectId!;
      const modified = assertValidAnalysisDocument({
        ...analysis,
        interactions: analysis.interactions.map((interaction) =>
          interaction.id === createdInteraction.id
            ? { ...interaction, dispatchTiming: 'asynchronous' as const }
            : interaction,
        ),
        interactionHandlers: analysis.interactionHandlers.map((handler) =>
          handler.id === createdHandlerId
            ? { ...handler, registrationState: 'declared_candidate' as const }
            : handler,
        ),
      });
      const modifiedDiff = compareAnalysisDocuments(analysis, modified);
      expect(modifiedDiff.schemaVersion).toBe('2.0.0');
      expect(modifiedDiff.summary).toMatchObject({
        interactionsModified: 1,
        interactionHandlersModified: 1,
      });
      expect(modifiedDiff.interactionChanges?.[0]?.reasons).toEqual(['dispatch_timing']);
      expect(modifiedDiff.interactionHandlerChanges?.[0]?.reasons).toEqual(['registration_state']);

      const removedIds = new Set([
        ...analysis.interactions.map(({ id }) => id),
        ...analysis.interactionHandlers.map(({ id }) => id),
      ]);
      const withoutInteractions = assertValidAnalysisDocument({
        ...analysis,
        interactions: [],
        interactionHandlers: [],
        assertions: analysis.assertions.filter(
          ({ subjectId, objectId }) =>
            !removedIds.has(subjectId) && (objectId === null || !removedIds.has(objectId)),
        ),
        diagnostics: analysis.diagnostics.filter(
          ({ subjectId }) => subjectId === undefined || !removedIds.has(subjectId),
        ),
      });
      const addedDiff = compareAnalysisDocuments(withoutInteractions, analysis);
      const removedDiff = compareAnalysisDocuments(analysis, withoutInteractions);
      expect(addedDiff.summary).toMatchObject({
        interactionsAdded: interactions.length,
        interactionHandlersAdded: handlers.length,
      });
      expect(removedDiff.summary).toMatchObject({
        interactionsRemoved: interactions.length,
        interactionHandlersRemoved: handlers.length,
      });
      expect(
        serializeDiffDocument(
          compareAnalysisDocuments(
            {
              ...withoutInteractions,
              assertions: [...withoutInteractions.assertions].reverse(),
            },
            {
              ...analysis,
              interactions: [...analysis.interactions].reverse(),
              interactionHandlers: [...analysis.interactionHandlers].reverse(),
              assertions: [...analysis.assertions].reverse(),
            },
          ),
        ),
      ).toBe(serializeDiffDocument(addedDiff));

      const impact = analyzePotentialImpact(analysis, modified);
      expect(
        impact.impactedEndpoints.flatMap(({ reasons }) =>
          reasons.map(({ reasonCode }) => reasonCode),
        ),
      ).toEqual(expect.arrayContaining(['interaction_modified', 'interaction_handler_modified']));
      expect(serializeImpactDocument(analyzePotentialImpact(analysis, modified))).toBe(
        serializeImpactDocument(impact),
      );

      const policyResults = evaluatePolicies({
        analysis,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: { 'require-guard-on-write-endpoint': 'error' },
        }),
      });
      const createdPolicy = policyResults.results.find(({ subject }) =>
        subject.canonicalIds.includes(
          createdTrace.status === 'resolved' ? createdTrace.trace.endpoint.id : '',
        ),
      );
      expect(createdPolicy).toMatchObject({ outcome: 'not_applicable' });

      const controls = buildControlEvidenceDocument({ analysis, policyResults });
      const createdControl = controls.rows.find(({ path }) => path === '/wildcards/dot-created')!;
      expect(controls.schemaVersion).toBe('2.0.0');
      expect(createdControl.dbWrites).toEqual([]);
      expect(createdControl.localInteractions).toHaveLength(1);
      expect(createdControl.localCausalEffects).toHaveLength(5);
      expect(renderControlEvidenceCsv(controls)).toContain('local_causal_effects');
      expect(
        serializeControlEvidenceDocument({ document: controls, analysis, policyResults }),
      ).toBe(
        serializeControlEvidenceDocument({
          document: { ...controls, rows: [...controls.rows].reverse() },
          analysis,
          policyResults,
        }),
      );

      const openApi = enrichOpenApiDocument({
        analysis,
        openApi: {
          openapi: '3.1.1',
          info: { title: 'Wildcard fixture', version: '1' },
          paths: { '/wildcards/dot-created': { post: { responses: {} } } },
        },
      });
      const extension = (
        openApi.enrichedDocument.paths as Record<string, Record<string, Record<string, unknown>>>
      )['/wildcards/dot-created']!.post!['x-api-intel'] as Record<string, unknown>;
      expect(extension).toMatchObject({ schemaVersion: '2.0.0', dbWrites: [] });
      expect(extension.localCausalEffects).toHaveLength(5);
      const repeatedOpenApi = enrichOpenApiDocument({
        analysis,
        openApi: {
          openapi: '3.1.1',
          info: { title: 'Wildcard fixture', version: '1' },
          paths: { '/wildcards/dot-created': { post: { responses: {} } } },
        },
      });
      expect(serializeOpenApiEnrichmentResult(repeatedOpenApi.result)).toBe(
        serializeOpenApiEnrichmentResult(openApi.result),
      );

      const graph = buildGraphReportDocument({ analysis });
      const createdGraph = graph.endpoints.find(({ path }) => path === '/wildcards/dot-created')!;
      expect(graph.schemaVersion).toBe('3.0.0');
      expect(createdGraph.dbWrites).toEqual([]);
      expect(createdGraph.localCausalEffects).toHaveLength(5);
      expect(
        createdGraph.scene.nodes.filter(({ kind }) => kind === 'interaction_handler'),
      ).toHaveLength(5);
      expect(createdGraph.scene.nodes.some(({ kind }) => kind === 'boundary')).toBe(true);
      expect(createdGraph.scene.edges.some(({ label }) => label === 'dispatches')).toBe(true);
      expect(createdGraph.scene.edges.some(({ label }) => label === 'delivered')).toBe(false);
      expect(
        serializeGraphReportDocument({
          document: buildGraphReportDocument({ analysis: second.analysis }),
          analysis: second.analysis,
        }),
      ).toBe(serializeGraphReportDocument({ document: graph, analysis }));
      const firstHtml = await renderOfflineGraphReport(graph);
      expect(await renderOfflineGraphReport(graph)).toBe(firstHtml);
      expect(firstHtml).toContain('interaction_handler');
      expect(firstHtml).toContain('in-process event boundary');

      for (const code of expected.diagnostics) {
        expect(
          analysis.diagnostics.map(({ code: actual }) => actual),
          code,
        ).toContain(code);
      }
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
      expect(serializeCanonicalAnalysis(second.analysis)).toBe(
        serializeCanonicalAnalysis(analysis),
      );
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
