import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 17 QueryBuilder documentation', () => {
  it('documents proven roots, bounded flow, terminals, provenance, consumers, and gaps', async () => {
    const [readme, guide, architecture, model, supported] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/typeorm-query-builder.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
    ]);

    expect(readme).toContain('TypeORM QueryBuilder Analysis');
    expect(architecture).toContain('TypeORM repository + QueryBuilder extractor');
    expect(model).toContain('query_builder_literal');
    expect(supported).toContain('typeorm.query-builder.select.v1');
    const normalizedGuide = guide.replace(/\s+/gu, ' ');
    for (const phrase of [
      'Repository<T>',
      'DataSource',
      'EntityManager',
      'one method-local builder variable',
      'getSql()` and `getQuery()',
      'does not parse CTE text',
      'endpoint trace, semantic diff, potential impact, and architecture-policy',
    ]) {
      expect(normalizedGuide, `Missing QueryBuilder contract phrase: ${phrase}`).toContain(phrase);
    }
  });
});
