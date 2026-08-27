import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 33-34 in-process event documentation', () => {
  it('documents identity, registration, causal traversal, redaction, and boundaries', async () => {
    const [
      readme,
      guide,
      architecture,
      model,
      patterns,
      graph,
      impact,
      config,
      fixtureContract,
      plan,
    ] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/in-process-events.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('docs/offline-graph-report.md'), 'utf8'),
      readFile(resolve('docs/impact-analysis.md'), 'utf8'),
      readFile(resolve('docs/project-configuration.md'), 'utf8'),
      readFile(resolve('test/fixtures/interactions/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_interaction_expansion_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(readme).toContain('In-Process Event Analysis');
    expect(guide).toContain('`proven_registered`');
    expect(guide).toContain('`declared_candidate`');
    expect(guide).toContain('`registration_unknown`');
    expect(guide).toContain('`INTERACTION_CYCLE_TRUNCATED`');
    expect(guide).toContain('never retains event payloads');
    expect(guide).toContain('## Configured wildcard handlers');
    expect(architecture).toContain('Phase 33 activates `in_process_event`');
    expect(model).toContain('Phase 33 event producers are eager and `in_process`');
    expect(patterns).toContain('`event.in-process.event-emitter2.emit.exact.v1`');
    expect(patterns).toContain('`event.in-process.exact-match.v1`');
    expect(graph).toContain('`matches local handler`');
    expect(impact).toContain(
      '`HANDLER_IMPLEMENTED_BY` for exact or configured-wildcard local events',
    );
    expect(config).toMatch(
      /bound configured in-process event,\s+BullMQ, and Nest microservice causal traversal/u,
    );
    expect(fixtureContract).toContain('Phase 33 exact-event contract');
    expect(plan).toContain('|         33 | Complete (2026-08-25)');
    expect(plan).toContain('## 16.4 Phase 33 completion record');
    expect(plan).toContain(
      '# 10. Phase 34 - Wildcards, consumer integration, and Milestone I1 hardening',
    );
  });
});
