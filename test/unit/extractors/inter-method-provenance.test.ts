import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import {
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

const SOURCE = `import { Body, Controller, Injectable, Param, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Column, Entity, Repository } from 'typeorm';

class CreateNoteDto { title!: string; summary?: string; }

@Entity('note') class Note {
  @Column({ name: 'note_title' }) title!: string;
  @Column() slug!: string;
  @Column() reviewed!: boolean;
}

@Injectable() class WriterService {
  constructor(@InjectRepository(Note) private readonly notes: Repository<Note>) {}

  write(dto: CreateNoteDto) { return this.notes.insert({ title: dto.title }); }
  writeTitle(title: string) { return this.notes.insert({ title }); }
  combine(first: string, second: string) { return this.notes.insert({ slug: first + second }); }
  updateCriteria(id: string) { return this.notes.update(id, { reviewed: true }); }
  rest(...values: string[]) { return this.notes.insert({ title: values[0] }); }
  callback(title: string, mapper: (value: string) => string) {
    return this.notes.insert({ title: mapper(title) });
  }
  overloaded(value: string): unknown;
  overloaded(value: number): unknown;
  overloaded(value: string | number) { return this.notes.insert({ title: String(value) }); }
  uncalled(dto: CreateNoteDto) { return this.notes.insert({ slug: dto.title }); }
}

@Injectable() class MiddleService {
  constructor(private readonly writer: WriterService) {}
  forward(dto: CreateNoteDto) { return this.writer.write(dto); }
}

@Injectable() class CycleA {
  constructor(private readonly cycleB: CycleB) {}
  cycle(dto: CreateNoteDto): unknown { return this.cycleB.cycle(dto); }
}

@Injectable() class CycleB {
  constructor(private readonly cycleA: CycleA) {}
  cycle(dto: CreateNoteDto): unknown { return this.cycleA.cycle(dto); }
}

@Controller('provenance') class ProvenanceController {
  constructor(
    private readonly writer: WriterService,
    private readonly middle: MiddleService,
    private readonly cycleA: CycleA,
  ) {}

  @Post('direct') direct(@Body() dto: CreateNoteDto) { return this.writer.write(dto); }
  @Post('derived') derived(@Body() dto: CreateNoteDto) {
    return this.writer.writeTitle(dto.title.trim());
  }
  @Post('two-hop') twoHop(@Body() dto: CreateNoteDto) { return this.middle.forward(dto); }
  @Post('criteria/:id') criteria(@Param('id') id: string) {
    return this.writer.updateCriteria(id);
  }
  @Post('combined') combined(
    @Body() dto: CreateNoteDto,
    @Query('suffix') suffix: string,
  ) { return this.writer.combine(dto.title, suffix); }
  @Post('spread') spread(@Body() dto: CreateNoteDto) {
    return this.writer.rest(...[dto.title]);
  }
  @Post('callback') callback(@Body() dto: CreateNoteDto) {
    return this.writer.callback(dto.title, value => value);
  }
  @Post('overload') overload(@Body() dto: CreateNoteDto) {
    return this.writer.overloaded(dto.title);
  }
  @Post('cycle') cycle(@Body() dto: CreateNoteDto) { return this.cycleA.cycle(dto); }
}
`;

async function analyze(maxCallDepth = 3) {
  const project = await createTestTypeScriptProject();
  await writeFakeNestCommon(project);
  await writeFakeNestTypeOrm(project);
  await writeFakeTypeOrm(project);
  await project.write('src/inter-method.ts', SOURCE);
  await writeBasicTsconfig(project);
  const result = await scanRepository({
    repositoryRoot: project.path,
    configuration: { maxCallDepth },
  });
  return { project, analysis: result.analysis };
}

describe('Phase 21 bounded inter-method request provenance', () => {
  it('maps proven call arguments through one and two service hops without reachability shortcuts', async () => {
    const { project, analysis } = await analyze();
    try {
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
      const methods = new Map(analysis.methods.map((method) => [method.id, method]));
      const origins = new Map(analysis.requestFieldOrigins.map((origin) => [origin.id, origin]));
      const parameters = new Map(
        analysis.requestParameters.map((parameter) => [parameter.id, parameter]),
      );
      const columns = new Map(analysis.entityColumns.map((column) => [column.id, column]));
      const facts = analysis.columnInfluences.map((influence) => {
        const origin = origins.get(influence.originId)!;
        const parameter = parameters.get(origin.requestParameterId)!;
        return {
          entry: methods.get(parameter.methodId)?.displayName,
          sink: methods.get(influence.methodId)?.qualifiedName,
          field: origin.propertyPath.join('.'),
          column: columns.get(influence.columnId)?.propertyName,
          state: influence.state,
          path: influence.callPath.map(
            (step) =>
              `${methods.get(step.callerMethodId)?.displayName}->${methods.get(step.calleeMethodId)?.displayName}`,
          ),
        };
      });
      const forEntry = (entry: string) => facts.filter((fact) => fact.entry === entry);

      expect(forEntry('direct')).toEqual([
        expect.objectContaining({
          sink: 'WriterService.write',
          field: 'title',
          column: 'title',
          state: 'direct',
          path: ['direct->write'],
        }),
      ]);
      expect(forEntry('derived')).toEqual([
        expect.objectContaining({
          sink: 'WriterService.writeTitle',
          field: 'title',
          column: 'title',
          state: 'derived',
        }),
      ]);
      expect(forEntry('twoHop')).toEqual([
        expect.objectContaining({
          sink: 'WriterService.write',
          field: 'title',
          column: 'title',
          state: 'direct',
          path: ['twoHop->forward', 'forward->write'],
        }),
      ]);
      expect(forEntry('combined')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'title', column: 'slug', state: 'derived' }),
          expect.objectContaining({ field: 'suffix', column: 'slug', state: 'derived' }),
        ]),
      );
      for (const entry of ['criteria', 'spread', 'callback', 'overload', 'cycle']) {
        expect(forEntry(entry), entry).toEqual([]);
      }
      expect(facts.some(({ sink }) => sink === 'WriterService.uncalled')).toBe(false);

      const codes = analysis.diagnostics.map(({ code }) => code);
      expect(codes).toContain('REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED');
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('stops before a second hop when the configured call depth is one', async () => {
    const { project, analysis } = await analyze(1);
    try {
      if (analysis.schemaVersion !== '3.0.0') throw new Error('Expected analysis v3.');
      const methods = new Map(analysis.methods.map((method) => [method.id, method]));
      const origins = new Map(analysis.requestFieldOrigins.map((origin) => [origin.id, origin]));
      const parameters = new Map(
        analysis.requestParameters.map((parameter) => [parameter.id, parameter]),
      );
      const twoHopInfluences = analysis.columnInfluences.filter((influence) => {
        const origin = origins.get(influence.originId);
        const parameter =
          origin === undefined ? undefined : parameters.get(origin.requestParameterId);
        return parameter !== undefined && methods.get(parameter.methodId)?.displayName === 'twoHop';
      });
      expect(twoHopInfluences).toEqual([]);
      expect(
        analysis.diagnostics.some(({ code }) => code === 'REQUEST_PROVENANCE_CALL_DEPTH_LIMIT'),
      ).toBe(true);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
