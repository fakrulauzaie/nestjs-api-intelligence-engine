import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 22 structured-export documentation', () => {
  it('documents exact matching, immutable inputs, evidence exports, and exclusions', async () => {
    const [readme, guide, workflow, architecture, model, patterns] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/structured-evidence-exports.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
    ]);

    expect(readme).toContain('pnpm run cli -- openapi');
    expect(readme).toContain('pnpm run cli -- controls');
    expect(guide).toContain('The input document is read-only and remains byte-identical');
    expect(guide).toContain('There is no fuzzy path, operation-ID, handler-name');
    expect(guide).toContain('There is exactly one row per canonical endpoint');
    expect(guide).toMatch(/`=`,\s+`\+`,\s+`-`, or `@`/u);
    expect(guide).toContain('PDF is deliberately excluded');
    expect(workflow).toContain('api-intel openapi <analysis.json>');
    expect(workflow).toContain('api-intel controls <analysis.json>');
    expect(architecture).toContain('exact OpenAPI operation matcher');
    expect(model).toContain('`3.0.0` adds distributed interactions');
    expect(patterns).toContain('Derived structured evidence exports');
  });
});
