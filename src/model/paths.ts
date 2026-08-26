import path, { posix, win32 } from 'node:path';

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

export class PathOutsideRepositoryError extends Error {
  constructor(repositoryRoot: string, candidatePath: string) {
    super(`Path is outside the repository root: ${candidatePath} (root: ${repositoryRoot})`);
    this.name = 'PathOutsideRepositoryError';
  }
}

function pathImplementation(repositoryRoot: string): typeof path.win32 | typeof path.posix {
  return WINDOWS_ABSOLUTE_PATH.test(repositoryRoot) ? win32 : path;
}

export function normalizeRepositoryRelativePath(
  repositoryRoot: string,
  candidatePath: string,
): string {
  const implementation = pathImplementation(repositoryRoot);
  const absoluteRoot = implementation.resolve(repositoryRoot);
  const absoluteCandidate = implementation.resolve(absoluteRoot, candidatePath);
  const relativePath = implementation.relative(absoluteRoot, absoluteCandidate);

  if (
    implementation.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${implementation.sep}`)
  ) {
    throw new PathOutsideRepositoryError(repositoryRoot, candidatePath);
  }

  if (relativePath === '') {
    return '.';
  }

  return relativePath.split(implementation.sep).join(posix.sep).normalize('NFC');
}

export function isNormalizedRepositoryRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes('\\') &&
    !value.startsWith('/') &&
    !WINDOWS_ABSOLUTE_PATH.test(value) &&
    value !== '..' &&
    !value.startsWith('../') &&
    !value.includes('/../') &&
    !value.startsWith('./') &&
    value === posix.normalize(value)
  );
}
