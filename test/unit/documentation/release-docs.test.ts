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

  it('ships readable current-v6 catalogue, read/write traces, and JSON summary', async () => {
    const exampleRoot = resolve('docs/examples/current');
    const [catalogue, readTrace, writeTrace, analysisSummaryText] = await Promise.all([
      readFile(resolve(exampleRoot, 'endpoints.md'), 'utf8'),
      readFile(resolve(exampleRoot, 'read-trace.md'), 'utf8'),
      readFile(resolve(exampleRoot, 'write-trace.md'), 'utf8'),
      readFile(resolve(exampleRoot, 'analysis-summary.json'), 'utf8'),
    ]);

    expect(catalogue).toMatch(/\| GET\s+\| `\/notes` \| NotesController\.findAll \|/u);
    expect(readTrace).toMatch(/\| NotesService\.findAll \| READ\s+\| note\s+\| synchronous \|/u);
    expect(writeTrace).toMatch(/\| NotesService\.create \| WRITE\s+\| note\s+\| synchronous \|/u);
    expect(catalogue.toLowerCase()).not.toContain('c:\\users\\');
    expect(readTrace.toLowerCase()).not.toContain('c:\\users\\');
    expect(writeTrace.toLowerCase()).not.toContain('c:\\users\\');

    const summary = JSON.parse(analysisSummaryText) as {
      readonly resultState?: string;
      readonly schemaVersion?: string;
      readonly interactionAnalysis?: { readonly supportedKinds?: readonly string[] };
    };
    expect(summary.resultState).toBe('completed_with_gaps');
    expect(summary.schemaVersion).toBe('7.0.0');
    expect(summary.interactionAnalysis?.supportedKinds).toEqual([
      'in_process_event',
      'job_queue',
      'microservice_message',
      'outbound_http',
    ]);
  });
});
