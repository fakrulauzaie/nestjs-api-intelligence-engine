import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { writeFakeTypeOrm } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('bounded TypeORM QueryBuilder extraction', () => {
  it('proves supported roots, transitions, tables, joins, terminals, and explicit gaps', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeTypeOrm(project);
      const frozenCases = await readFile(
        'test/fixtures/post-mvp/query-builder/query-builder.ts.txt',
        'utf8',
      );
      await project.write(
        'src/query-builder.ts',
        `${frozenCases}

const LEGACY_TABLE = 'legacy_note';
declare const dynamicTable: string;
declare function consumeBuilder(value: unknown): void;

export class AdditionalQueryBuilderCases {
  constructor(private readonly dataSource: DataSource) {}

  literalRead(): Promise<unknown[]> {
    return this.dataSource.createQueryBuilder().select('*').from(LEGACY_TABLE, 'note').getRawMany();
  }

  entityRoot(): Promise<Note[]> {
    return this.dataSource.createQueryBuilder(Note, 'note').getMany();
  }

  dynamicTarget(): Promise<unknown[]> {
    return this.dataSource.createQueryBuilder().select('*').from(dynamicTable, 'note').getRawMany();
  }

  escapedBuilder(): Promise<Note[]> {
    const builder = this.dataSource.createQueryBuilder(Note, 'note');
    consumeBuilder(builder);
    return builder.getMany();
  }
}
`,
      );
      await writeBasicTsconfig(project);

      const { analysis } = await scanRepository({ repositoryRoot: project.path });
      const methods = new Map(analysis.methods.map((method) => [method.id, method]));
      const tables = new Map(analysis.tables.map((table) => [table.id, table]));
      const facts = analysis.assertions
        .filter(
          ({ predicate, ruleId }) =>
            (predicate === 'METHOD_READS_TABLE' || predicate === 'METHOD_WRITES_TABLE') &&
            ruleId.startsWith('typeorm.query-builder.'),
        )
        .map((assertion) => ({
          method: methods.get(assertion.subjectId)?.qualifiedName,
          direction: assertion.predicate === 'METHOD_READS_TABLE' ? 'READ' : 'WRITE',
          table: assertion.objectId === null ? null : tables.get(assertion.objectId)?.name,
          source: assertion.objectId === null ? null : tables.get(assertion.objectId)?.nameSource,
          status: assertion.status,
          ruleId: assertion.ruleId,
          evidenceRoles: assertion.evidenceIds.map(
            (id) => analysis.evidence.find((evidence) => evidence.id === id)?.role,
          ),
        }));
      const forMethod = (name: string) =>
        facts
          .filter(({ method }) => method?.endsWith(`.${name}`))
          .sort((left, right) => `${right.table}`.localeCompare(`${left.table}`));

      expect(forMethod('readNote')).toMatchObject([
        { direction: 'READ', table: 'note', status: 'resolved' },
      ]);
      expect(forMethod('readMany')).toMatchObject([
        { direction: 'READ', table: 'note', status: 'resolved' },
      ]);
      expect(forMethod('readWithAudit')).toMatchObject([
        { direction: 'READ', table: 'note', status: 'resolved' },
        { direction: 'READ', table: 'audit_log', status: 'resolved' },
      ]);
      expect(forMethod('insert')).toMatchObject([
        {
          direction: 'WRITE',
          table: 'note',
          ruleId: 'typeorm.query-builder.insert.v1',
        },
      ]);
      expect(forMethod('update')).toMatchObject([
        {
          direction: 'WRITE',
          table: 'note',
          ruleId: 'typeorm.query-builder.update.v1',
        },
      ]);
      expect(forMethod('delete')).toMatchObject([
        {
          direction: 'WRITE',
          table: 'note',
          ruleId: 'typeorm.query-builder.delete.v1',
        },
      ]);
      expect(forMethod('literalRead')).toMatchObject([
        {
          direction: 'READ',
          table: 'legacy_note',
          source: 'query_builder_literal',
        },
      ]);
      expect(forMethod('entityRoot')).toMatchObject([
        { direction: 'READ', table: 'note', status: 'resolved' },
      ]);

      for (const supported of [
        'readNote',
        'readMany',
        'readWithAudit',
        'insert',
        'update',
        'delete',
        'literalRead',
        'entityRoot',
      ]) {
        for (const fact of forMethod(supported)) {
          expect(fact.evidenceRoles).toContain('call_site');
          expect(fact.evidenceRoles).toContain('resolution_basis');
          if (fact.source !== 'query_builder_literal') {
            expect(fact.evidenceRoles).toContain('decorator');
            expect(fact.evidenceRoles).toContain('declaration');
          }
        }
      }

      expect(forMethod('relationJoin')).toMatchObject([
        { direction: 'READ', table: 'note', status: 'resolved' },
      ]);
      for (const unsupported of [
        'customRead',
        'ambiguousRead',
        'callbackSubquery',
        'cte',
        'reassigned',
        'inspectOnly',
        'dynamicTarget',
        'escapedBuilder',
      ]) {
        expect(forMethod(unsupported), unsupported).toEqual([]);
      }
      expect(facts.some(({ table }) => table === 'comment')).toBe(false);

      const diagnostics = analysis.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        method:
          diagnostic.subjectId === undefined
            ? undefined
            : methods.get(diagnostic.subjectId)?.qualifiedName,
      }));
      const diagnosticFor = (name: string, code: string) =>
        diagnostics.some(
          (diagnostic) => diagnostic.method?.endsWith(`.${name}`) && diagnostic.code === code,
        );
      expect(diagnosticFor('ambiguousRead', 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS')).toBe(true);
      expect(diagnosticFor('reassigned', 'TYPEORM_QUERY_BUILDER_STATE_AMBIGUOUS')).toBe(true);
      expect(diagnosticFor('relationJoin', 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED')).toBe(true);
      expect(diagnosticFor('callbackSubquery', 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED')).toBe(
        true,
      );
      expect(diagnosticFor('cte', 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED')).toBe(true);
      expect(diagnosticFor('dynamicTarget', 'TYPEORM_QUERY_BUILDER_TABLE_UNRESOLVED')).toBe(true);
      expect(diagnosticFor('escapedBuilder', 'TYPEORM_QUERY_BUILDER_FLOW_UNSUPPORTED')).toBe(true);
      expect(diagnosticFor('inspectOnly', 'TYPEORM_QUERY_BUILDER_TERMINAL_MISSING')).toBe(true);
      expect(diagnostics.some(({ method }) => method?.endsWith('.customRead'))).toBe(false);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
