import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface AtomicTextFile {
  readonly path: string;
  readonly contents: string;
}

interface PreparedTextFile extends AtomicTextFile {
  readonly temporaryPath: string;
}

export async function writeTextFilesAtomically(
  files: readonly AtomicTextFile[],
  signal?: AbortSignal,
): Promise<void> {
  const destinations = new Set<string>();
  const prepared: PreparedTextFile[] = [];

  try {
    for (const file of files) {
      signal?.throwIfAborted();
      const destination = resolve(file.path);
      if (destinations.has(destination)) {
        throw new Error(`Refusing to write the same artifact path twice: ${destination}`);
      }
      destinations.add(destination);
      await mkdir(dirname(destination), { recursive: true });
      const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
      prepared.push({ path: destination, contents: file.contents, temporaryPath });
      await writeFile(temporaryPath, file.contents, {
        encoding: 'utf8',
        ...(signal === undefined ? {} : { signal }),
      });
    }

    signal?.throwIfAborted();
    // Once commit begins, ignore cancellation so every prepared file reaches a complete
    // destination. Canonical analysis is supplied last by the bundle writer.
    for (const file of prepared) await rename(file.temporaryPath, file.path);
  } catch (error) {
    await Promise.all(prepared.map((file) => rm(file.temporaryPath, { force: true })));
    throw error;
  }
}
