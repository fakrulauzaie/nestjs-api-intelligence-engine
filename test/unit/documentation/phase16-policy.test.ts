import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Phase 16 policy documentation', () => {
  it('documents typed configuration, four-state outcomes, rules, and exit behavior', () => {
    const guide = readFileSync('docs/policy-engine.md', 'utf8');
    const workflow = readFileSync('docs/cli-workflow.md', 'utf8');
    const schema = JSON.parse(readFileSync('schemas/api-intel.config.schema.json', 'utf8')) as {
      anyOf: Array<{
        properties: {
          version: { const: number };
          rules: { properties: Record<string, unknown> };
        };
      }>;
    };
    expect(schema.anyOf.map((branch) => branch.properties.version.const)).toEqual([1, 2, 3]);

    for (const outcome of ['pass', 'fail', 'unknown', 'not_applicable']) {
      expect(guide).toContain(`\`${outcome}\``);
    }
    for (const rule of [
      'no-repository-access-in-controller',
      'require-guard-on-write-endpoint',
      'require-complete-write-trace',
      'no-new-diagnostics',
      'forbid-dynamic-interaction-target',
      'require-proven-interaction-activation',
      'require-local-in-process-event-handler',
    ]) {
      expect(guide).toContain(`\`${rule}\``);
      for (const branch of schema.anyOf) {
        expect(branch.properties.rules.properties).toHaveProperty(rule);
      }
    }
    expect(guide).toContain('does not label a guard as authentication');
    expect(workflow).toContain('|         8 |');
    expect(workflow).toContain('|         9 |');
  });
});
