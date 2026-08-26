import { describe, expect, it } from 'vitest';
import { hashContent } from '../../../src/model/hashing.js';
import {
  isNormalizedRepositoryRelativePath,
  normalizeRepositoryRelativePath,
  PathOutsideRepositoryError,
} from '../../../src/model/paths.js';

describe('repository-relative paths', () => {
  it('normalizes Windows input to forward-slash repository-relative output', () => {
    expect(
      normalizeRepositoryRelativePath(
        'C:\\work\\reference-app',
        'C:\\work\\reference-app\\src\\notes\\notes.controller.ts',
      ),
    ).toBe('src/notes/notes.controller.ts');
  });

  it('normalizes a relative candidate against the repository root', () => {
    expect(normalizeRepositoryRelativePath('C:\\work\\reference-app', 'src\\app.ts')).toBe(
      'src/app.ts',
    );
  });

  it('rejects a path outside the repository', () => {
    expect(() =>
      normalizeRepositoryRelativePath(
        'C:\\work\\reference-app',
        'C:\\work\\other-app\\src\\app.ts',
      ),
    ).toThrow(PathOutsideRepositoryError);
  });

  it.each([
    ['src/app.ts', true],
    ['tsconfig.json', true],
    ['.', true],
    ['src\\app.ts', false],
    ['/src/app.ts', false],
    ['C:/work/app.ts', false],
    ['../app.ts', false],
    ['./src/app.ts', false],
  ])('classifies %s as normalized=%s', (value, expected) => {
    expect(isNormalizedRepositoryRelativePath(value)).toBe(expected);
  });
});

describe('content hashes', () => {
  it('creates a stable prefixed SHA-256 hash', () => {
    expect(hashContent('hello')).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(hashContent(Buffer.from('hello'))).toBe(hashContent('hello'));
    expect(hashContent('hello!')).not.toBe(hashContent('hello'));
  });
});
