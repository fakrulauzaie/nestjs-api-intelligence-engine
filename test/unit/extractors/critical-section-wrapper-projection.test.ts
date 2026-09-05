import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { buildGraphReportDocument } from '../../../src/graph-report/project.js';
import { serializeGraphReportDocument } from '../../../src/graph-report/ordering.js';
import { assertValidGraphReportDocument } from '../../../src/graph-report/validate.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { renderEndpointTraceMarkdown } from '../../../src/reporting/endpoint-trace-markdown.js';
import { buildControlEvidenceDocument } from '../../../src/structured-exports/control-evidence.js';
import { enrichOpenApiDocument } from '../../../src/structured-exports/openapi.js';
import { buildEndpointTrace } from '../../../src/tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../../../src/tracing/interaction-handler-trace.js';
import {
  writeFakeAxios,
  writeFakeBullMq,
  writeFakeNestAxios,
  writeFakeNestCommon,
  writeFakeNestEventEmitter,
  writeFakeNestMicroservices,
  writeFakeNestTypeOrm,
  writeFakeRedlock,
  writeFakeRxjs,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

const source = `
import { Controller, Inject, Injectable, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Queue } from 'bullmq';
import Redlock from 'redlock';
import { firstValueFrom } from 'rxjs';
import { Column, Entity, PrimaryGeneratedColumn, Repository } from 'typeorm';

@Entity('work_item')
class WorkItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  state!: string;
}

@Injectable()
class LockWrapper {
  constructor(private readonly redlock: Redlock) {}

  executeForWork<T>(key: string, task: () => Promise<T>): Promise<T> {
    return this.execute(key, task);
  }

  execute<T>(key: string, task: () => Promise<T>): Promise<T> {
    return this.redlock.using([key], 5_000, async () => task());
  }
}

@Injectable()
class WorkService {
  constructor(
    private readonly locks: LockWrapper,
    @InjectRepository(WorkItem) private readonly items: Repository<WorkItem>,
    private readonly http: HttpService,
    private readonly events: EventEmitter2,
    @InjectQueue('work') private readonly queue: Queue,
    @Inject('WORK_CLIENT') private readonly client: ClientProxy,
  ) {}

  open(id: string): Promise<string> {
    return this.locks.executeForWork(\`lock:work:\${id}\`, async () => {
      await this.items.update(id, { state: 'open' });
      await this.items
        .createQueryBuilder('item')
        .update()
        .set({ state: 'indexed' })
        .where('item.id = :id', { id })
        .execute();
      await axios.post('https://audit.example.test/work', { id });
      await firstValueFrom(this.http.post('https://search.example.test/reindex', { id }));
      this.events.emit('work.opened', { id });
      await this.queue.add('index', { id });
      this.client.emit('work.changed', { id }).subscribe();
      return this.finish(id);
    });
  }

  closed(id: string): Promise<string> {
    return this.locks.execute(\`lock:work:\${id}\`, this.finish);
  }

  @OnEvent('work.opened')
  onOpened(id: string): Promise<string> {
    return this.locks.execute(\`lock:event:\${id}\`, async () => {
      await this.items.update(id, { state: 'observed' });
      return \`observed:\${id}\`;
    });
  }

  private async finish(id: string): Promise<string> {
    return \`done:\${id}\`;
  }
}

@Controller('work')
class WorkController {
  constructor(private readonly work: WorkService) {}

  @Post(':id/open')
  open(): Promise<string> {
    return this.work.open('runtime-id');
  }
}
`;

describe('verified critical-section wrapper call-site projection', () => {
  it('opens only the proven inline callback and scopes every downstream fact', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([
        writeFakeNestCommon(project),
        writeFakeNestTypeOrm(project),
        writeFakeTypeOrm(project),
        writeFakeRedlock(project),
        writeFakeAxios(project),
        writeFakeRxjs(project),
        writeFakeNestAxios(project),
        writeFakeNestEventEmitter(project),
        writeFakeBullMq(project),
        writeFakeNestMicroservices(project),
      ]);
      await project.write('src/work.ts', source);
      await writeBasicTsconfig(project);

      const first = await scanRepository({ repositoryRoot: project.path });
      const second = await scanRepository({ repositoryRoot: project.path });
      const { analysis } = first;
      if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
      expect(validateAnalysisDocument(analysis)).toEqual({ success: true, data: analysis });
      expect(serializeCanonicalAnalysis(second.analysis)).toBe(
        serializeCanonicalAnalysis(analysis),
      );

      const methodByName = new Map(
        analysis.methods.map((method) => [method.qualifiedName, method]),
      );
      const openMethod = methodByName.get('WorkService.open')!;
      const closedMethod = methodByName.get('WorkService.closed')!;
      const forwardingMethod = methodByName.get('LockWrapper.executeForWork')!;
      const openSection = analysis.criticalSections.find(
        ({ sourceMethodId }) => sourceMethodId === openMethod.id,
      );
      expect(openSection).toMatchObject({
        callbackKind: 'inline_arrow',
        ruleId: 'resource.redlock.verified-wrapper.v1',
      });
      expect(
        analysis.criticalSections.some(({ sourceMethodId }) => sourceMethodId === closedMethod.id),
      ).toBe(false);
      expect(
        analysis.diagnostics.find(
          ({ code, subjectId }) =>
            code === 'CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN' && subjectId === closedMethod.id,
        ),
      ).toMatchObject({ severity: 'warning' });
      expect(
        analysis.diagnostics.some(
          ({ code, subjectId }) =>
            code === 'CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN' && subjectId === forwardingMethod.id,
        ),
      ).toBe(false);

      const openInteractions = analysis.interactions.filter(
        ({ sourceMethodId }) => sourceMethodId === openMethod.id,
      );
      expect(openInteractions.map(({ kind }) => kind).sort()).toEqual([
        'in_process_event',
        'job_queue',
        'microservice_message',
        'outbound_http',
        'outbound_http',
      ]);
      const scopedAssertions = new Set(openSection?.effectAssertionIds ?? []);
      expect(
        analysis.assertions
          .filter(({ id }) => scopedAssertions.has(id))
          .map(({ predicate }) => predicate),
      ).toEqual(
        expect.arrayContaining([
          'METHOD_CALLS_METHOD',
          'METHOD_WRITES_TABLE',
          'METHOD_INITIATES_INTERACTION',
        ]),
      );
      for (const interaction of openInteractions) {
        const assertion = analysis.assertions.find(
          ({ predicate, objectId }) =>
            predicate === 'METHOD_INITIATES_INTERACTION' && objectId === interaction.id,
        );
        expect(scopedAssertions.has(assertion!.id)).toBe(true);
      }

      const trace = buildEndpointTrace(analysis, {
        httpMethod: 'POST',
        path: '/work/:id/open',
      });
      expect(trace.status).toBe('resolved');
      if (trace.status !== 'resolved') throw new Error('Expected endpoint trace.');
      expect(
        trace.trace.terminals.find(({ tableName }) => tableName === 'work_item')?.causalClass,
      ).toBe('critical_section_conditional');
      expect(trace.trace.causalSummary?.outboundInteractionIds).toHaveLength(2);
      expect(trace.trace.causalSummary?.localInteractionIds).toHaveLength(1);
      expect(trace.trace.causalSummary?.distributedInteractionIds).toHaveLength(2);

      const markdown = renderEndpointTraceMarkdown({
        analysis,
        trace: trace.trace,
        diagnostics: trace.diagnostics,
      });
      expect(markdown).toContain('Critical-section conditional effects: 1');

      const eventHandlerMethod = methodByName.get('WorkService.onOpened')!;
      const eventHandler = analysis.interactionHandlers.find(
        ({ kind, methodId }) => kind === 'in_process_event' && methodId === eventHandlerMethod.id,
      )!;
      const handlerTrace = buildInteractionHandlerTrace(analysis, eventHandler.id);
      expect(handlerTrace.status).toBe('resolved');
      if (handlerTrace.status !== 'resolved') throw new Error('Expected handler trace.');
      expect(
        handlerTrace.trace.terminals.find(({ tableName }) => tableName === 'work_item')
          ?.causalClass,
      ).toBe('critical_section_conditional');

      const policyResults = evaluatePolicies({
        analysis,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: {
            'require-guard-on-write-endpoint': ['error', { onUnknown: 'error' }],
          },
        }),
      });
      expect(policyResults.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'require-guard-on-write-endpoint',
            outcome: 'unknown',
            reasonCode: 'write_endpoint_guard_unknown',
          }),
        ]),
      );

      const controls = buildControlEvidenceDocument({ analysis, policyResults });
      const controlRow = controls.rows.find(({ path }) => path === '/work/:id/open')!;
      expect(controls.schemaVersion).toBe('5.0.0');
      expect(controlRow.analysisSchemaVersion).toBe('8.0.0');
      expect(controlRow.dbWrites).toEqual([]);
      expect(controlRow.mutationClassification).toBe('non_write');
      expect(controlRow).not.toHaveProperty('criticalSectionConditionalEffects');

      const openApi = enrichOpenApiDocument({
        analysis,
        openApi: {
          openapi: '3.1.0',
          info: { title: 'Work API', version: '1' },
          paths: { '/work/{id}/open': { post: {} } },
        },
      });
      expect(openApi.enrichedDocument).toMatchObject({
        paths: {
          '/work/{id}/open': {
            post: {
              'x-api-intel': {
                schemaVersion: '5.0.0',
                resolution: 'resolved',
                dbWrites: [],
              },
            },
          },
        },
      });

      const graph = buildGraphReportDocument({ analysis, policyResults });
      expect(assertValidGraphReportDocument({ document: graph, analysis, policyResults })).toEqual(
        graph,
      );
      const endpointScene = graph.endpoints.find(({ path }) => path === '/work/:id/open')!.scene;
      const wrapperNode = endpointScene.nodes.find(({ id }) => id === openSection!.id)!;
      expect(wrapperNode.label).toBe('verified wrapper critical section (1 lock resource)');
      expect(
        endpointScene.edges.find(({ id }) => id === `critical-scope:${openSection!.id}`)?.label,
      ).toBe('static wrapper callback projection');
      const wrapperEvidence = new Set(wrapperNode.evidenceIds);
      expect(
        endpointScene.evidence
          .filter(({ id }) => wrapperEvidence.has(id))
          .flatMap(({ snippet }) => (snippet === null ? [] : [snippet])),
      ).toEqual(
        expect.arrayContaining([
          'this.locks.executeForWork',
          'task',
          'this.execute',
          'this.redlock.using',
        ]),
      );
      const repeatedPolicyResults = evaluatePolicies({
        analysis: second.analysis,
        configuration: policyResults.configuration,
      });
      const repeatedGraph = buildGraphReportDocument({
        analysis: second.analysis,
        policyResults: repeatedPolicyResults,
      });
      expect(
        serializeGraphReportDocument({
          document: repeatedGraph,
          analysis: second.analysis,
          policyResults: repeatedPolicyResults,
        }),
      ).toBe(serializeGraphReportDocument({ document: graph, analysis, policyResults }));

      const withoutOpenWrapper = source
        .replace(
          '    return this.locks.executeForWork(`lock:work:${id}`, async () => {',
          '    return (async () => {',
        )
        .replace(
          '      return this.finish(id);\n    });\n  }\n\n  closed',
          '      return this.finish(id);\n    })();\n  }\n\n  closed',
        );
      await project.write('src/work.ts', withoutOpenWrapper);
      const changed = await scanRepository({ repositoryRoot: project.path });
      const diff = compareAnalysisDocuments(analysis, changed.analysis);
      expect(diff.endpointChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            change: 'modified',
            reasons: expect.arrayContaining(['resource_accesses']),
          }),
        ]),
      );
      const impact = analyzePotentialImpact(analysis, changed.analysis);
      expect(impact.impactedEndpoints.map(({ path }) => path)).toContain('/work/:id/open');
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('diagnoses an ambiguous verified-wrapper target without opening its callback', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await Promise.all([writeFakeNestCommon(project), writeFakeRedlock(project)]);
      await project.write(
        'src/ambiguous.ts',
        `
import { Injectable } from '@nestjs/common';
import Redlock from 'redlock';

@Injectable()
class FirstLockWrapper {
  constructor(private readonly redlock: Redlock) {}
  execute<T>(key: string, task: () => Promise<T>): Promise<T> {
    return this.redlock.using([key], 5_000, async () => task());
  }
}

@Injectable()
class SecondLockWrapper {
  constructor(private readonly redlock: Redlock) {}
  execute<T>(key: string, task: () => Promise<T>): Promise<T> {
    return this.redlock.using([key], 5_000, async () => task());
  }
}

@Injectable()
class AmbiguousCaller {
  constructor(private readonly locks: FirstLockWrapper | SecondLockWrapper) {}
  run(): Promise<string> {
    return this.locks.execute('lock:ambiguous', async () => 'closed');
  }
}
`,
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
      const caller = analysis.methods.find(({ qualifiedName }) =>
        qualifiedName.endsWith('AmbiguousCaller.run'),
      )!;
      expect(
        analysis.diagnostics.find(
          ({ code, subjectId }) =>
            code === 'CRITICAL_SECTION_WRAPPER_TARGET_AMBIGUOUS' && subjectId === caller.id,
        ),
      ).toMatchObject({ severity: 'warning' });
      expect(
        analysis.criticalSections.some(({ sourceMethodId }) => sourceMethodId === caller.id),
      ).toBe(false);
    } finally {
      await project.cleanup();
    }
  }, 20_000);
});
