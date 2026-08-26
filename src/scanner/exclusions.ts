import { extname } from 'node:path';

export const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.api-intel',
  '.git',
  '.hg',
  '.svn',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

export const TYPESCRIPT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

export function isExcludedDirectoryName(name: string): boolean {
  return EXCLUDED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export function isTypeScriptSourcePath(filePath: string): boolean {
  return TYPESCRIPT_SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase());
}
