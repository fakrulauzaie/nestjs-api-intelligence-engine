import { describe, expect, it } from 'vitest';
import { normalizeRoutePath } from '../../../src/extractors/route-paths.js';

describe('route path normalization', () => {
  it.each([
    [[], '/'],
    [[''], '/'],
    [['/', '//'], '/'],
    [['notes', ''], '/notes'],
    [['/notes/', '/:id/'], '/notes/:id'],
    [['//admin//notes//', '///count'], '/admin/notes/count'],
    [['cafe\u0301', ':noteId'], '/caf\u00e9/:noteId'],
  ] as const)('normalizes %j to %s', (parts, expected) => {
    expect(normalizeRoutePath(...parts)).toBe(expected);
  });
});
