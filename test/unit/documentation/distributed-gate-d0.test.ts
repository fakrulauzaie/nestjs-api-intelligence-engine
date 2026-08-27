import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Distributed Gate D0 documentation', () => {
  it('documents the frozen corpus, honesty boundaries, compatibility targets, and gate result', async () => {
    const [readme, architecture, patterns, gate, fixtures, plan] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('docs/distributed-gate-d0.md'), 'utf8'),
      readFile(resolve('test/fixtures/distributed/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_interaction_expansion_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(readme).toContain('[Distributed Gate D0](docs/distributed-gate-d0.md)');
    expect(architecture).toContain('Phase 35 now\nactivates only `job_queue`');
    expect(patterns).toContain('consumed by Phases 35 and 36');
    expect(gate).toContain('| `@nestjs/bullmq`');
    expect(gate).toContain('| `@nestjs/microservices`');
    expect(gate).toContain('never a missing-consumer failure');
    expect(gate).toContain('or claim that broker delivery occurred');
    expect(fixtures).toContain('never imported or evaluated');
    expect(plan).toContain('|         D0 | Complete (2026-08-26)');
    expect(plan).toContain('|         35 | Complete (2026-08-26)');
  });
});
