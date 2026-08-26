import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SourceFileRecord } from '../model/entities.js';
import { hashContent } from '../model/hashing.js';
import { makeSourceFileId } from '../model/ids.js';
import { normalizeRepositoryRelativePath } from '../model/paths.js';
import { isExcludedDirectoryName, isTypeScriptSourcePath } from './exclusions.js';
import { RepositoryInputError } from './errors.js';

export const DEFAULT_MAX_SOURCE_FILE_BYTES = 1_048_576;

export const INVENTORY_SKIP_REASONS = [
  'excluded_directory',
  'unsupported_extension',
  'oversized',
  'binary',
  'symbolic_link',
  'symlink_outside_repository',
  'unreadable',
] as const;
export type InventorySkipReason = (typeof INVENTORY_SKIP_REASONS)[number];

export interface InventorySkip {
  readonly path: string;
  readonly reason: InventorySkipReason;
}

export interface InventorySourceFile {
  readonly absolutePath: string;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly record: SourceFileRecord;
}

export interface RepositoryInventory {
  readonly repositoryRoot: string;
  readonly sourceFiles: readonly InventorySourceFile[];
  readonly skippedEntries: readonly InventorySkip[];
}

export interface InventoryOptions {
  readonly repositoryRoot: string;
  readonly repositoryRevision: string | null;
  readonly maxSourceFileBytes?: number;
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
  );
}

async function assertRepositoryDirectory(repositoryRoot: string): Promise<string> {
  const absoluteRoot = resolve(repositoryRoot);
  let metadata;
  try {
    metadata = await stat(absoluteRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw new RepositoryInputError(
        'REPOSITORY_UNREADABLE',
        `Repository directory cannot be inspected: ${absoluteRoot}`,
      );
    }
    throw new RepositoryInputError(
      'REPOSITORY_NOT_FOUND',
      `Repository directory does not exist: ${absoluteRoot}`,
    );
  }

  if (!metadata.isDirectory()) {
    throw new RepositoryInputError(
      'REPOSITORY_NOT_DIRECTORY',
      `Repository path is not a directory: ${absoluteRoot}`,
    );
  }

  return absoluteRoot;
}

function normalizedSkipPath(repositoryRoot: string, absolutePath: string): string {
  return normalizeRepositoryRelativePath(repositoryRoot, absolutePath);
}

export async function inventoryRepository(options: InventoryOptions): Promise<RepositoryInventory> {
  const repositoryRoot = await assertRepositoryDirectory(options.repositoryRoot);
  const realRepositoryRoot = await realpath(repositoryRoot);
  const maximumBytes = options.maxSourceFileBytes ?? DEFAULT_MAX_SOURCE_FILE_BYTES;

  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError('Maximum source-file size must be a positive integer.');
  }

  const sourceFiles: InventorySourceFile[] = [];
  const skippedEntries: InventorySkip[] = [];

  const visitDirectory = async (directoryPath: string, isRepositoryRoot = false): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      if (isRepositoryRoot) {
        throw new RepositoryInputError(
          'REPOSITORY_UNREADABLE',
          `Repository directory cannot be read: ${directoryPath}`,
        );
      }
      skippedEntries.push({
        path: normalizedSkipPath(repositoryRoot, directoryPath),
        reason: 'unreadable',
      });
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = resolve(directoryPath, entry.name);
      const relativePath = normalizedSkipPath(repositoryRoot, absolutePath);

      let entryMetadata;
      try {
        entryMetadata = await lstat(absolutePath);
      } catch {
        skippedEntries.push({ path: relativePath, reason: 'unreadable' });
        continue;
      }

      if (entryMetadata.isSymbolicLink()) {
        try {
          const target = await realpath(absolutePath);
          skippedEntries.push({
            path: relativePath,
            reason: isContainedPath(realRepositoryRoot, target)
              ? 'symbolic_link'
              : 'symlink_outside_repository',
          });
        } catch {
          skippedEntries.push({ path: relativePath, reason: 'unreadable' });
        }
        continue;
      }

      if (entryMetadata.isDirectory()) {
        if (isExcludedDirectoryName(entry.name)) {
          skippedEntries.push({ path: relativePath, reason: 'excluded_directory' });
          continue;
        }
        await visitDirectory(absolutePath);
        continue;
      }

      if (!entryMetadata.isFile()) {
        skippedEntries.push({ path: relativePath, reason: 'unsupported_extension' });
        continue;
      }

      if (!isTypeScriptSourcePath(entry.name)) {
        skippedEntries.push({ path: relativePath, reason: 'unsupported_extension' });
        continue;
      }

      if (entryMetadata.size > maximumBytes) {
        skippedEntries.push({ path: relativePath, reason: 'oversized' });
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = await readFile(absolutePath);
      } catch {
        skippedEntries.push({ path: relativePath, reason: 'unreadable' });
        continue;
      }

      if (bytes.includes(0)) {
        skippedEntries.push({ path: relativePath, reason: 'binary' });
        continue;
      }

      const contentHash = hashContent(bytes);
      sourceFiles.push({
        absolutePath,
        bytes,
        text: bytes.toString('utf8'),
        record: {
          id: makeSourceFileId(relativePath, options.repositoryRevision),
          path: relativePath,
          contentHash,
          byteLength: bytes.byteLength,
        },
      });
    }
  };

  await visitDirectory(repositoryRoot, true);

  return {
    repositoryRoot,
    sourceFiles: sourceFiles.sort((left, right) =>
      left.record.path.localeCompare(right.record.path),
    ),
    skippedEntries: skippedEntries.sort((left, right) =>
      `${left.path}:${left.reason}`.localeCompare(`${right.path}:${right.reason}`),
    ),
  };
}
