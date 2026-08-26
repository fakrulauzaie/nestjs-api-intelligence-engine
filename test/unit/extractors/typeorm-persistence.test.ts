import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import {
  extractTypeOrmPersistence,
  TYPEORM_READ_OPERATIONS,
  TYPEORM_WRITE_OPERATIONS,
} from '../../../src/extractors/typeorm-persistence.js';
import {
  writeFakeNestCommon,
  writeFakeNestTypeOrm,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('TypeORM persistence extraction', () => {
  it('maps entities and proven repository receivers across the supported operation catalogue', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project);
      await writeFakeNestTypeOrm(project);
      await writeFakeTypeOrm(project);
      await project.write(
        'src/persistence.ts',
        [
          "import { Injectable } from '@nestjs/common';",
          "import { InjectRepository } from '@nestjs/typeorm';",
          "import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn, Repository } from 'typeorm';",
          "const EXPLICIT_TABLE = 'explicit_items';",
          '@Entity()',
          'class DefaultItem {',
          '  @PrimaryGeneratedColumn() id: number;',
          '  @Column() label: string;',
          '  @PrimaryColumn() code: string;',
          '}',
          '@Entity(EXPLICIT_TABLE)',
          'class ExplicitItem {',
          '  @Column() value: string;',
          '}',
          'class NotAnEntity { id: number; }',
          'declare const chooseEntity: boolean;',
          'const AmbiguousEntity = chooseEntity ? DefaultItem : ExplicitItem;',
          '@Injectable()',
          'class PersistenceService {',
          '  private explicitRepo: Repository<ExplicitItem>;',
          '  private fakeStore = {',
          '    find: async () => [] as DefaultItem[],',
          '    save: async (value: DefaultItem) => value,',
          '  };',
          '  constructor(',
          '    @InjectRepository(DefaultItem) private readonly defaultRepo: Repository<DefaultItem>,',
          '    @InjectRepository(ExplicitItem) explicitRepo: Repository<ExplicitItem>,',
          '    @InjectRepository(NotAnEntity) private readonly unresolvedRepo: Repository<NotAnEntity>,',
          '    @InjectRepository(AmbiguousEntity) private readonly ambiguousRepo: Repository<DefaultItem | ExplicitItem>,',
          '  ) { this.explicitRepo = explicitRepo; }',
          '  readFind() { return this.defaultRepo.find(); }',
          '  readFindOne() { return this.defaultRepo.findOne({}); }',
          '  readFindOneBy() { return this.defaultRepo.findOneBy({}); }',
          '  readFindBy() { return this.defaultRepo.findBy({}); }',
          '  readCount() { return this.defaultRepo.count(); }',
          '  readExists() { return this.defaultRepo.exists(); }',
          '  writeSave(value: DefaultItem) { return this.defaultRepo.save(value); }',
          '  writeInsert(value: DefaultItem) { return this.defaultRepo.insert(value); }',
          '  writeUpdate(value: DefaultItem) { return this.defaultRepo.update(1, value); }',
          '  writeDelete() { return this.defaultRepo.delete(1); }',
          '  writeRemove(value: DefaultItem) { return this.defaultRepo.remove(value); }',
          '  explicitRead() { return this.explicitRepo.find(); }',
          '  ambiguousRead() { return this.ambiguousRepo.find(); }',
          '  unresolvedRead() { return this.unresolvedRepo.find(); }',
          '  unsupported(value: DefaultItem) { return this.defaultRepo.preload(value); }',
          '  fakeRead() { return this.fakeStore.find(); }',
          '  fakeWrite(value: DefaultItem) { return this.fakeStore.save(value); }',
          '}',
        ].join('\n'),
      );
      await writeBasicTsconfig(project);

      const result = await scanRepository({ repositoryRoot: project.path });
      const { analysis } = result;
      const classById = new Map(analysis.classes.map((record) => [record.id, record]));
      const methodById = new Map(analysis.methods.map((record) => [record.id, record]));
      const tableById = new Map(analysis.tables.map((record) => [record.id, record]));
      const entityById = new Map(analysis.entities.map((record) => [record.id, record]));

      expect(
        analysis.entities
          .map((entity) => ({
            entity: entity.displayName,
            role: classById.get(entity.classId)?.roles,
          }))
          .sort((left, right) => left.entity.localeCompare(right.entity)),
      ).toEqual([
        { entity: 'DefaultItem', role: ['entity'] },
        { entity: 'ExplicitItem', role: ['entity'] },
      ]);
      expect(
        analysis.assertions
          .filter((assertion) => assertion.predicate === 'ENTITY_MAPS_TO_TABLE')
          .map((assertion) => ({
            entity: entityById.get(assertion.subjectId)?.displayName,
            table: assertion.objectId === null ? null : tableById.get(assertion.objectId)?.name,
            source:
              assertion.objectId === null ? null : tableById.get(assertion.objectId)?.nameSource,
          }))
          .sort((left, right) => `${left.entity}`.localeCompare(`${right.entity}`)),
      ).toEqual([
        { entity: 'DefaultItem', table: 'defaultitem', source: 'default_lowercase_class_name' },
        { entity: 'ExplicitItem', table: 'explicit_items', source: 'explicit' },
      ]);

      const accessAssertions = analysis.assertions.filter(
        (assertion) =>
          assertion.predicate === 'METHOD_READS_TABLE' ||
          assertion.predicate === 'METHOD_WRITES_TABLE',
      );
      for (const operation of TYPEORM_READ_OPERATIONS) {
        expect(
          accessAssertions.some(
            (assertion) =>
              assertion.ruleId === `typeorm.repository.${operation}.v1` &&
              assertion.predicate === 'METHOD_READS_TABLE' &&
              assertion.status === 'resolved',
          ),
        ).toBe(true);
      }
      for (const operation of TYPEORM_WRITE_OPERATIONS) {
        expect(
          accessAssertions.some(
            (assertion) =>
              assertion.ruleId === `typeorm.repository.${operation}.v1` &&
              assertion.predicate === 'METHOD_WRITES_TABLE' &&
              assertion.status === 'resolved',
          ),
        ).toBe(true);
      }
      expect(
        accessAssertions
          .filter((assertion) => assertion.status === 'ambiguous')
          .map((assertion) =>
            assertion.objectId === null ? null : tableById.get(assertion.objectId)?.name,
          )
          .sort(),
      ).toEqual(['defaultitem', 'explicit_items']);
      expect(
        accessAssertions.some((assertion) =>
          ['PersistenceService.fakeRead', 'PersistenceService.fakeWrite'].includes(
            methodById.get(assertion.subjectId)?.qualifiedName ?? '',
          ),
        ),
      ).toBe(false);
      expect(
        accessAssertions.every((assertion) => {
          const roles = assertion.evidenceIds.map(
            (id) => analysis.evidence.find((evidence) => evidence.id === id)?.role,
          );
          return (
            roles.includes('call_site') &&
            roles.includes('resolution_basis') &&
            roles.includes('decorator') &&
            roles.includes('declaration')
          );
        }),
      ).toBe(true);

      const unsupported = analysis.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'TYPEORM_OPERATION_UNSUPPORTED',
      );
      expect(unsupported).toHaveLength(1);
      expect(
        unsupported[0]?.subjectId === undefined
          ? undefined
          : methodById.get(unsupported[0].subjectId)?.qualifiedName,
      ).toBe('PersistenceService.unsupported');
      const impreciseWrites = analysis.diagnostics
        .filter((diagnostic) => diagnostic.code === 'TYPEORM_SAVE_COLUMNS_UNKNOWN')
        .map((diagnostic) =>
          diagnostic.subjectId === undefined
            ? undefined
            : methodById.get(diagnostic.subjectId)?.qualifiedName,
        )
        .sort();
      expect(impreciseWrites).toEqual([
        'PersistenceService.writeRemove',
        'PersistenceService.writeSave',
      ]);
      expect(
        analysis.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === 'TYPEORM_ENTITY_UNRESOLVED' &&
            diagnostic.subjectId?.startsWith('repository_binding:'),
        ),
      ).toBe(true);
      expect(
        analysis.assertions.some(
          (assertion) =>
            assertion.predicate === 'REPOSITORY_FOR_ENTITY' &&
            assertion.status === 'unresolved' &&
            assertion.objectId === null,
        ),
      ).toBe(true);

      const extraction = extractTypeOrmPersistence({
        sourceIndex: result.sourceIndex,
        checker: result.project.checker,
        repositoryRevision: result.analysis.analysisRun.repositoryRevision,
        evidenceSnippetLimit: result.analysis.analysisRun.configuration.evidenceSnippetLimit,
      });
      expect(
        extraction.columnMetadata
          .map((column) => ({
            entity: entityById.get(column.entityId)?.displayName,
            property: column.propertyName,
            decorator: column.decorator,
          }))
          .sort((left, right) =>
            `${left.entity}:${left.property}`.localeCompare(`${right.entity}:${right.property}`),
          ),
      ).toEqual([
        { entity: 'DefaultItem', property: 'code', decorator: 'PrimaryColumn' },
        { entity: 'DefaultItem', property: 'id', decorator: 'PrimaryGeneratedColumn' },
        { entity: 'DefaultItem', property: 'label', decorator: 'Column' },
        { entity: 'ExplicitItem', property: 'value', decorator: 'Column' },
      ]);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 20_000);
});
