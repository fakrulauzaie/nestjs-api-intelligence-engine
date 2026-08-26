import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PINNED_REFERENCE_REVISION = '841df8792fbedd1fbba12c9fe999aee307a155c7';

describe('MVP release documentation', () => {
  it('covers installation, usage, states, safety, architecture, limitations, and demo', async () => {
    const [readme, architecture, supported, validation, demo, packageText] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('docs/real-repository-validation.md'), 'utf8'),
      readFile(resolve('scripts/demo.mjs'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
    ]);

    for (const section of [
      '## Install and build',
      '## Usage',
      '## Result states',
      '## Supported MVP patterns',
      '## Deliberate limitations',
      '## Architecture and trust boundary',
      '## Reproducible official-sample demo',
    ]) {
      expect(readme, `README is missing ${section}`).toContain(section);
    }
    expect(readme).toContain('does not start the target application');
    expect(architecture).toContain('Validated analysis.json');
    expect(architecture).toContain('run.json');
    expect(architecture).toContain('```mermaid');
    expect(supported).toContain('Independent repository confirmation');
    expect(validation).toContain(PINNED_REFERENCE_REVISION);
    expect(validation).toContain('Target application executions: 0');

    expect(demo).toContain(PINNED_REFERENCE_REVISION);
    expect(demo).toContain("'--ignore-scripts'");
    expect(demo).not.toContain("'start'");
    expect(demo).not.toContain("'start:dev'");
    expect(demo).not.toContain("'docker-compose'");

    const packageJson = JSON.parse(packageText) as {
      readonly version?: string;
      readonly scripts?: Readonly<Record<string, string>>;
    };
    expect(packageJson.version).toBe('0.1.0');
    expect(packageJson.scripts?.demo).toBe('node scripts/demo.mjs');
  });

  it('ships readable sanitized catalogue, read/write traces, and JSON', async () => {
    const exampleRoot = resolve('docs/examples/official-nestjs-typeorm');
    const [catalogue, readTrace, writeTrace, analysisExcerptText] = await Promise.all([
      readFile(resolve(exampleRoot, 'endpoints.md'), 'utf8'),
      readFile(resolve(exampleRoot, 'read-trace.md'), 'utf8'),
      readFile(resolve(exampleRoot, 'write-trace.md'), 'utf8'),
      readFile(resolve(exampleRoot, 'analysis-excerpt.json'), 'utf8'),
    ]);

    expect(catalogue).toMatch(/\| GET\s+\| `\/users\/:id` \| UsersController\.findOne \|/u);
    expect(readTrace).toMatch(/\| UsersService\.findOne \| READ\s+\| user\s+\|/u);
    expect(writeTrace).toMatch(/\| UsersService\.create \| WRITE\s+\| user\s+\|/u);
    expect(catalogue.toLowerCase()).not.toContain('c:\\users\\');
    expect(readTrace.toLowerCase()).not.toContain('c:\\users\\');
    expect(writeTrace.toLowerCase()).not.toContain('c:\\users\\');

    const excerpt = JSON.parse(analysisExcerptText) as {
      readonly resultState?: string;
      readonly source?: { readonly revision?: string };
    };
    expect(excerpt.resultState).toBe('completed_with_gaps');
    expect(excerpt.source?.revision).toBe(PINNED_REFERENCE_REVISION);
  });
});
