import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 31 outbound HTTP documentation', () => {
  it('documents supported clients, redaction, uncertainty, consumers, and boundaries', async () => {
    const [readme, guide, architecture, model, patterns, graph, fixtureContract, plan] =
      await Promise.all([
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/outbound-http.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('test/fixtures/interactions/README.md'), 'utf8'),
        readFile(
          resolve('backend_api_intelligence_interaction_expansion_implementation_plan.md'),
          'utf8',
        ),
      ]);

    expect(readme).toContain('Eager Outbound HTTP Analysis');
    expect(guide).toContain('Axios default imports');
    expect(guide).toContain('unshadowed standard global `fetch`');
    expect(guide).toContain('Query values, URL fragments, URL userinfo credentials');
    expect(guide).toContain('`OUTBOUND_HTTP_TARGET_DYNAMIC`');
    expect(guide).toContain('Phase 32 models its cold RxJS semantics separately');
    expect(architecture).toContain('Phase 31 activates only `outbound_http`');
    expect(model).toContain('`METHOD_INITIATES_INTERACTION` assertion');
    expect(patterns).toContain('`http.outbound.axios.eager.v1`');
    expect(graph).toMatch(/Historical graph\s+schemas `2\.0\.0` and `3\.0\.0`/u);
    expect(fixtureContract).toContain('They are never imported or executed');
    expect(plan).toContain('|         31 | Complete (2026-08-25)');
    expect(plan).toContain('|         32 | Complete (2026-08-25)');
  });
});
