import { describe, expect, it } from 'vitest';
import { rawSqlConfigurationForDialect } from '../../../src/config/analysis-config.js';
import { postgresql18TableAccessAdapter } from '../../../src/sql/postgresql-table-access.js';

const configuration = {
  ...rawSqlConfigurationForDialect('postgresql-18'),
  maxParseTimeMs: 5_000,
};

async function accesses(sql: string): Promise<string[]> {
  const result = await postgresql18TableAccessAdapter.analyze(sql, configuration);
  expect(result.status, result.status === 'failed' ? result.message : undefined).toBe('resolved');
  if (result.status === 'failed') return [];
  return result.accesses.map(
    ({ statementKind, direction, tableName }) => `${statementKind}:${direction}:${tableName}`,
  );
}

describe('PostgreSQL 18 table-access adapter', () => {
  it('extracts bounded physical reads and writes with CTE and identifier semantics', async () => {
    expect(
      await accesses('SELECT n.id FROM public.note n JOIN audit_log a ON a.note_id = n.id'),
    ).toEqual(['select:read:audit_log', 'select:read:public.note']);
    expect(await accesses('INSERT INTO note_archive (id) SELECT id FROM note')).toEqual([
      'insert:write:note_archive',
      'select:read:note',
    ]);
    expect(
      await accesses('UPDATE note n SET reviewed = true FROM audit_log a WHERE a.note_id = n.id'),
    ).toEqual(['update:read:audit_log', 'update:write:note']);
    expect(await accesses('DELETE FROM note n USING expired_note e WHERE e.id = n.id')).toEqual([
      'delete:read:expired_note',
      'delete:write:note',
    ]);
    expect(
      await accesses(
        'WITH recent AS (SELECT id FROM note) SELECT * FROM recent JOIN audit_log ON true',
      ),
    ).toEqual(['select:read:audit_log', 'select:read:note']);
    expect(
      await accesses(
        'SELECT * FROM note WHERE EXISTS (SELECT 1 FROM audit_log WHERE audit_log.note_id = note.id)',
      ),
    ).toEqual(['select:read:audit_log', 'select:read:note']);
    expect(await accesses('SELECT * FROM "audit"."EventLog" WHERE id = $1')).toEqual([
      'select:read:audit."EventLog"',
    ]);
    expect(await accesses('SELECT * FROM note; DELETE FROM expired_note')).toEqual([
      'delete:write:expired_note',
      'select:read:note',
    ]);
  });

  it('fails closed for invalid, unsupported, or over-limit input', async () => {
    await expect(
      postgresql18TableAccessAdapter.analyze('SELECT FROM WHERE', configuration),
    ).resolves.toMatchObject({ status: 'failed', kind: 'parse_failed' });
    await expect(
      postgresql18TableAccessAdapter.analyze('SELECT * FROM `note`', configuration),
    ).resolves.toMatchObject({ status: 'failed', kind: 'parse_failed' });
    await expect(
      postgresql18TableAccessAdapter.analyze('CALL rebuild_note_index()', configuration),
    ).resolves.toMatchObject({ status: 'failed', kind: 'unsupported_statement' });
    await expect(
      postgresql18TableAccessAdapter.analyze(
        'SELECT * FROM note; CALL rebuild_note_index()',
        configuration,
      ),
    ).resolves.toMatchObject({ status: 'failed', kind: 'unsupported_statement' });
    await expect(
      postgresql18TableAccessAdapter.analyze('SELECT * INTO copied_note FROM note', configuration),
    ).resolves.toMatchObject({ status: 'failed', kind: 'unsupported_statement' });
    await expect(
      postgresql18TableAccessAdapter.analyze('SELECT * FROM note', {
        ...configuration,
        maxSqlBytes: 5,
      }),
    ).resolves.toMatchObject({ status: 'failed', kind: 'limit_exceeded' });
    await expect(
      postgresql18TableAccessAdapter.analyze('SELECT 1; SELECT 2', {
        ...configuration,
        maxStatements: 1,
      }),
    ).resolves.toMatchObject({ status: 'failed', kind: 'limit_exceeded' });
    await expect(
      postgresql18TableAccessAdapter.analyze('SELECT * FROM note', {
        ...configuration,
        maxAstNodes: 2,
      }),
    ).resolves.toMatchObject({ status: 'failed', kind: 'limit_exceeded' });
  });

  it('publishes the exact selected dialect and parser identity', () => {
    expect(postgresql18TableAccessAdapter).toMatchObject({
      dialect: 'postgresql-18',
      parserName: 'libpg-query',
      parserVersion: '18.1.2',
    });
  });

  it('returns deterministic access order across repeated parses', async () => {
    const sql =
      'WITH n AS (SELECT id FROM note) SELECT * FROM n JOIN audit_log ON true; UPDATE note SET title = $1 FROM author';
    const first = await postgresql18TableAccessAdapter.analyze(sql, configuration);
    const second = await postgresql18TableAccessAdapter.analyze(sql, configuration);
    expect(first.status).toBe('resolved');
    expect(second.status).toBe('resolved');
    if (first.status === 'resolved' && second.status === 'resolved') {
      expect(second.accesses).toEqual(first.accesses);
    }
  });
});
