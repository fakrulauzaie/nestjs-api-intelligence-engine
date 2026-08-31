import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 43 non-relational resource documentation', () => {
  it('documents the bounded clients, structural targets, consumers, and non-claims', async () => {
    const [readme, guide, architecture, model, patterns, benchmark] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/non-relational-resource-access.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('docs/benchmarks/phase43-resource-access.md'), 'utf8'),
    ]);

    expect(readme).toContain('Non-Relational Resource Access');
    expect(guide).toContain('`cache-manager`');
    expect(guide).toContain('`ioredis`');
    expect(guide).toContain('`exact`');
    expect(guide).toContain('`template`');
    expect(guide).toContain('`symbolic`');
    expect(guide).toContain('`dynamic`');
    expect(guide).toContain('Pipelines, transactions, Lua scripts, pub/sub');
    expect(architecture).toContain('METHOD_ACCESSES_RESOURCE');
    expect(model).toContain('Analysis v6 non-relational resource access');
    expect(patterns).toContain('resource.cache-manager.direct.v1');
    expect(patterns).toContain('resource.ioredis.direct.v1');
    expect(benchmark).toContain('graph v8');
  });
});
