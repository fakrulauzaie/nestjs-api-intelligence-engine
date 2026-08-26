import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 27 project configuration documentation', () => {
  it('documents the strict schema, discovery, precedence, migration, and identity boundary', async () => {
    const [readme, workflow, projectConfig, policy, architecture, plan] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/project-configuration.md'), 'utf8'),
      readFile(resolve('docs/policy-engine.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_workflow_improvements_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(readme).toContain('[Project Configuration](docs/project-configuration.md)');
    expect(workflow).toContain('[--config <path> | --no-config]');
    expect(projectConfig).toContain('checks exactly `<repository>/api-intel.config.json`');
    expect(projectConfig).toContain('never walks');
    expect(projectConfig).toContain('`$schema` is inert editor metadata');
    expect(projectConfig).toContain('An explicit CLI value.');
    expect(projectConfig).toContain('Existing version-1 policy-only files remain valid');
    expect(projectConfig).toContain('does not change canonical facts or identity');
    expect(policy).toMatch(/version-2\s+project configuration is also accepted/u);
    expect(architecture).toContain('project-config provenance');
    expect(plan).toContain('|    27 | Complete (2026-08-24)');
    expect(plan).toContain('|    29 | Closed');
  });
});
