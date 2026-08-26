import { describe, expect, it } from 'vitest';
import { createStableId, makeDiagnosticId, makeMethodId } from '../../../src/model/ids.js';

describe('stable IDs', () => {
  it('returns the same ID for the same semantic identity', () => {
    const identity = ['revision', 'src/controller.ts', 'Controller'] as const;

    expect(createStableId('class', identity)).toBe(createStableId('class', identity));
    expect(createStableId('class', identity)).toMatch(/^class:[a-f0-9]{32}$/);
  });

  it('normalizes Unicode identity components', () => {
    expect(createStableId('class', ['Café'])).toBe(createStableId('class', ['Cafe\u0301']));
  });

  it('distinguishes same-named methods in different files and overload signatures', () => {
    const base = {
      qualifiedClassName: 'CustomerService',
      methodName: 'find',
      repositoryRevision: 'abc123',
    } as const;

    const first = makeMethodId({ ...base, path: 'src/a.ts', signature: 'find(id: string)' });
    const otherFile = makeMethodId({ ...base, path: 'src/b.ts', signature: 'find(id: string)' });
    const overload = makeMethodId({ ...base, path: 'src/a.ts', signature: 'find(id: number)' });

    expect(new Set([first, otherFile, overload]).size).toBe(3);
  });

  it('makes diagnostic identity independent of evidence discovery order', () => {
    const evidenceIds = [`evidence:${'1'.repeat(32)}`, `evidence:${'2'.repeat(32)}`];

    expect(makeDiagnosticId({ code: 'CALL_TARGET_UNRESOLVED', evidenceIds })).toBe(
      makeDiagnosticId({ code: 'CALL_TARGET_UNRESOLVED', evidenceIds: evidenceIds.toReversed() }),
    );
  });
});
