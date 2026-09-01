import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 45 system identity and stitching documentation', () => {
  it('preserves the separate contract, real pair, Gate S0, and phase boundary history', async () => {
    const [plan, readme, guide, architecture, model, patterns, benchmark, fixtureReadme] =
      await Promise.all([
        readFile(
          resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
          'utf8',
        ),
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/system-analysis-contract.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase45-system-stitching-gate-s0.md'), 'utf8'),
        readFile(resolve('test/fixtures/system-stitching/README.md'), 'utf8'),
      ]);

    expect(plan).toMatch(/### Phase 45[\s\S]*?Status: complete/u);
    expect(readme).toContain('System Analysis and Artifact Stitching');
    expect(guide).toContain('`SystemAnalysisDocument` schema `1.0.0`');
    expect(guide).toContain('`sourceDocumentsEmbedded: false`');
    expect(guide).toContain('`declared_realm_candidate`');
    expect(guide).toContain('`target_only_candidate`');
    expect(guide).toContain('ticket-service-example');
    expect(guide).toContain('ctt-queue-service-example');
    expect(guide).toContain('tmf-update-ctt-list');
    expect(guide).toContain('no `stitch` CLI');
    expect(architecture).toMatch(/separate\s+`SystemAnalysisDocument` validation boundary/u);
    expect(model).toContain('system-analysis contract');
    expect(patterns).toMatch(/Target equality without a shared\s+declared realm/u);
    expect(benchmark).toContain('14 semantic cases');
    expect(fixtureReadme).toContain('Gate S0');
  });
});
