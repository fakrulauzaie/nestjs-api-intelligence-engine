import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 15 module and global-guard documentation', () => {
  it('documents the bounded syntax, three-state interpretation, compatibility, and non-claims', async () => {
    const [readme, modules, architecture, comparison, model] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/nest-modules-and-global-guards.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/comparison.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
    ]);

    expect(readme).toContain('Nest Modules and Effective Guard State');
    expect(modules).toMatch(/never imports or executes a\s+target module/u);
    expect(modules).toContain('one-hop unmodified local `const` arrays');
    expect(modules).toContain('`declared`');
    expect(modules).toContain('`none_proven`');
    expect(modules).toContain('`unknown`');
    expect(modules).toContain('never means `public`');
    expect(modules).toContain('strict `1.0.0` and `2.0.0` schemas');
    expect(architecture).toContain('Nest module + global-guard extractor');
    expect(comparison).toContain('analysis schemas `1.0.0` through `8.0.0`');
    expect(model).toContain('global guard registration');
  });
});
