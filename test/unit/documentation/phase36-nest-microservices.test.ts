import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 36 Nest microservice documentation', () => {
  it('documents activation, patterns, open-world candidates, consumers, exclusions, and measurement', async () => {
    const [readme, guide, model, comparison, impact, exports, graph, patterns, benchmark, plan] =
      await Promise.all([
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/nest-microservices.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/comparison.md'), 'utf8'),
        readFile(resolve('docs/impact-analysis.md'), 'utf8'),
        readFile(resolve('docs/structured-evidence-exports.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase36-nest-microservices.md'), 'utf8'),
        readFile(
          resolve('backend_api_intelligence_interaction_expansion_implementation_plan.md'),
          'utf8',
        ),
      ]);

    expect(readme).toContain('[Nest Microservice Interactions](docs/nest-microservices.md)');
    expect(guide).toContain('`constructed_cold`');
    expect(guide).toContain('normal for producer-only repositories');
    expect(guide).toContain('deliberately not traversed');
    expect(guide).toContain('does not connect to a broker');
    expect(model).toContain('duplicate request handlers use `ambiguous`');
    expect(comparison).toContain('Phase 36 `microservice_message` records');
    expect(impact).toContain('ambiguous\nrequest-response candidates');
    expect(exports).toContain('Nest microservice\nmode/pattern/client/transport labels');
    expect(graph).toContain('no edge is labeled delivered');
    expect(patterns).toContain('`microservice.request-response-ambiguous-candidate.v1`');
    expect(benchmark).toContain('Median impact time was 592.29 ms');
    expect(plan).toContain('|         36 | Complete (2026-08-27)');
    expect(plan).toContain('## 16.9 Phase 36 completion record');
  });
});
