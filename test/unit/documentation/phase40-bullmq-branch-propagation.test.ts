import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 40 BullMQ branch propagation documentation', () => {
  it('records the v4 branch contract and every migrated consumer', async () => {
    const [guide, model, comparison, impact, graph, exportsGuide, benchmark, plan] =
      await Promise.all([
        readFile(resolve('docs/bullmq-interactions.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/comparison.md'), 'utf8'),
        readFile(resolve('docs/impact-analysis.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('docs/structured-evidence-exports.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase40-bullmq-branch-propagation.md'), 'utf8'),
        readFile(
          resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
          'utf8',
        ),
      ]);

    expect(guide).toContain('Analysis v4 publishes the Gate B0 vocabulary');
    expect(model).toContain('interactionHandlerBranchEffects');
    expect(comparison).toContain('Schema `3.0.0` additionally compares BullMQ dispatches');
    expect(impact).toContain('Impact v2 also consumes dispatch, branch, and branch-effect');
    expect(graph).toContain('Graph v5 adds');
    expect(exportsGuide).toContain('adds `jobQueueBranchIds`');
    expect(benchmark).toContain('Full one-worker Vitest: 120 files and 312 tests passed');
    expect(benchmark).toContain('not evidence that a broker delivered');
    expect(plan).toMatch(
      /### Phase 40 — BullMQ branch extraction and propagation\s+\nStatus: complete/u,
    );
  });
});
