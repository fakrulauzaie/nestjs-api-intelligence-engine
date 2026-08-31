import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 44 Redlock critical-section documentation', () => {
  it('documents the bounded extraction, conditional effects, versions, and non-claims', async () => {
    const [plan, readme, guide, architecture, model, patterns, comparison, benchmark] =
      await Promise.all([
        readFile(
          resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
          'utf8',
        ),
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/redlock-critical-sections.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/comparison.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase44-redlock-critical-sections.md'), 'utf8'),
      ]);

    expect(plan).toMatch(/### Phase 44[\s\S]*?Status: complete/u);
    expect(readme).toContain('Redlock Critical Sections');
    expect(guide).toContain('package-proven');
    expect(guide).toContain('`critical_section_conditional`');
    expect(guide).toMatch(/never claim lock\s+acquisition/u);
    expect(guide).toContain('custom lock abstractions');
    expect(architecture).toContain('CriticalSectionRecord.effectAssertionIds');
    expect(model).toContain('Analysis v7 Redlock critical sections');
    expect(patterns).toContain('resource.redlock.using.v1');
    expect(comparison).toMatch(/Critical-section\s+families are unavailable in v1-v6/u);
    expect(benchmark).toMatch(/Gate L0 remains\s+closed/u);
  });
});
