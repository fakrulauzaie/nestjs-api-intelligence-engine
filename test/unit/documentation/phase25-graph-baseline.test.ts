import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 25 graph baseline documentation', () => {
  it('documents direction, exclusivity, in-memory behavior, and the durable alternative', async () => {
    const [readme, workflow, guide, benchmark, plan] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
      readFile(resolve('docs/benchmarks/phase25-graph-baseline.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_workflow_improvements_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(readme).toContain('--baseline C:\\reports\\before\\analysis.json');
    expect(workflow).toContain('positional analysis as the current/after side');
    expect(workflow).toMatch(/mutually\s+exclusive with `--impact-results`/u);
    expect(guide).toMatch(/it does not\s+write `impact\.json`/u);
    expect(guide).toContain('Use `pnpm run cli -- impact` first');
    expect(benchmark).toContain('Median baseline generation was 641.20 ms');
    expect(benchmark).toContain('a 48.81% local wall-time reduction');
    expect(benchmark).toContain('HTML files were byte-identical');
    expect(plan).toContain('|    25 | Complete');
    expect(plan).toContain('|    29 | Closed');
  });
});
