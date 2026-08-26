import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase 19 contract and column documentation', () => {
  it('documents canonical records, report output, and runtime honesty boundaries', async () => {
    const [readme, guide, architecture, model, cli, supported] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/declared-contracts-and-columns.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/supported-patterns.md'), 'utf8'),
    ]);

    expect(readme).toContain('Declared Request/Response Contracts and Entity Columns');
    expect(architecture).toContain('Nest contract extractor');
    expect(model).toContain('METHOD_DECLARES_REQUEST_PARAMETER');
    expect(cli).toContain('contracts.md');
    expect(supported).toContain('typeorm.entity-column.v1');

    const normalizedGuide = guide.replaceAll('`', '').replace(/\s+/gu, ' ');
    for (const phrase of [
      'does not execute the target application',
      'declared constraints only',
      'one bounded Promise<T> unwrap',
      'no serialized HTTP response schema is claimed',
      'property_name_fallback',
      'Dynamic options and object spreads produce unknown metadata',
      'Phase 19 itself emits no REQUEST_FIELD_MAY_FLOW_TO_COLUMN edge',
    ]) {
      expect(normalizedGuide, `Missing Phase 19 contract phrase: ${phrase}`).toContain(phrase);
    }
  });
});
