import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 30 interaction substrate documentation', () => {
  it('documents v3 compatibility, capability honesty, and the no-extractor boundary', async () => {
    const [adr, architecture, model, projectConfig, supported, plan] = await Promise.all([
      readFile(resolve('docs/adr/0003-analysis-v3-interaction-substrate.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/project-configuration.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_interaction_expansion_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(adr).toContain('Freeze analysis v1 and v2');
    expect(adr).toContain('Reservation is representational only');
    expect(architecture).toContain('Phase 30 adds an inert interaction topology');
    expect(model).toContain('Analysis v3 interaction substrate');
    expect(projectConfig).toContain('Version 3');
    expect(projectConfig).toContain('they do not enable or disable an extractor');
    expect(supported).toContain('Phase 30 implements no extractor');
    expect(supported).toContain('`supportedKinds: []`');
    expect(plan).toContain('|         30 | Complete (2026-08-25)');
  });
});
