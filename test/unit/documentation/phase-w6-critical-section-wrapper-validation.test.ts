import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase W6 real-service critical-section wrapper validation', () => {
  it('records the acceptance result, remaining gap, determinism, and honesty boundary', async () => {
    const [plan, benchmark, guide, patterns] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_critical_section_wrapper_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/benchmarks/phase-w6-critical-section-wrapper-validation.md'), 'utf8'),
      readFile(resolve('docs/redlock-critical-sections.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase W6[\s\S]*?Status: complete/u);
    expect(benchmark).toContain('`PUT /resolve` no longer terminates');
    expect(benchmark).toContain('`critical_section_conditional`');
    expect(benchmark).toContain('CRITICAL_SECTION_CALLBACK_FLOW_UNPROVEN');
    expect(benchmark).toContain('byte-identical artifacts');
    expect(benchmark).toMatch(/do\s+not prove that a lock is acquired/u);
    expect(guide).toMatch(/successful wrapper\s+proof does not also emit/u);
    expect(patterns).toContain('Phase W6 real-service validation');
  });
});
