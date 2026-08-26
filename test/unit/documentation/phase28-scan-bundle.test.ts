import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Phase 28 selected scan bundle documentation', () => {
  it('documents explicit selection, coherent publication, and the no-all boundary', () => {
    const guide = readFileSync('docs/selected-scan-bundles.md', 'utf8');
    const readme = readFileSync('README.md', 'utf8');
    const workflow = readFileSync('docs/cli-workflow.md', 'utf8');
    expect(guide).toContain('`bundle.json` last');
    expect(guide).toContain('There is no `--all` flag');
    expect(guide).toContain('Blocking error findings use exit code 8 only after');
    expect(readme).toContain('--with-graph --with-controls --with-openapi');
    expect(workflow).toContain('[--with-controls] [--with-openapi <openapi.json>]');
  });
});
