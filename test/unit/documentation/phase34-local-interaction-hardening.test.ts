import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 34 local interaction hardening documentation', () => {
  it('documents wildcard, causal, comparison, export, graph, and gate contracts', async () => {
    const [readme, events, model, comparison, impact, exports, graph, policy, patterns, fixtures] =
      await Promise.all([
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/in-process-events.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/comparison.md'), 'utf8'),
        readFile(resolve('docs/impact-analysis.md'), 'utf8'),
        readFile(resolve('docs/structured-evidence-exports.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('docs/policy-engine.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('test/fixtures/interactions/README.md'), 'utf8'),
      ]);

    expect(readme).toContain('configured exact/wildcard local `EventEmitter2` fan-out');
    expect(events).toContain('`*` consumes exactly one segment');
    expect(events).toContain('`**` consumes zero or more segments');
    expect(events).toContain('`event.in-process.wildcard-match.v1`');
    expect(model).toContain('`causalSummary`');
    expect(comparison).toContain('Schema `2.0.0` additionally publishes');
    expect(impact).toContain('explicit interaction/handler add, remove, and modify');
    expect(exports).toContain('`localCausalEffects`');
    expect(graph).toContain('interaction, boundary, and handler nodes');
    expect(graph).toContain('never uses `delivered`');
    expect(policy).toContain('remains intentionally synchronous');
    expect(patterns).toContain('`event.in-process.wildcard-match.v1`');
    expect(fixtures).toContain('Phase 34 configured');
  });
});
