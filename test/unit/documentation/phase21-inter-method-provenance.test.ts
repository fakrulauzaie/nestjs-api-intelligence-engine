import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUEST_INTER_METHOD_INFLUENCE_RULE_ID } from '../../../src/extractors/inter-method-provenance.js';

describe('Phase 21 inter-method provenance documentation', () => {
  it('keeps the call-path, uncertainty, and fail-closed boundary visible', async () => {
    const [guide, supported, readme, model] = await Promise.all([
      readFile(resolve('docs/inter-method-request-provenance.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
    ]);

    expect(guide).toContain('reachability never creates an origin');
    expect(guide).toContain('REQUEST_PROVENANCE_INTER_METHOD_UNSUPPORTED');
    expect(guide).toContain('REQUEST_PROVENANCE_CALL_DEPTH_LIMIT');
    expect(guide).toContain('`save()`, `remove()`');
    expect(supported).toContain(`\`${REQUEST_INTER_METHOD_INFLUENCE_RULE_ID}\``);
    expect(readme).toContain('Inter-Method Request-to-Column Provenance');
    expect(model).toContain('continuous path from the request handler');
  });
});
