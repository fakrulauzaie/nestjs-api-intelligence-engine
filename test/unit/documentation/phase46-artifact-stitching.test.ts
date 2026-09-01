import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 46 artifact stitching documentation', () => {
  it('documents named artifacts, strict topology, non-proof states, and outputs', async () => {
    const [plan, readme, workflow, guide, architecture, model, patterns, benchmark, topology] =
      await Promise.all([
        readFile(
          resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
          'utf8',
        ),
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/cli-workflow.md'), 'utf8'),
        readFile(resolve('docs/system-analysis-contract.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase46-artifact-stitching.md'), 'utf8'),
        readFile(resolve('test/fixtures/system-stitching/ticket-ctt.topology.json'), 'utf8'),
      ]);

    expect(plan).toMatch(/### Phase 46[\s\S]*?Status: complete/u);
    expect(readme).toContain('pnpm run cli -- stitch');
    expect(workflow).toContain('api-intel stitch <service=analysis.json-or-.api-intel>');
    expect(guide).toContain('`service-namespace=path`');
    expect(guide).toContain('`declared_realm_candidate`');
    expect(guide).toContain('does not prove broker routing');
    expect(architecture).toContain('artifact-only stitch projection');
    expect(model).toContain('`system-analysis.json`');
    expect(patterns).toContain('Phase 46 artifact-only stitching');
    expect(benchmark).toContain('Thirteen tests passed');
    expect(JSON.parse(topology)).toMatchObject({
      schemaVersion: '1.0.0',
      systemName: 'ticket-ctt-system',
      brokerRealms: [
        expect.objectContaining({
          transport: 'rmq',
          destination: { kind: 'queue', value: 'intt_ctt_queue' },
        }),
      ],
    });
  });
});
