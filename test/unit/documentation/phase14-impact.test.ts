import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 14 impact documentation', () => {
  it('documents explicit inputs, two-sided traversal, interpretation, and unreachable files', async () => {
    const [readme, impact, architecture, workflow] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/impact-analysis.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
    ]);

    expect(readme).toContain('pnpm run cli -- impact');
    expect(impact).toMatch(/does not prove that runtime behavior\s+changed/u);
    expect(impact).toMatch(/never\s+inspects a working tree/u);
    expect(impact).toContain('The analysis traverses both snapshots');
    expect(impact).toContain('A terminals-only endpoint diff is not labeled a direct edit');
    expect(impact).toContain('Changed files with no supported endpoint path remain visible');
    expect(impact).toMatch(
      /`ImpactDocument` uses independent schema `1\.0\.0`[\s\S]*`2\.0\.0` when either input is analysis v4/u,
    );
    expect(architecture).toContain('validated impact.json');
    expect(workflow).toContain('api-intel impact <before-analysis.json> <after-analysis.json>');
  });
});
