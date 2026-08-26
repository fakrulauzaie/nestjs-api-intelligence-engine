import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 26 graph preview documentation', () => {
  it('documents explicit post-publication launch and graceful degradation', async () => {
    const [readme, workflow, guide, plan] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_workflow_improvements_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(readme).toContain('--output C:\\reports\\graph --open');
    expect(workflow).toContain('`graph --open` (short form `-O`)');
    expect(workflow).toMatch(/only after the HTML\s+artifact has been atomically published/u);
    expect(guide).toContain('receives the absolute report path as one');
    expect(guide).toContain('with `shell: false`');
    expect(guide).toMatch(/command retains exit code 0/u);
    expect(guide).toContain('never invokes a launcher');
    expect(plan).toContain('|    26 | Complete (2026-08-24)');
    expect(plan).toContain('|    29 | Closed');
  });
});
