import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryDirectory {
  readonly path: string;
  cleanup(): Promise<void>;
}

export async function createTemporaryDirectory(): Promise<TemporaryDirectory> {
  const path = await mkdtemp(join(tmpdir(), 'api-intel-test-'));

  return {
    path,
    async cleanup() {
      await rm(path, { recursive: true, force: true });
    },
  };
}
