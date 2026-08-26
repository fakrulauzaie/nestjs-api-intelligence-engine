import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 32 Nest HttpService documentation', () => {
  it('documents receiver proof, activation, symbolic targets, redaction, and boundaries', async () => {
    const [readme, guide, architecture, model, patterns, graph, fixtureContract, plan] =
      await Promise.all([
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/nest-http-service.md'), 'utf8'),
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

    expect(readme).toContain('Nest HttpService and Symbolic Targets');
    expect(guide).toContain('`constructed_cold`');
    expect(guide).toContain('`proven_activated`');
    expect(guide).toContain('{config:PAYMENT_URL}');
    expect(guide).toContain('{env:AUTH_SERVICE_URL}');
    expect(guide).toContain('never retains URL userinfo');
    expect(guide).toContain('`.pipe()` retains the underlying producer');
    expect(architecture).toContain('Phase 32 extends that same kind');
    expect(model).toContain('Phase 32 cold producers');
    expect(patterns).toContain('`http.outbound.nest-http-service.cold.v1`');
    expect(patterns).toContain('`http.outbound.nest-axios-ref.eager.v1`');
    expect(graph).toContain('HTTP producer labels show activation/timing');
    expect(fixtureContract).toContain('Phase 32 cold/proven/unknown/');
    expect(plan).toContain('|         32 | Complete (2026-08-25)');
    expect(plan).toContain('## 16.3 Phase 32 completion record');
    expect(plan).toContain('|         33 | Complete (2026-08-25)');
  });
});
