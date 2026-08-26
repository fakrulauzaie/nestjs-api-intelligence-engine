import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUEST_COLUMN_INFLUENCE_RULE_ID,
  REQUEST_FIELD_ORIGIN_RULE_ID,
} from '../../../src/extractors/request-provenance.js';

describe('Phase 20 provenance documentation', () => {
  it('keeps the supported boundary, uncertainty, and report contract visible', async () => {
    const [guide, supported, readme] = await Promise.all([
      readFile(resolve('docs/request-to-column-provenance.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
    ]);
    for (const ruleId of [REQUEST_FIELD_ORIGIN_RULE_ID, REQUEST_COLUMN_INFLUENCE_RULE_ID]) {
      expect(supported).toContain(`\`${ruleId}\``);
    }
    expect(guide).toContain('not exact data lineage');
    expect(guide).toContain('REQUEST_FIELD_MAY_FLOW_TO_COLUMN');
    expect(guide).toContain('No column provenance is emitted for `save()` or `remove()`');
    expect(guide).toContain('Phase 21 passed that go/no-go gate');
    expect(readme).toContain('request-to-column influence');
  });
});
