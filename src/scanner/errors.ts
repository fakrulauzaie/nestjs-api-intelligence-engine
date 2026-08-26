export const REPOSITORY_INPUT_ERROR_CODES = [
  'REPOSITORY_NOT_FOUND',
  'REPOSITORY_NOT_DIRECTORY',
  'REPOSITORY_UNREADABLE',
  'TSCONFIG_NOT_FOUND',
  'TSCONFIG_NOT_FILE',
  'TSCONFIG_UNREADABLE',
  'TSCONFIG_OUTSIDE_REPOSITORY',
  'TSCONFIG_INVALID',
  'TSCONFIG_PROJECT_REFERENCES_UNSUPPORTED',
  'TSCONFIG_SOURCE_OUTSIDE_REPOSITORY',
  'TSCONFIG_SOURCE_EXCLUDED',
] as const;
export type RepositoryInputErrorCode = (typeof REPOSITORY_INPUT_ERROR_CODES)[number];

export class RepositoryInputError extends Error {
  readonly code: RepositoryInputErrorCode;
  readonly details: readonly string[];

  constructor(code: RepositoryInputErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'RepositoryInputError';
    this.code = code;
    this.details = details;
  }
}
