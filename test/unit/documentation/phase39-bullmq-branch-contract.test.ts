import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 39 BullMQ branch contract documentation', () => {
  it('preserves the Gate B0 decision while current docs describe Phase 40 publication', async () => {
    const [guide, patterns, decision, benchmark, plan] = await Promise.all([
      readFile(resolve('docs/bullmq-interactions.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('docs/adr/0004-bullmq-branch-analysis-v4.md'), 'utf8'),
      readFile(resolve('docs/benchmarks/phase39-bullmq-branch-contract.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_refactoring_expansion_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(guide).toContain('Phase 40 branch publication boundary');
    expect(guide).toContain('Analysis v4 publishes the Gate B0 vocabulary');
    expect(patterns).toContain('BullMQ exact branch extraction');
    expect(decision).toContain('Freeze analysis schema `3.0.0`');
    expect(decision).toContain('interactionHandlerDispatches');
    expect(decision).toMatch(/Unsupported control flow retains its\s+effects/u);
    expect(benchmark).toContain('Focused Gate B0 Vitest: 2 files and 9 tests passed');
    expect(plan).toMatch(
      /### Phase 39 — BullMQ branch contract and frozen corpus\s+\nStatus: complete/u,
    );
  });
});
