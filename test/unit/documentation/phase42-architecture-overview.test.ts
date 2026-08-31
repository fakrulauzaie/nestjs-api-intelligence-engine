import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 42 architecture overview documentation', () => {
  it('defines metrics, percentile heat, ownership states, limits, and the zero-reach boundary', async () => {
    const [guide, model, graph, architecture, patterns, readme, benchmark, plan] =
      await Promise.all([
        readFile(resolve('docs/architecture-overview.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase42-architecture-overview.md'), 'utf8'),
        readFile(
          resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
          'utf8',
        ),
      ]);

    for (const metric of [
      'direct_call_fan_in',
      'direct_call_fan_out',
      'endpoint_reach_count',
      'handler_reach_count',
      'supported_root_reach_count',
    ]) {
      expect(guide).toContain(`\`${metric}\``);
    }
    for (const state of [
      'uniquely_owned',
      'multiple_owners',
      'not_declared_by_supported_modules',
      'ownership_unknown',
      'unavailable',
    ]) {
      expect(guide).toContain(`\`${state}\``);
    }
    expect(guide).toContain('nearest-rank');
    expect(guide).toContain('not_reached_from_supported_roots');
    expect(guide).toMatch(/never\s+labels it dead code/iu);
    expect(model).toContain('graph schema `7.0.0`');
    expect(graph).toMatch(/architecture.*heat selector/iu);
    expect(architecture).toContain('Phase 42 keeps analysis v5 frozen');
    expect(patterns).toMatch(/Resolved-only\s+connectivity/u);
    expect(readme).toContain('bounded repository architecture view');
    expect(benchmark).toContain('125 files and 323 tests passed');
    expect(plan).toMatch(
      /### Phase 42 — Architecture overview and bounded refactoring metrics\s+\nStatus: complete/u,
    );
  });
});
