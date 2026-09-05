import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase W4 verified critical-section wrapper documentation', () => {
  it('documents analysis v8, its proof boundary, diagnostics, and compatibility', async () => {
    const [plan, readme, guide, architecture, model, patterns, comparison] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_critical_section_wrapper_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/redlock-critical-sections.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('docs/comparison.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase W4[\s\S]*?Status: complete/u);
    expect(readme).toContain('Analysis v8');
    expect(guide).toContain('resource.redlock.verified-wrapper.v1');
    expect(guide).toMatch(/no connection to a\s+package-proven Redlock terminal/u);
    expect(architecture).toMatch(/No wrapper\s+selector configuration/u);
    expect(model).toContain('Analysis v8 verified wrapper flows');
    expect(model).toContain('CRITICAL_SECTION_WRAPPER_TARGET_AMBIGUOUS');
    expect(patterns).toContain('Verified Redlock wrapper flows');
    expect(comparison).toContain('analysis schemas `1.0.0` through `8.0.0`');
  });
});
