import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 18 raw-SQL documentation', () => {
  it('documents opt-in dialect, parser identity, sources, directions, limits, and gaps', async () => {
    const [readme, guide, architecture, model, cli, packageJson] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/postgresql-raw-sql.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
    ]);

    expect(readme).toContain('Static PostgreSQL Raw-SQL Analysis');
    expect(architecture).toContain('PostgreSQL raw-SQL extractor');
    expect(model).toContain('raw_sql_literal');
    expect(cli).toContain('--raw-sql-dialect postgresql-18');
    expect(JSON.parse(packageJson)).toMatchObject({
      dependencies: { 'libpg-query': '18.1.2' },
    });

    const normalizedGuide = guide.replace(/\s+/gu, ' ');
    for (const phrase of [
      'Repository<T>',
      'DataSource',
      'EntityManager',
      'QueryRunner',
      'libpg-query@18.1.2',
      'CTE names are scoped aliases, not physical tables',
      'one unsupported statement discards all candidate facts',
      'No timeout or failure path falls back to regex extraction',
      'endpoint trace, semantic diff, potential impact, and architecture policy',
    ]) {
      expect(normalizedGuide, `Missing raw-SQL contract phrase: ${phrase}`).toContain(phrase);
    }
  });
});
