import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 13 comparison documentation', () => {
  it('documents explicit inputs, semantic matching, availability, and exit behavior', async () => {
    const [readme, comparison, architecture, workflow, semanticKeyAdr] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/comparison.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/adr/0002-snapshot-semantic-keys.md'), 'utf8'),
    ]);

    expect(readme).toContain('pnpm run cli -- diff');
    expect(readme).toContain('--format markdown');
    expect(comparison).toContain('Canonical IDs remain audit references');
    expect(comparison).toContain('No fuzzy name or path matching occurs');
    expect(comparison).toMatch(/effective guards\s+as `unavailable`/u);
    expect(comparison).toMatch(/A diff containing changes exits\s+successfully/u);
    expect(comparison).toContain('`1.0.0` for v1/v2-only comparisons');
    expect(comparison).toContain('`2.0.0` when either input is analysis v3');
    expect(comparison).toContain('`3.0.0` when either input is analysis');
    expect(architecture).toContain('semantic projection');
    expect(architecture).toContain('validated diff.json');
    expect(workflow).toContain('eleven complete commands');
    expect(workflow).toContain('api-intel diff <before-analysis.json> <after-analysis.json>');
    expect(semanticKeyAdr).toContain('Repository binding');
  });
});
