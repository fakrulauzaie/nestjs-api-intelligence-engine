import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 47 system report documentation', () => {
  it('documents conditional paths, proof-only policies, limits, offline security, and the real pair', async () => {
    const [plan, readme, workflow, architecture, model, patterns, graph, guide, benchmark] =
      await Promise.all([
        readFile(
          resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
          'utf8',
        ),
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/cli-workflow.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('docs/system-report.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase47-system-report.md'), 'utf8'),
      ]);

    expect(plan).toMatch(/### Phase 47[\s\S]*?Status: done/u);
    expect(readme).toContain('--with-graph --open');
    expect(workflow).toContain('[--with-graph] [--max-nodes <10-500>]');
    expect(architecture).toContain('SystemReportDocument` schema `1.0.0`');
    expect(model).toContain('`SystemReportDocument` schema `1.0.0`');
    expect(patterns).toContain('Phase 47 conditional system reporting');
    expect(graph).toContain('api-intel-system-graph.html');
    expect(guide).toContain('target-only, ambiguous, and unmatched');
    expect(guide).toContain('`require-declared-realm-candidate`');
    expect(guide).toContain('`nest.call.bound-callback-forward.v1`');
    expect(guide).toContain("`connect-src 'none'`");
    expect(benchmark).toContain('`POST /mobile/create`');
    expect(benchmark).toContain('`WRITE table apim_log`');
  });
});
