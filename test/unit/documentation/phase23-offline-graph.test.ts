import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 23 offline-graph documentation', () => {
  it('documents the command, trust boundary, limits, security, accessibility, and benchmark', async () => {
    const [readme, guide, workflow, architecture, model, patterns, benchmark, packageText] =
      await Promise.all([
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('docs/cli-workflow.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase23-offline-graph.md'), 'utf8'),
        readFile(resolve('package.json'), 'utf8'),
      ]);

    expect(readme).toContain('pnpm run cli -- graph');
    expect(guide).toContain('self-contained HTML file');
    expect(guide).toContain("`default-src 'none'` and `connect-src 'none'`");
    expect(guide).toContain('accessible table');
    expect(guide).toContain('Defaults are 120 nodes and 180 edges per scene');
    expect(guide).toContain('No Git-facing workflow');
    expect(workflow).toContain('eleven complete commands');
    expect(workflow).toContain('api-intel graph <analysis.json>');
    expect(architecture).toContain('validated endpoint/handler/architecture graph views');
    expect(model).toContain('schema `1.0.0` remains readable for');
    expect(model).toMatch(/current analysis v7\/v8 reports emit graph schema `9\.0\.0`/u);
    expect(patterns).toContain('Derived offline graph report');
    expect(benchmark).toContain('Median generation time was 913.70 ms');
    expect(benchmark).toContain('22.01% size increase');
    expect(JSON.parse(packageText)).toMatchObject({ dependencies: { cytoscape: '3.34.0' } });
  });
});
