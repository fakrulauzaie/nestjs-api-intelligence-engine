import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import { rawSqlConfigurationForDialect } from '../../../src/config/analysis-config.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { writeFakeTypeOrm } from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
} from '../../helpers/typescript-project.js';

describe('TypeORM PostgreSQL raw-SQL extraction', () => {
  it('proves exact physical access and fails closed across the frozen corpus', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeTypeOrm(project);
      const frozenCases = await readFile('test/fixtures/post-mvp/raw-sql/raw-sql.ts.txt', 'utf8');
      await project.write('src/raw-sql.ts', frozenCases);
      await writeBasicTsconfig(project);

      const disabled = await scanRepository({ repositoryRoot: project.path });
      expect(
        disabled.analysis.assertions.filter(({ ruleId }) => ruleId.startsWith('typeorm.raw-sql.')),
      ).toEqual([]);
      const disabledMethods = new Map(
        disabled.analysis.methods.map((method) => [method.id, method.qualifiedName]),
      );
      expect(
        disabled.analysis.diagnostics.some(
          ({ code, subjectId }) =>
            code === 'TYPEORM_RAW_SQL_DIALECT_UNSELECTED' &&
            disabledMethods.get(subjectId ?? '')?.endsWith('.staticSelect'),
        ),
      ).toBe(true);

      const { analysis, run } = await scanRepository({
        repositoryRoot: project.path,
        configuration: { rawSql: rawSqlConfigurationForDialect('postgresql-18') },
      });
      expect(analysis.analysisRun.id).not.toBe(disabled.analysis.analysisRun.id);
      expect(analysis.analysisRun.configuration.rawSql).toEqual(
        rawSqlConfigurationForDialect('postgresql-18'),
      );
      expect(run.configuration.rawSql).toEqual(rawSqlConfigurationForDialect('postgresql-18'));

      const methods = new Map(analysis.methods.map((method) => [method.id, method]));
      const tables = new Map(analysis.tables.map((table) => [table.id, table]));
      const facts = analysis.assertions
        .filter(({ ruleId }) => ruleId.startsWith('typeorm.raw-sql.'))
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
          .sort((left, right) =>
            `${left.direction}:${left.table}`.localeCompare(`${right.direction}:${right.table}`),
          );

      expect(forMethod('staticSelect')).toMatchObject([
        { direction: 'READ', table: 'audit_log', source: 'raw_sql_literal' },
        { direction: 'READ', table: 'public.note', source: 'raw_sql_literal' },
      ]);
      expect(forMethod('archive')).toMatchObject([
        { direction: 'READ', table: 'note', ruleId: 'typeorm.raw-sql.select.read.v1' },
        {
          direction: 'WRITE',
          table: 'note_archive',
          ruleId: 'typeorm.raw-sql.insert.write.v1',
        },
      ]);
      expect(forMethod('updateFromAudit')).toMatchObject([
        { direction: 'READ', table: 'audit_log', ruleId: 'typeorm.raw-sql.update.read.v1' },
        { direction: 'WRITE', table: 'note', ruleId: 'typeorm.raw-sql.update.write.v1' },
      ]);
      expect(forMethod('purge')).toMatchObject([
        {
          direction: 'READ',
          table: 'expired_note',
          ruleId: 'typeorm.raw-sql.delete.read.v1',
        },
        { direction: 'WRITE', table: 'note', ruleId: 'typeorm.raw-sql.delete.write.v1' },
      ]);
      expect(forMethod('recent')).toMatchObject([
        { direction: 'READ', table: 'audit_log' },
        { direction: 'READ', table: 'note' },
      ]);
      expect(forMethod('byTitle')).toMatchObject([{ direction: 'READ', table: 'note' }]);
      expect(facts.some(({ table }) => table === 'recent_note')).toBe(false);
      for (const supported of [
        'staticSelect',
        'archive',
        'updateFromAudit',
        'purge',
        'recent',
        'byTitle',
      ]) {
        for (const fact of forMethod(supported)) {
          expect(fact.status).toBe('resolved');
          expect(fact.evidenceRoles).toContain('call_site');
          expect(fact.evidenceRoles).toContain('resolution_basis');
        }
      }
      for (const unsupported of [
        'customQuery',
        'ambiguousQuery',
        'dynamicTable',
        'rawIdentifier',
        'invalidSql',
        'callProcedure',
      ]) {
        expect(forMethod(unsupported), unsupported).toEqual([]);
      }

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
      expect(diagnosticFor('ambiguousQuery', 'TYPEORM_RAW_SQL_RECEIVER_AMBIGUOUS')).toBe(true);
      expect(diagnosticFor('dynamicTable', 'TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED')).toBe(true);
      expect(diagnosticFor('rawIdentifier', 'TYPEORM_RAW_SQL_SOURCE_UNSUPPORTED')).toBe(true);
      expect(diagnosticFor('invalidSql', 'TYPEORM_RAW_SQL_PARSE_FAILED')).toBe(true);
      expect(diagnosticFor('callProcedure', 'TYPEORM_RAW_SQL_STATEMENT_UNSUPPORTED')).toBe(true);
      expect(diagnostics.some(({ method }) => method?.endsWith('.customQuery'))).toBe(false);
      expect(validateAnalysisDocument(analysis)).toMatchObject({ success: true });
    } finally {
      await project.cleanup();
    }
  }, 30_000);
});
