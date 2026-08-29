import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 41 authorization metadata documentation', () => {
  it('records exact sources, redaction, enforcement states, and policy separation', async () => {
    const [guide, model, policy, patterns, benchmark, plan] = await Promise.all([
      readFile(resolve('docs/authorization-metadata.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/policy-engine.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('docs/benchmarks/phase41-authorization-metadata.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
        'utf8',
      ),
    ]);

    for (const state of ['proven_enforced', 'configured_relationship', 'enforcement_unknown']) {
      expect(guide).toContain(`\`${state}\``);
      expect(model).toContain(`\`${state}\``);
    }
    expect(guide).toContain('`redacted: true`');
    expect(guide).toContain('separate application root');
    expect(policy).toContain('`require-proven-authorization-enforcement`');
    expect(patterns).toContain('Bare decorator names');
    expect(benchmark).toMatch(/Metadata\s+alone cannot satisfy it/u);
    expect(plan).toMatch(
      /### Phase 41 — Authorization metadata and composite decorators\s+\nStatus: complete/u,
    );
  });
});
