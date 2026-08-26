import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/analysis/scan-repository.js';
import { compareAnalysisDocuments } from '../../src/comparison/compare.js';
import { analyzePotentialImpact } from '../../src/impact/analyze.js';
import { normalizePolicyConfiguration } from '../../src/policy/config.js';
import { evaluatePolicies } from '../../src/policy/evaluate.js';
import { buildEndpointTrace } from '../../src/tracing/endpoint-trace.js';
import {
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

const controllerSource = `import { Controller, Get, Injectable, Post, UseGuards } from '@nestjs/common';
import { NotesService } from './notes.service';

@Injectable()
class WriteGuard {}

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  read() { return this.notes.read(); }

  @Post()
  @UseGuards(WriteGuard)
  write() { return this.notes.write(); }
}
`;

function serviceSource(queryBuilder: boolean): string {
  const read = queryBuilder
    ? `return this.notes.createQueryBuilder('note').getMany();`
    : `return Promise.resolve([] as Note[]);`;
  const write = queryBuilder
    ? `return this.notes.createQueryBuilder('note').insert().into(Note).values({}).execute();`
    : `return Promise.resolve({});`;
  return `import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Entity, Repository } from 'typeorm';

@Entity('note')
export class Note {}

@Injectable()
export class NotesService {
  constructor(@InjectRepository(Note) private readonly notes: Repository<Note>) {}
  read(): Promise<Note[]> { ${read} }
  write(): Promise<unknown> { ${write} }
}
`;
}

describe('Phase 17 downstream consumers', () => {
  it('uses QueryBuilder terminals in trace, diff, impact, and policy views without special inference', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestTypeOrm(project);
      await writeFakeTypeOrm(project);
      await project.write('src/notes.controller.ts', controllerSource);
      await project.write('src/notes.service.ts', serviceSource(false));
      await writeBasicTsconfig(project);
      const before = (await scanRepository({ repositoryRoot: project.path })).analysis;

      await project.write('src/notes.service.ts', serviceSource(true));
      const after = (await scanRepository({ repositoryRoot: project.path })).analysis;

      expect(buildEndpointTrace(after, { httpMethod: 'GET', path: '/notes' })).toMatchObject({
        status: 'resolved',
        trace: { terminals: [{ direction: 'READ', tableName: 'note' }] },
      });
      expect(buildEndpointTrace(after, { httpMethod: 'POST', path: '/notes' })).toMatchObject({
        status: 'resolved',
        trace: { terminals: [{ direction: 'WRITE', tableName: 'note' }] },
      });

      const diff = compareAnalysisDocuments(before, after);
      expect(
        diff.endpointChanges.filter(({ reasons }) => reasons.includes('terminals')),
      ).toHaveLength(2);

      const impact = analyzePotentialImpact(before, after);
      expect(impact.summary).toMatchObject({
        impactedEndpointSlots: 2,
        directlyChangedEndpointSlots: 0,
        transitivelyImpactedEndpointSlots: 2,
      });

      const policy = evaluatePolicies({
        analysis: after,
        baseline: before,
        configuration: normalizePolicyConfiguration({
          version: 1,
          rules: {
            'no-repository-access-in-controller': 'error',
            'require-guard-on-write-endpoint': ['error', { onUnknown: 'error' }],
            'require-complete-write-trace': ['error', { onUnknown: 'error' }],
            'no-new-diagnostics': ['error', { minimumSeverity: 'warning' }],
          },
        }),
      });
      expect(policy.summary).toMatchObject({ failed: 0, unknown: 0, blocking: 0 });
      expect(
        policy.results.find(
          ({ ruleId, subject }) =>
            ruleId === 'require-guard-on-write-endpoint' && subject.displayName === 'POST /notes',
        ),
      ).toMatchObject({ outcome: 'pass', reasonCode: 'write_endpoint_guard_declared' });
      expect(
        policy.results.find(
          ({ ruleId, subject }) =>
            ruleId === 'require-complete-write-trace' && subject.displayName === 'POST /notes',
        ),
      ).toMatchObject({ outcome: 'pass', reasonCode: 'write_trace_complete' });
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
