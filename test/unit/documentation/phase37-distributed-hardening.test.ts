import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 37 distributed policy and graph documentation', () => {
  it('records adopted rules, handler scenes, compatibility, and rejected speculation', async () => {
    const [guide, graph, policy, model, patterns, plan] = await Promise.all([
      readFile(resolve('docs/phase37-distributed-policy-report-hardening.md'), 'utf8'),
      readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
      readFile(resolve('docs/policy-engine.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_interaction_expansion_implementation_plan.md'),
        'utf8',
      ),
    ]);

    for (const rule of [
      'forbid-dynamic-interaction-target',
      'require-proven-interaction-activation',
      'require-local-in-process-event-handler',
    ]) {
      expect(guide).toContain(`\`${rule}\``);
      expect(policy).toContain(`### \`${rule}\` v1.0.0`);
    }
    expect(guide).toMatch(/Missing\s+local distributed consumers are normal open-world topology/u);
    expect(guide).toContain('Visible HTTP timeout enforcement is unsound');
    expect(graph).toMatch(/Graph v4 adds\s+one bounded handler-rooted/u);
    expect(graph).toContain('An inbound-only handler is therefore visible');
    expect(model).toMatch(/exactly one view per\s+canonical interaction handler/u);
    expect(patterns).toContain('The eight built-in policy rules');
    expect(plan).toContain('|         37 | Complete (2026-08-27)');
    expect(plan).toContain('## 16.10 Phase 37 completion record');
  });
});
