import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { renderEndpointContractsMarkdown } from '../../../src/reporting/endpoint-contracts.js';
import {
  writeFakeClassValidator,
  writeFakeNestCommon,
  writeFakeNestMappedTypes,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('Phase 19 request/response and column contracts', () => {
  it('satisfies the frozen contract corpus without runtime validation or serialization claims', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestMappedTypes(project);
      await writeFakeClassValidator(project);
      await writeFakeTypeOrm(project);
      const frozen = await readFile(
        resolve('test/fixtures/post-mvp/contracts/contracts.ts.txt'),
        'utf8',
      );
      await project.write(
        'src/contracts.ts',
        `${frozen}\n@Controller('mapped')\nclass MappedController {\n  @Post()\n  update(@Body() dto: UpdateNoteDto): NoteViewDto { void dto; return new NoteViewDto(); }\n}\n`,
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      expect(analysis.schemaVersion).toBe('8.0.0');
      if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });

      const methods = new Map(analysis.methods.map((method) => [method.id, method]));
      const types = new Map(analysis.contractTypes.map((type) => [type.id, type]));
      const createParameters = analysis.requestParameters
        .filter(
          (parameter) =>
            methods.get(parameter.methodId)?.qualifiedName === 'NotesController.create',
        )
        .map((parameter) => ({
          index: parameter.parameterIndex,
          name: parameter.parameterName,
          source: parameter.sourceKind,
          selector: parameter.selector,
          selectorState: parameter.selectorState,
          type: parameter.declaredType.typeText,
        }))
        .sort((left, right) => left.index - right.index);
      expect(createParameters).toEqual([
        {
          index: 0,
          name: 'tenantId',
          source: 'param',
          selector: 'tenantId',
          selectorState: 'literal',
          type: 'string',
        },
        {
          index: 1,
          name: 'dto',
          source: 'body',
          selector: null,
          selectorState: 'whole',
          type: 'CreateNoteDto',
        },
        {
          index: 2,
          name: 'dryRun',
          source: 'query',
          selector: 'dryRun',
          selectorState: 'literal',
          type: 'string',
        },
      ]);

      const createType = analysis.contractTypes.find(
        (type) => type.qualifiedName === 'CreateNoteDto',
      )!;
      expect(
        analysis.contractFields
          .filter((field) => field.contractTypeId === createType.id)
          .map((field) => ({
            name: field.name,
            inherited: field.inherited,
            optional: field.optional,
            constraints: field.declaredConstraints.map((constraint) => constraint.name).sort(),
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ).toEqual([
        {
          name: 'clientRequestId',
          inherited: true,
          optional: true,
          constraints: ['IsOptional'],
        },
        { name: 'summary', inherited: false, optional: true, constraints: ['IsOptional'] },
        {
          name: 'title',
          inherited: false,
          optional: false,
          constraints: ['IsString', 'MaxLength'],
        },
      ]);

      const unionParameter = analysis.requestParameters.find(
        (parameter) => methods.get(parameter.methodId)?.qualifiedName === 'NotesController.import',
      )!;
      expect(unionParameter.declaredType.kind).toBe('union');
      expect(
        unionParameter.declaredType.contractTypeIds.map((id) => types.get(id)?.displayName).sort(),
      ).toEqual(['ImportNoteDto', 'LegacyNoteDto']);

      const mapped = analysis.contractTypes.find((type) => type.displayName === 'UpdateNoteDto')!;
      expect(mapped.shapeSource).toBe('checker_derived');
      expect(
        analysis.contractFields
          .filter((field) => field.contractTypeId === mapped.id)
          .every((field) => field.shapeSource === 'checker_derived'),
      ).toBe(true);

      const responsesByMethod = new Map(
        analysis.responseContracts.map((response) => [
          methods.get(response.methodId)?.qualifiedName,
          response,
        ]),
      );
      expect(responsesByMethod.get('NotesController.create')).toMatchObject({
        outerTypeText: 'Promise<NoteViewDto>',
        promiseUnwrapped: true,
        handling: 'return_value',
        declaredType: { typeText: 'NoteViewDto', kind: 'contract' },
      });
      expect(responsesByMethod.get('NotesController.manual')).toMatchObject({
        handling: 'manual',
        outerTypeText: 'void',
      });
      expect(responsesByMethod.get('NotesController.untyped')).toMatchObject({
        handling: 'return_value',
        declaredType: { kind: 'any' },
      });

      const noteEntity = analysis.entities.find((entity) => entity.displayName === 'Note')!;
      expect(
        analysis.entityColumns
          .filter((column) => column.entityId === noteEntity.id)
          .map((column) => ({
            property: column.propertyName,
            database: column.databaseName,
            source: column.databaseNameSource,
            kind: column.columnKind,
            insert: column.insert,
            update: column.update,
            transformer: column.transformer,
          }))
          .sort((left, right) => left.property.localeCompare(right.property)),
      ).toEqual([
        {
          property: 'id',
          database: 'id',
          source: 'property_name_fallback',
          kind: 'primary_generated',
          insert: true,
          update: true,
          transformer: 'absent',
        },
        {
          property: 'internalCode',
          database: 'internal_code',
          source: 'explicit',
          kind: 'regular',
          insert: true,
          update: false,
          transformer: 'absent',
        },
        {
          property: 'title',
          database: 'note_title',
          source: 'explicit',
          kind: 'regular',
          insert: true,
          update: true,
          transformer: 'present',
        },
      ]);
      expect(
        analysis.requestParameters.some((parameter) => parameter.parameterName === 'value'),
        'the same-named LocalBody lookalike must not become a request binding',
      ).toBe(false);

      const report = renderEndpointContractsMarkdown(analysis);
      expect(report).toContain('static declaration inventory');
      expect(report).toContain('do not prove');
      expect(report).toContain('`body`');
      expect(report).toContain('`CreateNoteDto`');
      expect(report).toContain('`checker_derived`');
      expect(report).toContain('No serialized response schema is claimed');
      expect(report).toContain('`note_title`');
      expect(report).toContain('naming strategies');
    } finally {
      await project.cleanup();
    }
  }, 20_000);

  it('keeps same-named contracts distinct and labels inheritance, arrays, unions, and dynamic columns', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeTypeOrm(project);
      await project.write(
        'src/alpha.ts',
        'export interface SharedDto { readonly alpha?: string; }\n',
      );
      await project.write('src/beta.ts', 'export interface SharedDto { beta: number; }\n');
      await project.write(
        'src/app.ts',
        [
          "import { Body, Controller, Get, Post } from '@nestjs/common';",
          "import { Column, Entity } from 'typeorm';",
          "import type { SharedDto as Alpha } from './alpha.js';",
          "import type { SharedDto as Beta } from './beta.js';",
          'declare const dynamicOptions: unknown;',
          'class BaseRecord { @Column() inherited!: string; }',
          '@Entity() class DerivedRecord extends BaseRecord {',
          '  @Column(dynamicOptions) dynamic!: string;',
          '}',
          "@Controller('contracts') class ContractController {",
          "  @Post('alpha') alpha(@Body() dto: Alpha): Alpha[] { return [dto]; }",
          "  @Post('beta') beta(@Body() dto: Beta): Beta | void { return dto; }",
          "  @Get('none') none(): void {}",
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      expect(analysis.schemaVersion).toBe('8.0.0');
      if (analysis.schemaVersion !== '8.0.0') throw new Error('Expected analysis v8.');
      const sameNamed = analysis.contractTypes.filter((type) => type.displayName === 'SharedDto');
      expect(sameNamed).toHaveLength(2);
      expect(new Set(sameNamed.map((type) => type.id)).size).toBe(2);
      expect(new Set(sameNamed.map((type) => type.sourceFileId)).size).toBe(2);

      const methods = new Map(analysis.methods.map((method) => [method.id, method]));
      const responses = new Map(
        analysis.responseContracts.map((response) => [
          methods.get(response.methodId)?.displayName,
          response,
        ]),
      );
      expect(responses.get('alpha')?.declaredType.kind).toBe('array');
      expect(responses.get('beta')?.declaredType.kind).toBe('union');
      expect(responses.get('none')?.declaredType.kind).toBe('void');

      const entity = analysis.entities.find((record) => record.displayName === 'DerivedRecord')!;
      const inherited = analysis.entityColumns.find(
        (column) => column.entityId === entity.id && column.propertyName === 'inherited',
      )!;
      const dynamic = analysis.entityColumns.find(
        (column) => column.entityId === entity.id && column.propertyName === 'dynamic',
      )!;
      expect(inherited.inherited).toBe(true);
      expect(dynamic).toMatchObject({
        databaseName: null,
        databaseNameSource: 'unknown',
        insert: null,
        update: null,
        transformer: 'unknown',
      });
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 20_000);
});
