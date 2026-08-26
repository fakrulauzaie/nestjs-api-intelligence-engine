import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 35 BullMQ documentation', () => {
  it('documents supported rules, open-world boundaries, conditional effects, and exclusions', async () => {
    const [readme, bullmq, model, comparison, impact, exports, graph, patterns, benchmark, plan] =
      await Promise.all([
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/bullmq-interactions.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/comparison.md'), 'utf8'),
        readFile(resolve('docs/impact-analysis.md'), 'utf8'),
        readFile(resolve('docs/structured-evidence-exports.md'), 'utf8'),
        readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
        readFile(resolve('docs/supported-patterns.md'), 'utf8'),
        readFile(resolve('docs/benchmarks/phase35-bullmq.md'), 'utf8'),
        readFile(
          resolve('backend_api_intelligence_interaction_expansion_implementation_plan.md'),
          'utf8',
        ),
      ]);

    expect(readme).toContain('[BullMQ Queue Interactions](docs/bullmq-interactions.md)');
    expect(bullmq).toContain('`queue.bullmq.queue-add.v1`');
    expect(bullmq).toContain('`queue.bullmq.worker-host.process.queue-wide.v1`');
    expect(bullmq).toContain('normal open-world topology');
    expect(bullmq).toContain('does not prove enqueue success');
    expect(bullmq).toMatch(/renderer never\s+uses `delivered`/);
    expect(model).toContain('`distributedInteractionIds`');
    expect(comparison).toContain('Phase 35 `job_queue` records');
    expect(impact).toContain('BullMQ interaction and handler changes');
    expect(exports).toContain('`distributedConditionalEffects`');
    expect(graph).toContain('`broker or worker boundary`');
    expect(patterns).toContain('`queue.bullmq.queue-wide-candidate.v1`');
    expect(benchmark).toContain('Median impact time was 819.62 ms');
    expect(plan).toContain('|         35 | Complete (2026-08-26)');
    expect(plan).toContain('## 16.7 Phase 35 completion record');
  });
});
