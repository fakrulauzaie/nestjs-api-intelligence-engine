import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { renderEndpointContractsMarkdown } from '../../../src/reporting/endpoint-contracts.js';
import {
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('Phase 20 bounded request-to-column provenance', () => {
  it('classifies the frozen direct, derived, ambiguous, unknown, and unsupported cases', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestTypeOrm(project);
      await writeFakeTypeOrm(project);
      await project.write(
        'src/provenance.ts',
        await readFile('test/fixtures/post-mvp/provenance/provenance.ts.txt', 'utf8'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      if (analysis.schemaVersion !== '5.0.0') throw new Error('Expected analysis v5.');
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });

      const methods = new Map(analysis.methods.map((method) => [method.id, method]));
      const origins = new Map(analysis.requestFieldOrigins.map((origin) => [origin.id, origin]));
      const parameters = new Map(
        analysis.requestParameters.map((parameter) => [parameter.id, parameter]),
      );
      const columns = new Map(analysis.entityColumns.map((column) => [column.id, column]));
      const assertions = new Map(analysis.assertions.map((assertion) => [assertion.id, assertion]));
      const facts = analysis.columnInfluences.map((influence) => {
        const origin = origins.get(influence.originId)!;
        return {
          method: methods.get(influence.methodId)?.displayName,
          parameter: parameters.get(origin.requestParameterId)?.parameterName,
          field: origin.propertyPath.join('.'),
          originResolution: origin.resolution,
          contractFields: origin.contractFieldIds.length,
          column: columns.get(influence.columnId)?.propertyName,
          database: columns.get(influence.columnId)?.databaseName,
          state: influence.state,
          sink: influence.sinkKind,
          assertion: assertions.get(influence.assertionId)?.status,
          callDepth: influence.callPath.length,
        };
      });
      const forMethod = (method: string) => facts.filter((fact) => fact.method === method);

      expect(forMethod('direct')).toEqual([
        expect.objectContaining({
          parameter: 'dto',
          field: 'title',
          column: 'title',
          database: 'note_title',
          state: 'direct',
          sink: 'repository_insert',
          assertion: 'resolved',
        }),
      ]);
      expect(forMethod('derived')).toEqual([
        expect.objectContaining({
          parameter: 'dto',
          field: 'title',
          column: 'slug',
          state: 'derived',
          sink: 'repository_update',
        }),
      ]);
      expect(forMethod('destructured')).toEqual([
        expect.objectContaining({ field: 'title', column: 'title', state: 'direct' }),
      ]);
      expect(forMethod('ambiguous')).toEqual([
        expect.objectContaining({
          originResolution: 'ambiguous',
          contractFields: 2,
          assertion: 'ambiguous',
        }),
      ]);
      expect(forMethod('mapped')).toEqual([
        expect.objectContaining({ field: 'title', column: 'title', state: 'unknown' }),
      ]);
      for (const method of ['review', 'staticField', 'spread', 'computed', 'save']) {
        expect(forMethod(method), method).toEqual([]);
      }
      expect(
        facts.some(
          (fact) =>
            fact.method === 'create' &&
            fact.parameter === 'dto' &&
            fact.column === 'title' &&
            fact.callDepth === 1,
        ),
        'the proven DTO argument must map to the service parameter without a reachability shortcut',
      ).toBe(true);

      const diagnosticMethods = analysis.diagnostics
        .filter(({ code }) => code.startsWith('REQUEST_PROVENANCE_'))
        .map(({ subjectId }) =>
          subjectId === undefined ? undefined : methods.get(subjectId)?.displayName,
        );
      expect(diagnosticMethods).toEqual(expect.arrayContaining(['spread', 'computed', 'mapped']));
      expect(renderEndpointContractsMarkdown(analysis)).toContain('Request-to-column influence');
      expect(renderEndpointContractsMarkdown(analysis)).toContain('may influence');
    } finally {
      await project.cleanup();
    }
  }, 30_000);

  it('supports selected request fields, one-hop aliases, and executed QueryBuilder values/set sinks', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestTypeOrm(project);
      await writeFakeTypeOrm(project);
      await project.write(
        'src/query-provenance.ts',
        `import { Body, Controller, Post, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Column, Entity, Repository } from 'typeorm';

@Entity('note') class Note {
  @Column({ name: 'note_title', transformer: { to: (v: string) => v, from: (v: string) => v } }) title!: string;
  @Column() slug!: string;
}

@Controller('query') class QueryController {
  constructor(@InjectRepository(Note) private readonly notes: Repository<Note>) {}

  @Post() insert(@Body('title') title: string) {
    const alias = title;
    return this.notes.createQueryBuilder('note').insert().values({ title: alias }).execute();
  }

  @Put() update(@Body('title') title: string) {
    const builder = this.notes.createQueryBuilder('note').update();
    builder.set({ slug: title.trim() });
    return builder.execute();
  }

  @Post('mutated') mutated(@Body('title') title: string) {
    let alias = title;
    alias = 'system';
    return this.notes.insert({ title: alias });
  }

  @Post('branch') branch(@Body('title') title: string) {
    if (title) return this.notes.insert({ title });
    return undefined;
  }

  @Post('loop') loop(@Body('title') title: string) {
    for (const ignored of [1]) return this.notes.insert({ title });
    return undefined;
  }

  @Post('nested') nested(@Body('title') title: string) {
    return [1].map(() => this.notes.insert({ title }));
  }

  @Post('nested-object') nestedObject(@Body('title') title: string) {
    return this.notes.insert({ title: { value: title } });
  }
}
`,
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      if (analysis.schemaVersion !== '5.0.0') throw new Error('Expected analysis v5.');
      const methods = new Map(analysis.methods.map((method) => [method.id, method.displayName]));
      const columns = new Map(analysis.entityColumns.map((column) => [column.id, column]));
      const facts = analysis.columnInfluences.map((influence) => ({
        method: methods.get(influence.methodId),
        state: influence.state,
        sink: influence.sinkKind,
        column: columns.get(influence.columnId)?.propertyName,
        transformer: columns.get(influence.columnId)?.transformer,
      }));
      expect(facts).toEqual(
        expect.arrayContaining([
          {
            method: 'insert',
            state: 'direct',
            sink: 'query_builder_insert',
            column: 'title',
            transformer: 'present',
          },
          {
            method: 'update',
            state: 'derived',
            sink: 'query_builder_update',
            column: 'slug',
            transformer: 'absent',
          },
          {
            method: 'mutated',
            state: 'unknown',
            sink: 'repository_insert',
            column: 'title',
            transformer: 'present',
          },
          ...['branch', 'loop', 'nested', 'nestedObject'].map((method) => ({
            method,
            state: 'unknown',
            sink: 'repository_insert',
            column: 'title',
            transformer: 'present',
          })),
        ]),
      );
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
